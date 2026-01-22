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
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { sendTransaction, estimateGas, resolveEnsName, isEnsName, simulateTransaction, resolveToken, getTokenMetadata, encodeERC20Transfer, getTokenBalance, } from "../para/client.js";
const SUPPORTED_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "solana"];
export function registerSendTool(server) {
    server.registerTool("wallet_send", {
        description: `Send native tokens or ERC-20 tokens to an address or ENS name.

Examples:
- Send ETH: to="vitalik.eth", amount="0.1", chain="ethereum"
- Send USDC: to="0x...", amount="100", chain="base", token="USDC"
- Send token by address: to="0x...", amount="50", chain="ethereum", token="0xa0b86991..."

Supported tokens by symbol: USDC, USDT, DAI, WETH, WBTC
Or provide any ERC-20 token contract address.

REQUIRES USER APPROVAL.`,
        inputSchema: {
            to: z.string().describe("Recipient address or ENS name (e.g., '0x...' or 'vitalik.eth')"),
            amount: z.string().describe("Amount to send in human units (e.g., '100' for 100 USDC)"),
            chain: z.enum(SUPPORTED_CHAINS).describe("Blockchain to send on"),
            token: z.string().optional().describe("Token symbol (USDC, USDT, DAI, WETH, WBTC) or contract address. Omit for native token."),
        },
    }, async (args) => {
        const { to, amount, chain, token } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured. Run wallet_setup first.`
                        }]
                };
            }
            // Resolve ENS name if applicable (only for EVM chains)
            let resolvedTo = to;
            let ensName = null;
            if (chain !== "solana" && isEnsName(to)) {
                ensName = to;
                const resolved = await resolveEnsName(to);
                if (!resolved) {
                    return {
                        content: [{
                                type: "text",
                                text: `❌ Could not resolve ENS name "${to}"\n\n` +
                                    `The name may not be registered or doesn't have an address set.\n` +
                                    `Check: https://app.ens.domains/name/${to}`
                            }]
                    };
                }
                resolvedTo = resolved;
            }
            // Handle ERC-20 token transfer
            if (token && chain !== "solana") {
                return await handleERC20Transfer(resolvedTo, ensName, amount, chain, token, session.address);
            }
            // Native token transfer
            const tokenSymbol = getNativeSymbol(chain);
            const valueWei = chain !== "solana"
                ? (BigInt(Math.floor(parseFloat(amount) * 1e18))).toString()
                : amount;
            // Simulate transaction first (EVM only)
            let simulationWarnings = [];
            let simulationFailed = false;
            if (chain !== "solana") {
                try {
                    const simulation = await simulateTransaction({ to: resolvedTo, value: valueWei }, chain);
                    simulationWarnings = simulation.warnings;
                    simulationFailed = !simulation.success;
                    if (simulationFailed) {
                        simulationWarnings.unshift(`🚨 Simulation FAILED: ${simulation.error || "Transaction would revert"}`);
                    }
                }
                catch (simError) {
                    console.error("[clara] Simulation error:", simError);
                    simulationWarnings.push("⚠️ Could not simulate transaction");
                }
            }
            // Estimate gas
            const gasEstimate = await estimateGas({ to: resolvedTo, value: amount }, chain);
            // Build transaction details
            const txDetails = [
                `┌─────────────────────────────────────`,
                `│ Send Transaction`,
                `│`,
                ensName ? `│ To: ${ensName}` : null,
                ensName ? `│     → ${resolvedTo}` : `│ To: ${resolvedTo}`,
                `│ Amount: ${amount} ${tokenSymbol}`,
                `│ Chain: ${chain}`,
                `│ Est. Fee: ~$${gasEstimate.estimatedCostUsd}`,
                simulationWarnings.length > 0 ? `│` : null,
                ...simulationWarnings.map(w => `│ ${w}`),
                `└─────────────────────────────────────`,
            ].filter(Boolean).join("\n");
            // Execute send
            const result = await sendTransaction(resolvedTo, amount, chain, undefined);
            return {
                content: [{
                        type: "text",
                        text: `✓ Transaction sent!\n\n` +
                            `${txDetails}\n\n` +
                            `Transaction Hash:\n${result.txHash}\n\n` +
                            `Track: ${getExplorerUrl(chain, result.txHash)}`
                    }]
            };
        }
        catch (error) {
            console.error("wallet_send error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`
                    }]
            };
        }
    });
}
/**
 * Handle ERC-20 token transfer
 */
