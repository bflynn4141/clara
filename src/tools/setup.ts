/**
 * wallet_setup - Initialize wallet with zero friction
 *
 * Hybrid approach:
 * 1. No params → auto-generate UUID, instant wallet (zero friction)
 * 2. Email provided → use email as identifier (portable, claimable on getpara.com)
 *
 * Para's pregenerated wallets are created instantly - no verification needed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as crypto from "crypto";
import * as os from "os";
import { getSession, saveSession } from "../storage/session.js";
import { createPregenWallet, completeWalletSetup, type PregenIdentifier } from "../para/client.js";

/**
 * Generate a machine-specific UUID for zero-friction setup
 * Uses hostname + a random component to create a stable-ish identifier
 */
function generateMachineId(): string {
  const hostname = os.hostname();
  const random = crypto.randomBytes(8).toString("hex");
  return `claude-code-${hostname}-${random}`;
}

export function registerSetupTool(server: McpServer) {
  server.registerTool(
    "wallet_setup",
    {
      description: "Initialize your wallet. Call with no parameters for instant setup, or provide an email for a portable wallet you can claim on getpara.com.",
      inputSchema: {
        email: z.string().email().optional().describe("Optional: email for portable wallet (can claim on getpara.com)"),
      },
    },
    async (args) => {
      const { email } = args;

      try {
        // Check if already authenticated
        const existingSession = await getSession();
        if (existingSession?.authenticated) {
          const identifierInfo = existingSession.email
            ? `Linked to: ${existingSession.email}`
            : `Local wallet (machine-specific)`;

          return {
            content: [{
              type: "text" as const,
              text: `✓ Already authenticated!\n\n` +
                `Wallet: ${existingSession.address}\n` +
                `${identifierInfo}\n` +
                `Chains: ${existingSession.chains?.join(", ") || "EVM, Solana"}\n\n` +
                `Use wallet_get_balance or wallet_send to interact.\n` +
                `Use wallet_logout to clear and create a new wallet.`
            }]
          };
        }

        // Determine identifier: email (portable) or UUID (zero-friction)
        const identifier: PregenIdentifier = email
          ? { type: 'email', value: email }
          : { type: 'customId', value: generateMachineId() };

        const isPortable = identifier.type === 'email';

        // Create the wallet (instant)
        const createResult = await createPregenWallet(identifier);

        // Complete setup (retrieves wallet info)
        const walletResult = await completeWalletSetup(createResult.sessionId);

        // Save session
        await saveSession({
          authenticated: true,
          address: walletResult.address,
          solanaAddress: walletResult.solanaAddress,
          email: isPortable ? email : undefined,
          identifierType: identifier.type,
          identifier: identifier.value,
          chains: ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        });

        const isNew = walletResult.isNewWallet;
        const solanaInfo = walletResult.solanaAddress
          ? `\nSolana: ${walletResult.solanaAddress}`
          : "";

        // Different messaging based on identifier type
        if (isPortable) {
          return {
            content: [{
              type: "text" as const,
              text: `🎉 Wallet ${isNew ? "created" : "restored"}!\n\n` +
                `EVM Address: ${walletResult.address}${solanaInfo}\n` +
                `Linked to: ${email}\n` +
                `Chains: Ethereum, Base, Arbitrum, Optimism, Polygon${walletResult.solanaAddress ? ", Solana" : ""}\n\n` +
                `Your wallet is now ready to use across all Claude Code plugins.\n\n` +
                `💡 Portable wallet: You can claim this at getpara.com using ${email}\n\n` +
                `Next steps:\n` +
                `• wallet_get_balance - Check balances\n` +
                `• wallet_send - Send tokens\n` +
                `• wallet_sign_message - Sign for dApps`
            }]
          };
        } else {
          return {
            content: [{
              type: "text" as const,
              text: `🎉 Wallet ${isNew ? "created" : "restored"}!\n\n` +
                `EVM Address: ${walletResult.address}${solanaInfo}\n` +
                `Type: Local (machine-specific)\n` +
                `Chains: Ethereum, Base, Arbitrum, Optimism, Polygon${walletResult.solanaAddress ? ", Solana" : ""}\n\n` +
                `Your wallet is ready to use across all Claude Code plugins on this machine.\n\n` +
                `💡 Want a portable wallet? Run wallet_setup with your email:\n` +
                `   wallet_setup email:"you@example.com"\n\n` +
                `Next steps:\n` +
                `• wallet_get_balance - Check balances\n` +
                `• wallet_send - Send tokens\n` +
                `• wallet_sign_message - Sign for dApps`
            }]
          };
        }

      } catch (error) {
        console.error("wallet_setup error:", error);
        return {
          content: [{
            type: "text" as const,
            text: `❌ Setup failed: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );
}
