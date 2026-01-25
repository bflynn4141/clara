/**
 * wallet_balance - Unified balance tool
 *
 * Consolidates wallet_get_balance, wallet_token_balance, and wallet_portfolio
 * into a single smart tool with progressive disclosure:
 *
 * - No params: Full portfolio across all chains
 * - chain only: All balances on that chain
 * - token only: That token across all chains
 * - chain + token: Specific token on specific chain
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import {
  getPortfolioFast,
  formatUsd,
  formatChange,
  reverseResolveEns,
  getTokenBalance,
  getBalances,
  resolveToken,
  getSolanaAssets,
  POPULAR_TOKENS,
  type SupportedChain,
  type PortfolioItem,
} from "../para/client.js";
import {
  isZerionAvailable,
  getPortfolioZerion,
} from "../para/zerion.js";

const EVM_CHAINS: SupportedChain[] = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
const ALL_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"] as const;
const STABLECOINS_TO_CHECK = ["USDC", "USDT", "DAI"] as const;

export function registerUnifiedBalanceTool(server: McpServer) {
  server.registerTool(
    "wallet_balance",
    {
      description: `Check your wallet balances - the smart, unified balance tool.

**Usage patterns:**
- No params → Full portfolio across all chains (dashboard view)
- chain="base" → All balances on Base
- token="USDC" → USDC balance across all chains
- chain="base", token="USDC" → USDC on Base specifically

**Examples:**
- "What's my balance?" → Shows full portfolio
- "How much ETH do I have on Base?" → chain="base", token="ETH"
- "Where's my USDC?" → token="USDC" (shows all chains)
- "Check my Arbitrum wallet" → chain="arbitrum"

Supported tokens: ETH, MATIC, SOL, USDC, USDT, DAI, WETH, WBTC (or any contract address)`,
      inputSchema: {
        chain: z.enum(ALL_CHAINS)
          .optional()
          .describe("Filter by chain. Omit to show all chains."),
        token: z.string()
          .optional()
          .describe("Filter by token symbol (ETH, USDC, etc.) or contract address. Omit to show all tokens."),
        showEmpty: z.boolean()
          .optional()
          .default(false)
          .describe("Include zero balances (default: false)"),
      },
    },
    async (args) => {
      const { chain, token, showEmpty = false } = args;

      try {
        const session = await getSession();

        if (!session?.authenticated || !session.address) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ No wallet configured. Run wallet_setup first.`
            }]
          };
        }

        // Route to appropriate handler based on params
        if (!chain && !token) {
          // Full portfolio view
          return await showFullPortfolio(session.address, session.solanaAddress, showEmpty);
        } else if (chain && !token) {
          // All balances on specific chain
          return await showChainBalances(chain as SupportedChain, session.address, session.solanaAddress, showEmpty);
        } else if (!chain && token) {
          // Specific token across all chains
          return await showTokenAcrossChains(token, session.address, session.solanaAddress, showEmpty);
        } else {
          // Specific token on specific chain
          return await showSpecificBalance(chain as SupportedChain, token!, session.address, session.solanaAddress);
        }

      } catch (error) {
        console.error("wallet_balance error:", error);
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );
}

/**
 * Full portfolio view - all chains, all tokens
 */
