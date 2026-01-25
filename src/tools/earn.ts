/**
 * wallet_earn - Intent-based yield earning
 *
 * User says "earn yield on my USDC" and we:
 * 1. Find the best yield across supported protocols (Aave v3)
 * 2. Check balances across chains
 * 3. Route to the best option
 * 4. Execute deposit after confirmation
 *
 * Powered by DeFiLlama for yield discovery + Aave v3 adapter
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import {
  getTransactionsForPosition,
  calculateEarnings,
  loadYieldHistory,
} from "../storage/yield-history.js";
import {
  getYieldOpportunities,
  createYieldPlan,
  createWithdrawPlan,
  executeYieldDeposit,
  executeYieldWithdraw,
  getYieldPositions,
  getTokenBalance,
  getBalances,
  encodeApproveCalldata,
  resolveToken,
  sendTransaction,
  checkGasForTransaction,
  executeSwap,
  type SupportedChain,
  type YieldOpportunity,
  type YieldPlan,
} from "../para/client.js";

const SUPPORTED_CHAINS = ["base", "arbitrum"] as const; // MVP chains

// Estimated gas units for common operations
const GAS_ESTIMATES = {
  approve: 65000n,
  deposit: 200000n,
  withdraw: 180000n,
};

/**
 * Pre-flight gas check with auto-swap capability
 */
async function ensureGasForOperation(
  chain: SupportedChain,
  operation: "approve" | "deposit" | "withdraw"
): Promise<{ ready: boolean; message?: string; swapExecuted?: boolean }> {
  const gasUnits = GAS_ESTIMATES[operation];

  try {
    const gasCheck = await checkGasForTransaction(chain, gasUnits);

    if (gasCheck.hasEnoughGas) {
      return { ready: true };
    }

    // Not enough gas - check if we can auto-swap
    if (gasCheck.suggestedSwap && gasCheck.suggestedSwap.swapQuote) {
      const swap = gasCheck.suggestedSwap;
      const quote = swap.swapQuote;
      if (!quote) {
        return { ready: false, message: "No swap quote available for gas" };
      }

      console.log(`[clara] Auto-swapping ${swap.fromAmount} ${swap.fromToken} to ETH for gas...`);

      try {
        const swapResult = await executeSwap(quote, chain);

        if (swapResult.status === "success" || swapResult.status === "pending") {
          return {
            ready: true,
            swapExecuted: true,
            message: `⛽ Auto-swapped ${swap.fromAmount} ${swap.fromToken} → ETH for gas (tx: ${swapResult.txHash?.slice(0, 10)}...)`
          };
        } else {
          return {
            ready: false,
            message: `❌ Gas swap status: ${swapResult.status}. You need ~${gasCheck.estimatedGasUsd} of ETH for gas.`
          };
        }
      } catch (swapError) {
        return {
          ready: false,
          message: `❌ Gas swap failed: ${swapError instanceof Error ? swapError.message : "Unknown error"}. You need ~${gasCheck.estimatedGasUsd} of ETH for gas.`
        };
      }
    }

    // No tokens available to swap for gas
    if (gasCheck.availableForSwap && gasCheck.availableForSwap.length > 0) {
      return {
        ready: false,
        message: `❌ Insufficient gas (need ~$${gasCheck.estimatedGasUsd})\n\nYou have ${gasCheck.nativeBalance} ${gasCheck.nativeSymbol} but need more.\nAvailable to swap: ${gasCheck.availableForSwap.map(t => `${t.balance} ${t.symbol}`).join(", ")}`
      };
    }

    return {
      ready: false,
      message: `❌ Insufficient gas\n\nYou have ${gasCheck.nativeBalance} ${gasCheck.nativeSymbol} but need ~$${gasCheck.estimatedGasUsd} for this transaction.\n\nFund your wallet with ETH or a stablecoin (USDC, USDT, DAI) to continue.`
    };
  } catch (error) {
    console.error("[clara] Gas check failed:", error);
    return { ready: true };
  }
}

