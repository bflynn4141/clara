/**
 * wallet_sign_transaction - Sign blockchain transactions
 *
 * SECURITY: Requires user approval. Transaction details are parsed
 * and displayed in human-readable format.
 */
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { signTransaction, decodeTransaction } from "../para/client.js";
const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"];
export function registerSignTransactionTool(server) {
    server.registerTool("wallet_sign_transaction", {
        description: "Sign a blockchain transaction. Returns signed data that can be broadcast. REQUIRES USER APPROVAL.",
        inputSchema: {
            transaction: z.string().describe("Serialized transaction data (JSON or hex)"),
            chain: z.enum(SUPPORTED_CHAINS).describe("The blockchain for this transaction"),
        },
    }, async (args) => {
        const { transaction, chain } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured. Run wallet_setup first.`
                        }]
                };
            }
            // Parse transaction for display
            let txData;
            try {
                txData = JSON.parse(transaction);
            }
            catch {
                // Assume hex-encoded raw transaction
                txData = { to: "Unknown", data: transaction };
            }
            const decoded = await decodeTransaction(txData, chain);
            // Build details display
            const txDetails = [
                `┌─────────────────────────────────────`,
                `│ Transaction Details`,
                `│`,
                `│ Action: ${decoded.action}`,
                ...decoded.details.map(d => `│ ${d}`),
                `│ Chain: ${chain}`,
                `└─────────────────────────────────────`,
            ].join("\n");
            // Sign the transaction
            const signed = await signTransaction(txData, chain);
            return {
                content: [{
                        type: "text",
                        text: `✓ Transaction signed\n\n` +
                            `${txDetails}\n\n` +
                            `Signed Transaction:\n${signed.signedTx}\n\n` +
                            `ℹ️ NOT broadcast. Use this signed data to submit to the network.`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_sign_transaction error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
//# sourceMappingURL=sign-transaction.js.map