async function showFullPortfolio(
  address: string,
  solanaAddress: string | undefined,
  showEmpty: boolean
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const portfolio = await getPortfolioFast();

  // Safety net: explicitly check stablecoins
  const stablecoinChecks = await checkStablecoins(address);
  const existingKeys = new Set(portfolio.items.map(i => `${i.chain}:${i.symbol}`));
  for (const item of stablecoinChecks) {
    const key = `${item.chain}:${item.symbol}`;
    if (!existingKeys.has(key) && parseFloat(item.balance) > 0) {
      portfolio.items.push(item);
      portfolio.totalValueUsd += item.valueUsd ?? 0;
    }
  }

  // Add Solana balances
  if (solanaAddress) {
    try {
      const solanaPortfolio = await getSolanaAssets(solanaAddress);
      if (parseFloat(solanaPortfolio.nativeBalance.balance) > 0) {
        portfolio.items.push({
          chain: "solana",
          symbol: "SOL",
          balance: solanaPortfolio.nativeBalance.balance,
          priceUsd: solanaPortfolio.nativeBalance.priceUsd,
          valueUsd: solanaPortfolio.nativeBalance.valueUsd,
          change24h: null,
        });
        portfolio.totalValueUsd += solanaPortfolio.nativeBalance.valueUsd ?? 0;
      }
      for (const token of solanaPortfolio.tokens) {
        portfolio.items.push({
          chain: "solana",
          symbol: token.symbol,
          balance: token.balance,
          priceUsd: token.priceUsd,
          valueUsd: token.valueUsd,
          change24h: null,
        });
        portfolio.totalValueUsd += token.valueUsd ?? 0;
      }
    } catch (error) {
      console.error("[wallet_balance] Failed to fetch Solana portfolio:", error);
    }
  }

  // Filter and format
  const items = showEmpty
    ? portfolio.items
    : portfolio.items.filter(item => parseFloat(item.balance) > 0);

  // Get ENS name
  const ensName = await reverseResolveEns(address).catch(() => null);
  const addressDisplay = ensName
    ? `${ensName} (${address.slice(0, 6)}...${address.slice(-4)})`
    : `${address.slice(0, 6)}...${address.slice(-4)}`;

  // Build table
  const lines: string[] = [
    `┌─────────────────────────────────────────────────────────────┐`,
    `│  📊 Portfolio Overview                                      │`,
    `│  ${addressDisplay.padEnd(55)}│`,
    `├─────────────────────────────────────────────────────────────┤`,
  ];

  if (items.length === 0) {
    lines.push(`│  No balances found across any chain.                        │`);
    lines.push(`│  Send some tokens to your address to get started!           │`);
  } else {
    lines.push(`│  Chain        │ Balance        │ Price      │ Value      │`);
    lines.push(`├───────────────┼────────────────┼────────────┼────────────┤`);

    for (const item of items) {
      const chainName = item.chain.charAt(0).toUpperCase() + item.chain.slice(1);
      const balanceStr = `${parseFloat(item.balance).toFixed(4)} ${item.symbol}`;
      const priceStr = item.priceUsd ? formatUsd(item.priceUsd) : "—";
      const valueStr = formatUsd(item.valueUsd);

      lines.push(
        `│  ${chainName.padEnd(12)} │ ${balanceStr.padEnd(14)} │ ${priceStr.padEnd(10)} │ ${valueStr.padEnd(10)} │`
      );
    }
  }

  lines.push(`├─────────────────────────────────────────────────────────────┤`);
  lines.push(`│  Total Value: ${formatUsd(portfolio.totalValueUsd).padEnd(44)}│`);

  if (portfolio.totalChange24h !== null) {
    const changeEmoji = portfolio.totalChange24h >= 0 ? "📈" : "📉";
    lines.push(`│  24h Change: ${changeEmoji} ${formatChange(portfolio.totalChange24h).padEnd(43)}│`);
  }

  lines.push(`└─────────────────────────────────────────────────────────────┘`);

  // Freshness indicator
  const now = Date.now();
  const fetchTime = new Date(portfolio.lastUpdated).getTime();
  const ageSeconds = Math.floor((now - fetchTime) / 1000);
  const timeStr = new Date(fetchTime).toLocaleTimeString();

  let ageStr: string;
  let freshIndicator: string;
  if (ageSeconds < 5) {
    ageStr = "just now";
    freshIndicator = "🟢";
  } else if (ageSeconds < 60) {
    ageStr = `${ageSeconds}s ago`;
    freshIndicator = "🟢";
  } else if (ageSeconds < 300) {
    ageStr = `${Math.floor(ageSeconds / 60)}m ago`;
    freshIndicator = "🟡";
  } else {
    ageStr = `${Math.floor(ageSeconds / 60)}m ago`;
    freshIndicator = "🟠";
  }

  lines.push(``);
  lines.push(`${freshIndicator} Last updated: ${timeStr} (${ageStr})`);

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}

/**
 * All balances on a specific chain - uses Zerion for EVM (1 call with chain filter)
 */
