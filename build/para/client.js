/**
 * Para REST API Client
 *
 * Uses Para's REST API for wallet creation and signing.
 * Supports routing through a proxy (for API key injection).
 *
 * Flow:
 * 1. Create wallet via REST API (EVM and/or Solana)
 * 2. Store wallet ID locally
 * 3. Sign messages/transactions via REST API
 */
import { getSession, updateSession } from "../storage/session.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
// Chain configurations
const CHAIN_CONFIG = {
    ethereum: { name: "Ethereum", chainId: 1, rpcUrl: "https://eth.llamarpc.com" },
    base: { name: "Base", chainId: 8453, rpcUrl: "https://mainnet.base.org" },
    arbitrum: { name: "Arbitrum One", chainId: 42161, rpcUrl: "https://arb1.arbitrum.io/rpc" },
    optimism: { name: "Optimism", chainId: 10, rpcUrl: "https://mainnet.optimism.io" },
    polygon: { name: "Polygon", chainId: 137, rpcUrl: "https://polygon-rpc.com" },
    solana: { name: "Solana", rpcUrl: "https://api.mainnet-beta.solana.com" },
};
// Block explorer API configuration (for transaction history)
const EXPLORER_CONFIG = {
    ethereum: {
        apiUrl: "https://api.etherscan.io/api",
        explorerUrl: "https://etherscan.io",
    },
    base: {
        apiUrl: "https://api.basescan.org/api",
        explorerUrl: "https://basescan.org",
    },
    arbitrum: {
        apiUrl: "https://api.arbiscan.io/api",
        explorerUrl: "https://arbiscan.io",
    },
    optimism: {
        apiUrl: "https://api-optimistic.etherscan.io/api",
        explorerUrl: "https://optimistic.etherscan.io",
    },
    polygon: {
        apiUrl: "https://api.polygonscan.com/api",
        explorerUrl: "https://polygonscan.com",
    },
    solana: null, // Solana uses different explorer APIs
};
// Para API configuration
// Default: Uses Clara proxy which injects API key
// Override with PARA_API_URL env var for direct API access with your own key
const PARA_API_BASE = process.env.PARA_API_URL || "https://clara-proxy.bflynn-me.workers.dev/api";
// ENS Contract Addresses (Ethereum Mainnet)
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
/**
 * Compute ENS namehash for a domain name
 * namehash('') = 0x0000...0000
 * namehash('eth') = keccak256(namehash('') + keccak256('eth'))
 * namehash('vitalik.eth') = keccak256(namehash('eth') + keccak256('vitalik'))
 */
function namehash(name) {
    if (!name) {
        return "0x" + "00".repeat(32);
    }
    const labels = name.split(".");
    let node = new Uint8Array(32); // Start with 32 zero bytes
    for (let i = labels.length - 1; i >= 0; i--) {
        const labelHash = keccak_256(new TextEncoder().encode(labels[i]));
        const combined = new Uint8Array(64);
        combined.set(node, 0);
        combined.set(new Uint8Array(labelHash), 32);
        node = new Uint8Array(keccak_256(combined));
    }
    return "0x" + Buffer.from(node).toString("hex");
}
/**
 * Resolve ENS name to Ethereum address
 * Works with .eth names on Ethereum mainnet
 */
export async function resolveEnsName(name) {
    // Only resolve names that look like ENS
    if (!name.includes(".") || name.startsWith("0x")) {
        return null;
    }
    // Normalize the name
    const normalizedName = name.toLowerCase().trim();
    console.error(`[clara] Resolving ENS: ${normalizedName}`);
    const config = CHAIN_CONFIG["ethereum"];
    const node = namehash(normalizedName);
    try {
        // Step 1: Get the resolver address from ENS Registry
        // resolver(bytes32 node) -> address
        const resolverSelector = "0178b8bf"; // keccak256('resolver(bytes32)')[:4]
        const resolverCalldata = "0x" + resolverSelector + node.slice(2);
        const resolverResponse = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [{ to: ENS_REGISTRY, data: resolverCalldata }, "latest"],
                id: 1,
            }),
        });
        const resolverData = (await resolverResponse.json());
        if (resolverData.error || !resolverData.result || resolverData.result === "0x" + "00".repeat(32)) {
            console.error(`[clara] No resolver found for ${normalizedName}`);
            return null;
        }
        // Extract resolver address (last 20 bytes of the 32-byte response)
        const resolverAddress = "0x" + resolverData.result.slice(-40);
        console.error(`[clara] Found resolver: ${resolverAddress}`);
        // Step 2: Get the address from the resolver
        // addr(bytes32 node) -> address
        const addrSelector = "3b3b57de"; // keccak256('addr(bytes32)')[:4]
        const addrCalldata = "0x" + addrSelector + node.slice(2);
        const addrResponse = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [{ to: resolverAddress, data: addrCalldata }, "latest"],
                id: 2,
            }),
        });
        const addrData = (await addrResponse.json());
        if (addrData.error || !addrData.result || addrData.result === "0x" + "00".repeat(32)) {
            console.error(`[clara] No address found for ${normalizedName}`);
            return null;
        }
        // Extract address (last 20 bytes)
        const address = "0x" + addrData.result.slice(-40);
        console.error(`[clara] Resolved ${normalizedName} -> ${address}`);
        return address;
    }
    catch (error) {
        console.error(`[clara] ENS resolution error:`, error);
        return null;
    }
}
/**
 * Reverse resolve: get ENS name for an Ethereum address
 */
export async function reverseResolveEns(address) {
    if (!address.startsWith("0x") || address.length !== 42) {
        return null;
    }
    // Reverse resolution uses {address}.addr.reverse
    const reverseName = address.slice(2).toLowerCase() + ".addr.reverse";
    const node = namehash(reverseName);
    const config = CHAIN_CONFIG["ethereum"];
    try {
        // Get resolver for reverse record
        const resolverSelector = "0178b8bf";
        const resolverCalldata = "0x" + resolverSelector + node.slice(2);
        const resolverResponse = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [{ to: ENS_REGISTRY, data: resolverCalldata }, "latest"],
                id: 1,
            }),
        });
        const resolverData = (await resolverResponse.json());
        if (!resolverData.result || resolverData.result === "0x" + "00".repeat(32)) {
            return null;
        }
        const resolverAddress = "0x" + resolverData.result.slice(-40);
        // Call name(bytes32) on resolver
        const nameSelector = "691f3431"; // keccak256('name(bytes32)')[:4]
        const nameCalldata = "0x" + nameSelector + node.slice(2);
        const nameResponse = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [{ to: resolverAddress, data: nameCalldata }, "latest"],
                id: 2,
            }),
        });
        const nameData = (await nameResponse.json());
        if (!nameData.result || nameData.result === "0x") {
            return null;
        }
        // Decode the string result (ABI-encoded string)
        const hex = nameData.result.slice(2);
        // Skip offset (32 bytes) and length (32 bytes), then decode
        const lengthHex = hex.slice(64, 128);
        const length = parseInt(lengthHex, 16);
        const nameHex = hex.slice(128, 128 + length * 2);
        const name = Buffer.from(nameHex, "hex").toString("utf8");
        console.error(`[clara] Reverse resolved ${address} -> ${name}`);
        return name || null;
    }
    catch (error) {
        console.error(`[clara] Reverse ENS resolution error:`, error);
        return null;
    }
}
/**
 * Check if a string looks like an ENS name
 */
export function isEnsName(input) {
    if (!input || input.startsWith("0x"))
        return false;
    return input.includes(".") && (input.endsWith(".eth") ||
        input.endsWith(".xyz") ||
        input.endsWith(".com") ||
        input.endsWith(".org") ||
        input.endsWith(".io") ||
        input.endsWith(".app"));
}
/**
 * Make authenticated request to Para API
 */
async function paraFetch(endpoint, options = {}) {
    const apiKey = process.env.PARA_API_KEY;
    // API key is optional when using a proxy that injects it
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
    };
    if (apiKey) {
        headers["X-API-Key"] = apiKey;
    }
    const url = `${PARA_API_BASE}${endpoint}`;
    console.error(`[clara] API call: ${options.method || "GET"} ${endpoint}`);
    const response = await fetch(url, {
        ...options,
        headers,
    });
    if (!response.ok) {
        const error = await response.text();
        console.error(`[clara] API error: ${response.status} - ${error}`);
        throw new Error(`Para API error: ${response.status} - ${error}`);
    }
    return response;
}
/**
 * Create wallet via Para REST API
 * Creates both EVM and Solana wallets for full multi-chain support
 */
