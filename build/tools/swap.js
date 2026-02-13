/**
 * wallet_swap - Swap tokens via DEX aggregation
 *
 * Uses Li.Fi to find the best rates across multiple DEXs:
 * - Uniswap, Sushiswap, Curve, Balancer, and more
 * - Automatic routing for best price
 * - Slippage protection
 *
 * Supports:
 * - Native tokens (ETH, MATIC)
 * - ERC-20 tokens (USDC, USDT, DAI, WETH, WBTC)
 * - Any token by contract address
 */
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { getSwapQuoteBest, executeSwap, encodeApproveCalldata, getTokenMetadata, sendTransaction, getBalances, } from "../para/client.js";
import { parseAndValidateAmount, zodAmount, zodToken, gasGuidance } from "../utils/validators.js";
import { checkBalance } from "../utils/balance.js";
const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
export function registerSwapTool(server) {
    server.registerTool("wallet_swap", {
        description: `Swap tokens using DEX aggregation for best rates.

Finds the best price across Uniswap, Sushiswap, Curve, and other DEXs.

**Get a quote:**
- fromToken="ETH", toToken="USDC", amount="0.1", chain="base"
- fromToken="USDC", toToken="WETH", amount="100", chain="ethereum"

**Execute the swap:**
- Add action="execute" to perform the swap after reviewing the quote

**Examples:**
- "Swap 0.1 ETH for USDC on Base" → Gets quote, then executes
- "How much USDC would I get for 1 ETH?" → Quote only
- "Swap 100 USDC for ETH on Arbitrum"

Supported tokens: ETH, MATIC, USDC, USDT, DAI, WETH, WBTC (or any contract address)`,
        inputSchema: {
            fromToken: zodToken.describe("Token to sell (symbol like ETH/USDC or contract address)"),
            toToken: zodToken.describe("Token to buy (symbol like ETH/USDC or contract address)"),
            amount: zodAmount.describe("Amount of fromToken to swap"),
            chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to swap on"),
            action: z.enum(["quote", "execute"]).optional().default("quote").describe("quote = preview only, execute = perform the swap"),
            slippage: z.number().optional().default(0.5).describe("Max slippage percentage (default 0.5%)"),
        },
    }, async (args) => {
        const { fromToken, toToken, amount, chain, action = "quote", slippage = 0.5 } = args;
        try {
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
            // ── Input validation (before any API calls) ──
            const amountCheck = parseAndValidateAmount(amount);
            if (!amountCheck.valid) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Invalid amount: ${amountCheck.error}\n\nExample: amount="0.1" to swap 0.1 ETH`
                        }]
                };
            }
            if (fromToken.toUpperCase() === toToken.toUpperCase()) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Cannot swap ${fromToken.toUpperCase()} to itself.\n\n` +
                                `Did you mean to bridge to another chain? Try:\n` +
                                `  \`wallet_bridge fromToken="${fromToken}" toToken="${toToken}" fromChain="${chain}" toChain="..."\``
                        }]
                };
            }
            // Check gas balance (the "why does nothing work?" issue for newbies)
            try {
                const balances = await getBalances(chain);
                const nativeBalance = parseFloat(balances[0]?.balance || "0");
                if (nativeBalance === 0) {
                    return {
                        content: [{
                                type: "text",
                                text: gasGuidance(chain)
                            }]
                    };
                }
            }
            catch {
                // Don't block on gas check failure
            }
            // Check balance first
            const balanceCheck = await checkBalance(fromToken, amount, chain, session.address);
            if (!balanceCheck.sufficient) {
                const capitalChain = chain.charAt(0).toUpperCase() + chain.slice(1);
                const lines = [
                    `❌ Insufficient ${fromToken.toUpperCase()} on ${capitalChain}`,
                    "",
                    `You want to swap: ${amount} ${fromToken.toUpperCase()}`,
                    `Your balance: ${balanceCheck.balance} ${fromToken.toUpperCase()}`,
                    "",
                    "💡 Options:",
                ];
                if (parseFloat(balanceCheck.balance) > 0) {
                    lines.push(`  • Swap available balance: wallet_swap fromToken="${fromToken}" toToken="${toToken}" amount="${balanceCheck.balance}" chain="${chain}"`);
                }
                lines.push(`  • Bridge from another chain: wallet_bridge fromToken="${fromToken.toUpperCase()}" toChain="${chain}"`);
                lines.push(`  • Receive tokens: Send ${fromToken.toUpperCase()} to ${session.address}`);
                return {
                    content: [{
                            type: "text",
                            text: lines.join("\n")
                        }]
                };
            }
            // Get best quote from multiple aggregators (Li.Fi + 0x)
            const quote = await getSwapQuoteBest(fromToken, toToken, amount, chain, { slippage });
            // Format quote for display
            const quoteDisplay = formatQuote(quote, chain);
            if (action === "quote") {
                // Just show the quote
                return {
                    content: [{
                            type: "text",
                            text: quoteDisplay + "\n\n" +
                                `To execute this swap, run again with action="execute"`
                        }]
                };
            }
            // Execute the swap
            if (quote.needsApproval) {
                // Need to approve first
                return await handleApproval(quote, chain);
            }
            // Execute the swap
            const result = await executeSwap(quote, chain);
            // Build success message
            const successLines = [
                formatQuote(quote, chain),
                "",
                `✅ Swap submitted!`,
                "",
                `Transaction: ${result.txHash}`,
                `Status: ${result.status}`,
                "",
                `Your ${quote.toToken.symbol} will arrive shortly.`,
            ];
            return {
                content: [{
                        type: "text",
                        text: successLines.join("\n")
                    }]
            };
        }
        catch (error) {
            console.error("wallet_swap error:", error);
            const msg = error instanceof Error ? error.message : "Unknown error";
            const isGasError = /insufficient funds|gas required|intrinsic gas/i.test(msg);
            const isLiquidityError = /no route|liquidity|no quotes/i.test(msg);
            let guidance = "";
            if (isGasError) {
                guidance = `\n\n${gasGuidance(chain)}`;
            }
            else if (isLiquidityError) {
                guidance = "\n\nNot enough liquidity for this swap. Try a smaller amount or a different token pair.";
            }
            return {
                content: [{
                        type: "text",
                        text: `❌ Swap failed: ${msg}${guidance}`
                    }]
            };
        }
    });
}
// checkBalance extracted to ../utils/balance.ts
/**
 * Format a swap quote for display
 */
