/**
 * wallet_token_balance - Check ERC-20 token balance
 *
 * Supports checking any ERC-20 token by:
 * - Symbol (USDC, USDT, DAI, WETH, WBTC)
 * - Contract address
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../storage/session.js";
import {
  getTokenBalance,
  resolveToken,
  getTokenMetadata,
  fetchPrices,
  type SupportedChain,
  POPULAR_TOKENS,
} from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"] as const;

export function registerTokenBalanceTool(server: McpServer) {
  server.registerTool(
    "wallet_token_balance",
    {
      description: `Check your ERC-20 token balance.

Examples:
- Check USDC: token="USDC", chain="ethereum"
- Check by address: token="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", chain="ethereum"
- Check all popular tokens: (omit token parameter)

Supported tokens by symbol: USDC, USDT, DAI, WETH, WBTC`,
      inputSchema: {
        token: z.string().optional().describe("Token symbol (USDC, USDT, DAI, WETH, WBTC) or contract address. Omit to show all popular tokens."),
        chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to check balance on"),
      },
    },
    async (args) => {
      const { token, chain } = args;

      try {
        const session = await getSession();

        if (!session?.authenticated || !session.address) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`
            }]
          };
        }

        // If no token specified, show all popular tokens on this chain
        if (!token) {
          return await showAllTokenBalances(chain as SupportedChain, session.address);
        }

        // Resolve token
        let tokenAddress: string;
        let tokenSymbol: string;

        const knownToken = resolveToken(token, chain as SupportedChain);
        if (knownToken) {
          tokenAddress = knownToken.address;
          tokenSymbol = knownToken.symbol;
        } else if (token.startsWith("0x")) {
          const metadata = await getTokenMetadata(token, chain as SupportedChain);
          tokenAddress = metadata.address;
          tokenSymbol = metadata.symbol;
        } else {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Unknown token "${token}" on ${chain}\n\n` +
                `Supported tokens: USDC, USDT, DAI, WETH, WBTC\n` +
                `Or provide a token contract address (0x...)`
            }]
          };
        }

        // Get balance
        const balanceInfo = await getTokenBalance(tokenAddress, chain as SupportedChain, session.address);

        return {
          content: [{
            type: "text" as const,
            text: `💰 Token Balance\n\n` +
              `Token: ${balanceInfo.symbol}\n` +
              `Balance: ${balanceInfo.balance} ${balanceInfo.symbol}\n` +
              `Chain: ${chain}\n` +
              `Contract: ${tokenAddress}`
          }]
        };

      } catch (error) {
        console.error("wallet_token_balance error:", error);
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
          }]
        };
      }
    }
  );
}

/**
 * Show balances for all popular tokens on a chain
 */
async function showAllTokenBalances(
  chain: SupportedChain,
  ownerAddress: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const lines: string[] = [`💰 Token Balances on ${chain.charAt(0).toUpperCase() + chain.slice(1)}`, ""];

  // Get available tokens for this chain
  const tokensToCheck: Array<{ symbol: string; address: string }> = [];

  for (const [symbol, chainData] of Object.entries(POPULAR_TOKENS)) {
    const tokenInfo = chainData[chain];
    if (tokenInfo) {
      tokensToCheck.push({ symbol, address: tokenInfo.address });
    }
  }

  if (tokensToCheck.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: `No popular tokens configured for ${chain}.\n\nProvide a token address to check a specific token.`
      }]
    };
  }

  // Fetch all balances in parallel
  const balancePromises = tokensToCheck.map(async ({ symbol, address }) => {
    try {
      const balance = await getTokenBalance(address, chain, ownerAddress);
      return { symbol, balance: balance.balance, hasBalance: parseFloat(balance.balance) > 0 };
    } catch {
      return { symbol, balance: "error", hasBalance: false };
    }
  });

  const balances = await Promise.all(balancePromises);

  // Sort: tokens with balance first, then alphabetically
  balances.sort((a, b) => {
    if (a.hasBalance && !b.hasBalance) return -1;
    if (!a.hasBalance && b.hasBalance) return 1;
    return a.symbol.localeCompare(b.symbol);
  });

  // Format output
  let hasAnyBalance = false;
  for (const { symbol, balance, hasBalance } of balances) {
    if (hasBalance) {
      lines.push(`✓ ${symbol}: ${balance}`);
      hasAnyBalance = true;
    } else if (balance !== "error") {
      lines.push(`  ${symbol}: ${balance}`);
    }
  }

  if (!hasAnyBalance) {
    lines.push("No token balances found.");
    lines.push("");
    lines.push("To receive tokens, share your address:");
    lines.push(`${ownerAddress}`);
  }

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}