export async function createPregenWallet(identifier) {
    const identifierLabel = identifier.type === "email"
        ? identifier.value
        : `custom:${identifier.value.slice(0, 8)}...`;
    console.error(`[clara] Creating wallets for: ${identifierLabel}`);
    // Map identifier type to Para API format
    const userIdentifierType = identifier.type === "email" ? "EMAIL" : "CUSTOM_ID";
    try {
        // Create EVM wallet
        const evmResponse = await paraFetch("/v1/wallets", {
            method: "POST",
            body: JSON.stringify({
                type: "EVM",
                userIdentifier: identifier.value,
                userIdentifierType,
            }),
        });
        const evmResult = (await evmResponse.json());
        const evmWallet = evmResult.wallet;
        console.error(`[clara] Created EVM wallet: ${evmWallet.address}`);
        let solanaWallet = null;
        // Try to create Solana wallet
        try {
            const solResponse = await paraFetch("/v1/wallets", {
                method: "POST",
                body: JSON.stringify({
                    type: "SOLANA",
                    userIdentifier: identifier.value,
                    userIdentifierType,
                }),
            });
            const solResult = (await solResponse.json());
            solanaWallet = solResult.wallet;
            console.error(`[clara] Created Solana wallet: ${solanaWallet.address}`);
        }
        catch (solError) {
            console.error("[clara] Solana wallet creation skipped:", solError);
        }
        // Store wallet info in session
        await updateSession({
            walletId: evmWallet.id,
            solanaWalletId: solanaWallet?.id,
            address: evmWallet.address,
            solanaAddress: solanaWallet?.address,
            pendingIdentifier: identifier.value,
            identifierType: identifier.type,
        });
        return {
            sessionId: `new_${identifier.type}_${identifier.value}`,
            isExisting: false,
        };
    }
    catch (error) {
        // Check if wallet already exists (409 Conflict or similar)
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("409") || errorMessage.includes("already exists") || errorMessage.includes("duplicate")) {
            console.error(`[clara] Wallet already exists for ${identifierLabel}`);
            // Try to fetch existing wallets
            try {
                const existingWallets = await fetchWalletsForIdentifier(identifier);
                if (existingWallets.evm) {
                    await updateSession({
                        walletId: existingWallets.evm.id,
                        solanaWalletId: existingWallets.solana?.id,
                        address: existingWallets.evm.address,
                        solanaAddress: existingWallets.solana?.address,
                        pendingIdentifier: identifier.value,
                        identifierType: identifier.type,
                    });
                }
            }
            catch (fetchError) {
                console.error("[clara] Could not fetch existing wallets:", fetchError);
            }
            return {
                sessionId: `existing_${identifier.type}_${identifier.value}`,
                isExisting: true,
            };
        }
        console.error("[clara] Failed to create wallet:", error);
        throw error;
    }
}
/**
 * Fetch existing wallets for an identifier
 */
async function fetchWalletsForIdentifier(identifier) {
    const userIdentifierType = identifier.type === "email" ? "EMAIL" : "CUSTOM_ID";
    try {
        const response = await paraFetch(`/v1/wallets?userIdentifier=${encodeURIComponent(identifier.value)}&userIdentifierType=${userIdentifierType}`);
        const result = (await response.json());
        const wallets = result.wallets || [];
        return {
            evm: wallets.find((w) => w.type === "EVM") || null,
            solana: wallets.find((w) => w.type === "SOLANA") || null,
        };
    }
    catch {
        return { evm: null, solana: null };
    }
}
/**
 * Legacy wrapper for email-based auth (backward compatibility)
 */
export async function startEmailAuth(email) {
    const result = await createPregenWallet({ type: "email", value: email });
    return { sessionId: result.sessionId };
}
/**
 * Legacy wrapper for OTP verification (backward compatibility)
 * OTP parameter is ignored - REST API wallets don't need verification
 */
export async function verifyEmailOTP(sessionId, _otp) {
    return completeWalletSetup(sessionId);
}
/**
 * Complete wallet setup and retrieve wallet info
 */
export async function completeWalletSetup(sessionId) {
    const session = await getSession();
    const isExisting = sessionId.startsWith("existing_");
    if (!session?.address || !session.walletId) {
        throw new Error("No wallet found in session. Please run wallet_setup again.");
    }
    console.error(`[clara] Completing setup - Address: ${session.address}`);
    return {
        address: session.address,
        solanaAddress: session.solanaAddress,
        isNewWallet: !isExisting,
    };
}
/**
 * Get wallet address for a specific chain
 */
export async function getWalletAddress(chain) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    if (chain === "solana") {
        if (session.solanaAddress) {
            return session.solanaAddress;
        }
        throw new Error("Solana wallet not configured. EVM address works for EVM chains only.");
    }
    return session.address;
}
/**
 * Get token balances for a chain
 */
export async function getBalances(chain, _tokenAddress) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    const config = CHAIN_CONFIG[chain];
    console.error(`[clara] Fetching balances for ${chain}`);
    try {
        if (chain === "solana") {
            const solAddress = await getWalletAddress("solana").catch(() => null);
            if (!solAddress) {
                return [{ symbol: "SOL", balance: "0.0", usdValue: "N/A" }];
            }
            const response = await fetch(config.rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "getBalance",
                    params: [solAddress],
                }),
            });
            const data = (await response.json());
            const lamports = data.result?.value || 0;
            const solBalance = lamports / 1e9;
            return [
                {
                    symbol: "SOL",
                    balance: solBalance.toFixed(6),
                    usdValue: undefined,
                },
            ];
        }
        // EVM balance check via RPC
        const response = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_getBalance",
                params: [session.address, "latest"],
                id: 1,
            }),
        });
        const data = (await response.json());
        const balanceWei = BigInt(data.result || "0");
        const balanceEth = Number(balanceWei) / 1e18;
        const symbol = chain === "polygon" ? "MATIC" : "ETH";
        return [
            {
                symbol,
                balance: balanceEth.toFixed(6),
                usdValue: undefined,
            },
        ];
    }
    catch (error) {
        console.error(`[clara] Balance fetch error:`, error);
        return [
            {
                symbol: chain === "solana" ? "SOL" : chain === "polygon" ? "MATIC" : "ETH",
                balance: "0.0",
            },
        ];
    }
}
/**
 * Sign an arbitrary message using Para REST API
 * Uses the /sign-raw endpoint which accepts 0x-prefixed hex data
 */
export async function signMessage(message, chain = "ethereum") {
    const session = await getSession();
    if (!session?.authenticated) {
        throw new Error("Not authenticated");
    }
    const walletId = chain === "solana" ? session.solanaWalletId : session.walletId;
    if (!walletId) {
        throw new Error(`No ${chain === "solana" ? "Solana" : "EVM"} wallet found`);
    }
    console.error(`[clara] Signing message on ${chain}`);
    try {
        // Convert message to 0x-prefixed hex format
        const dataHex = "0x" + Buffer.from(message).toString("hex");
        const response = await paraFetch(`/v1/wallets/${walletId}/sign-raw`, {
            method: "POST",
            body: JSON.stringify({
                data: dataHex,
            }),
        });
        const result = (await response.json());
        return result.signature;
    }
    catch (error) {
        console.error("[clara] Sign message error:", error);
        throw error;
    }
}
/**
 * Sign a transaction using Para REST API
 */
export async function signTransaction(tx, chain) {
    const session = await getSession();
    if (!session?.authenticated) {
        throw new Error("Not authenticated");
    }
    console.error(`[clara] Signing transaction on ${chain}`);
    try {
        if (chain === "solana") {
            const solWalletId = session.solanaWalletId;
            if (!solWalletId) {
                throw new Error("No Solana wallet found. Run wallet_setup to create one.");
            }
            const solTx = tx;
            // If a pre-serialized transaction is provided, sign it
            if (solTx.serializedTx) {
                // Ensure data is 0x-prefixed hex
                const dataHex = solTx.serializedTx.startsWith("0x")
                    ? solTx.serializedTx
                    : "0x" + solTx.serializedTx;
                const response = await paraFetch(`/v1/wallets/${solWalletId}/sign-raw`, {
                    method: "POST",
                    body: JSON.stringify({
                        data: dataHex,
                    }),
                });
                const result = (await response.json());
                return { signedTx: result.signature };
            }
            // For simple transfers, sign the intent
            const intentMessage = JSON.stringify({
                type: "solana_transfer",
                to: solTx.to,
                amount: solTx.amount,
                memo: solTx.memo,
                timestamp: Date.now(),
            });
            const signature = await signMessage(intentMessage, chain);
            return { signedTx: signature };
        }
        // EVM transaction signing
        const evmWalletId = session.walletId;
        if (!evmWalletId) {
            throw new Error("No EVM wallet found");
        }
        const evmTx = tx;
        const config = CHAIN_CONFIG[chain];
        // Build unsigned transaction object
        const unsignedTx = {
            to: evmTx.to,
            value: evmTx.value ? `0x${BigInt(evmTx.value).toString(16)}` : "0x0",
            data: evmTx.data || "0x",
            gasLimit: evmTx.gasLimit || "0x5208",
            maxFeePerGas: evmTx.maxFeePerGas || "0x3b9aca00",
            maxPriorityFeePerGas: evmTx.maxPriorityFeePerGas || "0x3b9aca00",
            chainId: config.chainId,
            type: 2,
            nonce: 0,
        };
        // Sign the transaction data using sign-raw endpoint
        // For proper EVM tx signing, you'd use RLP encoding here
        // This is a simplified version - for production, use ethers.js
        const txDataHex = "0x" + Buffer.from(JSON.stringify(unsignedTx)).toString("hex");
        const response = await paraFetch(`/v1/wallets/${evmWalletId}/sign-raw`, {
            method: "POST",
            body: JSON.stringify({
                data: txDataHex,
            }),
        });
        const result = (await response.json());
        return {
            signedTx: result.signature,
        };
    }
    catch (error) {
        console.error("[clara] Sign transaction error:", error);
        throw error;
    }
}
/**
 * Send tokens (sign + broadcast)
 *
 * For native tokens: sendTransaction(to, amount, chain)
 * For ERC-20 tokens: sendTransaction(tokenContract, "0", chain, undefined, transferData)
 */