async function showChainBalances(
  chain: SupportedChain,
  address: string,
  solanaAddress: string | undefined,
  showEmpty: boolean
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const chainDisplay = chain.charAt(0).toUpperCase() + chain.slice(1);
  const lines: string[] = [`💰 ${chainDisplay} Balances`, ""];

  if (chain === "solana") {
    if (!solanaAddress) {
      return {
        content: [{
          type: "text" as const,
          text: `No Solana address configured for this wallet.`
        }]
      };
    }

    try {
      const solanaPortfolio = await getSolanaAssets(solanaAddress);

      if (parseFloat(solanaPortfolio.nativeBalance.balance) > 0 || showEmpty) {
        const valueStr = solanaPortfolio.nativeBalance.valueUsd
          ? ` (~$${formatUsd(solanaPortfolio.nativeBalance.valueUsd)})`
          : "";
        lines.push(`SOL: ${solanaPortfolio.nativeBalance.balance}${valueStr}`);
      }

      for (const token of solanaPortfolio.tokens) {
        if (parseFloat(token.balance) > 0 || showEmpty) {
          const valueStr = token.valueUsd ? ` (~$${formatUsd(token.valueUsd)})` : "";
          lines.push(`${token.symbol}: ${token.balance}${valueStr}`);
        }
      }

      if (lines.length === 2) {
        lines.push("No balances found on Solana.");
      }
    } catch (error) {
      lines.push(`Error fetching Solana balances: ${error instanceof Error ? error.message : "Unknown"}`);
    }
  } else {
    // EVM chain - try Zerion first, fall back to Multicall
    let foundBalances = false;

    if (isZerionAvailable()) {
      try {
        const portfolio = await getPortfolioZerion(address, { minValueUsd: 0 });
        const chainPositions = portfolio.positions.filter(
          pos => pos.chain === chain && pos.positionType === "wallet"
        );

        for (const pos of chainPositions) {
          if (parseFloat(pos.balance) > 0 || showEmpty) {
            foundBalances = true;
            const valueStr = pos.valueUsd ? ` (~$${formatUsd(pos.valueUsd)})` : "";
            lines.push(`${pos.symbol}: ${pos.balance}${valueStr}`);
          }
        }

        if (chainPositions.length > 0) {
          foundBalances = true;
        }
      } catch (error) {
        console.error("[wallet_balance] Zerion failed for chain balance:", error);
        // Fall through to Multicall
      }
    }

    // Fallback to Multicall if Zerion unavailable or failed
    if (!foundBalances) {
      const balances = await getBalances(chain);

      for (const b of balances) {
        if (parseFloat(b.balance) > 0 || showEmpty) {
          foundBalances = true;
          const valueStr = b.usdValue ? ` (~$${b.usdValue})` : "";
          lines.push(`${b.symbol}: ${b.balance}${valueStr}`);
        }
      }
    }

    if (lines.length === 2) {
      lines.push("No balances found.");
      lines.push("");
      lines.push(`To receive tokens on ${chainDisplay}, send to:`);
      lines.push(address);
    }
  }

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}

/**
 * Specific token across all chains - uses Zerion for efficiency (1 call vs 5)
 */
