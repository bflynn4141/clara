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
 */
export async function sendTransaction(to, amount, chain, _tokenAddress) {
    const session = await getSession();
    if (!session?.authenticated) {
        throw new Error("Not authenticated");
    }
    console.error(`[clara] Sending ${amount} to ${to} on ${chain}`);
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
        const data = (await response.json());
        if (data.error) {
            throw new Error(data.error.message);
        }
        return { txHash: data.result || signed.txHash || "" };
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
export { CHAIN_CONFIG };
//# sourceMappingURL=client.js.map