export async function sendTransaction(to, amount, chain, _tokenAddress, data // ERC-20 transfer calldata
) {
    const session = await getSession();
    if (!session?.authenticated) {
        throw new Error("Not authenticated");
    }
    const isTokenTransfer = data && data.startsWith("0xa9059cbb");
    console.error(`[clara] Sending ${isTokenTransfer ? "token transfer" : amount} to ${to} on ${chain}`);
    const config = CHAIN_CONFIG[chain];
    try {
        if (chain === "solana") {
            const signed = await signTransaction({ to, amount }, chain);
            return {
                txHash: "",
                signature: signed.signedTx,
                requiresManualBroadcast: true,
            };
        }
        // EVM send
        const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18));
        const signed = await signTransaction({
            to,
            value: amountWei.toString(),
            data: data || "0x", // Include ERC-20 calldata if provided
            chainId: config.chainId,
        }, chain);
        // Broadcast via RPC
        const response = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_sendRawTransaction",
                params: [signed.signedTx],
                id: 1,
            }),
        });
        const rpcResult = (await response.json());
        if (rpcResult.error) {
            throw new Error(rpcResult.error.message);
        }
        return { txHash: rpcResult.result || signed.txHash || "" };
    }
    catch (error) {
        console.error("[clara] Send error:", error);
        throw error;
    }
}
/**
 * Estimate gas for a transaction
 */
export async function estimateGas(tx, chain) {
    if (chain === "solana") {
        return { gasLimit: "5000", maxFee: "0.000005", estimatedCostUsd: "0.01" };
    }
    const config = CHAIN_CONFIG[chain];
    try {
        const response = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_estimateGas",
                params: [
                    {
                        to: tx.to,
                        value: tx.value ? `0x${BigInt(tx.value).toString(16)}` : "0x0",
                        data: tx.data || "0x",
                    },
                ],
                id: 1,
            }),
        });
        const data = (await response.json());
        const gasLimit = BigInt(data.result || "21000");
        const gasCostEth = (Number(gasLimit) * 30) / 1e9;
        const estimatedCostUsd = (gasCostEth * 2500).toFixed(2);
        return {
            gasLimit: gasLimit.toString(),
            maxFee: gasCostEth.toFixed(6),
            estimatedCostUsd,
        };
    }
    catch {
        return { gasLimit: "21000", maxFee: "0.001", estimatedCostUsd: "2.50" };
    }
}
/**
 * Get human-readable description of a transaction
 */
export async function decodeTransaction(tx, _chain) {
    if (!tx.data || tx.data === "0x") {
        return {
            action: "Native Transfer",
            details: [`Send ${tx.value || "0"} to ${tx.to}`],
        };
    }
    const selector = tx.data.slice(0, 10);
    const SELECTORS = {
        "0xa9059cbb": { action: "Token Transfer" },
        "0x095ea7b3": { action: "Token Approval" },
        "0x23b872dd": { action: "Transfer From" },
        "0x42842e0e": { action: "NFT Transfer" },
        "0x7ff36ab5": { action: "Swap Exact ETH" },
        "0x38ed1739": { action: "Swap Exact Tokens" },
    };
    const known = SELECTORS[selector];
    if (known) {
        return {
            action: known.action,
            details: [`Contract: ${tx.to}`],
        };
    }
    return {
        action: "Contract Interaction",
        details: [`Contract: ${tx.to}`, `Method: ${selector}`],
    };
}
// CoinGecko API for price data (free, no API key required)
const COINGECKO_API = "https://api.coingecko.com/api/v3";
// Map chain native tokens to CoinGecko IDs
const COINGECKO_IDS = {
    ethereum: "ethereum",
    base: "ethereum", // Base uses ETH
    arbitrum: "ethereum", // Arbitrum uses ETH
    optimism: "ethereum", // Optimism uses ETH
    polygon: "matic-network",
    solana: "solana",
};
/**
 * Fetch current prices from CoinGecko
 * Returns prices in USD for supported tokens
 */
