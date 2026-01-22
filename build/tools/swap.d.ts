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
export declare function registerSwapTool(server: McpServer): void;
//# sourceMappingURL=swap.d.ts.map