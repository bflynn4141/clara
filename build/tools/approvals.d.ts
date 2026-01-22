/**
 * wallet_approvals - View and manage token spending approvals
 *
 * Shows all active token approvals (spending permissions) and allows revoking them.
 * Critical for security - unlimited approvals can be exploited if protocols are compromised.
 *
 * Uses:
 * - ERC-20 allowance() to check current approvals
 * - Block explorer APIs to find tokens with active approvals
 * - ERC-20 approve(spender, 0) to revoke
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerApprovalsTool(server: McpServer): void;
//# sourceMappingURL=approvals.d.ts.map