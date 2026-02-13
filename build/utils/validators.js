/**
 * Shared validation utilities for Clara wallet tools.
 *
 * All validation happens BEFORE API calls to give users
 * fast, clear feedback on bad input.
 */
import { z } from "zod";
// ─── Address Validation ─────────────────────────────────
const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
/**
 * Check if a string is a valid EVM address (0x + 40 hex chars).
 * Does NOT do EIP-55 checksum validation — just format.
 */
export function isValidEvmAddress(addr) {
    return EVM_ADDRESS_REGEX.test(addr);
}
/**
 * Check if a string looks like an ENS name (has a dot-separated TLD).
 * Accepts: vitalik.eth, uniswap.xyz, name.com, brian.claraid.eth
 */
export function looksLikeEnsName(input) {
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(input);
}
/**
 * Check if a string is a valid recipient: either an EVM address or an ENS-like name.
 */
export function isValidRecipient(input) {
    return isValidEvmAddress(input) || looksLikeEnsName(input);
}
/**
 * Human-friendly error for invalid recipient.
 */
export function recipientError(input) {
    if (input.startsWith("0x")) {
        const hexPart = input.slice(2);
        if (hexPart.length !== 40) {
            return `❌ Invalid address: "${input}" is ${input.length} characters (expected 42).\n\n` +
                `Ethereum addresses are 42 characters: 0x + 40 hex digits.\n` +
                `Example: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`;
        }
        if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
            return `❌ Invalid address: "${input}" contains non-hex characters.\n\n` +
                `Ethereum addresses can only contain 0-9 and a-f after the 0x prefix.`;
        }
    }
    return `❌ Invalid recipient: "${input}"\n\n` +
        `Expected either:\n` +
        `• An Ethereum address (0x...)\n` +
        `• An ENS name (name.eth)\n` +
        `• A Clara name (name.claraid.eth)`;
}
// ─── Amount Validation ──────────────────────────────────
/**
 * Validate and parse a token amount string.
 * Returns the parsed number or an error message.
 */
export function parseAndValidateAmount(amount) {
    const trimmed = amount.trim();
    if (trimmed === "") {
        return { valid: false, error: "Amount cannot be empty." };
    }
    const value = Number(trimmed);
    if (isNaN(value)) {
        return { valid: false, error: `"${trimmed}" is not a valid number.` };
    }
    if (value <= 0) {
        return { valid: false, error: `Amount must be greater than zero (got ${trimmed}).` };
    }
    if (!isFinite(value)) {
        return { valid: false, error: `Amount must be a finite number.` };
    }
    return { valid: true, value };
}
/**
 * Format an amount validation error as a tool response.
 */
export function amountError(amount, context) {
    const result = parseAndValidateAmount(amount);
    if (result.valid)
        return ""; // shouldn't happen, but safe
    return `❌ Invalid amount: ${result.error}${context ? `\n\n${context}` : ""}`;
}
// ─── Token Validation ───────────────────────────────────
const KNOWN_SYMBOLS = new Set([
    "ETH", "MATIC", "SOL",
    "USDC", "USDT", "DAI", "WETH", "WBTC",
    "NATIVE",
]);
/**
 * Check if a token input is either a known symbol or a valid contract address.
 */
export function isValidTokenInput(token) {
    return KNOWN_SYMBOLS.has(token.toUpperCase()) || isValidEvmAddress(token);
}
/**
 * Human-friendly error for invalid token input.
 */
export function tokenError(token) {
    return `❌ Unknown token: "${token}"\n\n` +
        `Supported symbols: ${[...KNOWN_SYMBOLS].filter(s => !["NATIVE"].includes(s)).join(", ")}\n` +
        `Or provide a token contract address (0x...)`;
}
// ─── Gas Guidance ───────────────────────────────────────
/**
 * Friendly message when a user doesn't have gas.
 */
export function gasGuidance(chain) {
    return `💡 **You need ETH for gas fees** to send transactions on ${chain}.\n\n` +
        `Gas fees are small charges (usually < $0.01 on Base) that go to the network, not to Clara.\n\n` +
        `Options:\n` +
        `• Run \`wallet_sponsor_gas\` — get free gas for your first transactions\n` +
        `• Bridge ETH from another chain: \`wallet_bridge fromToken="ETH" toChain="${chain}"\`\n` +
        `• Receive ETH from someone: share your address with \`wallet_dashboard\``;
}
// ─── Zod Refinements (for inputSchema) ──────────────────
/**
 * Zod schema for a recipient field (address or ENS name).
 * Use in tool inputSchema for the `to` parameter.
 */
export const zodRecipient = z.string()
    .min(1, "Recipient cannot be empty")
    .describe("Recipient: 0x address, ENS name (vitalik.eth), or Clara name (brian.claraid.eth)");
/**
 * Zod schema for a positive amount string.
 * Use in tool inputSchema for `amount` parameters.
 */
export const zodAmount = z.string()
    .min(1, "Amount cannot be empty")
    .describe("Amount in human units (e.g., '0.1' for 0.1 ETH, '100' for 100 USDC)");
/**
 * Zod schema for a token input (symbol or address).
 */
export const zodToken = z.string()
    .min(1, "Token cannot be empty")
    .describe("Token symbol (USDC, USDT, DAI, WETH, WBTC) or contract address (0x...)");
//# sourceMappingURL=validators.js.map