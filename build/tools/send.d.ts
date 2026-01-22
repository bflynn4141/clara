/**
 * wallet_send - Send tokens to an address
 *
 * Supports:
 * - Native tokens (ETH, MATIC, SOL)
 * - ERC-20 tokens by symbol (USDC, USDT, DAI, WETH, WBTC)
 * - ERC-20 tokens by contract address
 *
 * SECURITY: Requires user approval via Claude Code's permission system.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerSendTool(server: McpServer): void;
//# sourceMappingURL=send.d.ts.map