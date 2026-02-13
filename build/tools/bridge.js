/**
 * wallet_bridge - Cross-chain bridging and swaps
 *
 * Uses Li.Fi to find the best bridge routes:
 * - Same-token bridging: USDC (Base) → USDC (Arbitrum)
 * - Cross-chain swaps: ETH (Ethereum) → USDC (Base)
 * - Automatic routing via Stargate, Across, Hop, etc.
 */
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { getBridgeQuote, executeBridge, encodeApproveCalldata, getTokenMetadata, sendTransaction, getBalances, } from "../para/client.js";
import { parseAndValidateAmount, zodAmount, zodToken, gasGuidance } from "../utils/validators.js";
import { checkBalance } from "../utils/balance.js";
const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
// Native tokens by chain
const NATIVE_TOKENS = {
    ethereum: "ETH",
    base: "ETH",
    arbitrum: "ETH",
    optimism: "ETH",
    polygon: "MATIC",
};
// Minimum recommended gas in USD
const MIN_GAS_USD = 2.0;
/**
 * Check if user has sufficient native token on destination chain for gas
 * Returns warning message if they don't have enough
 */
async function checkDestinationGas(toChain, address, bridgingNativeToken) {
    try {
        const balances = await getBalances(toChain);
        const nativeBalance = parseFloat(balances[0]?.balance || "0");
        const nativeUsd = parseFloat(balances[0]?.usdValue || "0");
        const nativeSymbol = NATIVE_TOKENS[toChain] || "ETH";
        // If bridging native token, they'll have gas after the bridge
        if (bridgingNativeToken) {
            return { hasGas: true, balance: balances[0]?.balance || "0" };
        }
        // Check if they have enough for gas
        if (nativeUsd < MIN_GAS_USD && nativeBalance < 0.001) {
            return {
                hasGas: false,
                balance: balances[0]?.balance || "0",
                warning: [
                    `⚠️ **No gas on ${capitalizeFirst(toChain)}**`,
                    "",
                    `You have ${nativeBalance.toFixed(6)} ${nativeSymbol} on ${capitalizeFirst(toChain)}.`,
                    `After bridging, you won't be able to do anything without ${nativeSymbol} for gas.`,
                    "",
                    `**Recommended:** Bridge some ${nativeSymbol} first:`,
                    `  wallet_bridge fromToken="${nativeSymbol}" toToken="${nativeSymbol}" amount="0.01" fromChain="..." toChain="${toChain}"`,
                    "",
                    `Or continue anyway if you plan to bridge ${nativeSymbol} separately.`,
                ].join("\n"),
            };
        }
        return { hasGas: true, balance: balances[0]?.balance || "0" };
    }
    catch (error) {
        // If we can't check, don't block the user
        console.error("Failed to check destination gas:", error);
        return { hasGas: true, balance: "unknown" };
    }
}
export function registerBridgeTool(server) {
    server.registerTool("wallet_bridge", {
        description: `Bridge tokens between chains or perform cross-chain swaps.

**Same-token bridging:**
- "Bridge 100 USDC from Arbitrum to Base"
- "Move 0.5 ETH from Ethereum to Optimism"

**Cross-chain swaps:**
- "Swap ETH on Ethereum for USDC on Base"
- "Convert 100 USDC on Base to ETH on Arbitrum"

Uses Li.Fi to find the best route across Stargate, Across, Hop, and other bridges.

Supported chains: Ethereum, Base, Arbitrum, Optimism, Polygon
Supported tokens: ETH, USDC, USDT, DAI, WETH, WBTC (or any contract address)`,
        inputSchema: {
            fromToken: zodToken.describe("Token to send (symbol like ETH/USDC or contract address)"),
            toToken: zodToken.describe("Token to receive (can be same or different from fromToken)"),
            amount: zodAmount.describe("Amount of fromToken to bridge"),
            fromChain: z.enum(SUPPORTED_CHAINS).describe("Source blockchain"),
            toChain: z.enum(SUPPORTED_CHAINS).describe("Destination blockchain"),
            action: z.enum(["quote", "execute"]).optional().default("quote").describe("quote = preview only, execute = perform the bridge"),
            slippage: z.number().optional().default(0.5).describe("Max slippage percentage (default 0.5%)"),
        },
    }, async (args) => {
        const { fromToken, toToken, amount, fromChain, toChain, action = "quote", slippage = 0.5 } = args;
        try {
            // Validate chains are different
            if (fromChain === toChain) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Source and destination chains are the same (${fromChain}).\n\n` +
                                `For same-chain swaps, use \`wallet_swap\` instead.`
                        }]
                };
            }
            // Validate amount before any API calls
            const amountCheck = parseAndValidateAmount(amount);
            if (!amountCheck.valid) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Invalid amount: ${amountCheck.error}\n\nExample: amount="0.1" to bridge 0.1 ETH`
                        }]
                };
            }
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\n` +
                                `Run \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`
                        }]
                };
            }
            // Check balance on source chain
            const balanceCheck = await checkBalance(fromToken, amount, fromChain, session.address);
            if (!balanceCheck.sufficient) {
                const lines = [
                    `❌ Insufficient ${fromToken.toUpperCase()} on ${capitalizeFirst(fromChain)}`,
                    "",
                    `You want to bridge: ${amount} ${fromToken.toUpperCase()}`,
                    `Your balance: ${balanceCheck.balance} ${fromToken.toUpperCase()}`,
                    "",
                    "💡 Options:",
                    `  • Reduce amount to ${balanceCheck.balance} or less`,
                    `  • Swap ETH for ${fromToken.toUpperCase()}: wallet_swap fromToken="ETH" toToken="${fromToken.toUpperCase()}" chain="${fromChain}"`,
                    `  • Receive tokens: Send ${fromToken.toUpperCase()} to ${session.address}`,
                ];
                return {
                    content: [{
                            type: "text",
                            text: lines.join("\n")
                        }]
                };
            }
            // Check if user has gas on destination chain (critical for non-native token bridges)
            const nativeSymbols = ["ETH", "MATIC", "NATIVE"];
            const bridgingNativeToken = nativeSymbols.includes(fromToken.toUpperCase()) &&
                nativeSymbols.includes(toToken.toUpperCase());
            const destGasCheck = await checkDestinationGas(toChain, session.address, bridgingNativeToken);
            // Get bridge quote
            const quote = await getBridgeQuote(fromToken, toToken, amount, fromChain, toChain, { slippage });
            // Format quote for display
            const quoteDisplay = formatBridgeQuote(quote);
            if (action === "quote") {
                // Include gas warning in quote if applicable
                let response = quoteDisplay;
                if (destGasCheck.warning) {
                    response += "\n\n" + destGasCheck.warning;
                }
                response += "\n\n" + `To execute this bridge, run again with action="execute"`;
                return {
                    content: [{
                            type: "text",
                            text: response
                        }]
                };
            }
            // Execute the bridge - but first check for gas on destination
            if (!destGasCheck.hasGas && destGasCheck.warning) {
                // Block execution if no gas on destination for non-native token bridges
                return {
                    content: [{
                            type: "text",
                            text: quoteDisplay + "\n\n" + destGasCheck.warning + "\n\n" +
                                `❌ Bridge blocked: You need ${NATIVE_TOKENS[toChain] || "ETH"} on ${capitalizeFirst(toChain)} first.`
                        }]
                };
            }
            if (quote.needsApproval) {
                return await handleApproval(quote);
            }
            const result = await executeBridge(quote);
            // Build success message
            const successLines = [
                quoteDisplay,
                "",
                `✅ Bridge initiated!`,
                "",
                `Transaction: ${result.txHash}`,
                `Status: ${result.status}`,
                `Estimated arrival: ${result.estimatedArrival}`,
                "",
                `Your ${quote.toToken.symbol} will arrive on ${capitalizeFirst(quote.toChain)} shortly.`,
            ];
            return {
                content: [{
                        type: "text",
                        text: successLines.join("\n")
                    }]
            };
        }
        catch (error) {
            console.error("wallet_bridge error:", error);
            const msg = error instanceof Error ? error.message : "Unknown error";
            const isGasError = /insufficient funds|gas required|intrinsic gas/i.test(msg);
            const isRouteError = /no route|no quotes|route not found/i.test(msg);
            let guidance = "";
            if (isGasError) {
                guidance = `\n\n${gasGuidance(fromChain)}`;
            }
            else if (isRouteError) {
                guidance = "\n\nNo bridge route found for this pair. Try a different token or a more common route (e.g., ETH or USDC between major chains).";
            }
            return {
                content: [{
                        type: "text",
                        text: `❌ Bridge failed: ${msg}${guidance}`
                    }]
            };
        }
    });
}
// checkBalance extracted to ../utils/balance.ts
/**
 * Format a bridge quote for display
 */
