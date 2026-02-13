/**
 * wallet_resolve_ens - Resolve ENS names to addresses and vice versa
 */
import { z } from "zod";
import { resolveEnsName, reverseResolveEns, isEnsName } from "../para/client.js";
import { isValidEvmAddress } from "../utils/validators.js";
export function registerResolveEnsTool(server) {
    server.registerTool("wallet_resolve_ens", {
        description: "Resolve an ENS name (like vitalik.eth) to an Ethereum address, or look up the ENS name for an address. Works with .eth, .xyz, .com, and other ENS-supported domains.",
        inputSchema: {
            input: z.string()
                .describe("ENS name (e.g., 'vitalik.eth') or Ethereum address (e.g., '0xd8dA6BF...')"),
        },
    }, async (args) => {
        const { input } = args;
        if (!input) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Please provide an ENS name or Ethereum address to resolve.`
                    }]
            };
        }
        try {
            // Determine if this is a forward or reverse lookup
            const isAddress = isValidEvmAddress(input);
            if (isAddress) {
                // Reverse lookup: address -> ENS name
                const ensName = await reverseResolveEns(input);
                if (ensName) {
                    return {
                        content: [{
                                type: "text",
                                text: `🏷️ ENS Lookup\n\n` +
                                    `Address: ${input}\n` +
                                    `ENS Name: ${ensName}\n\n` +
                                    `✓ This address has a primary ENS name set.`
                            }]
                    };
                }
                else {
                    return {
                        content: [{
                                type: "text",
                                text: `🏷️ ENS Lookup\n\n` +
                                    `Address: ${input}\n` +
                                    `ENS Name: (none)\n\n` +
                                    `ℹ️ This address does not have a primary ENS name configured.`
                            }]
                    };
                }
            }
            // Catch malformed addresses: starts with 0x but isn't valid
            if (input.startsWith("0x") && !isAddress) {
                const hexPart = input.slice(2);
                const issues = [];
                if (hexPart.length !== 40)
                    issues.push(`has ${input.length} characters (expected 42)`);
                if (!/^[0-9a-fA-F]*$/.test(hexPart))
                    issues.push("contains non-hex characters");
                return {
                    content: [{
                            type: "text",
                            text: `❌ Invalid Ethereum address: "${input}"\n\n` +
                                `Issues: ${issues.join(", ")}\n\n` +
                                `Ethereum addresses are 42 characters: 0x followed by 40 hex digits (0-9, a-f).\n` +
                                `Example: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`
                        }]
                };
            }
            // Forward lookup: ENS name -> address
            if (!isEnsName(input)) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ "${input}" doesn't look like an ENS name.\n\n` +
                                `ENS names end with .eth, .xyz, .com, .org, .io, or .app\n` +
                                `Examples: vitalik.eth, uniswap.eth, opensea.eth`
                        }]
                };
            }
            const address = await resolveEnsName(input);
            if (address) {
                return {
                    content: [{
                            type: "text",
                            text: `🏷️ ENS Resolution\n\n` +
                                `Name: ${input}\n` +
                                `Address: ${address}\n\n` +
                                `✓ You can send tokens to "${input}" and it will go to this address.`
                        }]
                };
            }
            else {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Could not resolve "${input}"\n\n` +
                                `Possible reasons:\n` +
                                `• The name is not registered\n` +
                                `• The name exists but has no address set\n` +
                                `• Network connectivity issue\n\n` +
                                `Try checking on https://app.ens.domains/name/${input}`
                        }]
                };
            }
        }
        catch (error) {
            console.error("wallet_resolve_ens error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error resolving ENS: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
//# sourceMappingURL=resolve-ens.js.map