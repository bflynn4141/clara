/**
 * wallet_sign_message - Sign arbitrary messages
 *
 * SECURITY: Requires user approval.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { signMessage } from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "solana"] as const;

export function registerSignMessageTool(server: McpServer) {
  server.registerTool(
    "wallet_sign_message",
    {
      description: "Sign a message with your wallet. Used for authentication (SIWE) and proving ownership. REQUIRES USER APPROVAL.",
      inputSchema: {
        message: z.string().min(1).max(10000).describe("The message to sign"),
        chain: z.enum(SUPPORTED_CHAINS).default("ethereum").describe("Chain context for signing"),
      },
    },
    async (args) => {
      const { message, chain = "ethereum" } = args;

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

        const signature = await signMessage(message, chain);

        return {
          content: [{
            type: "text" as const,
            text: `✓ Message signed\n\n` +
              `Message: "${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"\n` +
              `Chain: ${chain}\n\n` +
              `Signature:\n${signature}`
          }]
        };

      } catch (error) {
        console.error("wallet_sign_message error:", error);
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
