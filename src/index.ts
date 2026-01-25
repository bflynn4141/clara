#!/usr/bin/env node
/**
 * Para Wallet MCP Server
 *
 * Universal wallet infrastructure for Claude Code plugins.
 * Powered by Para (getpara.com) for MPC-based non-custodial wallets.
 *
 * Tools:
 * - wallet_setup: Initialize wallet with email OTP
 * - wallet_status: Check authentication status
 * - wallet_get_address: Get wallet address for a chain
 * - wallet_balance: Unified balance tool (replaces get_balance, portfolio, token_balance)
 * - wallet_sign_message: Sign arbitrary messages (requires approval)
 * - wallet_sign_transaction: Sign transactions (requires approval)
 * - wallet_send: Send tokens (requires approval)
 * - wallet_logout: Clear local session
 * - wallet_resolve_ens: Resolve ENS names to addresses
 * - wallet_simulate: Preview what a transaction will do
 * - wallet_history: View transaction history
 * - wallet_swap: Swap tokens via DEX aggregation (Li.Fi + 0x)
 * - wallet_bridge: Bridge tokens across chains (supports cross-chain swaps)
 * - wallet_earn: Earn yield on tokens via lending protocols
 *
 * App Tokenization:
 * - wallet_create_app_token: Deploy a tokenized app with bonding curve
 * - wallet_buy_app_token: Buy tokens on the bonding curve
 * - wallet_sell_app_token: Sell tokens back to the curve
 * - wallet_claim_dividends: Claim your revenue share
 * - wallet_app_token_info: View token stats and your position
 * - wallet_distribute_revenue: (Creators) Share revenue with holders
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { registerSetupTool } from "./tools/setup.js";
import { registerRestoreTool } from "./tools/restore.js";
import { registerStatusTool } from "./tools/status.js";
import { registerAddressTool } from "./tools/address.js";
import { registerUnifiedBalanceTool } from "./tools/balance-unified.js";
import { registerSignMessageTool } from "./tools/sign-message.js";
import { registerSignTransactionTool } from "./tools/sign-transaction.js";
import { registerSendTool } from "./tools/send.js";
import { registerLogoutTool } from "./tools/logout.js";
import { registerResolveEnsTool } from "./tools/resolve-ens.js";
import { registerSimulateTool } from "./tools/simulate.js";
import { registerHistoryTool } from "./tools/history.js";
import { registerApprovalsTool } from "./tools/approvals.js";
import { registerSwapTool } from "./tools/swap.js";
import { registerBridgeTool } from "./tools/bridge.js";
import { registerEarnTool } from "./tools/earn.js";
import { registerAppTokenTools } from "./tools/app-token.js";

// Create MCP server instance
const server = new McpServer({
  name: "para-wallet",
  version: "0.1.0",
});

// Register all wallet tools
registerSetupTool(server);
registerRestoreTool(server);
registerStatusTool(server);
registerAddressTool(server);
registerUnifiedBalanceTool(server);
registerSignMessageTool(server);
registerSignTransactionTool(server);
registerSendTool(server);
registerLogoutTool(server);
registerResolveEnsTool(server);
registerSimulateTool(server);
registerHistoryTool(server);
registerApprovalsTool(server);
registerSwapTool(server);
registerBridgeTool(server);
registerEarnTool(server);
registerAppTokenTools(server);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Para Wallet MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
