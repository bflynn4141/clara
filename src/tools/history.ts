/**
 * wallet_history - View transaction history
 *
 * Shows recent transactions including:
 * - ETH/native token transfers
 * - ERC-20 token transfers
 * - Contract interactions
 *
 * Uses block explorer APIs (Etherscan, Basescan, etc.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import {
  getTransactionHistory,
  formatTransaction,
  type SupportedChain,
} from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"] as const;

export function registerHistoryTool(server: McpServer) {
  server.registerTool(
    "wallet_history",
    {
      description: `View your transaction history on a blockchain.

Shows recent transactions including:
- ETH/native token sends and receives
- ERC-20 token transfers
- Contract interactions (swaps, approvals, etc.)

Examples:
- "Show my recent transactions on Base"
- "What did I do on Ethereum recently?"
- "Show my last 20 transactions"`,
      inputSchema: {
        chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to check history on"),
        limit: z.number().optional().default(10).describe("Number of transactions to show (max 50)"),
        includeTokens: z.boolean().optional().default(true).describe("Include ERC-20 token transfers"),
      },
    },
    async (args) => {
      const { chain, limit = 10, includeTokens = true } = args;

      try {
        const session = await getSession();

        if (!session?.authenticated || !session.address) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`
            }]
          };
        }

        // Fetch history
        const history = await getTransactionHistory(chain as SupportedChain, {
          limit: Math.min(limit, 50),
          includeTokenTransfers: includeTokens,
        });

        if (history.transactions.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `📜 Transaction History on ${capitalizeFirst(chain)}\n\n` +
                `No transactions found for:\n${session.address}\n\n` +
                `This could mean:\n` +
                `• No transactions on this chain yet\n` +
                `• Very recent transactions may take time to appear`
            }]
          };
        }

        // Build output
        const lines: string[] = [
          `📜 Transaction History on ${capitalizeFirst(chain)}`,
          `Address: ${session.address.slice(0, 6)}...${session.address.slice(-4)}`,
          "",
        ];

        // Group by date
        let currentDate = "";
        for (const tx of history.transactions) {
          const txDate = new Date(tx.timestamp).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });

          if (txDate !== currentDate) {
            if (currentDate !== "") lines.push("");
            lines.push(`**${txDate}**`);
            currentDate = txDate;
          }

          lines.push(formatTransaction(tx));
        }

        // Footer
        lines.push("");
        if (history.hasMore) {
          lines.push(`Showing ${history.transactions.length} most recent transactions.`);
        }
        lines.push(`View all: ${getExplorerAddressUrl(chain, session.address)}`);

        return {
          content: [{
            type: "text" as const,
            text: lines.join("\n")
          }]
        };

      } catch (error) {
        console.error("wallet_history error:", error);
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

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getExplorerAddressUrl(chain: string, address: string): string {
  const explorers: Record<string, string> = {
    ethereum: `https://etherscan.io/address/${address}`,
    base: `https://basescan.org/address/${address}`,
    arbitrum: `https://arbiscan.io/address/${address}`,
    optimism: `https://optimistic.etherscan.io/address/${address}`,
    polygon: `https://polygonscan.com/address/${address}`,
  };
  return explorers[chain] || address;
}
