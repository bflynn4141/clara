/**
 * wallet_get_balance - Get token balances for a chain
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { getBalances } from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"] as const;

export function registerBalanceTool(server: McpServer) {
  server.registerTool(
    "wallet_get_balance",
    {
      description: `Get token balances for your wallet on a specific chain.

EVM chains: Shows native token (ETH/MATIC) and major stablecoins (USDC, USDT, DAI).
Solana: Shows SOL and all SPL tokens with USD values (requires HELIUS_API_KEY for full token list).`,
      inputSchema: {
        chain: z.enum(SUPPORTED_CHAINS)
          .default("base")
          .describe("The blockchain to check balances on"),
        token: z.string()
          .optional()
          .describe("Specific token address to check (optional)"),
      },
    },
    async (args) => {
      const chain = args.chain || "base";
      const token = args.token;

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

        const balances = await getBalances(chain, token);

        if (!balances || balances.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No balances found on ${chain}. Your wallet may be empty on this chain.`
            }]
          };
        }

        const chainDisplay = chain.charAt(0).toUpperCase() + chain.slice(1);
        const balanceLines = balances.map(b =>
          `${b.symbol}: ${b.balance}${b.usdValue ? ` (~$${b.usdValue})` : ""}`
        ).join("\n");

        return {
          content: [{
            type: "text" as const,
            text: `💰 ${chainDisplay} Balances\n\n${balanceLines}`
          }]
        };

      } catch (error) {
        console.error("wallet_get_balance error:", error);
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
