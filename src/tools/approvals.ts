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
import { z } from "zod";
import { getSession } from "../storage/session.js";
import {
  getApprovalHistory,
  getAllowance,
  formatApproval,
  encodeApproveCalldata,
  getTokenMetadata,
  sendTransaction,
  type SupportedChain,
  type TokenApproval,
} from "../para/client.js";

const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"] as const;

export function registerApprovalsTool(server: McpServer) {
  server.registerTool(
    "wallet_approvals",
    {
      description: `View and manage your token spending approvals.

Token approvals allow DeFi protocols to spend your tokens. This is normal for swaps
and deposits, but unlimited approvals can be risky if the protocol is compromised.

**View approvals:**
- chain="ethereum" → Shows all active approvals on Ethereum
- chain="base" → Shows all active approvals on Base

**Check specific approval:**
- token="USDC", spender="0x7a250d..." → Check USDC approval for specific contract

**Revoke approval (set to 0):**
- action="revoke", token="USDC", spender="0x7a250d..." → Removes the approval

⚠️ Warning: Revoking approvals costs gas. Only revoke if you're concerned about security.`,
      inputSchema: {
        chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to check approvals on"),
        action: z.enum(["list", "check", "revoke"]).optional().default("list").describe("Action: list all, check specific, or revoke"),
        token: z.string().optional().describe("Token address or symbol (for check/revoke)"),
        spender: z.string().optional().describe("Spender contract address (for check/revoke)"),
      },
    },
    async (args) => {
      const { chain, action = "list", token, spender } = args;

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

        // Handle different actions
        if (action === "list") {
          return await listApprovals(chain as SupportedChain, session.address);
        }

        if (action === "check") {
          if (!token || !spender) {
            return {
              content: [{
                type: "text" as const,
                text: `❌ Missing parameters. For checking a specific approval, provide both:\n` +
                  `- token: Token address or symbol (e.g., "USDC" or "0xa0b86991...")\n` +
                  `- spender: Contract address to check (e.g., "0x7a250d...")`
              }]
            };
          }
          return await checkApproval(chain as SupportedChain, token, spender);
        }

        if (action === "revoke") {
          if (!token || !spender) {
            return {
              content: [{
                type: "text" as const,
                text: `❌ Missing parameters. To revoke an approval, provide both:\n` +
                  `- token: Token address or symbol\n` +
                  `- spender: Contract address to revoke`
              }]
            };
          }
          return await revokeApproval(chain as SupportedChain, token, spender);
        }

        return {
          content: [{
            type: "text" as const,
            text: `❌ Unknown action: ${action}`
          }]
        };

      } catch (error) {
        console.error("wallet_approvals error:", error);
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
 * List all active approvals on a chain
 */
async function listApprovals(
  chain: SupportedChain,
  _address: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const history = await getApprovalHistory(chain);

  if (history.approvals.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: `🔒 Token Approvals on ${capitalizeFirst(chain)}\n\n` +
          `No active token approvals found.\n\n` +
          `This means no contracts have permission to spend your tokens on ${chain}.\n` +
          `That's great for security! 🛡️`
      }]
    };
  }

  const lines: string[] = [
    `🔓 Token Approvals on ${capitalizeFirst(chain)}`,
    `Address: ${history.address.slice(0, 6)}...${history.address.slice(-4)}`,
    "",
    `Found ${history.approvals.length} active approval(s):`,
    "",
  ];

  // Group by risk (unlimited vs limited)
  const unlimited = history.approvals.filter((a) => a.isUnlimited);
  const limited = history.approvals.filter((a) => !a.isUnlimited);

  if (unlimited.length > 0) {
    lines.push(`⚠️ **Unlimited Approvals** (${unlimited.length})`);
    lines.push("These allow contracts to spend ANY amount of your tokens:");
    lines.push("");
    for (const approval of unlimited) {
      lines.push(`  ${formatApproval(approval)}`);
    }
    lines.push("");
  }

  if (limited.length > 0) {
    lines.push(`✓ **Limited Approvals** (${limited.length})`);
    lines.push("");
    for (const approval of limited) {
      lines.push(`  ${formatApproval(approval)}`);
    }
    lines.push("");
  }

  // Security tips
  lines.push("─".repeat(40));
  lines.push("💡 **Security Tips:**");
  if (unlimited.length > 0) {
    lines.push(`• Consider revoking unlimited approvals you no longer use`);
    lines.push(`• Use: action="revoke", token="...", spender="..."`);
  }
  lines.push(`• Approvals only affect ERC-20 tokens, not native ETH`);
  lines.push(`• Revoking costs gas (~$0.50-5 depending on network)`);

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}

