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
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { getYieldOpportunities, createYieldPlan, createWithdrawPlan, executeYieldDeposit, executeYieldWithdraw, getYieldPositions, formatYieldOpportunity, getTokenBalance, getBalances, encodeApproveCalldata, sendTransaction, } from "../para/client.js";
const SUPPORTED_CHAINS = ["base", "arbitrum"]; // MVP chains
export function registerEarnTool(server) {
    server.registerTool("wallet_earn", {
        description: `Earn yield on your tokens by depositing into lending protocols.

Clara automatically finds the best yield across Aave v3 on Base and Arbitrum.

**Check your positions:**
- action="positions" → Shows your current deposits earning yield

**Get a deposit plan:**
- asset="USDC" → Shows best yield opportunity with APY
- asset="USDC", amount="100" → Creates a deposit plan

**Execute deposit:**
- action="deposit", asset="USDC", amount="100" → Deposits after confirmation

**Withdraw:**
- action="withdraw", asset="USDC", amount="50", chain="base" → Withdraw specific amount
- action="withdraw", asset="USDC", amount="all", chain="base" → Withdraw everything

**Examples:**
- "Earn yield on my USDC" → Finds best rate, shows plan
- "Deposit 100 USDC for yield" → Creates plan, asks for confirmation
- "Where can I get the best yield on USDC?" → Shows all options
- "Show my yield positions" → Lists all deposits earning yield
- "Withdraw my USDC from Aave" → Withdraws from protocol

Supported: USDC, USDT, DAI on Base and Arbitrum (Aave v3)`,
        inputSchema: {
            asset: z.string().optional().describe("Token to earn yield on (e.g., USDC, USDT, DAI)"),
            amount: z.string().optional().describe("Amount to deposit/withdraw (omit to just see rates, use 'all' to withdraw everything)"),
            action: z.enum(["plan", "deposit", "withdraw", "positions"]).optional().default("plan").describe("plan = show opportunity, deposit = execute deposit, withdraw = execute withdrawal, positions = show current deposits"),
            chain: z.enum(SUPPORTED_CHAINS).optional().describe("Specific chain (required for withdraw)"),
        },
    }, async (args) => {
        const { asset, amount, action = "plan", chain } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured. Run wallet_setup first.`
                        }]
                };
            }
            const chains = chain ? [chain] : ["base", "arbitrum"];
            // Handle positions action
            if (action === "positions") {
                return await showPositions(chains);
            }
            // Handle withdraw action
            if (action === "withdraw") {
                if (!asset) {
                    return {
                        content: [{
                                type: "text",
                                text: `❌ Please specify which asset to withdraw (e.g., asset="USDC")`
                            }]
                    };
                }
                if (!chain) {
                    return {
                        content: [{
                                type: "text",
                                text: `❌ Please specify which chain to withdraw from (e.g., chain="base" or chain="arbitrum")`
                            }]
                    };
                }
                return await handleWithdraw(asset, amount || "all", chain);
            }
            // For deposit actions, asset is required
            if (!asset) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Please specify which asset (e.g., asset="USDC")\n\n` +
                                `Or use action="positions" to see your current deposits.`
                        }]
                };
            }
            // If no amount, just show opportunities
            if (!amount) {
                return await showYieldOpportunities(asset, chains);
            }
            // Check balance first
            const balanceCheck = await checkAssetBalance(asset, amount, chains, session.address);
            if (!balanceCheck.sufficient) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Insufficient ${asset.toUpperCase()} balance\n\n` +
                                `You want to deposit: ${amount} ${asset.toUpperCase()}\n` +
                                `Your balance: ${balanceCheck.balance} ${asset.toUpperCase()} on ${balanceCheck.chain || "available chains"}\n\n` +
                                `Add more ${asset.toUpperCase()} or reduce the amount.`
                        }]
                };
            }
            // Create a deposit plan
            const plan = await createYieldPlan(asset, amount, chains);
            if (!plan) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No yield opportunities found for ${asset.toUpperCase()}\n\n` +
                                `This could mean:\n` +
                                `• The asset isn't supported on our configured protocols\n` +
                                `• TVL is below our safety threshold ($1M minimum)\n\n` +
                                `Supported assets: USDC, USDT, DAI on Base and Arbitrum`
                        }]
                };
            }
            // Format the plan
            const planDisplay = formatPlan(plan);
            if (action === "plan") {
                return {
                    content: [{
                            type: "text",
                            text: planDisplay + "\n\n" +
                                `To deposit, run again with action="deposit"`
                        }]
                };
            }
            // Execute the deposit
            if (plan.needsApproval) {
                return await handleApproval(plan);
            }
            const result = await executeYieldDeposit(plan);
            return {
                content: [{
                        type: "text",
                        text: planDisplay + "\n\n" +
                            `✅ Deposit submitted!\n\n` +
                            `Transaction: ${result.txHash}\n` +
                            `Status: ${result.status}\n\n` +
                            `Your ${plan.asset} is now earning ${plan.apy.toFixed(2)}% APY on ${plan.protocol}.`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_earn error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
/**
 * Show available yield opportunities
 */
async function showYieldOpportunities(asset, chains) {
    const opportunities = await getYieldOpportunities(asset, { chains });
    if (opportunities.length === 0) {
        return {
            content: [{
                    type: "text",
                    text: `📊 Yield Opportunities for ${asset.toUpperCase()}\n\n` +
                        `No opportunities found on ${chains.join(", ")}.\n\n` +
                        `Supported assets: USDC, USDT, DAI\n` +
                        `Supported protocols: Aave v3`
                }]
        };
    }
    const lines = [
        `📊 Yield Opportunities for ${asset.toUpperCase()}`,
        "",
        `Found ${opportunities.length} option${opportunities.length > 1 ? "s" : ""}:`,
        "",
    ];
    for (let i = 0; i < Math.min(opportunities.length, 5); i++) {
        const opp = opportunities[i];
        const rank = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        lines.push(`${rank} ${formatYieldOpportunity(opp)}`);
    }
    lines.push("");
    lines.push(`To deposit, specify an amount: asset="${asset}", amount="100"`);
    return {
        content: [{
                type: "text",
                text: lines.join("\n")
            }]
    };
}
/**
 * Check if user has sufficient balance on any of the target chains
 */
async function checkAssetBalance(asset, amount, chains, address) {
    const amountNum = parseFloat(amount);
    for (const chain of chains) {
        try {
            // Check if it's a native token
            if (asset.toUpperCase() === "ETH") {
                const balances = await getBalances(chain);
                const balance = parseFloat(balances[0]?.balance || "0");
                if (balance >= amountNum) {
                    return { sufficient: true, balance: balances[0]?.balance || "0", chain };
                }
                continue;
            }
            // Check ERC-20 token
            const tokenBalance = await getTokenBalance(asset, chain, address);
            const balance = parseFloat(tokenBalance.balance);
            if (balance >= amountNum) {
                return { sufficient: true, balance: tokenBalance.balance, chain };
            }
        }
        catch {
            // Skip chains where we can't check balance
            continue;
        }
    }
    // Return the first chain's balance info for the error message
    try {
        const tokenBalance = await getTokenBalance(asset, chains[0], address);
        return { sufficient: false, balance: tokenBalance.balance, chain: chains[0] };
    }
    catch {
        return { sufficient: false, balance: "0" };
    }
}
/**
 * Format a yield plan for display
 */
function formatPlan(plan) {
    const tvlStr = (plan.tvlUsd / 1_000_000).toFixed(1);
    const lines = [
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
    // Annual earnings estimate
    const annualEarnings = parseFloat(plan.amount) * (plan.apy / 100);
    lines.push("");
    lines.push(`📈 Estimated annual earnings: ~${annualEarnings.toFixed(2)} ${plan.asset}`);
    return lines.join("\n");
}
/**
 * Handle the approval flow
 */
async function handleApproval(plan) {
    if (!plan.approvalAddress) {
        return {
            content: [{
                    type: "text",
                    text: `❌ Approval address not available. Please try again.`
                }]
        };
    }
    const lines = [
        `🔐 Approval Required`,
        "",
        `Before depositing, you need to approve ${plan.protocol} to use your ${plan.asset}.`,
        "",
        `Token: ${plan.asset}`,
        `Spender: ${plan.protocol} (${plan.approvalAddress.slice(0, 8)}...)`,
        `Amount: ${plan.amount} ${plan.asset}`,
        "",
        `⏳ Sending approval transaction...`,
    ];
    try {
        // Get token decimals
        const decimals = plan.asset === "USDC" || plan.asset === "USDT" ? 6 : 18;
        // Encode exact-amount approval (not unlimited, for safety)
        const approvalData = encodeApproveCalldata(plan.approvalAddress, plan.amount, decimals);
        // Send approval
        const result = await sendTransaction(plan.assetAddress, "0", plan.chain, undefined, approvalData);
        lines.push("");
        lines.push(`✅ Approval submitted: ${result.txHash}`);
        lines.push("");
        lines.push(`⏳ Wait for confirmation, then run the deposit command again.`);
        return {
            content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: `❌ Approval failed: ${error instanceof Error ? error.message : "Unknown error"}`
                }]
        };
    }
}
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
/**
 * Show user's current yield positions
 */
async function showPositions(chains) {
    try {
        const positions = await getYieldPositions(chains);
        if (positions.length === 0) {
            return {
                content: [{
                        type: "text",
                        text: `📊 Your Yield Positions\n\n` +
                            `No active positions found on ${chains.map(capitalizeFirst).join(", ")}.` +
                            `\n\nTo start earning yield, try:\n` +
                            `• asset="USDC" to see rates\n` +
                            `• asset="USDC", amount="100" to create a deposit plan`
                    }]
            };
        }
        const lines = [
            `📊 Your Yield Positions`,
            "",
        ];
        let totalDeposited = 0;
        for (const pos of positions) {
            const depositNum = parseFloat(pos.deposited);
            totalDeposited += depositNum;
            lines.push(`**${pos.asset} on ${capitalizeFirst(pos.chain)}**`);
            lines.push(`  • Deposited: ${pos.deposited} ${pos.asset}`);
            lines.push(`  • Protocol: ${pos.protocol}`);
            lines.push(`  • Current APY: ${pos.currentApy.toFixed(2)}%`);
            lines.push("");
        }
        lines.push(`---`);
        lines.push(`To withdraw, use: action="withdraw", asset="USDC", chain="base"`);
        return {
            content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: `❌ Error fetching positions: ${error instanceof Error ? error.message : "Unknown error"}`
                }]
        };
    }
}
/**
 * Handle withdrawal from yield protocol
 */