export async function fetchPrices() {
    const ids = [...new Set(Object.values(COINGECKO_IDS))].join(",");
    try {
        console.error("[clara] Fetching prices from CoinGecko...");
        const response = await fetch(`${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, {
            headers: {
                "Accept": "application/json",
            },
        });
        if (!response.ok) {
            console.error(`[clara] CoinGecko error: ${response.status}`);
            return {};
        }
        const data = await response.json();
        console.error("[clara] Prices fetched:", Object.keys(data).join(", "));
        return data;
    }
    catch (error) {
        console.error("[clara] Price fetch error:", error);
        return {};
    }
}
/**
 * Get portfolio across all chains
 * Fetches balances and current prices, calculates USD values
 */
export async function getPortfolio() {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    console.error("[clara] Building portfolio...");
    // Fetch prices first
    const prices = await fetchPrices();
    // Get balances for all chains in parallel
    const evmChains = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
    const allChains = session.solanaAddress
        ? [...evmChains, "solana"]
        : evmChains;
    const balancePromises = allChains.map(async (chain) => {
        try {
            const balances = await getBalances(chain);
            const balance = balances[0]?.balance || "0";
            const symbol = balances[0]?.symbol || (chain === "solana" ? "SOL" : chain === "polygon" ? "MATIC" : "ETH");
            // Get price for this chain's native token
            const coingeckoId = COINGECKO_IDS[chain];
            const priceData = prices[coingeckoId];
            const priceUsd = priceData?.usd || null;
            const change24h = priceData?.usd_24h_change || null;
            // Calculate USD value
            const balanceNum = parseFloat(balance);
            const valueUsd = priceUsd && balanceNum > 0 ? balanceNum * priceUsd : null;
            return {
                chain,
                symbol,
                balance,
                priceUsd,
                valueUsd,
                change24h,
            };
        }
        catch (error) {
            console.error(`[clara] Failed to get balance for ${chain}:`, error);
            return {
                chain,
                symbol: chain === "solana" ? "SOL" : chain === "polygon" ? "MATIC" : "ETH",
                balance: "0",
                priceUsd: null,
                valueUsd: null,
                change24h: null,
            };
        }
    });
    const items = await Promise.all(balancePromises);
    // Calculate totals
    const totalValueUsd = items.reduce((sum, item) => sum + (item.valueUsd || 0), 0);
    // Calculate weighted average 24h change
    let totalChange24h = null;
    if (totalValueUsd > 0) {
        const weightedChange = items.reduce((sum, item) => {
            if (item.valueUsd && item.change24h !== null) {
                return sum + (item.change24h * item.valueUsd);
            }
            return sum;
        }, 0);
        totalChange24h = weightedChange / totalValueUsd;
    }
    return {
        items,
        totalValueUsd,
        totalChange24h,
        lastUpdated: new Date().toISOString(),
    };
}
/**
 * Format USD value for display
 */
export function formatUsd(value) {
    if (value === null || value === undefined)
        return "—";
    if (value < 0.01 && value > 0)
        return "<$0.01";
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/**
 * Format percentage change for display
 */
export function formatChange(change) {
    if (change === null || change === undefined)
        return "—";
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(2)}%`;
}
// Extended function signature database for transaction decoding
const FUNCTION_SIGNATURES = {
    // ERC-20
    "0xa9059cbb": { name: "transfer", description: "Transfer tokens to address" },
    "0x095ea7b3": { name: "approve", description: "Approve spending allowance", risk: "Check approval amount" },
    "0x23b872dd": { name: "transferFrom", description: "Transfer tokens from another address" },
    // ERC-721 (NFTs)
    "0x42842e0e": { name: "safeTransferFrom", description: "Transfer NFT safely" },
    "0xb88d4fde": { name: "safeTransferFrom", description: "Transfer NFT with data" },
    "0xa22cb465": { name: "setApprovalForAll", description: "Approve all NFTs for operator", risk: "Grants full NFT access" },
    // Uniswap V2/V3
    "0x7ff36ab5": { name: "swapExactETHForTokens", description: "Swap ETH for tokens" },
    "0x38ed1739": { name: "swapExactTokensForTokens", description: "Swap tokens for tokens" },
    "0x18cbafe5": { name: "swapExactTokensForETH", description: "Swap tokens for ETH" },
    "0xfb3bdb41": { name: "swapETHForExactTokens", description: "Swap ETH for exact token amount" },
    "0x5ae401dc": { name: "multicall", description: "Uniswap V3 multicall (multiple operations)" },
    "0xac9650d8": { name: "multicall", description: "Multicall (batched operations)" },
    "0x04e45aaf": { name: "exactInputSingle", description: "Uniswap V3 single swap" },
    // Aave
    "0xe8eda9df": { name: "deposit", description: "Deposit to Aave lending pool" },
    "0x69328dec": { name: "withdraw", description: "Withdraw from Aave lending pool" },
    "0xa415bcad": { name: "borrow", description: "Borrow from Aave", risk: "Creates debt position" },
    "0x573ade81": { name: "repay", description: "Repay Aave loan" },
    // Compound
    "0xa0712d68": { name: "mint", description: "Supply to Compound" },
    "0xdb006a75": { name: "redeem", description: "Withdraw from Compound" },
    "0xc5ebeaec": { name: "borrow", description: "Borrow from Compound", risk: "Creates debt position" },
    // ENS
    "0x77372213": { name: "setText", description: "Set ENS text record" },
    "0x8b95dd71": { name: "setAddr", description: "Set ENS address" },
    "0xf14fcbc8": { name: "commit", description: "ENS name commitment" },
    "0x85f6d155": { name: "register", description: "Register ENS name" },
    // Common
    "0x2e1a7d4d": { name: "withdraw", description: "Withdraw (e.g., WETH unwrap)" },
    "0xd0e30db0": { name: "deposit", description: "Deposit (e.g., WETH wrap)" },
    "0x3593564c": { name: "execute", description: "Universal Router execute (Uniswap)" },
    // Dangerous
    "0x00000000": { name: "unknown", description: "Unknown function", risk: "Unverified function call" },
};
// Known contract addresses for context
const KNOWN_CONTRACTS = {
    // Mainnet
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { name: "WETH", type: "token" },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { name: "USDC", type: "token" },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { name: "USDT", type: "token" },
    "0x6b175474e89094c44da98b954eedeac495271d0f": { name: "DAI", type: "token" },
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": { name: "Uniswap V2 Router", type: "dex" },
    "0xe592427a0aece92de3edee1f18e0157c05861564": { name: "Uniswap V3 Router", type: "dex" },
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": { name: "Uniswap Universal Router", type: "dex" },
    "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9": { name: "Aave V2 Pool", type: "lending" },
    "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": { name: "Aave V3 Pool", type: "lending" },
    // Base
    "0x4200000000000000000000000000000000000006": { name: "WETH (Base)", type: "token" },
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USDC (Base)", type: "token" },
    "0x2626664c2603336e57b271c5c0b26f421741e481": { name: "Uniswap V3 Router (Base)", type: "dex" },
};
// ============================================================================
// ERC-20 Token Support
// ============================================================================
/**
 * Popular tokens database with addresses across chains
 * Tokens are keyed by symbol, with chain-specific addresses
 */
export const POPULAR_TOKENS = {
    USDC: {
        ethereum: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
        base: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
        arbitrum: { address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimals: 6 },
        optimism: { address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", decimals: 6 },
        polygon: { address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals: 6 },
        solana: null, // SPL tokens not yet supported
    },
    USDT: {
        ethereum: { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
        base: null,
        arbitrum: { address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6 },
        optimism: { address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", decimals: 6 },
        polygon: { address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6 },
        solana: null,
    },
    DAI: {
        ethereum: { address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 },
        base: { address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", decimals: 18 },
        arbitrum: { address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", decimals: 18 },
        optimism: { address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", decimals: 18 },
        polygon: { address: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", decimals: 18 },
        solana: null,
    },
    WETH: {
        ethereum: { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18 },
        base: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
        arbitrum: { address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", decimals: 18 },
        optimism: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
        polygon: { address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", decimals: 18 },
        solana: null,
    },
    WBTC: {
        ethereum: { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", decimals: 8 },
        base: null,
        arbitrum: { address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", decimals: 8 },
        optimism: { address: "0x68f180fcce6836688e9084f035309e29bf0a2095", decimals: 8 },
        polygon: { address: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", decimals: 8 },
        solana: null,
    },
};
/**
 * ERC-20 function selectors
 */
const ERC20_SELECTORS = {
    balanceOf: "0x70a08231", // balanceOf(address)
    transfer: "0xa9059cbb", // transfer(address,uint256)
    approve: "0x095ea7b3", // approve(address,uint256)
    allowance: "0xdd62ed3e", // allowance(address,address)
    symbol: "0x95d89b41", // symbol()
    decimals: "0x313ce567", // decimals()
    name: "0x06fdde03", // name()
};
/**
 * Fetch ERC-20 token metadata from the blockchain
 * Falls back to POPULAR_TOKENS database if RPC calls fail
 */
export async function getTokenMetadata(tokenAddress, chain) {
    if (chain === "solana") {
        throw new Error("SPL tokens not yet supported");
    }
    const config = CHAIN_CONFIG[chain];
    const address = tokenAddress.toLowerCase();
    // Check if it's a known token first (faster)
    for (const [symbol, chainData] of Object.entries(POPULAR_TOKENS)) {
        const tokenInfo = chainData[chain];
        if (tokenInfo && tokenInfo.address.toLowerCase() === address) {
            return {
                address: tokenInfo.address,
                symbol,
                decimals: tokenInfo.decimals,
            };
        }
    }
    // Fetch from blockchain
    console.error(`[clara] Fetching token metadata for ${tokenAddress} on ${chain}`);
    try {
        // Fetch symbol and decimals in parallel
        const [symbolResult, decimalsResult] = await Promise.all([
            fetch(config.rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "eth_call",
                    params: [{ to: tokenAddress, data: ERC20_SELECTORS.symbol }, "latest"],
                    id: 1,
                }),
            }),
            fetch(config.rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "eth_call",
                    params: [{ to: tokenAddress, data: ERC20_SELECTORS.decimals }, "latest"],
                    id: 2,
                }),
            }),
        ]);
        const [symbolData, decimalsData] = await Promise.all([
            symbolResult.json(),
            decimalsResult.json(),
        ]);
        // Decode symbol (string type - skip first 64 chars for offset+length, then decode)
        let symbol = "UNKNOWN";
        if (symbolData.result && symbolData.result.length > 2) {
            try {
                // Try to decode as dynamic string
                const hex = symbolData.result.slice(2);
                if (hex.length >= 128) {
                    // Dynamic string: offset (32 bytes) + length (32 bytes) + data
                    const length = parseInt(hex.slice(64, 128), 16);
                    const strHex = hex.slice(128, 128 + length * 2);
                    symbol = Buffer.from(strHex, "hex").toString("utf8").replace(/\0/g, "");
                }
                else if (hex.length === 64) {
                    // Fixed bytes32
                    symbol = Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "");
                }
            }
            catch {
                symbol = "UNKNOWN";
            }
        }
        // Decode decimals (uint8)
        let decimals = 18;
        if (decimalsData.result && decimalsData.result !== "0x") {
            decimals = parseInt(decimalsData.result, 16);
        }
        return { address: tokenAddress, symbol, decimals };
    }
    catch (error) {
        console.error(`[clara] Failed to fetch token metadata:`, error);
        // Return default if fetch fails
        return { address: tokenAddress, symbol: "TOKEN", decimals: 18 };
    }
}
/**
 * Get ERC-20 token balance for an address
 */
export async function getTokenBalance(tokenAddress, chain, ownerAddress) {
    if (chain === "solana") {
        throw new Error("SPL tokens not yet supported");
    }
    const session = await getSession();
    const owner = ownerAddress || session?.address;
    if (!owner) {
        throw new Error("No wallet address available");
    }
    const config = CHAIN_CONFIG[chain];
    // Get token metadata
    const metadata = await getTokenMetadata(tokenAddress, chain);
    // Encode balanceOf(owner) call
    const paddedAddress = owner.slice(2).toLowerCase().padStart(64, "0");
    const calldata = ERC20_SELECTORS.balanceOf + paddedAddress;
    console.error(`[clara] Fetching ${metadata.symbol} balance on ${chain}`);
    try {
        const response = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [{ to: tokenAddress, data: calldata }, "latest"],
                id: 1,
            }),
        });
        const data = (await response.json());
        const balanceRaw = data.result ? BigInt(data.result).toString() : "0";
        const balanceNum = Number(BigInt(balanceRaw)) / Math.pow(10, metadata.decimals);
        return {
            balance: balanceNum.toFixed(metadata.decimals > 6 ? 6 : metadata.decimals),
            balanceRaw,
            symbol: metadata.symbol,
            decimals: metadata.decimals,
        };
    }
    catch (error) {
        console.error(`[clara] Token balance fetch error:`, error);
        return {
            balance: "0",
            balanceRaw: "0",
            symbol: metadata.symbol,
            decimals: metadata.decimals,
        };
    }
}
/**
 * Encode ERC-20 transfer calldata
 * transfer(address to, uint256 amount)
 */
export function encodeERC20Transfer(to, amount, decimals) {
    // Pad address to 32 bytes
    const paddedTo = to.slice(2).toLowerCase().padStart(64, "0");
    // Convert amount to raw units and pad to 32 bytes
    const amountFloat = parseFloat(amount);
    const amountRaw = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
    const paddedAmount = amountRaw.toString(16).padStart(64, "0");
    return ERC20_SELECTORS.transfer + paddedTo + paddedAmount;
}
/**
 * Resolve a token symbol or address to token info for a chain
 * Accepts: "USDC", "usdc", or "0xa0b86991..."
 */
export function resolveToken(tokenInput, chain) {
    if (chain === "solana") {
        return null;
    }
    // If it's an address, look it up
    if (tokenInput.startsWith("0x")) {
        const address = tokenInput.toLowerCase();
        for (const [symbol, chainData] of Object.entries(POPULAR_TOKENS)) {
            const tokenInfo = chainData[chain];
            if (tokenInfo && tokenInfo.address.toLowerCase() === address) {
                return { address: tokenInfo.address, symbol, decimals: tokenInfo.decimals };
            }
        }
        // Return the address with unknown metadata (will be fetched later)
        return null;
    }
    // It's a symbol - look up the address
    const symbol = tokenInput.toUpperCase();
    const tokenData = POPULAR_TOKENS[symbol];
    if (tokenData) {
        const chainInfo = tokenData[chain];
        if (chainInfo) {
            return { address: chainInfo.address, symbol, decimals: chainInfo.decimals };
        }
    }
    return null;
}
/**
 * Simulate a transaction without executing it
 * Uses eth_call to check if it would succeed and estimates gas
 */
export async function simulateTransaction(tx, chain) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    if (chain === "solana") {
        return {
            success: true,
            gasEstimate: "5000",
            gasUsd: "<$0.01",
            action: "Solana Transaction",
            description: "Solana transaction simulation not yet supported",
            warnings: ["Solana simulation limited"],
            details: {
                from: session.solanaAddress || "unknown",
                to: tx.to,
                value: tx.value || "0",
                valueUsd: "—",
            },
        };
    }
    const config = CHAIN_CONFIG[chain];
    const warnings = [];
    console.error(`[clara] Simulating transaction on ${chain}...`);
    // Decode the transaction
    const selector = tx.data?.slice(0, 10) || "0x";
    const sigInfo = FUNCTION_SIGNATURES[selector];
    const contractInfo = KNOWN_CONTRACTS[tx.to.toLowerCase()];
    // Determine action and description
    let action = "Contract Interaction";
    let description = "Unknown contract call";
    if (!tx.data || tx.data === "0x") {
        action = "Native Transfer";
        const valueEth = tx.value ? Number(BigInt(tx.value)) / 1e18 : 0;
        description = `Send ${valueEth.toFixed(4)} ${chain === "polygon" ? "MATIC" : "ETH"}`;
    }
    else if (sigInfo) {
        action = sigInfo.name;
        description = sigInfo.description;
        if (sigInfo.risk) {
            warnings.push(`⚠️ ${sigInfo.risk}`);
        }
    }
    if (contractInfo) {
        description += ` via ${contractInfo.name}`;
    }
    // Check for unlimited approval
    if (selector === "0x095ea7b3" && tx.data && tx.data.length >= 74) {
        const amountHex = "0x" + tx.data.slice(74);
        try {
            const amount = BigInt(amountHex);
            const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
            if (amount === maxUint256) {
                warnings.push("🚨 UNLIMITED APPROVAL - Contract can spend all your tokens");
            }
            else if (amount > BigInt("1000000000000000000000000")) {
                warnings.push("⚠️ Large approval amount");
            }
        }
        catch {
            // Ignore parsing errors
        }
    }
    // Check for high ETH value
    const valueWei = tx.value ? BigInt(tx.value) : BigInt(0);
    const valueEth = Number(valueWei) / 1e18;
    if (valueEth > 1) {
        warnings.push(`⚠️ Sending ${valueEth.toFixed(4)} ETH ($${(valueEth * 2500).toFixed(2)} approx)`);
    }
    // Simulate with eth_call
    let success = true;
    let error;
    try {
        const callResult = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [
                    {
                        from: session.address,
                        to: tx.to,
                        value: tx.value ? `0x${BigInt(tx.value).toString(16)}` : "0x0",
                        data: tx.data || "0x",
                    },
                    "latest",
                ],
                id: 1,
            }),
        });
        const result = (await callResult.json());
        if (result.error) {
            success = false;
            error = result.error.message;
            if (error.includes("execution reverted")) {
                warnings.push("🚨 Transaction would REVERT");
            }
        }
    }
    catch (e) {
        console.error("[clara] Simulation eth_call failed:", e);
        warnings.push("⚠️ Could not simulate transaction");
    }
    // Estimate gas
    const gasEstimate = await estimateGas(tx, chain);
    // Get ETH price for value conversion
    const prices = await fetchPrices();
    const ethPrice = prices["ethereum"]?.usd || 2500;
    const valueUsd = formatUsd(valueEth * ethPrice);
    return {
        success,
        error,
        gasEstimate: gasEstimate.gasLimit,
        gasUsd: `~$${gasEstimate.estimatedCostUsd}`,
        action,
        description,
        warnings,
        details: {
            from: session.address,
            to: tx.to,
            value: valueEth > 0 ? `${valueEth.toFixed(6)} ETH` : "0",
            valueUsd: valueEth > 0 ? valueUsd : "—",
            function: sigInfo?.name,
            contract: contractInfo?.name,
        },
    };
}
/**
 * Fetch transaction history from block explorer API
 */