/**
 * Check a specific approval
 */
async function checkApproval(
  chain: SupportedChain,
  tokenInput: string,
  spenderAddress: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Resolve token address
  let tokenAddress: string;
  if (tokenInput.startsWith("0x")) {
    tokenAddress = tokenInput;
  } else {
    // It's a symbol - look it up
    const metadata = await getTokenMetadata(tokenInput, chain);
    tokenAddress = metadata.address;
  }

  const approval = await getAllowance(tokenAddress, spenderAddress, chain);

  const lines: string[] = [
    `🔍 Approval Check`,
    "",
    `Token: ${approval.tokenSymbol} (${approval.tokenAddress.slice(0, 8)}...)`,
    `Spender: ${approval.spenderName || approval.spenderAddress}`,
    `Chain: ${capitalizeFirst(chain)}`,
    "",
    `Current Allowance: ${approval.allowance}`,
  ];

  if (approval.isUnlimited) {
    lines.push("");
    lines.push(`⚠️ This is an UNLIMITED approval!`);
    lines.push(`The spender can transfer any amount of your ${approval.tokenSymbol}.`);
    lines.push("");
    lines.push(`To revoke: action="revoke", token="${tokenInput}", spender="${spenderAddress}"`);
  } else if (approval.allowanceRaw === "0") {
    lines.push("");
    lines.push(`✓ No active approval. This contract cannot spend your ${approval.tokenSymbol}.`);
  } else {
    lines.push("");
    lines.push(`ℹ️ This is a limited approval.`);
    lines.push(`The spender can transfer up to ${approval.allowance} ${approval.tokenSymbol}.`);
  }

  return {
    content: [{
      type: "text" as const,
      text: lines.join("\n")
    }]
  };
}

/**
 * Revoke an approval (set to 0)
 */
async function revokeApproval(
  chain: SupportedChain,
  tokenInput: string,
  spenderAddress: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Resolve token address
  let tokenAddress: string;
  let tokenSymbol: string;
  let tokenDecimals: number;

  if (tokenInput.startsWith("0x")) {
    const metadata = await getTokenMetadata(tokenInput, chain);
    tokenAddress = metadata.address;
    tokenSymbol = metadata.symbol;
    tokenDecimals = metadata.decimals;
  } else {
    const metadata = await getTokenMetadata(tokenInput, chain);
    tokenAddress = metadata.address;
    tokenSymbol = metadata.symbol;
    tokenDecimals = metadata.decimals;
  }

  // Check current allowance first
  const currentApproval = await getAllowance(tokenAddress, spenderAddress, chain);

  if (currentApproval.allowanceRaw === "0") {
    return {
      content: [{
        type: "text" as const,
        text: `ℹ️ No approval to revoke.\n\n` +
          `${spenderAddress.slice(0, 8)}... already has no allowance for ${tokenSymbol}.`
      }]
    };
  }

  // Encode approve(spender, 0) transaction
  const data = encodeApproveCalldata(spenderAddress, "0", tokenDecimals);

  const lines: string[] = [
    `🔐 Revoke Approval`,
    "",
    `Token: ${tokenSymbol}`,
    `Spender: ${currentApproval.spenderName || spenderAddress}`,
    `Current Allowance: ${currentApproval.allowance}`,
    "",
    `⏳ Sending revoke transaction...`,
  ];

  try {
    // Send the approve(spender, 0) transaction
    // sendTransaction(to, amount, chain, tokenAddress?, data?)
    const result = await sendTransaction(
      tokenAddress,  // to: the token contract
      "0",           // amount: 0 ETH value
      chain,
      undefined,     // tokenAddress: not needed
      data           // data: the approve(spender, 0) calldata
    );

    lines.push("");
    lines.push(`✅ Approval revoked successfully!`);
    lines.push("");
    lines.push(`Transaction: ${result.txHash || result.signature?.slice(0, 16) || "pending"}...`);
    lines.push("");
    lines.push(`${spenderAddress.slice(0, 8)}... can no longer spend your ${tokenSymbol}.`);

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
        text: `❌ Failed to revoke approval: ${error instanceof Error ? error.message : "Unknown error"}`
      }]
    };
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
