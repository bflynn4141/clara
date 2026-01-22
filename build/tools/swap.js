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
import { getSwapQuote, executeSwap, encodeApproveCalldata, getTokenMetadata, sendTransaction, getTokenBalance, getBalances, } from "../para/client.js";
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
            fromToken: z.string().describe("Token to sell (symbol like ETH/USDC or contract address)"),
            toToken: z.string().describe("Token to buy (symbol like ETH/USDC or contract address)"),
            amount: z.string().describe("Amount of fromToken to swap"),
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
                            text: `❌ No wallet configured. Run wallet_setup first.`
                        }]
                };
            }
            // Check balance first
            const balanceCheck = await checkBalance(fromToken, amount, chain, session.address);
            if (!balanceCheck.sufficient) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Insufficient balance\n\n` +
                                `You want to swap: ${amount} ${fromToken.toUpperCase()}\n` +
                                `Your balance: ${balanceCheck.balance} ${fromToken.toUpperCase()}\n\n` +
                                `Please reduce the amount or add more ${fromToken.toUpperCase()} to your wallet.`
                        }]
                };
            }
            // Get quote
            const quote = await getSwapQuote(fromToken, toToken, amount, chain, slippage);
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
            return {
                content: [{
                        type: "text",
                        text: quoteDisplay + "\n\n" +
                            `✅ Swap submitted!\n\n` +
                            `Transaction: ${result.txHash}\n` +
                            `Status: ${result.status}\n\n` +
                            `Your ${quote.toToken.symbol} will arrive shortly.`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_swap error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Swap failed: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
/**
 * Check if user has sufficient balance for the swap
 */
async function checkBalance(token, amount, chain, address) {
    const amountNum = parseFloat(amount);
    // Check native token balance
    const nativeSymbols = ["ETH", "MATIC", "NATIVE"];
    if (nativeSymbols.includes(token.toUpperCase())) {
        const balances = await getBalances(chain);
        const balance = parseFloat(balances[0]?.balance || "0");
        return {
            sufficient: balance >= amountNum,
            balance: balances[0]?.balance || "0",
        };
    }
    // Check ERC-20 token balance
    try {
        let tokenAddress;
        if (token.startsWith("0x")) {
            tokenAddress = token;
        }
        else {
            const metadata = await getTokenMetadata(token, chain);
            tokenAddress = metadata.address;
        }
        const tokenBalance = await getTokenBalance(tokenAddress, chain, address);
        const balance = parseFloat(tokenBalance.balance);
        return {
            sufficient: balance >= amountNum,
            balance: tokenBalance.balance,
        };
    }
    catch {
        // If we can't check balance, assume sufficient and let the swap fail if not
        return { sufficient: true, balance: "unknown" };
    }
}
/**
 * Format a swap quote for display
 */
function formatQuote(quote, chain) {
    const lines = [
        `🔄 Swap Quote on ${capitalizeFirst(chain)}`,
        "",
        `**You send:** ${quote.fromAmount} ${quote.fromToken.symbol} (~$${quote.fromAmountUsd})`,
        `**You receive:** ${quote.toAmount} ${quote.toToken.symbol} (~$${quote.toAmountUsd})`,
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