export async function getTransactionHistory(chain, options = {}) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    const { limit = 10, includeTokenTransfers = true } = options;
    const address = session.address.toLowerCase();
    if (chain === "solana") {
        // Solana history not yet supported
        return {
            transactions: [],
            address: session.solanaAddress || address,
            chain,
            hasMore: false,
        };
    }
    const explorer = EXPLORER_CONFIG[chain];
    if (!explorer) {
        throw new Error(`Explorer not configured for ${chain}`);
    }
    console.error(`[clara] Fetching transaction history for ${address} on ${chain}`);
    const transactions = [];
    try {
        // Fetch normal transactions
        const txListUrl = `${explorer.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc`;
        const txResponse = await fetch(txListUrl);
        const txData = (await txResponse.json());
        if (txData.status === "1" && Array.isArray(txData.result)) {
            for (const tx of txData.result) {
                const valueWei = BigInt(tx.value || "0");
                const valueEth = Number(valueWei) / 1e18;
                const isIncoming = tx.to.toLowerCase() === address;
                const timestamp = parseInt(tx.timeStamp) * 1000;
                // Decode action
                let action = "Contract Call";
                const selector = tx.input?.slice(0, 10) || "0x";
                if (!tx.input || tx.input === "0x") {
                    action = isIncoming ? "Receive ETH" : "Send ETH";
                }
                else if (FUNCTION_SIGNATURES[selector]) {
                    action = FUNCTION_SIGNATURES[selector].name;
                }
                else if (tx.functionName) {
                    // Extract function name from "functionName(params)"
                    action = tx.functionName.split("(")[0];
                }
                transactions.push({
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: tx.value,
                    valueEth,
                    timestamp,
                    date: new Date(timestamp).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                    action,
                    status: tx.isError === "0" ? "success" : "failed",
                    gasUsed: tx.gasUsed,
                    gasPrice: tx.gasPrice,
                    functionName: tx.functionName,
                    isIncoming,
                    explorerUrl: `${explorer.explorerUrl}/tx/${tx.hash}`,
                });
            }
        }
        // Fetch ERC-20 token transfers if requested
        if (includeTokenTransfers) {
            const tokenTxUrl = `${explorer.apiUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc`;
            const tokenResponse = await fetch(tokenTxUrl);
            const tokenData = (await tokenResponse.json());
            if (tokenData.status === "1" && Array.isArray(tokenData.result)) {
                for (const tx of tokenData.result) {
                    // Skip if we already have this tx from normal list
                    if (transactions.some((t) => t.hash === tx.hash))
                        continue;
                    const decimals = parseInt(tx.tokenDecimal) || 18;
                    const tokenAmount = Number(BigInt(tx.value)) / Math.pow(10, decimals);
                    const isIncoming = tx.to.toLowerCase() === address;
                    const timestamp = parseInt(tx.timeStamp) * 1000;
                    transactions.push({
                        hash: tx.hash,
                        from: tx.from,
                        to: tx.to,
                        value: tx.value,
                        valueEth: 0,
                        timestamp,
                        date: new Date(timestamp).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                        }),
                        action: isIncoming ? "Receive Token" : "Send Token",
                        status: "success",
                        gasUsed: "0",
                        gasPrice: "0",
                        tokenSymbol: tx.tokenSymbol,
                        tokenAmount: tokenAmount.toFixed(decimals > 6 ? 6 : decimals),
                        isIncoming,
                        explorerUrl: `${explorer.explorerUrl}/tx/${tx.hash}`,
                    });
                }
            }
        }
        // Sort by timestamp descending
        transactions.sort((a, b) => b.timestamp - a.timestamp);
        // Limit results
        const limitedTxs = transactions.slice(0, limit);
        return {
            transactions: limitedTxs,
            address,
            chain,
            hasMore: transactions.length > limit,
        };
    }
    catch (error) {
        console.error(`[clara] Failed to fetch history:`, error);
        return {
            transactions: [],
            address,
            chain,
            hasMore: false,
        };
    }
}
/**
 * Format a transaction for display
 */
