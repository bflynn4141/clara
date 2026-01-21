/**
 * wallet_setup - Initialize wallet with zero friction
 *
 * Hybrid approach:
 * 1. No params → auto-generate UUID, instant wallet (zero friction)
 * 2. Email provided → use email as identifier (portable, claimable on getpara.com)
 *
 * Para's pregenerated wallets are created instantly - no verification needed.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerSetupTool(server: McpServer): void;
//# sourceMappingURL=setup.d.ts.map