function formatQuote(quote, chain) {
    const sourceLabel = quote.source === "0x" ? "0x" : "Li.Fi";
    const lines = [
        `🔄 Swap Quote on ${capitalizeFirst(chain)} (via ${sourceLabel})`,
        "",
        `**You send:** ${quote.fromAmount} ${quote.fromToken.symbol}${quote.fromAmountUsd !== "0" ? ` (~$${quote.fromAmountUsd})` : ""}`,
        `**You receive:** ${quote.toAmount} ${quote.toToken.symbol}${quote.toAmountUsd !== "0" ? ` (~$${quote.toAmountUsd})` : ""}`,
        `**Minimum:** ${quote.toAmountMin} ${quote.toToken.symbol} (after slippage)`,
        "",
        `**Rate:** 1 ${quote.fromToken.symbol} = ${quote.exchangeRate} ${quote.toToken.symbol}`,
        `**Price Impact:** ${quote.priceImpact}%`,
        `**Gas:** ~$${quote.estimatedGasUsd}`,
        `**Route:** ${quote.toolDetails || quote.tool}`,
    ];
    // Warn about high price impact
    const impact = parseFloat(quote.priceImpact);
    if (impact > 1) {
        lines.push("");
        if (impact > 5) {
            lines.push(`⚠️ HIGH PRICE IMPACT! You may lose significant value.`);
        }
        else {
            lines.push(`⚠️ Price impact is above 1%. Consider a smaller swap.`);
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
 * Handle the approval flow for a swap
 */
async function handleApproval(quote, chain) {
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
        `Before swapping, you need to approve the DEX to spend your ${quote.fromToken.symbol}.`,
        "",
        `Token: ${quote.fromToken.symbol}`,
        `Spender: ${quote.approvalAddress.slice(0, 8)}...${quote.approvalAddress.slice(-6)}`,
        `Amount: ${quote.fromAmount} ${quote.fromToken.symbol}`,
        "",
        `⏳ Sending approval transaction...`,
    ];
    try {
        // Get token metadata
        const metadata = await getTokenMetadata(quote.fromToken.address, chain);
        // Encode unlimited approval (common practice for DEXs)
        const approvalData = encodeApproveCalldata(quote.approvalAddress, "unlimited", metadata.decimals);
        // Send approval transaction
        const result = await sendTransaction(quote.fromToken.address, "0", chain, undefined, approvalData);
        lines.push("");
        lines.push(`✅ Approval submitted: ${result.txHash}`);
        lines.push("");
        lines.push(`⏳ Please wait for confirmation, then run the swap again.`);
        lines.push("");
        lines.push(`Note: After approval confirms, run the swap command again to complete the trade.`);
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
//# sourceMappingURL=swap.js.map