function formatBridgeQuote(quote) {
    const isCrossChainSwap = quote.fromToken.symbol !== quote.toToken.symbol;
    const actionType = isCrossChainSwap ? "Cross-Chain Swap" : "Bridge";
    const lines = [
        `🌉 ${actionType} Quote`,
        "",
        `**From:** ${quote.fromAmount} ${quote.fromToken.symbol} on ${capitalizeFirst(quote.fromChain)} (~$${quote.fromAmountUsd})`,
        `**To:** ${quote.toAmount} ${quote.toToken.symbol} on ${capitalizeFirst(quote.toChain)} (~$${quote.toAmountUsd})`,
        `**Minimum:** ${quote.toAmountMin} ${quote.toToken.symbol} (after slippage)`,
        "",
    ];
    if (isCrossChainSwap) {
        lines.push(`**Rate:** 1 ${quote.fromToken.symbol} = ${quote.exchangeRate} ${quote.toToken.symbol}`);
    }
    lines.push(`**Estimated Time:** ${formatDuration(quote.estimatedTime)}`);
    lines.push(`**Gas Cost:** ~$${quote.estimatedGasUsd}`);
    lines.push(`**Route:** ${quote.toolDetails || quote.tool}`);
    // Show route steps if there are multiple
    if (quote.steps && quote.steps.length > 1) {
        lines.push("");
        lines.push("**Route Details:**");
        for (const step of quote.steps) {
            const stepType = step.type === "bridge" ? "🌉" : step.type === "swap" ? "🔄" : "↔️";
            lines.push(`  ${stepType} ${step.fromToken} → ${step.toToken} via ${step.tool}`);
        }
    }
    // Show approval status
    if (quote.needsApproval) {
        lines.push("");
        lines.push(`🔐 Approval required: You need to approve ${quote.fromToken.symbol} first.`);
        lines.push(`Current allowance: ${quote.currentAllowance || "0"}`);
    }
    return lines.join("\n");
}
/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds) {
    if (seconds < 60) {
        return `~${seconds} seconds`;
    }
    else if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return `~${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    else {
        const hours = Math.ceil(seconds / 3600);
        return `~${hours} hour${hours > 1 ? "s" : ""}`;
    }
}
/**
 * Handle the approval flow for a bridge
 */
async function handleApproval(quote) {
    if (!quote.approvalAddress) {
        return {
            content: [{
                    type: "text",
                    text: `❌ Approval address not provided in quote. Please try again.`
                }]
        };
    }
    const lines = [
        `🔐 Approval Required`,
        "",
        `Before bridging, you need to approve the bridge contract to spend your ${quote.fromToken.symbol}.`,
        "",
        `Token: ${quote.fromToken.symbol}`,
        `Spender: ${quote.approvalAddress.slice(0, 8)}...${quote.approvalAddress.slice(-6)}`,
        `Amount: ${quote.fromAmount} ${quote.fromToken.symbol}`,
        "",
        `⏳ Sending approval transaction...`,
    ];
    try {
        // Get token metadata
        const metadata = await getTokenMetadata(quote.fromToken.address, quote.fromChain);
        // Encode unlimited approval
        const approvalData = encodeApproveCalldata(quote.approvalAddress, "unlimited", metadata.decimals);
        // Send approval transaction
        const result = await sendTransaction(quote.fromToken.address, "0", quote.fromChain, undefined, approvalData);
        lines.push("");
        lines.push(`✅ Approval submitted: ${result.txHash}`);
        lines.push("");
        lines.push(`⏳ Please wait for confirmation, then run the bridge again.`);
        lines.push("");
        lines.push(`Note: After approval confirms, run the bridge command again to complete the transfer.`);
        return {
            content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: `❌ Approval failed: ${error instanceof Error ? error.message : "Unknown error"}`
                }]
        };
    }
}
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=bridge.js.map