export function registerEarnTool(server: McpServer) {
  server.registerTool(
    "wallet_earn",
    {
      description: `Earn yield on your tokens by depositing into lending protocols.

Clara automatically finds the best yield across Aave v3 and Compound v3 on Base and Arbitrum.

**Check your positions:**
- action="positions" → Shows current deposits with earnings breakdown

**View transaction history:**
- action="history" → Shows all deposits/withdrawals
- action="history", asset="USDC" → Filter by asset

**Get a deposit plan:**
- asset="USDC" → Shows best yield opportunity with chain recommendation
- asset="USDC", amount="100" → Creates a deposit plan

**Execute deposit:**
- action="deposit", asset="USDC", amount="100" → Deposits (auto-swaps for gas if needed)

**Withdraw:**
- action="withdraw", asset="USDC", amount="50", chain="base" → Withdraw specific amount
- action="withdraw", asset="USDC", amount="all", chain="base" → Withdraw everything

Supported: USDC, USDT, DAI on Base and Arbitrum (Aave v3, Compound v3)`,
      inputSchema: {
        asset: z.string().optional().describe("Token to earn yield on (e.g., USDC, USDT, DAI)"),
        amount: z.string().optional().describe("Amount to deposit/withdraw (omit to just see rates, use 'all' to withdraw everything)"),
        action: z.enum(["plan", "deposit", "withdraw", "positions", "history"]).optional().default("plan").describe("plan = show opportunity, deposit = execute deposit, withdraw = execute withdrawal, positions = show current deposits, history = show transaction history"),
        chain: z.enum(SUPPORTED_CHAINS).optional().describe("Specific chain (required for withdraw)"),
      },
    },
    async (args) => {
      const { asset, amount, action = "plan", chain } = args;

      try {
        const session = await getSession();

        if (!session?.authenticated || !session.address) {
          return {
            content: [{ type: "text" as const, text: `❌ No wallet configured. Run wallet_setup first.` }]
          };
        }

        const chains: SupportedChain[] = chain ? [chain] : ["base", "arbitrum"];

        if (action === "positions") {
          return await showPositions(chains);
        }

        if (action === "history") {
          return await showTransactionHistory(asset);
        }

        if (action === "withdraw") {
          if (!asset) {
            return { content: [{ type: "text" as const, text: `❌ Please specify which asset to withdraw (e.g., asset="USDC")` }] };
          }
          if (!chain) {
            return { content: [{ type: "text" as const, text: `❌ Please specify which chain to withdraw from (e.g., chain="base")` }] };
          }
          return await handleWithdraw(asset, amount || "all", chain);
        }

        if (!asset) {
          return { content: [{ type: "text" as const, text: `❌ Please specify which asset (e.g., asset="USDC")\n\nOr use action="positions" to see your current deposits.` }] };
        }

        if (!amount) {
          return await showYieldOpportunities(asset, chains);
        }

        // Check balance first
        const balanceCheck = await checkAssetBalance(asset, amount, chains, session.address);
        if (!balanceCheck.sufficient) {
          // Build a helpful error message with diagnostics
          const lines: string[] = [
            `❌ Insufficient ${asset.toUpperCase()} balance`,
            "",
            `You want to deposit: ${amount} ${asset.toUpperCase()}`,
          ];

          // Show balances found across chains
          const nonZeroBalances = Object.entries(balanceCheck.balancesByChain)
            .filter(([_, bal]) => parseFloat(bal) > 0);

          if (nonZeroBalances.length > 0) {
            lines.push("");
            lines.push("Your balances:");
            for (const [chain, bal] of nonZeroBalances) {
              lines.push(`  • ${chain}: ${bal} ${asset.toUpperCase()}`);
            }
          } else {
            lines.push(`Your balance: 0 ${asset.toUpperCase()}`);
          }

          // Add helpful suggestions
          lines.push("");
          lines.push("💡 To get " + asset.toUpperCase() + ":");
          lines.push("  • Swap: wallet_swap fromToken=\"ETH\" toToken=\"" + asset.toUpperCase() + "\" amount=\"0.01\" chain=\"base\"");
          lines.push("  • Bridge: wallet_bridge fromToken=\"" + asset.toUpperCase() + "\" toToken=\"" + asset.toUpperCase() + "\" fromChain=\"ethereum\" toChain=\"base\"");
          lines.push("  • Receive: Send " + asset.toUpperCase() + " to " + session.address);

          return {
            content: [{
              type: "text" as const,
              text: lines.join("\n")
            }]
          };
        }

        // Create a deposit plan
        const plan = await createYieldPlan(asset, amount, chains);

        if (!plan) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ No yield opportunities found for ${asset.toUpperCase()}\n\nSupported assets: USDC, USDT, DAI on Base and Arbitrum`
            }]
          };
        }

        const planDisplay = formatPlan(plan);

        if (action === "plan") {
          return { content: [{ type: "text" as const, text: planDisplay + "\n\nTo deposit, run again with action=\"deposit\"" }] };
        }

        // Execute the deposit
        const outputLines: string[] = [planDisplay, ""];

        if (plan.needsApproval) {
          const gasResult = await ensureGasForOperation(plan.chain, "approve");
          if (!gasResult.ready) {
            return { content: [{ type: "text" as const, text: planDisplay + "\n\n" + (gasResult.message || "Insufficient gas for approval") }] };
          }
          if (gasResult.swapExecuted && gasResult.message) {
            outputLines.push(gasResult.message, "");
          }
          return await handleApproval(plan, outputLines);
        }

        const gasResult = await ensureGasForOperation(plan.chain, "deposit");
        if (!gasResult.ready) {
          return { content: [{ type: "text" as const, text: planDisplay + "\n\n" + (gasResult.message || "Insufficient gas for deposit") }] };
        }
        if (gasResult.swapExecuted && gasResult.message) {
          outputLines.push(gasResult.message, "");
        }

        const result = await executeYieldDeposit(plan);

        outputLines.push(
          `✅ Deposit submitted!`,
          "",
          `Transaction: ${result.txHash}`,
          `Status: ${result.status}`,
          "",
          `Your ${plan.asset} is now earning ${plan.apy.toFixed(2)}% APY on ${plan.protocol}.`
        );

        return { content: [{ type: "text" as const, text: outputLines.join("\n") }] };

      } catch (error) {
        console.error("wallet_earn error:", error);
        return { content: [{ type: "text" as const, text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}` }] };
      }
    }
  );
}

