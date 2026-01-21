/**
 * wallet_send - Send tokens to an address
 *
 * SECURITY: Requires user approval via Claude Code's permission system.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { sendTransaction, estimateGas } from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"] as const;

export function registerSendTool(server: McpServer) {
  server.registerTool(
    "wallet_send",
    {
      description: "Send native tokens or ERC-20/SPL tokens to an address. REQUIRES USER APPROVAL.",
      inputSchema: {
        to: z.string().describe("Recipient address"),
        amount: z.string().describe("Amount to send (e.g., '0.1' for 0.1 ETH)"),
        chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to send on"),
        token: z.string().optional().describe("Token contract address (optional, defaults to native)"),
      },
    },
    async (args) => {
      const { to, amount, chain, token } = args;

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

        // Estimate gas
        const gasEstimate = await estimateGas({ to, value: amount }, chain);
        const tokenSymbol = token ? "TOKEN" : getNativeSymbol(chain);

        // Build transaction details
        const txDetails = [
          `┌─────────────────────────────────────`,
          `│ Send Transaction`,
          `│`,
          `│ To: ${to}`,
          `│ Amount: ${amount} ${tokenSymbol}`,
          `│ Chain: ${chain}`,
          token ? `│ Token: ${token}` : null,
          `│ Est. Fee: ~$${gasEstimate.estimatedCostUsd}`,
          `└─────────────────────────────────────`,
        ].filter(Boolean).join("\n");

        // Execute send
        const result = await sendTransaction(to, amount, chain, token);

        return {
          content: [{
            type: "text" as const,
            text: `✓ Transaction sent!\n\n` +
              `${txDetails}\n\n` +
              `Transaction Hash:\n${result.txHash}\n\n` +
              `Track: ${getExplorerUrl(chain, result.txHash)}`
          }]
        };

      } catch (error) {
        console.error("wallet_send error:", error);
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

function getNativeSymbol(chain: string): string {
  const symbols: Record<string, string> = {
    ethereum: "ETH", base: "ETH", arbitrum: "ETH",
    optimism: "ETH", polygon: "MATIC", solana: "SOL",
  };
  return symbols[chain] || "ETH";
}

function getExplorerUrl(chain: string, txHash: string): string {
  const explorers: Record<string, string> = {
    ethereum: `https://etherscan.io/tx/${txHash}`,
    base: `https://basescan.org/tx/${txHash}`,
    arbitrum: `https://arbiscan.io/tx/${txHash}`,
    optimism: `https://optimistic.etherscan.io/tx/${txHash}`,
    polygon: `https://polygonscan.com/tx/${txHash}`,
    solana: `https://solscan.io/tx/${txHash}`,
  };
  return explorers[chain] || txHash;
}