async function handleWithdraw(asset, amount, chain) {
    try {
        const plan = await createWithdrawPlan(asset, amount, chain);
        if (!plan) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Cannot create withdrawal plan for ${asset.toUpperCase()} on ${capitalizeFirst(chain)}\\n\\n` +
                            `This could mean:\\n` +
                            `• You don't have any ${asset.toUpperCase()} deposited on this chain\\n` +
                            `• The asset isn't supported\\n\\n` +
                            `Use action="positions" to see your current deposits.`
                    }]
            };
        }
        // Show the withdrawal plan
        const isWithdrawAll = amount === "all" || amount === "max";
        const lines = [
            `💸 Withdraw from ${plan.protocol}`,
            "",
            `**You withdraw:** ${isWithdrawAll ? "All" : plan.amount} ${plan.asset}`,
            `**From:** ${plan.protocol} on ${capitalizeFirst(plan.chain)}`,
            `**Est. Gas:** ~$${plan.estimatedGasUsd}`,
            "",
            `⏳ Executing withdrawal...`,
        ];
        // Execute the withdrawal
        const result = await executeYieldWithdraw(plan);
        lines.push("");
        lines.push(`✅ Withdrawal submitted!`);
        lines.push("");
        lines.push(`Transaction: ${result.txHash}`);
        lines.push(`Status: ${result.status}`);
        lines.push("");
        lines.push(`Your ${plan.asset} will arrive in your wallet shortly.`);
        return {
            content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: `❌ Withdrawal failed: ${error instanceof Error ? error.message : "Unknown error"}`
                }]
        };
    }
}
//# sourceMappingURL=earn.js.map