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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import {
  getSwapQuote,
  getSwapQuoteBest,
  executeSwap,
  encodeApproveCalldata,
  getTokenMetadata,
  sendTransaction,
  getTokenBalance,
  getBalances,
  resolveToken,
  type SupportedChain,
  type SwapQuote,
} from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"] as const;

export function registerSwapTool(server: McpServer) {
  server.registerTool(
    "wallet_swap",
    {
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
    },
    async (args) => {
      const { fromToken, toToken, amount, chain, action = "quote", slippage = 0.5 } = args;

      try {
        const session = await getSession();

        if (!session?.authenticated || !session.address) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ No wallet configured. Run wallet_setup first.`
            }]
          };
        }

        // Check balance first
        const balanceCheck = await checkBalance(fromToken, amount, chain as SupportedChain, session.address);
        if (!balanceCheck.sufficient) {
          const capitalChain = chain.charAt(0).toUpperCase() + chain.slice(1);
          const lines: string[] = [
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
              type: "text" as const,
              text: lines.join("\n")
            }]
          };
        }

        // Get best quote from multiple aggregators (Li.Fi + 0x)
        const quote = await getSwapQuoteBest(
          fromToken,
          toToken,
          amount,
          chain as SupportedChain,
          { slippage }
        );

        // Format quote for display
        const quoteDisplay = formatQuote(quote, chain as SupportedChain);

        if (action === "quote") {
          // Just show the quote
          return {
            content: [{
              type: "text" as const,
              text: quoteDisplay + "\n\n" +
                `To execute this swap, run again with action="execute"`
            }]
          };
        }

        // Execute the swap
        if (quote.needsApproval) {
          // Need to approve first
          return await handleApproval(quote, chain as SupportedChain);
        }

        // Execute the swap
        const result = await executeSwap(quote, chain as SupportedChain);

        // Build success message
        const successLines: string[] = [
          formatQuote(quote, chain as SupportedChain),
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
            type: "text" as const,
            text: successLines.join("\n")
          }]
        };

      } catch (error) {
        console.error("wallet_swap error:", error);
        return {
          content: [{
            type: "text" as const,
            text: `❌ Swap failed: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );
}

/**
 * Check if user has sufficient balance for the swap
 */
async function checkBalance(
  token: string,
  amount: string,
  chain: SupportedChain,
  address: string
): Promise<{ sufficient: boolean; balance: string }> {
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
    let tokenAddress: string;
    if (token.startsWith("0x")) {
      tokenAddress = token;
    } else {
      // Use resolveToken to properly convert symbol to address
      const resolved = resolveToken(token, chain);
      if (!resolved) {
        // Token not supported on this chain
        return { sufficient: false, balance: "0" };
      }
      tokenAddress = resolved.address;
    }

    const tokenBalance = await getTokenBalance(tokenAddress, chain, address);
    const balance = parseFloat(tokenBalance.balance);
    return {
      sufficient: balance >= amountNum,
      balance: tokenBalance.balance,
    };
  } catch {
    return { sufficient: false, balance: "0" };
  }
}

/**
 * Format a swap quote for display
 */
function formatQuote(quote: SwapQuote, chain: SupportedChain): string {
  const sourceLabel = quote.source === "0x" ? "0x" : "Li.Fi";
  const lines: string[] = [
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
    } else {
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
async function handleApproval(
  quote: SwapQuote,
  chain: SupportedChain
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!quote.approvalAddress) {
    return {
      content: [{
        type: "text" as const,
        text: `❌ Approval address not provided in quote. Please try again.`
      }]
    };
  }

  const lines: string[] = [
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
    const result = await sendTransaction(
      quote.fromToken.address,
      "0",
      chain,
      undefined,
      approvalData
    );

    lines.push("");
    lines.push(`✅ Approval submitted: ${result.txHash}`);
    lines.push("");
    lines.push(`⏳ Please wait for confirmation, then run the swap again.`);
    lines.push("");
    lines.push(`Note: After approval confirms, run the swap command again to complete the trade.`);

    return {
      content: [{
        type: "text" as const,
        text: lines.join("\n")
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: `❌ Approval failed: ${error instanceof Error ? error.message : "Unknown error"}`
      }]
    };
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
