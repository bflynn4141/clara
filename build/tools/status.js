/**
 * wallet_status - Check current authentication and wallet status
 */
import { getSession } from "../storage/session.js";
export function registerStatusTool(server) {
    server.registerTool("wallet_status", {
        description: "Check if your wallet is set up and authenticated. Shows wallet address and supported chains.",
    }, async () => {
        try {
            const session = await getSession();
            if (!session?.authenticated) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured\n\nRun wallet_setup with your email to create or restore your wallet.`
                        }]
                };
            }
            return {
                content: [{
                        type: "text",
                        text: `✓ Wallet Active\n\n` +
                            `Address: ${session.address}\n` +
                            `Chains: ${session.chains?.join(", ") || "EVM, Solana"}\n` +
                            `Since: ${session.createdAt || "Unknown"}\n\n` +
                            `Available commands:\n` +
                            `• wallet_get_address - Get address for specific chain\n` +
                            `• wallet_get_balance - Check balances\n` +
                            `• wallet_send - Send tokens\n` +
                            `• wallet_sign_message - Sign messages`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_status error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error checking status: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
//# sourceMappingURL=status.js.map