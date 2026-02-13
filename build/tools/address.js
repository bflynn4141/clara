/**
 * wallet_get_address - Get wallet address for a specific chain
 */
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { getWalletAddress } from "../para/client.js";
const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"];
export function registerAddressTool(server) {
    server.registerTool("wallet_get_address", {
        description: "Get your wallet address for a specific blockchain. EVM chains share the same address, Solana has a different format.",
        inputSchema: {
            chain: z.enum(SUPPORTED_CHAINS)
                .default("base")
                .describe("The blockchain to get address for (default: base)"),
        },
    }, async (args) => {
        const chain = args.chain || "base";
        try {
            const session = await getSession();
            if (!session?.authenticated) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`
                        }]
                };
            }
            const address = await getWalletAddress(chain);
            const chainDisplay = chain.charAt(0).toUpperCase() + chain.slice(1);
            const isEVM = chain !== "solana";
            return {
                content: [{
                        type: "text",
                        text: `📍 ${chainDisplay} Address\n\n` +
                            `${address}\n\n` +
                            (isEVM ? `ℹ️ This address works on all EVM chains` : `ℹ️ Solana-specific address`)
                    }]
            };
        }
        catch (error) {
            console.error("wallet_get_address error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
//# sourceMappingURL=address.js.map