export function formatTransaction(tx) {
    const icon = tx.status === "failed" ? "❌" : tx.isIncoming ? "📥" : "📤";
    const amount = tx.tokenAmount
        ? `${tx.tokenAmount} ${tx.tokenSymbol}`
        : tx.valueEth > 0
            ? `${tx.valueEth.toFixed(4)} ETH`
            : "";
    const counterparty = tx.isIncoming
        ? `from ${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`
        : `to ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`;
    return `${icon} ${tx.action}${amount ? ` (${amount})` : ""} ${counterparty} • ${tx.date}`;
}
// Max uint256 value (unlimited approval)
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
// Threshold to consider "unlimited" (99% of max uint256)
const UNLIMITED_THRESHOLD = MAX_UINT256 * BigInt(99) / BigInt(100);
/**
 * Check current allowance for a specific token and spender
 */
export async function getAllowance(tokenAddress, spenderAddress, chain, ownerAddress) {
    if (chain === "solana") {
        throw new Error("SPL tokens not yet supported");
    }
    const session = await getSession();
    const owner = ownerAddress || session?.address;
    if (!owner) {
        throw new Error("No wallet address available");
    }
    const config = CHAIN_CONFIG[chain];
    // Get token metadata
    const metadata = await getTokenMetadata(tokenAddress, chain);
    // Encode allowance(owner, spender) call
    const paddedOwner = owner.slice(2).toLowerCase().padStart(64, "0");
    const paddedSpender = spenderAddress.slice(2).toLowerCase().padStart(64, "0");
    const calldata = ERC20_SELECTORS.allowance + paddedOwner + paddedSpender;
    console.error(`[clara] Checking ${metadata.symbol} allowance for spender ${spenderAddress.slice(0, 8)}... on ${chain}`);
    try {
        const response = await fetch(config.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [{ to: tokenAddress, data: calldata }, "latest"],
                id: 1,
            }),
        });
        const data = (await response.json());
        const allowanceRaw = data.result ? BigInt(data.result) : BigInt(0);
        const isUnlimited = allowanceRaw >= UNLIMITED_THRESHOLD;
        // Format allowance
        let allowance;
        if (isUnlimited) {
            allowance = "Unlimited";
        }
        else {
            const allowanceNum = Number(allowanceRaw) / Math.pow(10, metadata.decimals);
            allowance = allowanceNum.toFixed(metadata.decimals > 6 ? 6 : metadata.decimals);
        }
        // Look up known contract name
        const spenderLower = spenderAddress.toLowerCase();
        const knownContract = KNOWN_CONTRACTS[spenderLower];
        return {
            tokenAddress,
            tokenSymbol: metadata.symbol,
            tokenDecimals: metadata.decimals,
            spenderAddress,
            spenderName: knownContract?.name,
            allowance,
            allowanceRaw: allowanceRaw.toString(),
            isUnlimited,
        };
    }
    catch (error) {
        console.error(`[clara] Allowance check error:`, error);
        return {
            tokenAddress,
            tokenSymbol: metadata.symbol,
            tokenDecimals: metadata.decimals,
            spenderAddress,
            allowance: "0",
            allowanceRaw: "0",
            isUnlimited: false,
        };
    }
}
/**
 * Get approval history from block explorer
 * Fetches all Approval events for the user's address
 */
export async function getApprovalHistory(chain, options = {}) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    const { limit = 50 } = options;
    const address = session.address.toLowerCase();
    if (chain === "solana") {
        return { approvals: [], address, chain };
    }
    const explorer = EXPLORER_CONFIG[chain];
    if (!explorer) {
        throw new Error(`Explorer not configured for ${chain}`);
    }
    console.error(`[clara] Fetching approval history for ${address} on ${chain}`);
    try {
        // Fetch ERC-20 approval events using tokentx endpoint
        // We'll look for unique token+spender combinations
        const tokenTxUrl = `${explorer.apiUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc`;
        const response = await fetch(tokenTxUrl);
        const data = (await response.json());
        // Track unique token+spender pairs we need to check
        const spenderMap = new Map();
        if (data.status === "1" && Array.isArray(data.result)) {
            for (const tx of data.result) {
                // If we sent tokens, the recipient might be a contract that has approval
                if (tx.from.toLowerCase() === address && tx.to.toLowerCase() !== address) {
                    const tokenAddr = tx.contractAddress.toLowerCase();
                    if (!spenderMap.has(tokenAddr)) {
                        spenderMap.set(tokenAddr, new Set());
                    }
                    spenderMap.get(tokenAddr).add(tx.to.toLowerCase());
                }
            }
        }
        // Also add common DeFi protocols to check for each token
        const commonSpenders = [
            "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2 Router
            "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 Router
            "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Universal Router
            "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // Aave V3
        ];
        // Get all tokens user has interacted with
        for (const [tokenAddr, spenders] of spenderMap.entries()) {
            for (const commonSpender of commonSpenders) {
                spenders.add(commonSpender);
            }
        }
        // Check allowances for all token+spender pairs
        const approvals = [];
        for (const [tokenAddr, spenders] of spenderMap.entries()) {
            for (const spenderAddr of spenders) {
                try {
                    const approval = await getAllowance(tokenAddr, spenderAddr, chain, address);
                    // Only include non-zero approvals
                    if (approval.allowanceRaw !== "0") {
                        approvals.push(approval);
                    }
                }
                catch {
                    // Skip tokens that fail
                    continue;
                }
            }
        }
        // Sort by unlimited first, then by token symbol
        approvals.sort((a, b) => {
            if (a.isUnlimited && !b.isUnlimited)
                return -1;
            if (!a.isUnlimited && b.isUnlimited)
                return 1;
            return a.tokenSymbol.localeCompare(b.tokenSymbol);
        });
        return { approvals, address, chain };
    }
    catch (error) {
        console.error(`[clara] Failed to fetch approval history:`, error);
        return { approvals: [], address, chain };
    }
}
/**
 * Encode ERC-20 approve calldata
 * approve(address spender, uint256 amount)
 * Use amount = "0" to revoke approval
 */
export function encodeApproveCalldata(spenderAddress, amount, decimals) {
    const paddedSpender = spenderAddress.slice(2).toLowerCase().padStart(64, "0");
    let paddedAmount;
    if (amount === "0") {
        paddedAmount = "0".padStart(64, "0");
    }
    else if (amount === "unlimited" || amount === "max") {
        paddedAmount = MAX_UINT256.toString(16).padStart(64, "0");
    }
    else {
        const amountFloat = parseFloat(amount);
        const amountRaw = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
        paddedAmount = amountRaw.toString(16).padStart(64, "0");
    }
    return ERC20_SELECTORS.approve + paddedSpender + paddedAmount;
}
/**
 * Format an approval for display
 */
export function formatApproval(approval) {
    const riskIcon = approval.isUnlimited ? "⚠️" : "✓";
    const spenderDisplay = approval.spenderName
        ? approval.spenderName
        : `${approval.spenderAddress.slice(0, 6)}...${approval.spenderAddress.slice(-4)}`;
    return `${riskIcon} ${approval.tokenSymbol} → ${spenderDisplay}: ${approval.allowance}`;
}
// ============================================================================
// Token Swaps (via Li.Fi Aggregator)
// ============================================================================
// Li.Fi API - aggregates across multiple DEXs, no API key required
const LIFI_API = "https://li.quest/v1";
// Map our chain names to Li.Fi chain IDs
const LIFI_CHAIN_IDS = {
    ethereum: 1,
    base: 8453,
    arbitrum: 42161,
    optimism: 10,
    polygon: 137,
    solana: null, // Li.Fi doesn't support Solana swaps
};
// Native token address placeholder (used by Li.Fi for ETH/MATIC/etc)
const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/**
 * Get a swap quote from Li.Fi
 * Finds the best route across multiple DEXs
 */
