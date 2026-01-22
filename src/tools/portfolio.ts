/**
 * wallet_portfolio - View portfolio across all chains
 *
 * Shows native token balances, USD values, and 24h changes
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { getPortfolioFast, formatUsd, formatChange, reverseResolveEns } from "../para/client.js";

export function registerPortfolioTool(server: McpServer) {
  server.registerTool(
    "wallet_portfolio",
    {
      description: "View your portfolio across all chains. Shows native token balances, current prices, USD values, and 24h price changes.",
      inputSchema: {
        showEmpty: z.boolean()
          .optional()
          .default(false)
          .describe("Include chains with zero balance (default: false)"),
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
              text: `❌ No wallet configured. Run wallet_setup first.`
            }]
          };
        }

        const portfolio = await getPortfolioFast();

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

        // Add timestamp - now shows real-time via Multicall3
        const updatedTime = new Date(portfolio.lastUpdated).toLocaleTimeString();

        const output = [
          ...header,
          ...chainRows,
          ...footer,
          ``,
          `⚡ Real-time balances as of ${updatedTime}`,
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