/**
 * Show available yield opportunities
 */
async function showYieldOpportunities(
  asset: string,
  chains: SupportedChain[]
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const opportunities = await getYieldOpportunities(asset, { chains });

  if (opportunities.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: `📊 Yield Opportunities for ${asset.toUpperCase()}\n\nNo opportunities found on ${chains.join(", ")}.\n\nSupported assets: USDC, USDT, DAI\nSupported protocols: Aave v3, Compound v3`
      }]
    };
  }

  const session = await getSession();
  const balanceByChain: Record<string, number> = {};

  if (session?.address) {
    await Promise.all(
      chains.map(async (chain) => {
        try {
          const balance = await getTokenBalance(asset, chain, session.address!);
          balanceByChain[chain] = parseFloat(balance.balance);
        } catch {
          balanceByChain[chain] = 0;
        }
      })
    );
  }

  // Sort by APY
  opportunities.sort((a, b) => b.apyTotal - a.apyTotal);
  const best = opportunities[0];

  const lines: string[] = [
    `📊 Yield Opportunities for ${asset.toUpperCase()}`,
    "",
    `┌─────────────────────────────────────────────────────────────┐`,
    `│  💡 RECOMMENDATION                                          │`,
    `│                                                             │`,
    `│  ${capitalizeFirst(best.chain)} offers the best rate: ${best.apyTotal.toFixed(2)}% APY`.padEnd(62) + `│`,
    `└─────────────────────────────────────────────────────────────┘`,
    "",
    `All options (sorted by APY):`,
    "",
  ];

  for (let i = 0; i < Math.min(opportunities.length, 5); i++) {
    const opp = opportunities[i];
    const rank = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const balance = balanceByChain[opp.chain] || 0;
    const balanceTag = balance > 0 ? ` [${balance.toFixed(2)} available]` : "";
    lines.push(`${rank} ${opp.protocol} on ${capitalizeFirst(opp.chain)}: ${opp.apyTotal.toFixed(2)}% APY${balanceTag}`);
  }

  lines.push("");
  lines.push(`To deposit, specify an amount: asset="${asset}", amount="100"`);

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

