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
 * - wallet_get_balance: Get token balances
 * - wallet_sign_message: Sign arbitrary messages (requires approval)
 * - wallet_sign_transaction: Sign transactions (requires approval)
 * - wallet_send: Send tokens (requires approval)
 * - wallet_logout: Clear local session
 * - wallet_resolve_ens: Resolve ENS names to addresses
 * - wallet_portfolio: View portfolio across all chains
 * - wallet_simulate: Preview what a transaction will do
 * - wallet_token_balance: Check ERC-20 token balances
 * - wallet_history: View transaction history
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { registerSetupTool } from "./tools/setup.js";
import { registerStatusTool } from "./tools/status.js";
import { registerAddressTool } from "./tools/address.js";
import { registerBalanceTool } from "./tools/balance.js";
import { registerSignMessageTool } from "./tools/sign-message.js";
import { registerSignTransactionTool } from "./tools/sign-transaction.js";
import { registerSendTool } from "./tools/send.js";
import { registerLogoutTool } from "./tools/logout.js";
import { registerResolveEnsTool } from "./tools/resolve-ens.js";
import { registerPortfolioTool } from "./tools/portfolio.js";
import { registerSimulateTool } from "./tools/simulate.js";
import { registerTokenBalanceTool } from "./tools/token-balance.js";
import { registerHistoryTool } from "./tools/history.js";
import { registerApprovalsTool } from "./tools/approvals.js";
import { registerSwapTool } from "./tools/swap.js";
import { registerEarnTool } from "./tools/earn.js";

// Create MCP server instance
const server = new McpServer({
  name: "para-wallet",
  version: "0.1.0",
});

// Register all wallet tools
registerSetupTool(server);
registerStatusTool(server);
registerAddressTool(server);
registerBalanceTool(server);
registerSignMessageTool(server);
registerSignTransactionTool(server);
registerSendTool(server);
registerLogoutTool(server);
registerResolveEnsTool(server);
registerPortfolioTool(server);
registerSimulateTool(server);
registerTokenBalanceTool(server);
registerHistoryTool(server);
registerApprovalsTool(server);
registerSwapTool(server);
registerEarnTool(server);

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
