/**
 * wallet_earn - Intent-based yield earning
 *
 * User says "earn yield on my USDC" and we:
 * 1. Find the best yield across supported protocols (Aave v3)
 * 2. Check balances across chains
 * 3. Route to the best option
 * 4. Execute deposit after confirmation
 *
 * Powered by DeFiLlama for yield discovery + Aave v3 adapter
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerEarnTool(server: McpServer): void;
//# sourceMappingURL=earn.d.ts.map