async function showTokenAcrossChains(
  token: string,
  address: string,
  solanaAddress: string | undefined,
  showEmpty: boolean
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const tokenUpper = token.toUpperCase();
  const isNative = ["ETH", "MATIC", "SOL"].includes(tokenUpper);

  const lines: string[] = [`💰 ${tokenUpper} Balances Across Chains`, ""];
  let totalValue = 0;
  let foundAny = false;

  // Try Zerion first - ONE API call for all EVM chains!
  if (isZerionAvailable() && tokenUpper !== "SOL") {
    try {
      const portfolio = await getPortfolioZerion(address, { minValueUsd: 0 });

      // Filter for the requested token
      const tokenPositions = portfolio.positions.filter(
        pos => pos.symbol.toUpperCase() === tokenUpper && pos.positionType === "wallet"
      );

      for (const pos of tokenPositions) {
        if (parseFloat(pos.balance) > 0 || showEmpty) {
          foundAny = true;
          const chainDisplay = pos.chain.charAt(0).toUpperCase() + pos.chain.slice(1);
          const valueStr = pos.valueUsd ? ` (~$${formatUsd(pos.valueUsd)})` : "";
          lines.push(`${chainDisplay}: ${pos.balance} ${tokenUpper}${valueStr}`);
          totalValue += pos.valueUsd || 0;
        }
      }
    } catch (error) {
      console.error("[wallet_balance] Zerion failed, falling back to per-chain:", error);
      // Fall through to per-chain fallback below
      foundAny = false;
      totalValue = 0;
    }
  }

  // Fallback: Per-chain checks (only if Zerion unavailable or failed)
  if (!foundAny && !isZerionAvailable()) {
    const checks = EVM_CHAINS.map(async (chain): Promise<{ chain: string; balance: string; valueUsd: number | null } | null> => {
      try {
        if (isNative && tokenUpper === "ETH") {
          if (chain === "polygon") return null;
          const balances = await getBalances(chain);
          const ethBalance = balances.find(b => b.symbol === "ETH");
          if (ethBalance && (parseFloat(ethBalance.balance) > 0 || showEmpty)) {
            return { chain, balance: ethBalance.balance, valueUsd: parseFloat(ethBalance.usdValue || "0") };
          }
        } else if (isNative && tokenUpper === "MATIC") {
          if (chain !== "polygon") return null;
          const balances = await getBalances(chain);
          const maticBalance = balances.find(b => b.symbol === "MATIC");
          if (maticBalance && (parseFloat(maticBalance.balance) > 0 || showEmpty)) {
            return { chain, balance: maticBalance.balance, valueUsd: parseFloat(maticBalance.usdValue || "0") };
          }
        } else {
          const resolved = resolveToken(token, chain);
          if (!resolved) return null;
          const balance = await getTokenBalance(resolved.address, chain, address);
          if (parseFloat(balance.balance) > 0 || showEmpty) {
            const valueUsd = ["USDC", "USDT", "DAI"].includes(tokenUpper)
              ? parseFloat(balance.balance)
              : null;
            return { chain, balance: balance.balance, valueUsd };
          }
        }
      } catch {
        // Token not available on this chain
      }
      return null;
    });

    const results = await Promise.all(checks);

    for (const result of results) {
      if (result) {
        foundAny = true;
        const chainDisplay = result.chain.charAt(0).toUpperCase() + result.chain.slice(1);
        const valueStr = result.valueUsd ? ` (~$${formatUsd(result.valueUsd)})` : "";
        lines.push(`${chainDisplay}: ${result.balance} ${tokenUpper}${valueStr}`);
        if (result.valueUsd) totalValue += result.valueUsd;
      }
    }
  }

  // Check Solana for SOL (Zerion doesn't cover Solana well)
  if (tokenUpper === "SOL" && solanaAddress) {
    try {
      const solanaPortfolio = await getSolanaAssets(solanaAddress);
      if (parseFloat(solanaPortfolio.nativeBalance.balance) > 0 || showEmpty) {
        foundAny = true;
        const valueStr = solanaPortfolio.nativeBalance.valueUsd
          ? ` (~$${formatUsd(solanaPortfolio.nativeBalance.valueUsd)})`
          : "";
        lines.push(`Solana: ${solanaPortfolio.nativeBalance.balance} SOL${valueStr}`);
        totalValue += solanaPortfolio.nativeBalance.valueUsd || 0;
      }
    } catch {
      // Solana not available
    }
  }

  if (!foundAny) {
    lines.push(`No ${tokenUpper} found on any chain.`);
    lines.push("");
    lines.push("💡 To get " + tokenUpper + ":");
    if (isNative) {
      lines.push(`  • Receive: Send ${tokenUpper} to ${address}`);
    } else {
      lines.push(`  • Swap: wallet_swap fromToken="ETH" toToken="${tokenUpper}" chain="base"`);
      lines.push(`  • Bridge: wallet_bridge toToken="${tokenUpper}" toChain="base"`);
    }
  } else if (totalValue > 0) {
    lines.push("");
    lines.push(`Total: ~$${formatUsd(totalValue)}`);
  }

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}

/**
 * Specific token on specific chain
 */