export async function getSwapQuote(fromToken, toToken, amount, chain, slippage = 0.5) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    const chainId = LIFI_CHAIN_IDS[chain];
    if (!chainId) {
        throw new Error(`Swaps not supported on ${chain}`);
    }
    // Resolve token addresses
    let fromAddress;
    let toAddress;
    // Handle native token (ETH, MATIC, etc.)
    const nativeSymbols = ["ETH", "MATIC", "NATIVE"];
    if (nativeSymbols.includes(fromToken.toUpperCase())) {
        fromAddress = NATIVE_TOKEN_ADDRESS;
    }
    else if (fromToken.startsWith("0x")) {
        fromAddress = fromToken;
    }
    else {
        const resolved = resolveToken(fromToken, chain);
        if (!resolved) {
            throw new Error(`Unknown token: ${fromToken} on ${chain}`);
        }
        fromAddress = resolved.address;
    }
    if (nativeSymbols.includes(toToken.toUpperCase())) {
        toAddress = NATIVE_TOKEN_ADDRESS;
    }
    else if (toToken.startsWith("0x")) {
        toAddress = toToken;
    }
    else {
        const resolved = resolveToken(toToken, chain);
        if (!resolved) {
            throw new Error(`Unknown token: ${toToken} on ${chain}`);
        }
        toAddress = resolved.address;
    }
    // Get token metadata for amount conversion
    let fromDecimals = 18;
    if (fromAddress !== NATIVE_TOKEN_ADDRESS) {
        const metadata = await getTokenMetadata(fromAddress, chain);
        fromDecimals = metadata.decimals;
    }
    // Convert amount to raw units
    const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, fromDecimals)));
    console.error(`[clara] Getting swap quote: ${amount} ${fromToken} → ${toToken} on ${chain}`);
    // Call Li.Fi quote endpoint
    const params = new URLSearchParams({
        fromChain: chainId.toString(),
        toChain: chainId.toString(), // Same chain swap
        fromToken: fromAddress,
        toToken: toAddress,
        fromAmount: amountRaw.toString(),
        fromAddress: session.address,
        slippage: (slippage / 100).toString(), // Convert percentage to decimal
    });
    try {
        const response = await fetch(`${LIFI_API}/quote?${params}`);
        if (!response.ok) {
            const error = await response.text();
            console.error(`[clara] Li.Fi API error: ${response.status} - ${error}`);
            throw new Error(`Quote failed: ${response.status}`);
        }
        const data = await response.json();
        // Calculate exchange rate
        const fromAmountNum = parseFloat(amount);
        const toAmountNum = Number(BigInt(data.estimate.toAmount)) / Math.pow(10, data.action.toToken.decimals);
        const exchangeRate = (toAmountNum / fromAmountNum).toFixed(6);
        // Calculate price impact (rough estimate from USD values)
        const fromUsd = parseFloat(data.estimate.fromAmountUSD || "0");
        const toUsd = parseFloat(data.estimate.toAmountUSD || "0");
        const priceImpact = fromUsd > 0 ? (((fromUsd - toUsd) / fromUsd) * 100).toFixed(2) : "0";
        // Check if approval is needed (for non-native tokens)
        let needsApproval = false;
        let currentAllowance;
        if (fromAddress !== NATIVE_TOKEN_ADDRESS && data.estimate.approvalAddress) {
            const approval = await getAllowance(fromAddress, data.estimate.approvalAddress, chain);
            const requiredAmount = BigInt(data.action.fromAmount);
            const currentAmount = BigInt(approval.allowanceRaw);
            needsApproval = currentAmount < requiredAmount;
            currentAllowance = approval.allowance;
        }
        // Sum up gas costs
        const totalGasUsd = data.estimate.gasCosts.reduce((sum, g) => sum + parseFloat(g.amountUSD || "0"), 0);
        const totalGasEstimate = data.estimate.gasCosts.reduce((sum, g) => sum + parseInt(g.estimate || "0"), 0);
        return {
            id: data.id,
            fromToken: {
                address: data.action.fromToken.address,
                symbol: data.action.fromToken.symbol,
                decimals: data.action.fromToken.decimals,
                priceUsd: data.action.fromToken.priceUSD,
            },
            toToken: {
                address: data.action.toToken.address,
                symbol: data.action.toToken.symbol,
                decimals: data.action.toToken.decimals,
                priceUsd: data.action.toToken.priceUSD,
            },
            fromAmount: amount,
            fromAmountUsd: data.estimate.fromAmountUSD || "0",
            toAmount: toAmountNum.toFixed(data.action.toToken.decimals > 6 ? 6 : data.action.toToken.decimals),
            toAmountUsd: data.estimate.toAmountUSD || "0",
            toAmountMin: (Number(BigInt(data.estimate.toAmountMin)) / Math.pow(10, data.action.toToken.decimals)).toFixed(6),
            exchangeRate,
            priceImpact,
            estimatedGas: totalGasEstimate.toString(),
            estimatedGasUsd: totalGasUsd.toFixed(2),
            approvalAddress: data.estimate.approvalAddress,
            needsApproval,
            currentAllowance,
            transactionRequest: data.transactionRequest ? {
                to: data.transactionRequest.to,
                data: data.transactionRequest.data,
                value: data.transactionRequest.value,
                gasLimit: data.transactionRequest.gasLimit,
            } : undefined,
            tool: data.tool,
            toolDetails: data.toolDetails?.name,
        };
    }
    catch (error) {
        console.error(`[clara] Swap quote error:`, error);
        throw error;
    }
}
/**
 * Execute a swap using the quote's transaction request
 */
export async function executeSwap(quote, chain) {
    if (!quote.transactionRequest) {
        throw new Error("Quote does not include transaction data. Get a fresh quote.");
    }
    if (quote.needsApproval) {
        throw new Error(`Approval needed first. Approve ${quote.fromToken.symbol} for spender ${quote.approvalAddress}`);
    }
    console.error(`[clara] Executing swap: ${quote.fromAmount} ${quote.fromToken.symbol} → ${quote.toToken.symbol}`);
    // Send the swap transaction
    const result = await sendTransaction(quote.transactionRequest.to, "0", // Value is in the tx data
    chain, undefined, quote.transactionRequest.data);
    return {
        txHash: result.txHash,
        status: "pending",
    };
}
/**
 * Get supported tokens for swapping on a chain
 * Returns common tokens that Li.Fi supports
 */
export function getSwappableTokens(chain) {
    const tokens = [];
    // Add native token
    const nativeSymbol = chain === "polygon" ? "MATIC" : "ETH";
    tokens.push({ symbol: nativeSymbol, address: NATIVE_TOKEN_ADDRESS });
    // Add popular tokens for this chain
    for (const [symbol, chainData] of Object.entries(POPULAR_TOKENS)) {
        const tokenInfo = chainData[chain];
        if (tokenInfo) {
            tokens.push({ symbol, address: tokenInfo.address });
        }
    }
    return tokens;
}
// ============================================================================
// Yield / Lending (DeFiLlama + Aave v3 Adapter)
// ============================================================================
// DeFiLlama Yields API (free, no API key)
const DEFILLAMA_YIELDS_API = "https://yields.llama.fi";
// Aave v3 Pool addresses per chain
const AAVE_V3_POOLS = {
    ethereum: {
        pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
        poolDataProvider: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3",
    },
    base: {
        pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        poolDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
    },
    arbitrum: {
        pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        poolDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    },
    optimism: {
        pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        poolDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    },
    polygon: {
        pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        poolDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    },
};
// Aave v3 function selectors
const AAVE_SELECTORS = {
    supply: "0x617ba037", // supply(address,uint256,address,uint16)
    withdraw: "0x69328dec", // withdraw(address,uint256,address)
};
/**
 * Fetch yield opportunities from DeFiLlama
 * Filters for supported protocols and chains
 */
export async function getYieldOpportunities(asset, options = {}) {
    const { chains = ["base", "arbitrum"], minTvl = 1_000_000, // $1M minimum TVL for safety
    protocols = ["aave-v3"], // Start conservative
     } = options;
    console.error(`[clara] Fetching yields for ${asset} on ${chains.join(", ")}`);
    try {
        const response = await fetch(`${DEFILLAMA_YIELDS_API}/pools`);
        if (!response.ok) {
            throw new Error(`DeFiLlama API error: ${response.status}`);
        }
        const data = (await response.json());
        // Filter for matching opportunities
        const assetUpper = asset.toUpperCase();
        const opportunities = [];
        for (const pool of data.data) {
            // Check chain
            const chainLower = pool.chain.toLowerCase();
            if (!chains.includes(chainLower))
                continue;
            // Check protocol
            if (!protocols.includes(pool.project))
                continue;
            // Check asset (symbol contains our asset)
            if (!pool.symbol.toUpperCase().includes(assetUpper))
                continue;
            // Check TVL
            if (pool.tvlUsd < minTvl)
                continue;
            opportunities.push({
                pool: pool.pool,
                chain: chainLower,
                protocol: pool.project,
                symbol: pool.symbol,
                apy: pool.apyBase || 0,
                apyReward: pool.apyReward,
                apyTotal: pool.apy || 0,
                tvlUsd: pool.tvlUsd,
                stablecoin: pool.stablecoin,
                underlyingTokens: pool.underlyingTokens || [],
            });
        }
        // Sort by total APY descending
        opportunities.sort((a, b) => b.apyTotal - a.apyTotal);
        console.error(`[clara] Found ${opportunities.length} yield opportunities`);
        return opportunities;
    }
    catch (error) {
        console.error(`[clara] Yield fetch error:`, error);
        return [];
    }
}
/**
 * Get the best yield opportunity for an asset
 */
export async function getBestYield(asset, chains = ["base", "arbitrum"]) {
    const opportunities = await getYieldOpportunities(asset, { chains });
    return opportunities[0] || null;
}
/**
 * Encode Aave v3 supply transaction
 * supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
 */
export function encodeAaveSupply(assetAddress, amount, decimals, onBehalfOf) {
    // Pad asset address (32 bytes)
    const paddedAsset = assetAddress.slice(2).toLowerCase().padStart(64, "0");
    // Pad amount (32 bytes)
    const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));
    const paddedAmount = amountRaw.toString(16).padStart(64, "0");
    // Pad onBehalfOf address (32 bytes)
    const paddedOnBehalfOf = onBehalfOf.slice(2).toLowerCase().padStart(64, "0");
    // Referral code = 0 (32 bytes)
    const paddedReferral = "0".padStart(64, "0");
    return AAVE_SELECTORS.supply + paddedAsset + paddedAmount + paddedOnBehalfOf + paddedReferral;
}
/**
 * Encode Aave v3 withdraw transaction
 * withdraw(address asset, uint256 amount, address to)
 */