async function handleERC20Transfer(to, ensName, amount, chain, tokenInput, fromAddress) {
    // Resolve token (by symbol or address)
    let tokenAddress;
    let tokenSymbol;
    let tokenDecimals;
    const knownToken = resolveToken(tokenInput, chain);
    if (knownToken) {
        tokenAddress = knownToken.address;
        tokenSymbol = knownToken.symbol;
        tokenDecimals = knownToken.decimals;
    }
    else if (tokenInput.startsWith("0x")) {
        // Custom token address - fetch metadata
        const metadata = await getTokenMetadata(tokenInput, chain);
        tokenAddress = metadata.address;
        tokenSymbol = metadata.symbol;
        tokenDecimals = metadata.decimals;
    }
    else {
        return {
            content: [{
                    type: "text",
                    text: `❌ Unknown token "${tokenInput}" on ${chain}\n\n` +
                        `Supported tokens: USDC, USDT, DAI, WETH, WBTC\n` +
                        `Or provide a token contract address (0x...)`
                }]
        };
    }
    // Check balance before attempting transfer
    try {
        const balanceInfo = await getTokenBalance(tokenAddress, chain, fromAddress);
        const userBalance = parseFloat(balanceInfo.balance);
        const sendAmount = parseFloat(amount);
        if (userBalance < sendAmount) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Insufficient ${tokenSymbol} balance\n\n` +
                            `You have: ${balanceInfo.balance} ${tokenSymbol}\n` +
                            `Trying to send: ${amount} ${tokenSymbol}\n\n` +
                            `Shortfall: ${(sendAmount - userBalance).toFixed(6)} ${tokenSymbol}`
                    }]
            };
        }
    }
    catch (balanceError) {
        console.error("[clara] Balance check failed:", balanceError);
        // Continue anyway - let the transaction fail if insufficient
    }
    // Encode ERC-20 transfer calldata
    const transferData = encodeERC20Transfer(to, amount, tokenDecimals);
    // Simulate the ERC-20 transfer
    let simulationWarnings = [];
    let simulationFailed = false;
    try {
        const simulation = await simulateTransaction({ to: tokenAddress, data: transferData, value: "0" }, chain);
        simulationWarnings = simulation.warnings;
        simulationFailed = !simulation.success;
        if (simulationFailed) {
            simulationWarnings.unshift(`🚨 Simulation FAILED: ${simulation.error || "Transaction would revert"}`);
        }
    }
    catch (simError) {
        console.error("[clara] ERC-20 simulation error:", simError);
        simulationWarnings.push("⚠️ Could not simulate transaction");
    }
    // Estimate gas for the token transfer
    const gasEstimate = await estimateGas({ to: tokenAddress, data: transferData, value: "0" }, chain);
    // Build transaction details
    const txDetails = [
        `┌─────────────────────────────────────`,
        `│ ERC-20 Token Transfer`,
        `│`,
        ensName ? `│ To: ${ensName}` : null,
        ensName ? `│     → ${to}` : `│ To: ${to}`,
        `│ Amount: ${amount} ${tokenSymbol}`,
        `│ Token: ${tokenAddress}`,
        `│ Chain: ${chain}`,
        `│ Est. Fee: ~$${gasEstimate.estimatedCostUsd}`,
        simulationWarnings.length > 0 ? `│` : null,
        ...simulationWarnings.map(w => `│ ${w}`),
        `└─────────────────────────────────────`,
    ].filter(Boolean).join("\n");
    // Execute the ERC-20 transfer
    // For ERC-20, we send to the token contract with transfer calldata
    const result = await sendTransaction(tokenAddress, // to: token contract
    "0", // value: 0 ETH
    chain, undefined, // not used
    transferData // data: transfer(to, amount)
    );
    return {
        content: [{
                type: "text",
                text: `✓ Token transfer sent!\n\n` +
                    `${txDetails}\n\n` +
                    `Transaction Hash:\n${result.txHash}\n\n` +
                    `Track: ${getExplorerUrl(chain, result.txHash)}`
            }]
    };
}
function getNativeSymbol(chain) {
    const symbols = {
        ethereum: "ETH", base: "ETH", arbitrum: "ETH",
        optimism: "ETH", polygon: "MATIC", solana: "SOL",
    };
    return symbols[chain] || "ETH";
}
function getExplorerUrl(chain, txHash) {
    const explorers = {
        ethereum: `https://etherscan.io/tx/${txHash}`,
        base: `https://basescan.org/tx/${txHash}`,
        arbitrum: `https://arbiscan.io/tx/${txHash}`,
        optimism: `https://optimistic.etherscan.io/tx/${txHash}`,
        polygon: `https://polygonscan.com/tx/${txHash}`,
        solana: `https://solscan.io/tx/${txHash}`,
    };
    return explorers[chain] || txHash;
}
//# sourceMappingURL=send.js.map