interface BalanceCheckResult {
  sufficient: boolean;
  balance: string;
  chain?: SupportedChain;
  tokenAddress?: string;
  chainsChecked: SupportedChain[];
  balancesByChain: Record<string, string>;
}

/**
 * Check if user has sufficient balance
 * Returns detailed info for better error messages
 */
async function checkAssetBalance(
  asset: string,
  amount: string,
  chains: SupportedChain[],
  address: string
): Promise<BalanceCheckResult> {
  const amountNum = parseFloat(amount);
  const balancesByChain: Record<string, string> = {};
  const chainsChecked: SupportedChain[] = [];

  for (const chain of chains) {
    try {
      if (asset.toUpperCase() === "ETH") {
        const balances = await getBalances(chain);
        const balance = parseFloat(balances[0]?.balance || "0");
        balancesByChain[chain] = balances[0]?.balance || "0";
        chainsChecked.push(chain);
        if (balance >= amountNum) {
          return { sufficient: true, balance: balances[0]?.balance || "0", chain, chainsChecked, balancesByChain };
        }
        continue;
      }

      // Resolve symbol to token address before checking balance
      const resolved = resolveToken(asset, chain);
      if (!resolved) {
        // Token not supported on this chain, try next
        continue;
      }

      chainsChecked.push(chain);
      const tokenBalance = await getTokenBalance(resolved.address, chain, address);
      const balance = parseFloat(tokenBalance.balance);
      balancesByChain[chain] = tokenBalance.balance;

      if (balance >= amountNum) {
        return { sufficient: true, balance: tokenBalance.balance, chain, tokenAddress: resolved.address, chainsChecked, balancesByChain };
      }
    } catch {
      chainsChecked.push(chain);
      balancesByChain[chain] = "error";
      continue;
    }
  }

  // Return the balance from the first chain where the token exists
  for (const chain of chains) {
    try {
      const resolved = resolveToken(asset, chain);
      if (resolved) {
        const tokenBalance = await getTokenBalance(resolved.address, chain, address);
        return { sufficient: false, balance: tokenBalance.balance, chain, tokenAddress: resolved.address, chainsChecked, balancesByChain };
      }
    } catch {
      continue;
    }
  }

  return { sufficient: false, balance: "0", chainsChecked, balancesByChain };
}

/**
 * Format a yield plan for display
 */
function formatPlan(plan: YieldPlan): string {
  const tvlStr = (plan.tvlUsd / 1_000_000).toFixed(1);

  const lines: string[] = [
    `💰 Yield Deposit Plan`,
    "",
    `**You deposit:** ${plan.amount} ${plan.asset}`,
    `**Protocol:** ${plan.protocol} on ${capitalizeFirst(plan.chain)}`,
    `**APY:** ${plan.apy.toFixed(2)}%`,
    `**Pool TVL:** $${tvlStr}M`,
    `**Est. Gas:** ~$${plan.estimatedGasUsd}`,
  ];

  if (plan.needsApproval) {
    lines.push("");
    lines.push(`🔐 Approval required: You need to approve ${plan.asset} for ${plan.protocol} first.`);
  }

  const annualEarnings = parseFloat(plan.amount) * (plan.apy / 100);
  lines.push("");
  lines.push(`📈 Estimated annual earnings: ~${annualEarnings.toFixed(2)} ${plan.asset}`);

  return lines.join("\n");
}

/**
 * Handle the approval flow
 */
