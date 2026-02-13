/**
 * wallet_restore - Restore access to an existing wallet by identifier
 *
 * Used when the session is lost but you know the original identifier.
 */
import { z } from "zod";
import { getSession, clearSession } from "../storage/session.js";
import { createPregenWallet, completeWalletSetup } from "../para/client.js";
export function registerRestoreTool(server) {
    server.registerTool("wallet_restore", {
        description: "Restore access to an existing wallet using its identifier. Use this if you lost access to a wallet but know the original identifier.",
        inputSchema: {
            identifier: z.string().describe("The original wallet identifier (e.g., 'claude-code-hostname-abc123' or email)"),
            identifierType: z.enum(["customId", "email"]).optional().default("customId").describe("Type of identifier"),
        },
    }, async (args) => {
        const { identifier, identifierType = "customId" } = args;
        try {
            console.error(`[clara] Attempting to restore wallet for ${identifierType}: ${identifier}`);
            // Clear any existing session first
            await clearSession();
            // Build the identifier object
            const pregenIdentifier = {
                type: identifierType,
                value: identifier,
            };
            // createPregenWallet handles both new and existing wallets
            // For existing wallets, it fetches the wallet info and saves walletId
            const createResult = await createPregenWallet(pregenIdentifier);
            // Complete setup to verify and get final wallet info
            const walletResult = await completeWalletSetup(createResult.sessionId);
            // Get the session to check if walletId was saved
            const session = await getSession();
            const solanaInfo = walletResult.solanaAddress
                ? `\nSolana: ${walletResult.solanaAddress}`
                : "";
            const signingStatus = session?.walletId
                ? "✅ Signing enabled"
                : "⚠️ Signing may not work - try wallet_setup";
            return {
                content: [{
                        type: "text",
                        text: `✅ Wallet restored!\n\n` +
                            `EVM Address: ${walletResult.address}${solanaInfo}\n` +
                            `Status: ${createResult.isExisting ? "Existing wallet" : "New wallet created"}\n` +
                            `${signingStatus}\n\n` +
                            `Use wallet_get_balance to check your balances.`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_restore error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Restore failed: ${error instanceof Error ? error.message : "Unknown error"}\n\n` +
                            `Make sure you're using the exact identifier that was used to create the wallet.`
                    }]
            };
        }
    });
}
//# sourceMappingURL=restore.js.map