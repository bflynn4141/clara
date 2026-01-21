/**
 * wallet_logout - Clear local wallet session
 */
import { clearSession, getSession } from "../storage/session.js";
export function registerLogoutTool(server) {
    server.registerTool("wallet_logout", {
        description: "Log out and clear your local wallet session. Your wallet still exists and can be restored by running wallet_setup again with the same email.",
    }, async () => {
        try {
            const session = await getSession();
            if (!session?.authenticated) {
                return {
                    content: [{
                            type: "text",
                            text: `No active wallet session to log out from.`
                        }]
                };
            }
            const address = session.address;
            await clearSession();
            return {
                content: [{
                        type: "text",
                        text: `✓ Logged out successfully\n\n` +
                            `Wallet ${address} session cleared.\n\n` +
                            `Your wallet still exists and can be restored anytime by running wallet_setup with the same email.`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_logout error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
//# sourceMappingURL=logout.js.map