async function handleApproval(
  plan: YieldPlan,
  prefixLines: string[] = []
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!plan.approvalAddress) {
    return { content: [{ type: "text" as const, text: `❌ Approval address not available.` }] };
  }

  const lines: string[] = [
    ...prefixLines,
    `🔐 Approval Required`,
    "",
    `Token: ${plan.asset}`,
    `Spender: ${plan.protocol} (${plan.approvalAddress.slice(0, 8)}...)`,
    `Amount: ${plan.amount} ${plan.asset}`,
    "",
    `⏳ Sending approval transaction...`,
  ];

  try {
    const decimals = plan.asset === "USDC" || plan.asset === "USDT" ? 6 : 18;
    const approvalData = encodeApproveCalldata(plan.approvalAddress, plan.amount, decimals);

    const result = await sendTransaction(
      plan.assetAddress,
      "0",
      plan.chain,
      undefined,
      approvalData
    );

    lines.push("");
    lines.push(`✅ Approval submitted: ${result.txHash}`);
    lines.push("");
    lines.push(`⏳ Wait for confirmation, then run the deposit command again.`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    return { content: [{ type: "text" as const, text: `❌ Approval failed: ${error instanceof Error ? error.message : "Unknown error"}` }] };
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Show user's current yield positions
 */
async function showPositions(
  chains: SupportedChain[]
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const session = await getSession();
    const positions = await getYieldPositions(chains);

    if (positions.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `📊 Your Yield Positions\n\nNo active positions found.\n\nTo start earning yield, try:\n• asset="USDC" to see rates\n• asset="USDC", amount="100" to create a deposit plan`
        }]
      };
    }

    const lines: string[] = [`📊 Your Yield Positions`, ""];
    let totalCurrentValue = 0;
    let totalEarned = 0;

    for (const pos of positions) {
      const currentBalance = parseFloat(pos.deposited);
      totalCurrentValue += currentBalance;

      let earnings = { netDeposited: currentBalance, earnedYield: 0, earnedYieldPercent: 0, periodDays: 0, effectiveApy: null as number | null };

      if (session?.address) {
        const transactions = await getTransactionsForPosition(session.address, pos.asset, pos.chain, pos.protocol);
        if (transactions.length > 0) {
          earnings = calculateEarnings(transactions, currentBalance);
          totalEarned += earnings.earnedYield;
        }
      }

      lines.push(`┌─────────────────────────────────────────────────────────────┐`);
      lines.push(`│  ${pos.asset} on ${capitalizeFirst(pos.chain)} (${pos.protocol})`.padEnd(62) + `│`);
      lines.push(`├─────────────────────────────────────────────────────────────┤`);
      lines.push(`│  Current Balance: ${currentBalance.toFixed(2)} ${pos.asset}`.padEnd(62) + `│`);

      if (earnings.periodDays > 0) {
        const periodStr = earnings.periodDays >= 1 ? `${Math.floor(earnings.periodDays)}d` : `${Math.floor(earnings.periodDays * 24)}h`;
        lines.push(`│  Original Deposit: ${earnings.netDeposited.toFixed(2)} ${pos.asset}`.padEnd(62) + `│`);
        const earnedSign = earnings.earnedYield >= 0 ? "+" : "";
        lines.push(`│  📈 Yield Earned: ${earnedSign}${earnings.earnedYield.toFixed(4)} ${pos.asset}`.padEnd(62) + `│`);
        lines.push(`│  ⏱️  Period: ${periodStr}`.padEnd(62) + `│`);
        if (earnings.effectiveApy !== null) {
          lines.push(`│  📊 Effective APY: ${earnings.effectiveApy.toFixed(2)}%`.padEnd(62) + `│`);
        }
      } else {
        lines.push(`│  📊 Current APY: ${pos.currentApy.toFixed(2)}%`.padEnd(62) + `│`);
      }

      lines.push(`└─────────────────────────────────────────────────────────────┘`);
      lines.push("");
    }

    if (positions.length > 1 || totalEarned > 0) {
      lines.push(`TOTAL: $${totalCurrentValue.toFixed(2)} | Earned: +$${totalEarned.toFixed(4)}`);
      lines.push("");
    }

    lines.push(`To withdraw: action="withdraw", asset="USDC", chain="base"`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    return { content: [{ type: "text" as const, text: `❌ Error fetching positions: ${error instanceof Error ? error.message : "Unknown error"}` }] };
  }
}

