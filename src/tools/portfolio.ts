/**
 * wallet_portfolio - View portfolio across all chains
 *
 * Shows native token balances AND popular ERC-20s (USDC, USDT, DAI)
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
  POPULAR_TOKENS,
  getSolanaAssets,
  isHeliusAvailable,
  type SupportedChain,
  type PortfolioItem,
} from "../para/client.js";

// Popular stablecoins to always check (Multicall can be unreliable)
const STABLECOINS_TO_CHECK = ["USDC", "USDT", "DAI"] as const;
const EVM_CHAINS: SupportedChain[] = ["base", "arbitrum", "optimism", "ethereum", "polygon"];

export function registerPortfolioTool(server: McpServer) {
  server.registerTool(
    "wallet_portfolio",
    {
      description: "View your portfolio across all chains (EVM + Solana). Shows native token balances, stablecoins, SPL tokens, prices, USD values, and 24h price changes.",
      inputSchema: {
        showEmpty: z.boolean()
          .optional()
          .default(false)
          .describe("Include chains with zero balance (default: false)"),
        refresh: z.boolean()
          .optional()
          .default(true)
          .describe("Force fresh data fetch (default: true). Data is always fetched fresh from blockchain."),
      },
    },
    async (args) => {
      const showEmpty = args.showEmpty ?? false;

      try {
        const session = await getSession();

        if (!session?.authenticated) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`
            }]
          };
        }

        const portfolio = await getPortfolioFast();

        // SAFETY NET: Explicitly check stablecoins since Multicall can be unreliable
        // This ensures USDC/USDT/DAI always show up if present
        const stablecoinChecks = await checkStablecoins(session.address!);

        // Merge stablecoin results with portfolio (avoiding duplicates)
        const existingKeys = new Set(portfolio.items.map(i => `${i.chain}:${i.symbol}`));
        for (const item of stablecoinChecks) {
          const key = `${item.chain}:${item.symbol}`;
          if (!existingKeys.has(key) && parseFloat(item.balance) > 0) {
            portfolio.items.push(item);
            portfolio.totalValueUsd += item.valueUsd ?? 0;
          }
        }

        // Add Solana balances if wallet has Solana address
        if (session.solanaAddress) {
          try {
            const solanaPortfolio = await getSolanaAssets(session.solanaAddress);

            // Add native SOL
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

            // Add SPL tokens
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
            console.error("[clara] Failed to fetch Solana portfolio:", error);
          }
        }

        // Filter out zero balances unless showEmpty is true
        const items = showEmpty
          ? portfolio.items
          : portfolio.items.filter(item => parseFloat(item.balance) > 0);

        // Try to get ENS name for display
        let ensName: string | null = null;
        if (session.address) {
          ensName = await reverseResolveEns(session.address).catch(() => null);
        }

        // Build the portfolio display
        const addressDisplay = ensName
          ? `${ensName} (${session.address?.slice(0, 6)}...${session.address?.slice(-4)})`
          : `${session.address?.slice(0, 6)}...${session.address?.slice(-4)}`;

        const header = [
          `┌─────────────────────────────────────────────────────────────┐`,
          `│  📊 Portfolio Overview                                      │`,
          `│  ${addressDisplay.padEnd(55)}│`,
          `├─────────────────────────────────────────────────────────────┤`,
        ];

        // Build chain rows
        const chainRows: string[] = [];

        if (items.length === 0) {
          chainRows.push(`│  No balances found across any chain.                        │`);
          chainRows.push(`│  Send some tokens to your address to get started!           │`);
        } else {
          // Header row
          chainRows.push(`│  Chain        │ Balance        │ Price      │ Value      │`);
          chainRows.push(`├───────────────┼────────────────┼────────────┼────────────┤`);

          for (const item of items) {
            const chainName = item.chain.charAt(0).toUpperCase() + item.chain.slice(1);
            const balanceStr = `${parseFloat(item.balance).toFixed(4)} ${item.symbol}`;
            const priceStr = item.priceUsd ? formatUsd(item.priceUsd) : "—";
            const valueStr = formatUsd(item.valueUsd);
            const changeStr = formatChange(item.change24h);
            const changeColor = item.change24h !== null && item.change24h >= 0 ? "📈" : "📉";

            chainRows.push(
              `│  ${chainName.padEnd(12)} │ ${balanceStr.padEnd(14)} │ ${priceStr.padEnd(10)} │ ${valueStr.padEnd(10)} │`
            );
          }
        }

        // Footer with totals
        const footer = [
          `├─────────────────────────────────────────────────────────────┤`,
          `│  Total Value: ${formatUsd(portfolio.totalValueUsd).padEnd(44)}│`,
        ];

        if (portfolio.totalChange24h !== null) {
          const changeEmoji = portfolio.totalChange24h >= 0 ? "📈" : "📉";
          footer.push(`│  24h Change: ${changeEmoji} ${formatChange(portfolio.totalChange24h).padEnd(43)}│`);
        }

        footer.push(`└─────────────────────────────────────────────────────────────┘`);

        // Add timestamp with relative time indicator
        const now = Date.now();
        const fetchTime = new Date(portfolio.lastUpdated).getTime();
        const ageSeconds = Math.floor((now - fetchTime) / 1000);
        const timeStr = new Date(fetchTime).toLocaleTimeString();

        // Format relative age
        let ageStr: string;
        let freshIndicator: string;
        if (ageSeconds < 5) {
          ageStr = "just now";
          freshIndicator = "🟢"; // Fresh
        } else if (ageSeconds < 60) {
          ageStr = `${ageSeconds}s ago`;
          freshIndicator = "🟢"; // Fresh
        } else if (ageSeconds < 300) {
          ageStr = `${Math.floor(ageSeconds / 60)}m ago`;
          freshIndicator = "🟡"; // Slightly stale
        } else {
          ageStr = `${Math.floor(ageSeconds / 60)}m ago`;
          freshIndicator = "🟠"; // Stale
        }

        const output = [
          ...header,
          ...chainRows,
          ...footer,
          ``,
          `${freshIndicator} Last updated: ${timeStr} (${ageStr})`,
        ].join("\n");

        return {
          content: [{
            type: "text" as const,
            text: output
          }]
        };

      } catch (error) {
        console.error("wallet_portfolio error:", error);
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
 * Explicitly check stablecoin balances across chains
 * This is a safety net since Multicall3 can be unreliable on some RPCs
 */
async function checkStablecoins(address: string): Promise<PortfolioItem[]> {
  const results: PortfolioItem[] = [];

  // Check all stablecoins across all EVM chains in parallel
  const checks = EVM_CHAINS.flatMap(chain =>
    STABLECOINS_TO_CHECK.map(async (token) => {
      try {
        // Resolve symbol to token address using POPULAR_TOKENS
        const tokenInfo = POPULAR_TOKENS[token]?.[chain];
        if (!tokenInfo) {
          // Token not available on this chain
          return null;
        }

        const balance = await getTokenBalance(tokenInfo.address, chain, address);
        const balanceNum = parseFloat(balance.balance);
        if (balanceNum > 0) {
          return {
            chain,
            symbol: token,
            balance: balance.balance,
            priceUsd: 1.0, // Stablecoins ≈ $1
            valueUsd: balanceNum,
            change24h: null,
          } as PortfolioItem;
        }
      } catch {
        // Token might not exist on this chain or RPC error, ignore
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
