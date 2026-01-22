/**
 * Transaction Simulation Tool
 *
 * Preview what a transaction will do before signing it.
 * Uses eth_call to simulate execution and detect potential issues.
 */
import { z } from "zod";
import { simulateTransaction } from "../para/client.js";
export function registerSimulateTool(server) {
    server.registerTool("wallet_simulate", {
        description: `Simulate a transaction to preview what it will do before signing.

Shows:
- Whether the transaction would succeed or fail
- Gas estimate and cost in USD
- Decoded function name (transfer, approve, swap, etc.)
- Known contract names (Uniswap, Aave, WETH, etc.)
- Warnings for risky operations (unlimited approvals, high value)

Use this before wallet_send or wallet_sign_transaction to understand what you're signing.

Example:
- Simulate sending ETH: to="0x...", value="1000000000000000000" (1 ETH in wei)
- Simulate token approval: to="0xTokenAddress", data="0x095ea7b3..." (approve calldata)
- Simulate swap: to="0xUniswapRouter", data="0x7ff36ab5..." (swap calldata)`,
        inputSchema: {
            to: z.string().describe("Target contract or address"),
            value: z.string().optional().describe("Value in wei (for ETH transfers)"),
            data: z.string().optional().describe("Transaction calldata (hex string)"),
            chain: z.enum(["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"])
                .optional()
                .default("ethereum")
                .describe("Chain to simulate on"),
        },
    }, async (args) => {
        try {
            const { to, value, data, chain = "ethereum" } = args;
            const result = await simulateTransaction({
                to,
                value,
                data,
            }, chain);
            // Build display output
            const lines = [];
            // Header with status
            const statusIcon = result.success ? "✅" : "❌";
            lines.push(`${statusIcon} **Simulation Result**`);
            lines.push("");
            // Action summary
            lines.push(`**Action:** ${result.action}`);
            lines.push(`**Description:** ${result.description}`);
            lines.push("");
            // Transaction details
            lines.push("**Details:**");
            lines.push(`• From: \`${result.details.from}\``);
            lines.push(`• To: \`${result.details.to}\`${result.details.contract ? ` (${result.details.contract})` : ""}`);
            if (result.details.value !== "0") {
                lines.push(`• Value: ${result.details.value} (${result.details.valueUsd})`);
            }
            if (result.details.function) {
                lines.push(`• Function: \`${result.details.function}()\``);
            }
            lines.push("");
            // Gas estimate
            lines.push(`**Gas:** ${result.gasEstimate} units (${result.gasUsd})`);
            lines.push("");
            // Warnings
            if (result.warnings.length > 0) {
                lines.push("**Warnings:**");
                for (const warning of result.warnings) {
                    lines.push(`• ${warning}`);
                }
                lines.push("");
            }
            // Error if failed
            if (!result.success && result.error) {
                lines.push("**Error:** " + result.error);
                lines.push("");
            }
            // Recommendation
            if (result.success && result.warnings.length === 0) {
                lines.push("✨ Transaction looks safe to execute.");
            }
            else if (result.success && result.warnings.length > 0) {
                lines.push("⚠️ Review warnings before proceeding.");
            }
            else {
                lines.push("🛑 Transaction would fail. Do not proceed.");
            }
            return {
                content: [
                    {
                        type: "text",
                        text: lines.join("\n"),
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Simulation failed: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=simulate.js.map