/**
 * Handle withdrawal from yield protocol
 */
async function handleWithdraw(
  asset: string,
  amount: string,
  chain: SupportedChain
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const plan = await createWithdrawPlan(asset, amount, chain);

    if (!plan) {
      return { content: [{ type: "text" as const, text: `❌ Cannot create withdrawal plan for ${asset.toUpperCase()} on ${capitalizeFirst(chain)}. Use action="positions" to see your current deposits.` }] };
    }

    const isWithdrawAll = amount === "all" || amount === "max";
    const lines: string[] = [
      `💸 Withdraw from ${plan.protocol}`,
      "",
      `**You withdraw:** ${isWithdrawAll ? "All" : plan.amount} ${plan.asset}`,
      `**From:** ${plan.protocol} on ${capitalizeFirst(plan.chain)}`,
      `**Est. Gas:** ~$${plan.estimatedGasUsd}`,
      "",
    ];

    const gasResult = await ensureGasForOperation(plan.chain, "withdraw");
    if (!gasResult.ready) {
      return { content: [{ type: "text" as const, text: lines.join("\n") + "\n" + (gasResult.message || "Insufficient gas for withdrawal") }] };
    }
    if (gasResult.swapExecuted && gasResult.message) {
      lines.push(gasResult.message, "");
    }

    lines.push(`⏳ Executing withdrawal...`);
    const result = await executeYieldWithdraw(plan);

    lines.push("");
    lines.push(`✅ Withdrawal submitted!`);
    lines.push("");
    lines.push(`Transaction: ${result.txHash}`);
    lines.push(`Status: ${result.status}`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    return { content: [{ type: "text" as const, text: `❌ Withdrawal failed: ${error instanceof Error ? error.message : "Unknown error"}` }] };
  }
}

/**
 * Show transaction history
 */
async function showTransactionHistory(
  assetFilter?: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const session = await getSession();

    if (!session?.address) {
      return { content: [{ type: "text" as const, text: `❌ No wallet configured. Run wallet_setup first.` }] };
    }

    const history = await loadYieldHistory(session.address);

    if (history.transactions.length === 0) {
      return { content: [{ type: "text" as const, text: `📜 Yield Transaction History\n\nNo transactions recorded yet.` }] };
    }

    let transactions = history.transactions;
    if (assetFilter) {
      transactions = transactions.filter(tx => tx.asset.toUpperCase() === assetFilter.toUpperCase());
    }

    transactions = transactions.sort((a, b) => b.timestamp - a.timestamp);

    const lines: string[] = [
      `📜 Yield Transaction History`,
      assetFilter ? `   Filtered by: ${assetFilter.toUpperCase()}` : "",
      "",
    ];

    const displayTxs = transactions.slice(0, 20);

    for (const tx of displayTxs) {
      const date = new Date(tx.timestamp);
      const dateStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
      const actionEmoji = tx.action === "deposit" ? "📥" : "📤";
      const amountStr = parseFloat(tx.amount).toFixed(2);
      lines.push(`${dateStr} ${actionEmoji} ${tx.action} ${amountStr} ${tx.asset} (${tx.protocol}/${capitalizeFirst(tx.chain)})`);
    }

    if (transactions.length > 20) {
      lines.push("");
      lines.push(`Showing 20 of ${transactions.length} transactions.`);
    }

    const deposits = transactions.filter(tx => tx.action === "deposit");
    const withdrawals = transactions.filter(tx => tx.action === "withdraw");
    const totalDeposited = deposits.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    const totalWithdrawn = withdrawals.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

    lines.push("");
    lines.push(`Summary: ${deposits.length} deposits ($${totalDeposited.toFixed(2)}) | ${withdrawals.length} withdrawals ($${totalWithdrawn.toFixed(2)})`);

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    return { content: [{ type: "text" as const, text: `❌ Error fetching history: ${error instanceof Error ? error.message : "Unknown error"}` }] };
  }
}