export function encodeAaveWithdraw(assetAddress, amount, decimals, to) {
    const paddedAsset = assetAddress.slice(2).toLowerCase().padStart(64, "0");
    // Use max uint256 for "withdraw all"
    let paddedAmount;
    if (amount === "max" || amount === "all") {
        paddedAmount = MAX_UINT256.toString(16).padStart(64, "0");
    }
    else {
        const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));
        paddedAmount = amountRaw.toString(16).padStart(64, "0");
    }
    const paddedTo = to.slice(2).toLowerCase().padStart(64, "0");
    return AAVE_SELECTORS.withdraw + paddedAsset + paddedAmount + paddedTo;
}
/**
 * Create a yield deposit plan for the best available opportunity
 */
export async function createYieldPlan(asset, amount, preferredChains = ["base", "arbitrum"]) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    // Find best yield opportunity
    const best = await getBestYield(asset, preferredChains);
    if (!best) {
        return null;
    }
    // Only support Aave v3 for now
    if (best.protocol !== "aave-v3") {
        console.error(`[clara] Unsupported protocol: ${best.protocol}`);
        return null;
    }
    const aaveConfig = AAVE_V3_POOLS[best.chain];
    if (!aaveConfig) {
        console.error(`[clara] Aave not configured for ${best.chain}`);
        return null;
    }
    // Get asset address on this chain
    const tokenInfo = resolveToken(asset, best.chain);
    if (!tokenInfo) {
        console.error(`[clara] Token ${asset} not found on ${best.chain}`);
        return null;
    }
    // Check if approval is needed
    const approval = await getAllowance(tokenInfo.address, aaveConfig.pool, best.chain);
    const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, tokenInfo.decimals)));
    const needsApproval = BigInt(approval.allowanceRaw) < amountRaw;
    // Encode the supply transaction
    const transactionData = encodeAaveSupply(tokenInfo.address, amount, tokenInfo.decimals, session.address);
    return {
        action: "deposit",
        protocol: "Aave v3",
        chain: best.chain,
        asset: tokenInfo.symbol,
        assetAddress: tokenInfo.address,
        amount,
        amountRaw: amountRaw.toString(),
        apy: best.apyTotal,
        tvlUsd: best.tvlUsd,
        poolContract: aaveConfig.pool,
        transactionData,
        needsApproval,
        approvalAddress: needsApproval ? aaveConfig.pool : undefined,
        estimatedGasUsd: "0.50", // Rough estimate
    };
}
/**
 * Execute a yield deposit
 */
export async function executeYieldDeposit(plan) {
    if (plan.needsApproval) {
        throw new Error("Approval needed first");
    }
    console.error(`[clara] Executing yield deposit: ${plan.amount} ${plan.asset} → ${plan.protocol} on ${plan.chain}`);
    const result = await sendTransaction(plan.poolContract, "0", // No ETH value for ERC-20 supply
    plan.chain, undefined, plan.transactionData);
    return {
        txHash: result.txHash,
        status: "pending",
    };
}
// Aave v3 aToken addresses (receipt tokens for deposits)
const AAVE_ATOKENS = {
    base: {
        USDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
        USDbC: "0x0a1d576f3eFeF75b330424287a95A366e8281D54",
        DAI: "0x0000000000000000000000000000000000000000", // Not available on Base
        WETH: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7",
    },
    arbitrum: {
        USDC: "0x724dc807b04555b71ed48a6896b6F41593b8C637",
        "USDC.e": "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
        USDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
        DAI: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
        WETH: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
    },
};
/**
 * Get user's yield positions across chains
 */
export async function getYieldPositions(chains = ["base", "arbitrum"]) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    const positions = [];
    for (const chain of chains) {
        const aTokens = AAVE_ATOKENS[chain];
        if (!aTokens)
            continue;
        const aaveConfig = AAVE_V3_POOLS[chain];
        if (!aaveConfig)
            continue;
        // Check balance of each aToken
        for (const [symbol, aTokenAddress] of Object.entries(aTokens)) {
            if (aTokenAddress === "0x0000000000000000000000000000000000000000")
                continue;
            try {
                const balance = await getTokenBalance(aTokenAddress, chain, session.address);
                const balanceNum = parseFloat(balance.balance);
                if (balanceNum > 0.0001) { // Only show positions above dust
                    // Get underlying token address
                    const underlying = resolveToken(symbol, chain);
                    // Get current APY from DeFiLlama
                    const yields = await getYieldOpportunities(symbol, { chains: [chain] });
                    const currentApy = yields[0]?.apyTotal || 0;
                    positions.push({
                        protocol: "Aave v3",
                        chain,
                        asset: symbol,
                        assetAddress: underlying?.address || "",
                        aTokenAddress,
                        deposited: balance.balance,
                        depositedRaw: balance.balanceRaw,
                        currentApy,
                        valueUsd: "—", // Would need price oracle
                    });
                }
            }
            catch (error) {
                console.error(`[clara] Error checking aToken ${symbol} on ${chain}:`, error);
                continue;
            }
        }
    }
    return positions;
}
/**
 * Create a withdrawal plan for yield positions
 */
export async function createWithdrawPlan(asset, amount, // "all" or specific amount
chain) {
    const session = await getSession();
    if (!session?.authenticated || !session.address) {
        throw new Error("Not authenticated");
    }
    const aaveConfig = AAVE_V3_POOLS[chain];
    if (!aaveConfig) {
        console.error(`[clara] Aave not configured for ${chain}`);
        return null;
    }
    // Get token info
    const tokenInfo = resolveToken(asset, chain);
    if (!tokenInfo) {
        console.error(`[clara] Token ${asset} not found on ${chain}`);
        return null;
    }
    // Get aToken address
    const aTokens = AAVE_ATOKENS[chain];
    const aTokenAddress = aTokens?.[tokenInfo.symbol];
    if (!aTokenAddress || aTokenAddress === "0x0000000000000000000000000000000000000000") {
        console.error(`[clara] No aToken for ${asset} on ${chain}`);
        return null;
    }
    // Check deposited balance
    const aTokenBalance = await getTokenBalance(aTokenAddress, chain, session.address);
    const depositedNum = parseFloat(aTokenBalance.balance);
    if (depositedNum < 0.0001) {
        console.error(`[clara] No ${asset} deposited in Aave on ${chain}`);
        return null;
    }
    // Determine withdrawal amount
    const isWithdrawAll = amount === "all" || amount === "max";
    const withdrawAmount = isWithdrawAll ? aTokenBalance.balance : amount;
    const withdrawNum = parseFloat(withdrawAmount);
    if (withdrawNum > depositedNum) {
        console.error(`[clara] Cannot withdraw ${withdrawAmount}, only ${aTokenBalance.balance} deposited`);
        return null;
    }
    // Get current APY for display
    const yields = await getYieldOpportunities(asset, { chains: [chain] });
    const currentApy = yields[0]?.apyTotal || 0;
    const tvlUsd = yields[0]?.tvlUsd || 0;
    // Encode withdraw transaction
    const transactionData = encodeAaveWithdraw(tokenInfo.address, isWithdrawAll ? "max" : withdrawAmount, tokenInfo.decimals, session.address);
    return {
        action: "withdraw",
        protocol: "Aave v3",
        chain,
        asset: tokenInfo.symbol,
        assetAddress: tokenInfo.address,
        amount: withdrawAmount,
        amountRaw: isWithdrawAll ? aTokenBalance.balanceRaw : BigInt(Math.floor(withdrawNum * Math.pow(10, tokenInfo.decimals))).toString(),
        apy: currentApy,
        tvlUsd,
        poolContract: aaveConfig.pool,
        transactionData,
        needsApproval: false, // No approval needed for withdraws
        estimatedGasUsd: "0.30",
    };
}
/**
 * Execute a yield withdrawal
 */
export async function executeYieldWithdraw(plan) {
    if (plan.action !== "withdraw") {
        throw new Error("Invalid plan - not a withdraw action");
    }
    console.error(`[clara] Executing yield withdraw: ${plan.amount} ${plan.asset} from ${plan.protocol} on ${plan.chain}`);
    const result = await sendTransaction(plan.poolContract, "0", plan.chain, undefined, plan.transactionData);
    return {
        txHash: result.txHash,
        status: "pending",
    };
}
/**
 * Format a yield opportunity for display
 */
export function formatYieldOpportunity(opp) {
    const apyStr = opp.apyTotal.toFixed(2);
    const tvlStr = (opp.tvlUsd / 1_000_000).toFixed(1);
    return `${opp.protocol} on ${opp.chain}: ${apyStr}% APY ($${tvlStr}M TVL)`;
}
export { CHAIN_CONFIG, EXPLORER_CONFIG, NATIVE_TOKEN_ADDRESS, AAVE_V3_POOLS };
//# sourceMappingURL=client.js.map