async function showSpecificBalance(
  chain: SupportedChain,
  token: string,
  address: string,
  solanaAddress: string | undefined
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const chainDisplay = chain.charAt(0).toUpperCase() + chain.slice(1);
  const tokenUpper = token.toUpperCase();

  // Handle Solana
  if (chain === "solana") {
    if (!solanaAddress) {
      return {
        content: [{
          type: "text" as const,
          text: `No Solana address configured.`
        }]
      };
    }

    if (tokenUpper === "SOL") {
      const solanaPortfolio = await getSolanaAssets(solanaAddress);
      const valueStr = solanaPortfolio.nativeBalance.valueUsd
        ? ` (~$${formatUsd(solanaPortfolio.nativeBalance.valueUsd)})`
        : "";
      return {
        content: [{
          type: "text" as const,
          text: `💰 SOL on Solana: ${solanaPortfolio.nativeBalance.balance}${valueStr}`
        }]
      };
    }

    // SPL token
    const solanaPortfolio = await getSolanaAssets(solanaAddress);
    const spl = solanaPortfolio.tokens.find(t => t.symbol.toUpperCase() === tokenUpper);
    if (spl) {
      const valueStr = spl.valueUsd ? ` (~$${formatUsd(spl.valueUsd)})` : "";
      return {
        content: [{
          type: "text" as const,
          text: `💰 ${spl.symbol} on Solana: ${spl.balance}${valueStr}`
        }]
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: `No ${tokenUpper} found on Solana.`
      }]
    };
  }

  // Handle EVM chains
  const isNative = (tokenUpper === "ETH" && chain !== "polygon") ||
                   (tokenUpper === "MATIC" && chain === "polygon");

  if (isNative) {
    const balances = await getBalances(chain);
    const nativeBalance = balances[0];
    if (nativeBalance) {
      const valueStr = nativeBalance.usdValue ? ` (~$${nativeBalance.usdValue})` : "";
      return {
        content: [{
          type: "text" as const,
          text: `💰 ${nativeBalance.symbol} on ${chainDisplay}: ${nativeBalance.balance}${valueStr}`
        }]
      };
    }
  }

  // ERC-20 token
  let tokenAddress: string;
  let tokenSymbol: string;

  if (token.startsWith("0x")) {
    tokenAddress = token;
    tokenSymbol = token.slice(0, 8) + "...";
  } else {
    const resolved = resolveToken(token, chain);
    if (!resolved) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ Token "${token}" not found on ${chainDisplay}.\n\n` +
            `Supported tokens: USDC, USDT, DAI, WETH, WBTC\n` +
            `Or provide a contract address (0x...)`
        }]
      };
    }
    tokenAddress = resolved.address;
    tokenSymbol = resolved.symbol;
  }

  const balance = await getTokenBalance(tokenAddress, chain, address);
  const balanceNum = parseFloat(balance.balance);

  // Estimate USD for stablecoins
  let valueStr = "";
  if (["USDC", "USDT", "DAI"].includes(tokenSymbol.toUpperCase()) && balanceNum > 0) {
    valueStr = ` (~$${formatUsd(balanceNum)})`;
  }

  const lines = [
    `💰 ${tokenSymbol} on ${chainDisplay}`,
    "",
    `Balance: ${balance.balance} ${tokenSymbol}${valueStr}`,
    `Contract: ${tokenAddress}`,
  ];

  if (balanceNum === 0) {
    lines.push("");
    lines.push("💡 To get " + tokenSymbol + ":");
    lines.push(`  • Swap: wallet_swap fromToken="ETH" toToken="${tokenSymbol}" chain="${chain}"`);
    lines.push(`  • Bridge: wallet_bridge toToken="${tokenSymbol}" toChain="${chain}"`);
  }

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}

/**
 * Check stablecoin balances across EVM chains (safety net for Multicall unreliability)
 */
async function checkStablecoins(address: string): Promise<PortfolioItem[]> {
  const results: PortfolioItem[] = [];

  const checks = EVM_CHAINS.flatMap(chain =>
    STABLECOINS_TO_CHECK.map(async (token) => {
      try {
        const tokenInfo = POPULAR_TOKENS[token]?.[chain];
        if (!tokenInfo) return null;

        const balance = await getTokenBalance(tokenInfo.address, chain, address);
        const balanceNum = parseFloat(balance.balance);
        if (balanceNum > 0) {
          return {
            chain,
            symbol: token,
            balance: balance.balance,
            priceUsd: 1.0,
            valueUsd: balanceNum,
            change24h: null,
          } as PortfolioItem;
        }
      } catch {
        // Ignore errors
      }
      return null;
    })
  );

  const settled = await Promise.all(checks);
  for (const item of settled) {
    if (item) results.push(item);
  }

  return results;
}
