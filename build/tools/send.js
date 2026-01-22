/**
 * wallet_send - Send tokens to an address
 *
 * SECURITY: Requires user approval via Claude Code's permission system.
 */
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { sendTransaction, estimateGas, resolveEnsName, isEnsName } from "../para/client.js";
const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"];
export function registerSendTool(server) {
    server.registerTool("wallet_send", {
        description: "Send native tokens or ERC-20/SPL tokens to an address or ENS name (like vitalik.eth). REQUIRES USER APPROVAL.",
        inputSchema: {
            to: z.string().describe("Recipient address or ENS name (e.g., '0x...' or 'vitalik.eth')"),
            amount: z.string().describe("Amount to send (e.g., '0.1' for 0.1 ETH)"),
            chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to send on"),
            token: z.string().optional().describe("Token contract address (optional, defaults to native)"),
        },
    }, async (args) => {
        const { to, amount, chain, token } = args;
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
            // Resolve ENS name if applicable (only for EVM chains)
            let resolvedTo = to;
            let ensName = null;
            if (chain !== "solana" && isEnsName(to)) {
                ensName = to;
                const resolved = await resolveEnsName(to);
                if (!resolved) {
                    return {
                        content: [{
                                type: "text",
                                text: `❌ Could not resolve ENS name "${to}"\n\n` +
                                    `The name may not be registered or doesn't have an address set.\n` +
                                    `Check: https://app.ens.domains/name/${to}`
                            }]
                    };
                }
                resolvedTo = resolved;
            }
            // Estimate gas
            const gasEstimate = await estimateGas({ to: resolvedTo, value: amount }, chain);
            const tokenSymbol = token ? "TOKEN" : getNativeSymbol(chain);
            // Build transaction details
            const txDetails = [
                `┌─────────────────────────────────────`,
                `│ Send Transaction`,
                `│`,
                ensName ? `│ To: ${ensName}` : null,
                ensName ? `│     → ${resolvedTo}` : `│ To: ${resolvedTo}`,
                `│ Amount: ${amount} ${tokenSymbol}`,
                `│ Chain: ${chain}`,
                token ? `│ Token: ${token}` : null,
                `│ Est. Fee: ~$${gasEstimate.estimatedCostUsd}`,
                `└─────────────────────────────────────`,
            ].filter(Boolean).join("\n");
            // Execute send with resolved address
            const result = await sendTransaction(resolvedTo, amount, chain, token);
            return {
                content: [{
                        type: "text",
                        text: `✓ Transaction sent!\n\n` +
                            `${txDetails}\n\n` +
                            `Transaction Hash:\n${result.txHash}\n\n` +
                            `Track: ${getExplorerUrl(chain, result.txHash)}`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_send error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
function getNativeSymbol(chain) {
    const symbols = {
        ethereum: "ETH", base: "ETH", arbitrum: "ETH",
        optimism: "ETH", polygon: "MATIC", solana: "SOL",
    };
    return symbols[chain] || "ETH";
}
function getExplorerUrl(chain, txHash) {
    const explorers = {
        ethereum: `https://etherscan.io/tx/${txHash}`,
        base: `https://basescan.org/tx/${txHash}`,
        arbitrum: `https://arbiscan.io/tx/${txHash}`,
        optimism: `https://optimistic.etherscan.io/tx/${txHash}`,
        polygon: `https://polygonscan.com/tx/${txHash}`,
        solana: `https://solscan.io/tx/${txHash}`,
    };
    return explorers[chain] || txHash;
}
//# sourceMappingURL=send.js.map