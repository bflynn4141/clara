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
import {
  recordYieldTransaction,
  getTransactionsForPosition,
  calculateEarnings,
  getYieldEarningsSummary,
  type YieldTransaction,
} from "../storage/yield-history.js";
import {
  getProtocolAdapter,
  getSupportedProtocols,
  type ProtocolAdapter,
} from "./protocols/index.js";
import {
  getTransactionHistoryZerion,
  formatTransactionZerion,
  isZerionAvailable,
  getPortfolioZerion,
  type TransactionHistoryItem as ZerionTransactionHistoryItem,
  type TransactionHistory as ZerionTransactionHistory,
  type ZerionPortfolio,
} from "./zerion.js";
import {
  getSolanaAssets,
  getSolanaTransactions,
  isHeliusAvailable,
  type SolanaBalance,
  type SolanaPortfolio,
  type SolanaTransaction,
} from "./solana.js";

// Types
export interface TokenBalance {
  symbol: string;
  balance: string;
  usdValue?: string;
  contractAddress?: string;
}

export interface TransactionRequest {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId?: number;
}

export interface SignedTransaction {
  signedTx: string;
  txHash?: string;
}

export type SupportedChain =
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "solana";

// Chain configurations
const CHAIN_CONFIG: Record<SupportedChain, { name: string; chainId?: number; rpcUrl: string }> = {
  ethereum: { name: "Ethereum", chainId: 1, rpcUrl: "https://eth.llamarpc.com" },
  base: { name: "Base", chainId: 8453, rpcUrl: "https://mainnet.base.org" },
  arbitrum: { name: "Arbitrum One", chainId: 42161, rpcUrl: "https://arb1.arbitrum.io/rpc" },
  optimism: { name: "Optimism", chainId: 10, rpcUrl: "https://mainnet.optimism.io" },
  polygon: { name: "Polygon", chainId: 137, rpcUrl: "https://polygon-rpc.com" },
  solana: { name: "Solana", rpcUrl: "https://api.mainnet-beta.solana.com" },
};

// Block explorer API configuration (for transaction history)
const EXPLORER_CONFIG: Record<SupportedChain, { apiUrl: string; explorerUrl: string } | null> = {
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

// ============================================
// RLP Encoding for EIP-1559 Transactions
// ============================================

/**
 * Encode a single item for RLP
 * - Bytes 0-55: 0x80 + length prefix
 * - Bytes > 55: 0xb7 + length-of-length prefix
 */
function rlpEncodeBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0] < 0x80) {
    return data;
  }
  if (data.length <= 55) {
    const result = new Uint8Array(1 + data.length);
    result[0] = 0x80 + data.length;
    result.set(data, 1);
    return result;
  }
  const lengthBytes = bigIntToBytes(BigInt(data.length));
  const result = new Uint8Array(1 + lengthBytes.length + data.length);
  result[0] = 0xb7 + lengthBytes.length;
  result.set(lengthBytes, 1);
  result.set(data, 1 + lengthBytes.length);
  return result;
}

/**
 * Convert BigInt to minimal bytes (big-endian, no leading zeros)
 */
function bigIntToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array(0);
  let hex = value.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleanHex.length === 0) return new Uint8Array(0);
  const padded = cleanHex.length % 2 ? "0" + cleanHex : cleanHex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string with 0x prefix
 */
function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encode an EIP-1559 (type 2) unsigned transaction for signing
 * Returns: 0x02 || RLP([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList])
 */
function encodeUnsignedEIP1559Tx(tx: {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;
  value: bigint;
  data: string;
}): Uint8Array {
  // Encode each field individually
  const encodedFields: Uint8Array[] = [
    rlpEncodeBytes(bigIntToBytes(BigInt(tx.chainId))),
    rlpEncodeBytes(bigIntToBytes(BigInt(tx.nonce))),
    rlpEncodeBytes(bigIntToBytes(tx.maxPriorityFeePerGas)),
    rlpEncodeBytes(bigIntToBytes(tx.maxFeePerGas)),
    rlpEncodeBytes(bigIntToBytes(tx.gasLimit)),
    rlpEncodeBytes(hexToBytes(tx.to)),
    rlpEncodeBytes(bigIntToBytes(tx.value)),
    rlpEncodeBytes(hexToBytes(tx.data)),
    new Uint8Array([0xc0]), // Empty access list = RLP empty list
  ];

  // Calculate total length of encoded fields
  const totalLength = encodedFields.reduce((sum, f) => sum + f.length, 0);

  // Encode as RLP list
  let rlpEncoded: Uint8Array;
  if (totalLength <= 55) {
    rlpEncoded = new Uint8Array(1 + totalLength);
    rlpEncoded[0] = 0xc0 + totalLength;
    let offset = 1;
    for (const field of encodedFields) {
      rlpEncoded.set(field, offset);
      offset += field.length;
    }
  } else {
    const lengthBytes = bigIntToBytes(BigInt(totalLength));
    rlpEncoded = new Uint8Array(1 + lengthBytes.length + totalLength);
    rlpEncoded[0] = 0xf7 + lengthBytes.length;
    rlpEncoded.set(lengthBytes, 1);
    let offset = 1 + lengthBytes.length;
    for (const field of encodedFields) {
      rlpEncoded.set(field, offset);
      offset += field.length;
    }
  }

  // Prepend type byte (0x02 for EIP-1559)
  const result = new Uint8Array(1 + rlpEncoded.length);
  result[0] = 0x02;
  result.set(rlpEncoded, 1);
  return result;
}

/**
 * Encode a signed EIP-1559 transaction for broadcast
 * Returns: 0x02 || RLP([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList, v, r, s])
 */
function encodeSignedEIP1559Tx(tx: {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;
  value: bigint;
  data: string;
  v: number;
  r: bigint;
  s: bigint;
}): Uint8Array {
  // Encode each field individually
  const encodedFields: Uint8Array[] = [
    rlpEncodeBytes(bigIntToBytes(BigInt(tx.chainId))),
    rlpEncodeBytes(bigIntToBytes(BigInt(tx.nonce))),
    rlpEncodeBytes(bigIntToBytes(tx.maxPriorityFeePerGas)),
    rlpEncodeBytes(bigIntToBytes(tx.maxFeePerGas)),
    rlpEncodeBytes(bigIntToBytes(tx.gasLimit)),
    rlpEncodeBytes(hexToBytes(tx.to)),
    rlpEncodeBytes(bigIntToBytes(tx.value)),
    rlpEncodeBytes(hexToBytes(tx.data)),
    new Uint8Array([0xc0]), // Empty access list = RLP empty list
    rlpEncodeBytes(bigIntToBytes(BigInt(tx.v))),
    rlpEncodeBytes(bigIntToBytes(tx.r)),
    rlpEncodeBytes(bigIntToBytes(tx.s)),
  ];

  // Calculate total length
  const totalLength = encodedFields.reduce((sum, f) => sum + f.length, 0);

  // Encode as RLP list
  let rlpEncoded: Uint8Array;
  if (totalLength <= 55) {
    rlpEncoded = new Uint8Array(1 + totalLength);
    rlpEncoded[0] = 0xc0 + totalLength;
    let offset = 1;
    for (const field of encodedFields) {
      rlpEncoded.set(field, offset);
      offset += field.length;
    }
  } else {
    const lengthBytes = bigIntToBytes(BigInt(totalLength));
    rlpEncoded = new Uint8Array(1 + lengthBytes.length + totalLength);
    rlpEncoded[0] = 0xf7 + lengthBytes.length;
    rlpEncoded.set(lengthBytes, 1);
    let offset = 1 + lengthBytes.length;
    for (const field of encodedFields) {
      rlpEncoded.set(field, offset);
      offset += field.length;
    }
  }

  // Prepend type byte (0x02 for EIP-1559)
  const result = new Uint8Array(1 + rlpEncoded.length);
  result[0] = 0x02;
  result.set(rlpEncoded, 1);
  return result;
}

/**
 * Parse a 65-byte signature into r, s, v components
 * Format: r (32 bytes) + s (32 bytes) + v (1 byte)
 */
function parseSignature(sig: string): { r: bigint; s: bigint; v: number } {
  const cleanSig = sig.startsWith("0x") ? sig.slice(2) : sig;
  if (cleanSig.length !== 130) {
    throw new Error(`Invalid signature length: expected 130 hex chars, got ${cleanSig.length}`);
  }
  const r = BigInt("0x" + cleanSig.slice(0, 64));
  const s = BigInt("0x" + cleanSig.slice(64, 128));
  let v = parseInt(cleanSig.slice(128, 130), 16);

  // Normalize v: Para may return 27/28, but EIP-1559 uses 0/1
  if (v >= 27) v -= 27;

  return { r, s, v };
}

/**
 * Internal: Get the current nonce for an address
 */
async function fetchNonce(address: string, chain: SupportedChain): Promise<number> {
  const config = CHAIN_CONFIG[chain];
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionCount",
      params: [address, "pending"],
      id: 1,
    }),
  });

  const result = await response.json() as { result?: string; error?: { message: string } };
  if (result.error) {
    throw new Error(`Failed to get nonce: ${result.error.message}`);
  }
  return parseInt(result.result || "0x0", 16);
}

/**
 * Internal: Estimate gas limit for a transaction
 */
async function fetchGasLimit(tx: { to: string; from: string; value?: string; data?: string }, chain: SupportedChain): Promise<bigint> {
  const config = CHAIN_CONFIG[chain];
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_estimateGas",
      params: [{
        to: tx.to,
        from: tx.from,
        value: tx.value || "0x0",
        data: tx.data || "0x",
      }],
      id: 1,
    }),
  });

  const result = await response.json() as { result?: string; error?: { message: string } };
  if (result.error) {
    // Default to 21000 for simple transfers, higher for contract calls
    return tx.data && tx.data !== "0x" ? 100000n : 21000n;
  }
  // Add 20% buffer
  return BigInt(result.result || "0x5208") * 120n / 100n;
}

/**
 * Internal: Get current gas prices
 */
async function fetchGasPrices(chain: SupportedChain): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const config = CHAIN_CONFIG[chain];

  // Get base fee from latest block
  const blockResponse = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: ["latest", false],
      id: 1,
    }),
  });

  const blockResult = await blockResponse.json() as { result?: { baseFeePerGas?: string } };
  const baseFee = BigInt(blockResult.result?.baseFeePerGas || "0x3b9aca00"); // Default 1 gwei

  // Set priority fee (tip) - 0.1 gwei for L2s, 1 gwei for mainnet
  const priorityFee = chain === "ethereum" ? 1000000000n : 100000000n;

  // Max fee = 2 * base fee + priority fee (gives room for base fee increases)
  const maxFee = baseFee * 2n + priorityFee;

  return {
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: priorityFee,
  };
}

// ENS Contract Addresses (Ethereum Mainnet)
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

/**
 * Compute ENS namehash for a domain name
 * namehash('') = 0x0000...0000
 * namehash('eth') = keccak256(namehash('') + keccak256('eth'))
 * namehash('vitalik.eth') = keccak256(namehash('eth') + keccak256('vitalik'))
 */
function namehash(name: string): string {
  if (!name) {
    return "0x" + "00".repeat(32);
  }

  const labels = name.split(".");
  let node: Uint8Array = new Uint8Array(32); // Start with 32 zero bytes

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
export async function resolveEnsName(name: string): Promise<string | null> {
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

    const resolverData = (await resolverResponse.json()) as { result?: string; error?: { message: string } };

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

    const addrData = (await addrResponse.json()) as { result?: string; error?: { message: string } };

    if (addrData.error || !addrData.result || addrData.result === "0x" + "00".repeat(32)) {
      console.error(`[clara] No address found for ${normalizedName}`);
      return null;
    }

    // Extract address (last 20 bytes)
    const address = "0x" + addrData.result.slice(-40);
    console.error(`[clara] Resolved ${normalizedName} -> ${address}`);

    return address;
  } catch (error) {
    console.error(`[clara] ENS resolution error:`, error);
    return null;
  }
}

/**
 * Reverse resolve: get ENS name for an Ethereum address
 */
export async function reverseResolveEns(address: string): Promise<string | null> {
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

    const resolverData = (await resolverResponse.json()) as { result?: string };

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

    const nameData = (await nameResponse.json()) as { result?: string };

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
  } catch (error) {
    console.error(`[clara] Reverse ENS resolution error:`, error);
    return null;
  }
}

/**
 * Check if a string looks like an ENS name
 */
export function isEnsName(input: string): boolean {
  if (!input || input.startsWith("0x")) return false;
  return input.includes(".") && (
    input.endsWith(".eth") ||
    input.endsWith(".xyz") ||
    input.endsWith(".com") ||
    input.endsWith(".org") ||
    input.endsWith(".io") ||
    input.endsWith(".app")
  );
}

/**
 * Make authenticated request to Para API
 */
async function paraFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = process.env.PARA_API_KEY;

  // API key is optional when using a proxy that injects it
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
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
    const errorText = await response.text();
    console.error(`[clara] API error: ${response.status} - ${errorText}`);

    // For 409 Conflict, try to parse wallet info from response
    if (response.status === 409) {
      try {
        const errorJson = JSON.parse(errorText);
        // Some APIs return the existing resource on conflict
        if (errorJson.wallet) {
          console.error(`[clara] 409 response contains wallet info: ${errorJson.wallet.id}`);
          // Create a fake "ok" response with the wallet data
          return new Response(JSON.stringify(errorJson), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch {
        // Not JSON or no wallet info, continue with error
      }
    }

    throw new Error(`Para API error: ${response.status} - ${errorText}`);
  }

  return response;
}

/**
 * Identifier types supported by Para wallets
 */
export type PregenIdentifier =
  | { type: "email"; value: string }
  | { type: "customId"; value: string };

/**
 * Para wallet types
 */
type ParaWalletType = "EVM" | "SOLANA";

/**
 * Wallet info structure
 */
interface ParaWalletInfo {
  id: string;
  address: string;
  type: ParaWalletType;
  status?: string;
  createdAt?: string;
}

/**
 * Para API wallet response (nested in 'wallet' object)
 */
interface ParaWalletResponse {
  wallet: ParaWalletInfo;
  scheme?: string;
}

/**
 * Para API wallet list response
 */
interface ParaWalletListResponse {
  wallets: ParaWalletInfo[];
}

/**
 * Create wallet via Para REST API
 * Creates both EVM and Solana wallets for full multi-chain support
 */
export async function createPregenWallet(
  identifier: PregenIdentifier
): Promise<{ sessionId: string; isExisting: boolean }> {
  const identifierLabel =
    identifier.type === "email"
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

    const evmResult = (await evmResponse.json()) as ParaWalletResponse;
    const evmWallet = evmResult.wallet;
    console.error(`[clara] Created EVM wallet: ${evmWallet.address}`);

    let solanaWallet: ParaWalletInfo | null = null;

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

      const solResult = (await solResponse.json()) as ParaWalletResponse;
      solanaWallet = solResult.wallet;
      console.error(`[clara] Created Solana wallet: ${solanaWallet.address}`);
    } catch (solError) {
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
  } catch (error: unknown) {
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
      } catch (fetchError) {
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
async function fetchWalletsForIdentifier(
  identifier: PregenIdentifier
): Promise<{ evm: ParaWalletInfo | null; solana: ParaWalletInfo | null }> {
  const userIdentifierType = identifier.type === "email" ? "EMAIL" : "CUSTOM_ID";

  try {
    const response = await paraFetch(
      `/v1/wallets?userIdentifier=${encodeURIComponent(identifier.value)}&userIdentifierType=${userIdentifierType}`
    );

    const result = (await response.json()) as ParaWalletListResponse;
    const wallets = result.wallets || [];

    return {
      evm: wallets.find((w) => w.type === "EVM") || null,
      solana: wallets.find((w) => w.type === "SOLANA") || null,
    };
  } catch {
    return { evm: null, solana: null };
  }
}

/**
 * Legacy wrapper for email-based auth (backward compatibility)
 */
export async function startEmailAuth(
  email: string
): Promise<{ sessionId: string }> {
  const result = await createPregenWallet({ type: "email", value: email });
  return { sessionId: result.sessionId };
}

/**
 * Legacy wrapper for OTP verification (backward compatibility)
 * OTP parameter is ignored - REST API wallets don't need verification
 */
export async function verifyEmailOTP(
  sessionId: string,
  _otp: string
): Promise<{ address: string; solanaAddress?: string; isNewWallet: boolean }> {
  return completeWalletSetup(sessionId);
}

/**
 * Complete wallet setup and retrieve wallet info
 */
export async function completeWalletSetup(
  sessionId: string
): Promise<{ address: string; solanaAddress?: string; isNewWallet: boolean }> {
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
 * Repair a session that is missing walletId
 * This can happen if the session was created with an older version
 * or if there was a bug in the setup flow.
 *
 * Returns true if repair was successful, false otherwise.
 */
export async function repairMissingWalletId(): Promise<boolean> {
  const session = await getSession();

  if (!session?.authenticated) {
    console.error("[clara] Cannot repair: not authenticated");
    return false;
  }

  if (session.walletId) {
    console.error("[clara] Session already has walletId, no repair needed");
    return true;
  }

  // Build identifier from session
  const identifier: PregenIdentifier | null = session.identifier
    ? {
        type: session.identifierType === 'email' ? 'email' : 'customId',
        value: session.identifier,
      }
    : session.email
      ? { type: 'email', value: session.email }
      : null;

  if (!identifier) {
    console.error("[clara] Cannot repair: no identifier in session");
    return false;
  }

  console.error(`[clara] Repairing session - fetching walletId for ${identifier.type}: ${identifier.value}`);

  try {
    const wallets = await fetchWalletsForIdentifier(identifier);

    if (wallets.evm) {
      await updateSession({
        walletId: wallets.evm.id,
        solanaWalletId: wallets.solana?.id,
      });
      console.error(`[clara] Repair successful - walletId: ${wallets.evm.id}`);
      return true;
    }

    console.error("[clara] Repair failed: no EVM wallet found for identifier");
    return false;
  } catch (error) {
    console.error("[clara] Repair failed:", error);
    return false;
  }
}

/**
 * Get wallet address for a specific chain
 */
export async function getWalletAddress(chain: SupportedChain): Promise<string> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  if (chain === "solana") {
    if (session.solanaAddress) {
      return session.solanaAddress;
    }
    throw new Error(
      "Solana wallet not configured. EVM address works for EVM chains only."
    );
  }

  return session.address;
}

/**
 * Get token balances for a chain (legacy - native token only)
 */
export async function getBalances(
  chain: SupportedChain,
  _tokenAddress?: string
): Promise<TokenBalance[]> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  console.error(`[clara] Fetching balances for ${chain}`);

  try {
    if (chain === "solana") {
      // Use Helius-powered Solana client for rich data (USD prices, SPL tokens)
      try {
        const portfolio = await getSolanaAssets();
        const balances: TokenBalance[] = [];

        // Add native SOL
        balances.push({
          symbol: "SOL",
          balance: portfolio.nativeBalance.balance,
          usdValue: portfolio.nativeBalance.valueUsd?.toFixed(2),
        });

        // Add SPL tokens
        for (const token of portfolio.tokens) {
          balances.push({
            symbol: token.symbol,
            balance: token.balance,
            usdValue: token.valueUsd?.toFixed(2),
            contractAddress: token.mintAddress,
          });
        }

        return balances;
      } catch (error) {
        console.error("[clara] Solana balance fetch failed:", error);
        return [{ symbol: "SOL", balance: "0.0", usdValue: undefined }];
      }
    }

    // EVM chains: Use Multicall3 to fetch native + all ERC-20 tokens in one call
    const multiBalances = await getAllBalancesMulticall(chain);

    // Convert MultiTokenBalance[] to TokenBalance[]
    return multiBalances.map(b => ({
      symbol: b.symbol,
      balance: b.balance,
      usdValue: b.usdValue?.toString(),
      contractAddress: b.contractAddress,
    }));
  } catch (error) {
    console.error(`[clara] Balance fetch error:`, error);
    return [
      {
        symbol:
          chain === "solana" ? "SOL" : chain === "polygon" ? "MATIC" : "ETH",
        balance: "0.0",
      },
    ];
  }
}

// ============================================================================
// Multicall3 - Efficient Batch Balance Fetching
// ============================================================================

/**
 * Multicall3 contract address (same on all EVM chains)
 * https://www.multicall3.com/
 */
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Multicall3 function selectors
 */
const MULTICALL3_SELECTORS = {
  // aggregate3(Call3[]) - returns Result[]
  aggregate3: "0x82ad56cb",
  // getEthBalance(address) - returns uint256
  getEthBalance: "0x4d2301cc",
};

/**
 * Extended balance result with all tokens
 */
export interface MultiTokenBalance {
  symbol: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
  contractAddress?: string;
  usdValue?: number;
}

/**
 * Fetch ALL token balances for a chain in a single RPC call using Multicall3
 *
 * This is much more efficient than making separate calls for each token:
 * - Before: 1 call per token (5+ RPC calls)
 * - After: 1 RPC call total (via Multicall3 batching)
 */
export async function getAllBalancesMulticall(
  chain: SupportedChain
): Promise<MultiTokenBalance[]> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  if (chain === "solana") {
    // Solana doesn't have Multicall3 - use legacy method
    const balances = await getBalances("solana");
    return balances.map(b => ({
      symbol: b.symbol,
      balance: b.balance,
      balanceRaw: "0",
      decimals: 9,
    }));
  }

  const config = CHAIN_CONFIG[chain];
  const userAddress = session.address.slice(2).toLowerCase().padStart(64, "0");

  console.error(`[clara] Fetching all balances for ${chain} via Multicall3`);

  // Build the list of tokens to check
  const tokensToCheck: Array<{
    symbol: string;
    address: string;
    decimals: number;
  }> = [];

  for (const [symbol, chainData] of Object.entries(POPULAR_TOKENS)) {
    const tokenInfo = chainData[chain];
    if (tokenInfo) {
      tokensToCheck.push({
        symbol,
        address: tokenInfo.address,
        decimals: tokenInfo.decimals,
      });
    }
  }

  // Build Multicall3 calls array
  // Each call: { target, allowFailure, callData }
  // We encode this as: target (address) + allowFailure (bool) + callData (bytes)

  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];

  // First call: get native ETH balance via Multicall3.getEthBalance(address)
  calls.push({
    target: MULTICALL3_ADDRESS,
    allowFailure: true,
    callData: MULTICALL3_SELECTORS.getEthBalance + userAddress,
  });

  // Add balanceOf calls for each token
  for (const token of tokensToCheck) {
    calls.push({
      target: token.address,
      allowFailure: true,
      callData: ERC20_SELECTORS.balanceOf + userAddress,
    });
  }

  // Encode aggregate3 call
  // aggregate3(Call3[] calldata calls)
  // Call3 = (address target, bool allowFailure, bytes callData)
  const encodedCalls = encodeMulticallAggregate3(calls);

  try {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            to: MULTICALL3_ADDRESS,
            data: encodedCalls,
          },
          "latest",
        ],
        id: 1,
      }),
    });

    const rpcResult = (await response.json()) as { result?: string; error?: { message: string } };

    if (rpcResult.error || !rpcResult.result) {
      console.error(`[clara] Multicall3 failed:`, rpcResult.error);
      // Fallback to individual calls
      return await getAllBalancesFallback(chain, tokensToCheck);
    }

    // Decode the results
    const results = decodeMulticallResults(rpcResult.result, calls.length);
    const balances: MultiTokenBalance[] = [];

    // First result is native ETH balance
    const nativeSymbol = chain === "polygon" ? "MATIC" : "ETH";
    if (results[0].success && results[0].data.length >= 66) {
      const balanceRaw = BigInt(results[0].data);
      const balance = Number(balanceRaw) / 1e18;
      if (balance > 0) {
        balances.push({
          symbol: nativeSymbol,
          balance: balance.toFixed(6),
          balanceRaw: balanceRaw.toString(),
          decimals: 18,
        });
      }
    }

    // Rest are token balances
    for (let i = 0; i < tokensToCheck.length; i++) {
      const result = results[i + 1]; // +1 because first is native
      const token = tokensToCheck[i];

      if (result.success && result.data.length >= 66) {
        const balanceRaw = BigInt(result.data);
        const balance = Number(balanceRaw) / Math.pow(10, token.decimals);

        if (balance > 0) {
          balances.push({
            symbol: token.symbol,
            balance: balance.toFixed(token.decimals > 6 ? 6 : token.decimals),
            balanceRaw: balanceRaw.toString(),
            decimals: token.decimals,
            contractAddress: token.address,
          });
        }
      }
    }

    console.error(`[clara] Found ${balances.length} non-zero balances on ${chain}`);
    return balances;
  } catch (error) {
    console.error(`[clara] Multicall3 error:`, error);
    return await getAllBalancesFallback(chain, tokensToCheck);
  }
}

/**
 * Encode aggregate3 call data for Multicall3
 */
function encodeMulticallAggregate3(
  calls: Array<{ target: string; allowFailure: boolean; callData: string }>
): string {
  // aggregate3(Call3[] calldata calls)
  // Call3 = (address target, bool allowFailure, bytes callData)

  // Function selector
  let encoded = MULTICALL3_SELECTORS.aggregate3;

  // Offset to array data (32 bytes)
  encoded += "0000000000000000000000000000000000000000000000000000000000000020";

  // Array length
  encoded += calls.length.toString(16).padStart(64, "0");

  // Calculate offsets for each call's dynamic data
  // Each Call3 has: address (32) + bool (32) + bytes offset (32) = 96 bytes fixed
  // Plus variable bytes data

  let dataOffset = calls.length * 96; // Starting offset for bytes data
  const dynamicParts: string[] = [];

  for (const call of calls) {
    // target address (padded to 32 bytes)
    encoded += call.target.slice(2).toLowerCase().padStart(64, "0");

    // allowFailure bool
    encoded += call.allowFailure ? "0000000000000000000000000000000000000000000000000000000000000001" : "0000000000000000000000000000000000000000000000000000000000000000";

    // Offset to callData
    encoded += dataOffset.toString(16).padStart(64, "0");

    // Calculate this call's data size (32 for length + padded data)
    const callDataNoPrefix = call.callData.startsWith("0x") ? call.callData.slice(2) : call.callData;
    const dataLength = callDataNoPrefix.length / 2;
    const paddedDataLength = Math.ceil(dataLength / 32) * 32;

    // Length of callData
    dynamicParts.push(dataLength.toString(16).padStart(64, "0"));
    // Actual callData (padded to 32 bytes)
    dynamicParts.push(callDataNoPrefix.padEnd(paddedDataLength * 2, "0"));

    dataOffset += 32 + paddedDataLength; // 32 for length + padded data
  }

  // Append all dynamic data
  encoded += dynamicParts.join("");

  return "0x" + encoded.slice(2); // Ensure single 0x prefix
}

/**
 * Decode Multicall3 aggregate3 results
 */
function decodeMulticallResults(
  data: string,
  numCalls: number
): Array<{ success: boolean; data: string }> {
  const results: Array<{ success: boolean; data: string }> = [];

  // Remove 0x prefix
  const hex = data.startsWith("0x") ? data.slice(2) : data;

  // First 32 bytes: offset to array
  // Next 32 bytes: array length
  // Then for each result: success (32 bytes) + offset to returnData (32 bytes)
  // Then the actual return data

  try {
    const arrayOffset = parseInt(hex.slice(0, 64), 16) * 2;
    const arrayLength = parseInt(hex.slice(arrayOffset, arrayOffset + 64), 16);

    // Parse each result
    let pos = arrayOffset + 64;
    const resultOffsets: number[] = [];

    for (let i = 0; i < arrayLength; i++) {
      const resultOffset = parseInt(hex.slice(pos, pos + 64), 16) * 2;
      resultOffsets.push(arrayOffset + 64 + resultOffset);
      pos += 64;
    }

    for (const offset of resultOffsets) {
      const success = parseInt(hex.slice(offset, offset + 64), 16) === 1;
      const dataOffset = parseInt(hex.slice(offset + 64, offset + 128), 16) * 2;
      const dataLength = parseInt(hex.slice(offset + 64 + dataOffset, offset + 64 + dataOffset + 64), 16);
      const returnData = "0x" + hex.slice(offset + 64 + dataOffset + 64, offset + 64 + dataOffset + 64 + dataLength * 2);

      results.push({ success, data: returnData });
    }
  } catch (error) {
    console.error("[clara] Error decoding multicall results:", error);
    // Return empty results on decode error
    for (let i = 0; i < numCalls; i++) {
      results.push({ success: false, data: "0x" });
    }
  }

  return results;
}

/**
 * Fallback: fetch balances one by one (slower but more reliable)
 */
async function getAllBalancesFallback(
  chain: SupportedChain,
  tokens: Array<{ symbol: string; address: string; decimals: number }>
): Promise<MultiTokenBalance[]> {
  console.error(`[clara] Using fallback balance fetch for ${chain}`);

  const balances: MultiTokenBalance[] = [];

  // Get native balance
  const nativeResult = await getNativeBalance(chain);
  if (parseFloat(nativeResult.balance) > 0) {
    balances.push({
      symbol: nativeResult.symbol,
      balance: nativeResult.balance,
      balanceRaw: nativeResult.balanceRaw.toString(),
      decimals: 18,
    });
  }

  // Get each token balance
  for (const token of tokens) {
    try {
      const result = await getTokenBalance(token.address, chain);
      if (parseFloat(result.balance) > 0) {
        balances.push({
          symbol: token.symbol,
          balance: result.balance,
          balanceRaw: result.balanceRaw,
          decimals: token.decimals,
          contractAddress: token.address,
        });
      }
    } catch {
      // Skip tokens that fail
    }
  }

  return balances;
}

/**
 * Get complete portfolio - uses Zerion API when available (1 call vs 5+)
 * Falls back to Multicall3 per-chain if Zerion unavailable
 */
export async function getPortfolioFast(): Promise<Portfolio> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Try Zerion first - ONE API call for all EVM chains!
  if (isZerionAvailable()) {
    try {
      console.error("[clara] Building portfolio via Zerion (1 call)...");
      const zerionPortfolio = await getPortfolioZerion(session.address);

      // Convert Zerion format to our Portfolio format
      const items: PortfolioItem[] = zerionPortfolio.positions
        .filter(pos => pos.positionType === "wallet") // Only wallet balances, not staked
        .map(pos => ({
          chain: pos.chain as SupportedChain,
          symbol: pos.symbol,
          balance: pos.balance,
          priceUsd: pos.priceUsd,
          valueUsd: pos.valueUsd,
          change24h: pos.changePercent24h,
        }));

      return {
        items,
        totalValueUsd: zerionPortfolio.totalValueUsd,
        totalChange24h: zerionPortfolio.totalChangePercent24h,
        lastUpdated: zerionPortfolio.lastUpdated,
      };
    } catch (error) {
      console.error("[clara] Zerion failed, falling back to Multicall:", error);
      // Fall through to Multicall fallback
    }
  }

  // Fallback: Multicall3 per chain (5 RPC calls)
  console.error("[clara] Building portfolio via Multicall3 (5 calls)...");

  // Fetch prices
  const prices = await fetchPrices();
  const ethPrice = prices["ethereum"]?.usd || 0;
  const maticPrice = prices["matic-network"]?.usd || 0;

  // Get balances for all chains in parallel using Multicall3
  const evmChains: SupportedChain[] = ["base", "arbitrum", "optimism", "ethereum", "polygon"];

  const chainBalances = await Promise.all(
    evmChains.map(async (chain) => {
      try {
        return { chain, balances: await getAllBalancesMulticall(chain) };
      } catch {
        return { chain, balances: [] };
      }
    })
  );

  // Build portfolio items
  const items: PortfolioItem[] = [];
  let totalValueUsd = 0;

  for (const { chain, balances } of chainBalances) {
    for (const bal of balances) {
      const balanceNum = parseFloat(bal.balance);

      // Calculate USD value
      let priceUsd: number | null = null;
      if (bal.symbol === "ETH" || bal.symbol === "WETH") {
        priceUsd = ethPrice;
      } else if (bal.symbol === "MATIC") {
        priceUsd = maticPrice;
      } else if (STABLE_TOKENS.has(bal.symbol)) {
        priceUsd = 1.0;
      }

      const valueUsd = priceUsd ? balanceNum * priceUsd : null;
      if (valueUsd) totalValueUsd += valueUsd;

      items.push({
        chain,
        symbol: bal.symbol,
        balance: bal.balance,
        priceUsd,
        valueUsd,
        change24h: bal.symbol === "ETH" ? prices["ethereum"]?.usd_24h_change || null : null,
      });
    }
  }

  return {
    items,
    totalValueUsd,
    totalChange24h: prices["ethereum"]?.usd_24h_change || null,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Sign an arbitrary message using Para REST API
 * Uses the /sign-raw endpoint which accepts 0x-prefixed hex data
 */
export async function signMessage(
  message: string,
  chain: SupportedChain = "ethereum"
): Promise<string> {
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

    const result = (await response.json()) as { signature: string };
    return result.signature;
  } catch (error) {
    console.error("[clara] Sign message error:", error);
    throw error;
  }
}

/**
 * Solana transaction request structure
 */
export interface SolanaTransactionRequest {
  to: string;
  amount: string;
  memo?: string;
  serializedTx?: string;
}

/**
 * Sign a transaction using Para REST API
 */
export async function signTransaction(
  tx: TransactionRequest | SolanaTransactionRequest,
  chain: SupportedChain
): Promise<SignedTransaction> {
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

      const solTx = tx as SolanaTransactionRequest;

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

        const result = (await response.json()) as { signature: string };
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

    // EVM transaction signing with proper EIP-1559 encoding
    const evmWalletId = session.walletId;
    if (!evmWalletId) {
      throw new Error("No EVM wallet found");
    }

    const evmTx = tx as TransactionRequest;
    const config = CHAIN_CONFIG[chain];

    if (!config.chainId) {
      throw new Error(`Chain ${chain} does not have a chainId configured`);
    }

    // Get wallet address for nonce lookup
    const address = session.address;
    if (!address) {
      throw new Error("No wallet address found in session");
    }

    // Get current nonce, gas prices, and estimate gas
    const [nonce, gasPrices, gasEstimate] = await Promise.all([
      fetchNonce(address, chain),
      fetchGasPrices(chain),
      fetchGasLimit({ to: evmTx.to, from: address, value: evmTx.value, data: evmTx.data }, chain),
    ]);

    // Build the transaction object
    const txParams = {
      chainId: config.chainId,
      nonce,
      maxPriorityFeePerGas: evmTx.maxPriorityFeePerGas
        ? BigInt(evmTx.maxPriorityFeePerGas)
        : gasPrices.maxPriorityFeePerGas,
      maxFeePerGas: evmTx.maxFeePerGas
        ? BigInt(evmTx.maxFeePerGas)
        : gasPrices.maxFeePerGas,
      gasLimit: evmTx.gasLimit
        ? BigInt(evmTx.gasLimit)
        : gasEstimate,
      to: evmTx.to,
      value: evmTx.value ? BigInt(evmTx.value) : 0n,
      data: evmTx.data || "0x",
    };

    // Step 1: Encode unsigned transaction and hash it
    const unsignedTxBytes = encodeUnsignedEIP1559Tx(txParams);
    const txHash = keccak_256(unsignedTxBytes);
    const txHashHex = "0x" + Array.from(txHash).map(b => b.toString(16).padStart(2, "0")).join("");

    // Step 2: Sign the hash with Para
    const response = await paraFetch(`/v1/wallets/${evmWalletId}/sign-raw`, {
      method: "POST",
      body: JSON.stringify({
        data: txHashHex,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Para sign-raw failed: ${response.status} - ${responseText}`);
    }

    const result = JSON.parse(responseText) as { signature: string };

    // Step 3: Parse signature into r, s, v
    const { r, s, v } = parseSignature(result.signature);

    // Step 4: Encode the signed transaction
    const signedTxBytes = encodeSignedEIP1559Tx({
      ...txParams,
      v,
      r,
      s,
    });

    const signedTxHex = bytesToHex(signedTxBytes);

    return {
      signedTx: signedTxHex,
    };
  } catch (error) {
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
export async function sendTransaction(
  to: string,
  amount: string,
  chain: SupportedChain,
  _tokenAddress?: string,
  data?: string  // ERC-20 transfer calldata
): Promise<{
  txHash: string;
  signature?: string;
  requiresManualBroadcast?: boolean;
}> {
  const session = await getSession();
  if (!session?.authenticated) {
    throw new Error("Not authenticated");
  }

  const isTokenTransfer = data && data.startsWith("0xa9059cbb");
  console.error(`[clara] Sending ${isTokenTransfer ? "token transfer" : amount} to ${to} on ${chain}`);

  const config = CHAIN_CONFIG[chain];

  try {
    if (chain === "solana") {
      const signed = await signTransaction(
        { to, amount } as SolanaTransactionRequest,
        chain
      );

      return {
        txHash: "",
        signature: signed.signedTx,
        requiresManualBroadcast: true,
      };
    }

    // EVM send
    const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18));

    const signed = await signTransaction(
      {
        to,
        value: amountWei.toString(),
        data: data || "0x",  // Include ERC-20 calldata if provided
        chainId: config.chainId,
      },
      chain
    );

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

    const rpcResult = (await response.json()) as {
      result?: string;
      error?: { message: string; code?: number };
    };

    if (rpcResult.error) {
      throw new Error(`RPC error ${rpcResult.error.code || ''}: ${rpcResult.error.message}`);
    }

    return { txHash: rpcResult.result || signed.txHash || "" };
  } catch (error) {
    console.error("[clara] Send error:", error);
    throw error;
  }
}

/**
 * Transaction receipt from eth_getTransactionReceipt
 */
export interface TransactionReceipt {
  status: "success" | "reverted" | "pending";
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

/**
 * Wait for a transaction to be confirmed
 *
 * @param txHash - Transaction hash to wait for
 * @param chain - Chain the transaction was sent on
 * @param options - Polling options
 * @returns Transaction receipt
 */
export async function waitForTransaction(
  txHash: string,
  chain: SupportedChain,
  options: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    confirmations?: number;
  } = {}
): Promise<TransactionReceipt> {
  if (chain === "solana") {
    // Solana not supported for now
    return { status: "success" };
  }

  const pollInterval = options.pollIntervalMs || 3000; // 3 seconds
  const timeout = options.timeoutMs || 2 * 60 * 1000; // 2 minutes
  const startTime = Date.now();
  const config = CHAIN_CONFIG[chain];

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [txHash],
          id: 1,
        }),
      });

      const result = await response.json() as {
        result?: {
          status: string;
          blockNumber: string;
          gasUsed: string;
          effectiveGasPrice: string;
        };
        error?: { message: string };
      };

      if (result.result) {
        // Transaction mined
        const receipt = result.result;
        return {
          status: receipt.status === "0x1" ? "success" : "reverted",
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.effectiveGasPrice,
        };
      }

      // Not yet mined, continue polling
    } catch (error) {
      console.error("[clara] Receipt poll error:", error);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { status: "pending" };
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas(
  tx: TransactionRequest,
  chain: SupportedChain
): Promise<{ gasLimit: string; maxFee: string; estimatedCostUsd: string }> {
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

    const data = (await response.json()) as { result?: string };
    const gasLimit = BigInt(data.result || "21000");

    const gasCostEth = (Number(gasLimit) * 30) / 1e9;
    const estimatedCostUsd = (gasCostEth * 2500).toFixed(2);

    return {
      gasLimit: gasLimit.toString(),
      maxFee: gasCostEth.toFixed(6),
      estimatedCostUsd,
    };
  } catch {
    return { gasLimit: "21000", maxFee: "0.001", estimatedCostUsd: "2.50" };
  }
}

/**
 * Get human-readable description of a transaction
 */
export async function decodeTransaction(
  tx: TransactionRequest,
  _chain: SupportedChain
): Promise<{ action: string; details: string[] }> {
  if (!tx.data || tx.data === "0x") {
    return {
      action: "Native Transfer",
      details: [`Send ${tx.value || "0"} to ${tx.to}`],
    };
  }

  const selector = tx.data.slice(0, 10);

  const SELECTORS: Record<string, { action: string }> = {
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
const COINGECKO_IDS: Record<string, string> = {
  ethereum: "ethereum",
  base: "ethereum", // Base uses ETH
  arbitrum: "ethereum", // Arbitrum uses ETH
  optimism: "ethereum", // Optimism uses ETH
  polygon: "matic-network",
  solana: "solana",
};

/**
 * Portfolio item representing a single asset
 */
export interface PortfolioItem {
  chain: SupportedChain;
  symbol: string;
  balance: string;
  priceUsd: number | null;
  valueUsd: number | null;
  change24h: number | null;
}

/**
 * Full portfolio summary
 */
export interface Portfolio {
  items: PortfolioItem[];
  totalValueUsd: number;
  totalChange24h: number | null;
  lastUpdated: string;
}

/**
 * Fetch current prices from CoinGecko
 * Returns prices in USD for supported tokens
 */
export async function fetchPrices(): Promise<Record<string, { usd: number; usd_24h_change: number }>> {
  const ids = [...new Set(Object.values(COINGECKO_IDS))].join(",");

  try {
    console.error("[clara] Fetching prices from CoinGecko...");
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      {
        headers: {
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`[clara] CoinGecko error: ${response.status}`);
      return {};
    }

    const data = await response.json() as Record<string, { usd: number; usd_24h_change: number }>;
    console.error("[clara] Prices fetched:", Object.keys(data).join(", "));
    return data;
  } catch (error) {
    console.error("[clara] Price fetch error:", error);
    return {};
  }
}

/**
 * Token price mapping for yield position valuation
 * Stablecoins are assumed to be $1 (more reliable than API for DeFi calculations)
 * Non-stables fetch from CoinGecko
 */
const STABLE_TOKENS = new Set(["USDC", "USDT", "DAI", "USDbC", "USDC.e", "FRAX", "LUSD", "sUSD"]);

// CoinGecko token IDs for non-stablecoin yield assets
const TOKEN_COINGECKO_IDS: Record<string, string> = {
  WETH: "ethereum",
  ETH: "ethereum",
  WBTC: "wrapped-bitcoin",
  wstETH: "wrapped-steth",
  cbETH: "coinbase-wrapped-staked-eth",
  rETH: "rocket-pool-eth",
};

/**
 * Get USD price for a token
 * Stablecoins return 1.0, others fetch from CoinGecko
 */
export async function getTokenPriceUsd(symbol: string): Promise<number | null> {
  // Stablecoins are ~$1
  if (STABLE_TOKENS.has(symbol)) {
    return 1.0;
  }

  // Check if we have a CoinGecko ID for this token
  const geckoId = TOKEN_COINGECKO_IDS[symbol];
  if (!geckoId) {
    console.error(`[clara] No price source for ${symbol}`);
    return null;
  }

  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${geckoId}&vs_currencies=usd`,
      { headers: { "Accept": "application/json" } }
    );

    if (!response.ok) {
      console.error(`[clara] Price fetch error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, { usd: number }>;
    return data[geckoId]?.usd ?? null;
  } catch (error) {
    console.error(`[clara] Price fetch error for ${symbol}:`, error);
    return null;
  }
}

/**
 * Batch fetch prices for multiple tokens (efficient for portfolio)
 */
export async function getTokenPricesUsd(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  // Handle stablecoins first (no API call needed)
  for (const symbol of symbols) {
    if (STABLE_TOKENS.has(symbol)) {
      prices[symbol] = 1.0;
    }
  }

  // Collect non-stables that need API fetch
  const nonStables = symbols.filter(s => !STABLE_TOKENS.has(s));
  const geckoIds = nonStables
    .map(s => TOKEN_COINGECKO_IDS[s])
    .filter(Boolean);

  if (geckoIds.length === 0) {
    return prices;
  }

  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${[...new Set(geckoIds)].join(",")}&vs_currencies=usd`,
      { headers: { "Accept": "application/json" } }
    );

    if (response.ok) {
      const data = await response.json() as Record<string, { usd: number }>;
      for (const symbol of nonStables) {
        const geckoId = TOKEN_COINGECKO_IDS[symbol];
        if (geckoId && data[geckoId]) {
          prices[symbol] = data[geckoId].usd;
        }
      }
    }
  } catch (error) {
    console.error("[clara] Batch price fetch error:", error);
  }

  return prices;
}

/**
 * Get portfolio across all chains
 * Fetches balances and current prices, calculates USD values
 */
export async function getPortfolio(): Promise<Portfolio> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  console.error("[clara] Building portfolio...");

  // Fetch prices first
  const prices = await fetchPrices();

  // Get balances for all chains in parallel
  const evmChains: SupportedChain[] = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
  const allChains: SupportedChain[] = session.solanaAddress
    ? [...evmChains, "solana"]
    : evmChains;

  const balancePromises = allChains.map(async (chain): Promise<PortfolioItem> => {
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
    } catch (error) {
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
  let totalChange24h: number | null = null;
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
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 0.01 && value > 0) return "<$0.01";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format percentage change for display
 */
export function formatChange(change: number | null | undefined): string {
  if (change === null || change === undefined) return "—";
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

// Extended function signature database for transaction decoding
const FUNCTION_SIGNATURES: Record<string, { name: string; description: string; risk?: string }> = {
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
const KNOWN_CONTRACTS: Record<string, { name: string; type: string }> = {
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
export const POPULAR_TOKENS: Record<string, Record<SupportedChain, { address: string; decimals: number } | null>> = {
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
  balanceOf: "0x70a08231",    // balanceOf(address)
  transfer: "0xa9059cbb",     // transfer(address,uint256)
  approve: "0x095ea7b3",      // approve(address,uint256)
  allowance: "0xdd62ed3e",    // allowance(address,address)
  symbol: "0x95d89b41",       // symbol()
  decimals: "0x313ce567",     // decimals()
  name: "0x06fdde03",         // name()
};

/**
 * Token metadata
 */
export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

/**
 * Fetch ERC-20 token metadata from the blockchain
 * Falls back to POPULAR_TOKENS database if RPC calls fail
 */
export async function getTokenMetadata(
  tokenAddress: string,
  chain: SupportedChain
): Promise<TokenMetadata> {
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
      symbolResult.json() as Promise<{ result?: string }>,
      decimalsResult.json() as Promise<{ result?: string }>,
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
        } else if (hex.length === 64) {
          // Fixed bytes32
          symbol = Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "");
        }
      } catch {
        symbol = "UNKNOWN";
      }
    }

    // Decode decimals (uint8)
    let decimals = 18;
    if (decimalsData.result && decimalsData.result !== "0x") {
      decimals = parseInt(decimalsData.result, 16);
    }

    return { address: tokenAddress, symbol, decimals };
  } catch (error) {
    console.error(`[clara] Failed to fetch token metadata:`, error);
    // Return default if fetch fails
    return { address: tokenAddress, symbol: "TOKEN", decimals: 18 };
  }
}

/**
 * Get ERC-20 token balance for an address
 */
export async function getTokenBalance(
  tokenAddress: string,
  chain: SupportedChain,
  ownerAddress?: string
): Promise<{ balance: string; balanceRaw: string; symbol: string; decimals: number }> {
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

    const data = (await response.json()) as { result?: string };
    const balanceRaw = data.result ? BigInt(data.result).toString() : "0";
    const balanceNum = Number(BigInt(balanceRaw)) / Math.pow(10, metadata.decimals);

    return {
      balance: balanceNum.toFixed(metadata.decimals > 6 ? 6 : metadata.decimals),
      balanceRaw,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
    };
  } catch (error) {
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
export function encodeERC20Transfer(to: string, amount: string, decimals: number): string {
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
export function resolveToken(
  tokenInput: string,
  chain: SupportedChain
): { address: string; symbol: string; decimals: number } | null {
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
 * Simulation result
 */
export interface SimulationResult {
  success: boolean;
  error?: string;
  gasEstimate: string;
  gasUsd: string;
  action: string;
  description: string;
  warnings: string[];
  details: {
    from: string;
    to: string;
    value: string;
    valueUsd: string;
    function?: string;
    contract?: string;
  };
}

/**
 * Simulate a transaction without executing it
 * Uses eth_call to check if it would succeed and estimates gas
 */
export async function simulateTransaction(
  tx: TransactionRequest,
  chain: SupportedChain
): Promise<SimulationResult> {
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
  const warnings: string[] = [];

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
  } else if (sigInfo) {
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
      } else if (amount > BigInt("1000000000000000000000000")) {
        warnings.push("⚠️ Large approval amount");
      }
    } catch {
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
  let error: string | undefined;

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

    const result = (await callResult.json()) as { result?: string; error?: { message: string } };

    if (result.error) {
      success = false;
      error = result.error.message;
      if (error.includes("execution reverted")) {
        warnings.push("🚨 Transaction would REVERT");
      }
    }
  } catch (e) {
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

// ============================================================================
// Transaction History
// ============================================================================

/**
 * Transaction history item
 */
export interface TransactionHistoryItem {
  hash: string;
  chain?: string;
  from: string;
  to: string;
  value?: string;
  valueEth: number;
  timestamp: number;
  date: string;
  action: string;
  actionType?: string; // 'trade' | 'send' | 'receive' | 'approve' | etc.
  status: "success" | "failed" | "pending";
  gasUsed?: string;
  gasPrice?: string;
  gasUsedEth?: number;
  gasUsedUsd?: number;
  functionName?: string;
  tokenSymbol?: string;
  tokenAmount?: string;
  isIncoming?: boolean;
  explorerUrl: string;
  dappName?: string;
  // Rich transfer data from Zerion
  transfers?: Array<{
    direction: "in" | "out" | "self";
    symbol: string;
    name: string;
    amount: number;
    usdValue: number | null;
    isNft: boolean;
  }>;
  // Token approvals
  approvals?: Array<{
    symbol: string;
    spender: string;
    amount: number | "unlimited";
  }>;
}

/**
 * Transaction history response
 */
export interface TransactionHistory {
  transactions: TransactionHistoryItem[];
  address: string;
  chain: SupportedChain;
  hasMore: boolean;
}

/**
 * Fetch transaction history
 *
 * Uses Zerion API if ZERION_API_KEY is set (richer data, more reliable)
 * Falls back to block explorer APIs otherwise (basic but works without key)
 */
export async function getTransactionHistory(
  chain: SupportedChain,
  options: {
    limit?: number;
    includeTokenTransfers?: boolean;
  } = {}
): Promise<TransactionHistory> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  const { limit = 10, includeTokenTransfers = true } = options;
  const address = session.address.toLowerCase();

  if (chain === "solana") {
    return {
      transactions: [],
      address: session.solanaAddress || address,
      chain,
      hasMore: false,
    };
  }

  // Try Zerion first if API key is configured
  if (isZerionAvailable()) {
    try {
      const zerionResult = await getTransactionHistoryZerion(address, chain, { limit });

      const transactions: TransactionHistoryItem[] = zerionResult.transactions.map((tx) => {
        const hasIncoming = tx.transfers.some((t) => t.direction === "in");
        const hasOutgoing = tx.transfers.some((t) => t.direction === "out");
        const isIncoming = hasIncoming && !hasOutgoing;

        const mainTransfer = tx.transfers[0];
        let tokenSymbol: string | undefined;
        let tokenAmount: string | undefined;

        if (mainTransfer && mainTransfer.symbol !== "ETH") {
          tokenSymbol = mainTransfer.symbol;
          tokenAmount = mainTransfer.amount.toFixed(6);
        }

        return {
          hash: tx.hash,
          chain: tx.chain,
          from: tx.from,
          to: tx.to,
          valueEth: tx.valueEth,
          timestamp: tx.timestamp,
          date: tx.date,
          action: tx.action,
          actionType: tx.actionType,
          status: tx.status,
          gasUsedEth: tx.gasUsedEth,
          gasUsedUsd: tx.gasUsedUsd,
          tokenSymbol,
          tokenAmount,
          isIncoming,
          explorerUrl: tx.explorerUrl,
          dappName: tx.dappName,
          transfers: tx.transfers,
          approvals: tx.approvals,
        };
      });

      return { transactions, address, chain, hasMore: zerionResult.hasMore };
    } catch (error) {
      console.error(`[clara] Zerion API failed, falling back to block explorer:`, error);
    }
  }

  // Fallback: Block explorer APIs
  // NOTE: Etherscan V1 API is deprecated - V2 requires API key
  // For now, return empty with a helpful message
  const explorer = EXPLORER_CONFIG[chain];
  if (!explorer) {
    throw new Error(`Explorer not configured for ${chain}`);
  }

  console.error(`[clara] Fetching history via block explorer for ${address} on ${chain}`);
  console.error(`[clara] Note: Block explorer APIs now require API keys. Set ZERION_API_KEY for best results.`);
  const transactions: TransactionHistoryItem[] = [];

  try {
    // Fetch normal transactions
    const txListUrl = `${explorer.apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc`;
    const txResponse = await fetch(txListUrl);
    const txData = (await txResponse.json()) as {
      status: string;
      result: Array<{
        hash: string;
        from: string;
        to: string;
        value: string;
        timeStamp: string;
        isError: string;
        gasUsed: string;
        gasPrice: string;
        functionName?: string;
        input: string;
      }>;
    };

    if (txData.status === "1" && Array.isArray(txData.result)) {
      for (const tx of txData.result) {
        const valueWei = BigInt(tx.value || "0");
        const valueEth = Number(valueWei) / 1e18;
        const isIncoming = tx.to.toLowerCase() === address;
        const timestamp = parseInt(tx.timeStamp) * 1000;

        let action = "Contract Call";
        const selector = tx.input?.slice(0, 10) || "0x";

        if (!tx.input || tx.input === "0x") {
          action = isIncoming ? "Receive ETH" : "Send ETH";
        } else if (FUNCTION_SIGNATURES[selector]) {
          action = FUNCTION_SIGNATURES[selector].name;
        } else if (tx.functionName) {
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

    // Fetch ERC-20 token transfers
    if (includeTokenTransfers) {
      const tokenTxUrl = `${explorer.apiUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc`;
      const tokenResponse = await fetch(tokenTxUrl);
      const tokenData = (await tokenResponse.json()) as {
        status: string;
        result: Array<{
          hash: string;
          from: string;
          to: string;
          value: string;
          timeStamp: string;
          tokenSymbol: string;
          tokenDecimal: string;
        }>;
      };

      if (tokenData.status === "1" && Array.isArray(tokenData.result)) {
        for (const tx of tokenData.result) {
          if (transactions.some((t) => t.hash === tx.hash)) continue;

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

    transactions.sort((a, b) => b.timestamp - a.timestamp);
    return {
      transactions: transactions.slice(0, limit),
      address,
      chain,
      hasMore: transactions.length > limit,
    };
  } catch (error) {
    console.error(`[clara] Failed to fetch history:`, error);
    return { transactions: [], address, chain, hasMore: false };
  }
}

/**
 * Format a transaction for display
 */
export function formatTransaction(tx: TransactionHistoryItem): string {
  // Status icon
  const statusIcon = tx.status === "failed" ? "❌" : tx.status === "pending" ? "⏳" : "✓";

  // Direction icon based on action type or isIncoming
  let dirIcon = "📤";
  if (tx.actionType === "receive" || tx.isIncoming) {
    dirIcon = "📥";
  } else if (tx.actionType === "trade") {
    dirIcon = "🔄";
  } else if (tx.actionType === "approve") {
    dirIcon = "✅";
  }

  // Build amount string
  let amount = "";
  if (tx.transfers && tx.transfers.length > 0) {
    if (tx.actionType === "trade" && tx.transfers.length >= 2) {
      // Swap: show both tokens
      const outTx = tx.transfers.find((t) => t.direction === "out");
      const inTx = tx.transfers.find((t) => t.direction === "in");
      if (outTx && inTx) {
        amount = `${outTx.amount.toFixed(4)} ${outTx.symbol} → ${inTx.amount.toFixed(4)} ${inTx.symbol}`;
      }
    } else {
      // Single transfer
      const mainTransfer = tx.transfers[0];
      amount = `${mainTransfer.amount.toFixed(4)} ${mainTransfer.symbol}`;
      if (mainTransfer.usdValue && mainTransfer.usdValue > 0.01) {
        amount += ` ($${mainTransfer.usdValue.toFixed(2)})`;
      }
    }
  } else if (tx.tokenAmount) {
    amount = `${tx.tokenAmount} ${tx.tokenSymbol}`;
  } else if (tx.valueEth > 0) {
    amount = `${tx.valueEth.toFixed(4)} ETH`;
  }

  // Counterparty
  const counterparty = tx.isIncoming
    ? `from ${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`
    : `to ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`;

  // Dapp name if available
  const via = tx.dappName ? ` via ${tx.dappName}` : "";

  return `${statusIcon} ${dirIcon} ${tx.action}${amount ? ` (${amount})` : ""} ${counterparty}${via} • ${tx.date}`;
}

// ============================================================================
// Token Approval Management
// ============================================================================

/**
 * Token approval information
 */
export interface TokenApproval {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  spenderAddress: string;
  spenderName?: string;
  allowance: string;
  allowanceRaw: string;
  isUnlimited: boolean;
  lastUpdated?: string;
  txHash?: string;
}

/**
 * Approval history response
 */
export interface ApprovalHistory {
  approvals: TokenApproval[];
  address: string;
  chain: SupportedChain;
}

// Max uint256 value (unlimited approval)
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
// Threshold to consider "unlimited" (99% of max uint256)
const UNLIMITED_THRESHOLD = MAX_UINT256 * BigInt(99) / BigInt(100);

/**
 * Check current allowance for a specific token and spender
 */
export async function getAllowance(
  tokenAddress: string,
  spenderAddress: string,
  chain: SupportedChain,
  ownerAddress?: string
): Promise<TokenApproval> {
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

    const data = (await response.json()) as { result?: string };
    const allowanceRaw = data.result ? BigInt(data.result) : BigInt(0);
    const isUnlimited = allowanceRaw >= UNLIMITED_THRESHOLD;

    // Format allowance
    let allowance: string;
    if (isUnlimited) {
      allowance = "Unlimited";
    } else {
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
  } catch (error) {
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
export async function getApprovalHistory(
  chain: SupportedChain,
  options: { limit?: number } = {}
): Promise<ApprovalHistory> {
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
    const data = (await response.json()) as {
      status: string;
      result: Array<{
        hash: string;
        from: string;
        to: string;
        contractAddress: string;
        tokenSymbol: string;
        tokenDecimal: string;
        timeStamp: string;
      }>;
    };

    // Track unique token+spender pairs we need to check
    const spenderMap = new Map<string, Set<string>>();

    if (data.status === "1" && Array.isArray(data.result)) {
      for (const tx of data.result) {
        // If we sent tokens, the recipient might be a contract that has approval
        if (tx.from.toLowerCase() === address && tx.to.toLowerCase() !== address) {
          const tokenAddr = tx.contractAddress.toLowerCase();
          if (!spenderMap.has(tokenAddr)) {
            spenderMap.set(tokenAddr, new Set());
          }
          spenderMap.get(tokenAddr)!.add(tx.to.toLowerCase());
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
    const approvals: TokenApproval[] = [];

    for (const [tokenAddr, spenders] of spenderMap.entries()) {
      for (const spenderAddr of spenders) {
        try {
          const approval = await getAllowance(tokenAddr, spenderAddr, chain, address);
          // Only include non-zero approvals
          if (approval.allowanceRaw !== "0") {
            approvals.push(approval);
          }
        } catch {
          // Skip tokens that fail
          continue;
        }
      }
    }

    // Sort by unlimited first, then by token symbol
    approvals.sort((a, b) => {
      if (a.isUnlimited && !b.isUnlimited) return -1;
      if (!a.isUnlimited && b.isUnlimited) return 1;
      return a.tokenSymbol.localeCompare(b.tokenSymbol);
    });

    return { approvals, address, chain };
  } catch (error) {
    console.error(`[clara] Failed to fetch approval history:`, error);
    return { approvals: [], address, chain };
  }
}

/**
 * Encode ERC-20 approve calldata
 * approve(address spender, uint256 amount)
 * Use amount = "0" to revoke approval
 */
export function encodeApproveCalldata(spenderAddress: string, amount: string, decimals: number): string {
  const paddedSpender = spenderAddress.slice(2).toLowerCase().padStart(64, "0");

  let paddedAmount: string;
  if (amount === "0") {
    paddedAmount = "0".padStart(64, "0");
  } else if (amount === "unlimited" || amount === "max") {
    paddedAmount = MAX_UINT256.toString(16).padStart(64, "0");
  } else {
    const amountFloat = parseFloat(amount);
    const amountRaw = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
    paddedAmount = amountRaw.toString(16).padStart(64, "0");
  }

  return ERC20_SELECTORS.approve + paddedSpender + paddedAmount;
}

/**
 * Format an approval for display
 */
export function formatApproval(approval: TokenApproval): string {
  const riskIcon = approval.isUnlimited ? "⚠️" : "✓";
  const spenderDisplay = approval.spenderName
    ? approval.spenderName
    : `${approval.spenderAddress.slice(0, 6)}...${approval.spenderAddress.slice(-4)}`;

  return `${riskIcon} ${approval.tokenSymbol} → ${spenderDisplay}: ${approval.allowance}`;
}

// ============================================================================
// Token Swaps (Meta-Aggregation: Li.Fi + 0x)
// ============================================================================

// Li.Fi API - aggregates across multiple DEXs, no API key required
const LIFI_API = "https://li.quest/v1";

// 0x Swap API v2 - professional market makers + DEX aggregation
// API key optional but recommended for higher rate limits
const ZEROX_API = "https://api.0x.org/swap/allowance-holder";
const ZEROX_API_KEY = process.env.ZEROX_API_KEY || "";

// Map our chain names to chain IDs (shared by both aggregators)
const CHAIN_IDS: Record<SupportedChain, number | null> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  solana: null, // Neither aggregator supports Solana swaps
};

// Alias for backward compatibility
const LIFI_CHAIN_IDS = CHAIN_IDS;

// Native token address placeholder (used by Li.Fi for ETH/MATIC/etc)
const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// 0x uses different native token representation
const ZEROX_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * Swap quote from aggregator (Li.Fi or 0x)
 */
export interface SwapQuote {
  id: string;
  source: "lifi" | "0x";  // Which aggregator provided this quote
  fromToken: {
    address: string;
    symbol: string;
    decimals: number;
    priceUsd: string;
  };
  toToken: {
    address: string;
    symbol: string;
    decimals: number;
    priceUsd: string;
  };
  fromAmount: string;
  fromAmountUsd: string;
  toAmount: string;
  toAmountUsd: string;
  toAmountMin: string;
  exchangeRate: string;
  priceImpact: string;
  estimatedGas: string;
  estimatedGasUsd: string;
  approvalAddress?: string;
  needsApproval: boolean;
  currentAllowance?: string;
  transactionRequest?: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  };
  tool: string;
  toolDetails?: string;
}

/**
 * Options for swap quote request
 */
export interface SwapQuoteOptions {
  /** Max slippage percentage (default 0.5%) */
  slippage?: number;
  /** Preferred DEX to route through (for Boost rewards) */
  preferredDex?: string;
  /** DEXes to exclude from routing */
  denyDexes?: string[];
}

/**
 * Get a swap quote from Li.Fi
 * Finds the best route across multiple DEXs
 *
 * @param fromToken - Token to sell (symbol or address)
 * @param toToken - Token to buy (symbol or address)
 * @param amount - Amount to swap (human-readable)
 * @param chain - Blockchain to swap on
 * @param options - Optional: slippage, preferredDex for Boost routing
 */
export async function getSwapQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  chain: SupportedChain,
  options: SwapQuoteOptions | number = {}
): Promise<SwapQuote> {
  // Handle legacy signature where 5th param was slippage number
  const opts: SwapQuoteOptions = typeof options === "number"
    ? { slippage: options }
    : options;
  const slippage = opts.slippage ?? 0.5;
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  const chainId = LIFI_CHAIN_IDS[chain];
  if (!chainId) {
    throw new Error(`Swaps not supported on ${chain}`);
  }

  // Resolve token addresses
  let fromAddress: string;
  let toAddress: string;

  // Handle native token (ETH, MATIC, etc.)
  const nativeSymbols = ["ETH", "MATIC", "NATIVE"];

  if (nativeSymbols.includes(fromToken.toUpperCase())) {
    fromAddress = NATIVE_TOKEN_ADDRESS;
  } else if (fromToken.startsWith("0x")) {
    fromAddress = fromToken;
  } else {
    const resolved = resolveToken(fromToken, chain);
    if (!resolved) {
      throw new Error(`Unknown token: ${fromToken} on ${chain}`);
    }
    fromAddress = resolved.address;
  }

  if (nativeSymbols.includes(toToken.toUpperCase())) {
    toAddress = NATIVE_TOKEN_ADDRESS;
  } else if (toToken.startsWith("0x")) {
    toAddress = toToken;
  } else {
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

  // Convert amount to raw units (using precise BigInt parsing)
  const amountRaw = parseAmountToBigInt(amount, fromDecimals);

  console.error(`[clara] Getting swap quote: ${amount} ${fromToken} → ${toToken} on ${chain}${opts.preferredDex ? ` (prefer: ${opts.preferredDex})` : ""}`);

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

  // Add Boost-aware routing preferences
  if (opts.preferredDex) {
    // Li.Fi uses "dexs" param to limit to specific DEXes
    params.append("dexs", opts.preferredDex);
    console.error(`[clara] Boost routing: preferring ${opts.preferredDex}`);
  }
  if (opts.denyDexes && opts.denyDexes.length > 0) {
    params.append("denyExchanges", opts.denyDexes.join(","));
  }

  try {
    const response = await fetch(`${LIFI_API}/quote?${params}`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[clara] Li.Fi API error: ${response.status} - ${error}`);
      throw new Error(`Quote failed: ${response.status}`);
    }

    const data = await response.json() as {
      id: string;
      action: {
        fromToken: { address: string; symbol: string; decimals: number; priceUSD: string };
        toToken: { address: string; symbol: string; decimals: number; priceUSD: string };
        fromAmount: string;
        toAmount: string;
        slippage: number;
      };
      estimate: {
        toAmount: string;
        toAmountMin: string;
        fromAmountUSD: string;
        toAmountUSD: string;
        gasCosts: Array<{ amountUSD: string; estimate: string }>;
        executionDuration: number;
        approvalAddress?: string;
      };
      transactionRequest?: {
        to: string;
        data: string;
        value: string;
        gasLimit: string;
      };
      tool: string;
      toolDetails?: { name: string };
    };

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
    let currentAllowance: string | undefined;

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
      source: "lifi" as const,
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
  } catch (error) {
    console.error(`[clara] Li.Fi quote error:`, error);
    throw error;
  }
}

/**
 * Get a swap quote from 0x Swap API v2
 * Provides access to professional market makers + DEX aggregation
 *
 * @param fromToken - Token to sell (symbol or address)
 * @param toToken - Token to buy (symbol or address)
 * @param amount - Amount to swap (human-readable)
 * @param chain - Blockchain to swap on
 * @param options - Optional: slippage
 */
async function getSwapQuoteFrom0x(
  fromToken: string,
  toToken: string,
  amount: string,
  chain: SupportedChain,
  options: SwapQuoteOptions = {}
): Promise<SwapQuote> {
  const slippage = options.slippage ?? 0.5;

  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  const chainId = CHAIN_IDS[chain];
  if (!chainId) {
    throw new Error(`Swaps not supported on ${chain}`);
  }

  // Resolve token addresses
  let fromAddress: string;
  let toAddress: string;
  let fromDecimals = 18;
  let toDecimals = 18;
  let fromSymbol = fromToken;
  let toSymbol = toToken;

  const nativeSymbols = ["ETH", "MATIC", "NATIVE"];

  if (nativeSymbols.includes(fromToken.toUpperCase())) {
    fromAddress = ZEROX_NATIVE_TOKEN;
    fromSymbol = chain === "polygon" ? "MATIC" : "ETH";
  } else if (fromToken.startsWith("0x")) {
    fromAddress = fromToken;
    const metadata = await getTokenMetadata(fromToken, chain);
    fromDecimals = metadata.decimals;
    fromSymbol = metadata.symbol;
  } else {
    const resolved = resolveToken(fromToken, chain);
    if (!resolved) throw new Error(`Unknown token: ${fromToken} on ${chain}`);
    fromAddress = resolved.address;
    fromDecimals = resolved.decimals;
    fromSymbol = resolved.symbol;
  }

  if (nativeSymbols.includes(toToken.toUpperCase())) {
    toAddress = ZEROX_NATIVE_TOKEN;
    toSymbol = chain === "polygon" ? "MATIC" : "ETH";
  } else if (toToken.startsWith("0x")) {
    toAddress = toToken;
    const metadata = await getTokenMetadata(toToken, chain);
    toDecimals = metadata.decimals;
    toSymbol = metadata.symbol;
  } else {
    const resolved = resolveToken(toToken, chain);
    if (!resolved) throw new Error(`Unknown token: ${toToken} on ${chain}`);
    toAddress = resolved.address;
    toDecimals = resolved.decimals;
    toSymbol = resolved.symbol;
  }

  // Convert amount to raw units
  const amountRaw = parseAmountToBigInt(amount, fromDecimals);

  console.error(`[clara] Getting 0x quote: ${amount} ${fromSymbol} → ${toSymbol} on ${chain}`);

  // Build 0x API request
  const params = new URLSearchParams({
    chainId: chainId.toString(),
    sellToken: fromAddress,
    buyToken: toAddress,
    sellAmount: amountRaw.toString(),
    taker: session.address,
    slippageBps: Math.round(slippage * 100).toString(), // Convert % to basis points
  });

  const headers: Record<string, string> = {
    "0x-version": "v2",
  };

  // Add API key if available (for higher rate limits)
  if (ZEROX_API_KEY) {
    headers["0x-api-key"] = ZEROX_API_KEY;
  }

  const response = await fetch(`${ZEROX_API}/quote?${params}`, { headers });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[clara] 0x API error: ${response.status} - ${error}`);
    throw new Error(`0x quote failed: ${response.status}`);
  }

  const data = await response.json() as {
    liquidityAvailable: boolean;
    buyAmount: string;
    minBuyAmount: string;
    sellAmount: string;
    totalNetworkFee: string;
    transaction: {
      to: string;
      data: string;
      value: string;
      gas: string;
    };
    route: {
      fills: Array<{ source: string }>;
    };
    issues?: {
      allowance?: { spender: string };
    };
  };

  if (!data.liquidityAvailable) {
    throw new Error("No liquidity available for this swap on 0x");
  }

  // Calculate amounts
  const toAmountNum = Number(BigInt(data.buyAmount)) / Math.pow(10, toDecimals);
  const toAmountMinNum = Number(BigInt(data.minBuyAmount)) / Math.pow(10, toDecimals);
  const fromAmountNum = parseFloat(amount);
  const exchangeRate = (toAmountNum / fromAmountNum).toFixed(6);

  // Get gas cost in USD (rough estimate)
  const gasEstimate = data.transaction?.gas || "200000";
  const gasCostUsd = (parseInt(gasEstimate) * 0.00000001 * 2500).toFixed(2); // Rough ETH price estimate

  // Check for approval requirement
  const needsApproval = !!data.issues?.allowance;
  const approvalAddress = data.issues?.allowance?.spender;

  // Get liquidity sources
  const sources = [...new Set(data.route?.fills?.map(f => f.source) || [])];
  const toolDetails = sources.length > 0 ? sources.join(" → ") : "0x";

  return {
    id: `0x-${Date.now()}`,
    source: "0x" as const,
    fromToken: {
      address: fromAddress,
      symbol: fromSymbol,
      decimals: fromDecimals,
      priceUsd: "0", // 0x doesn't provide USD prices in basic response
    },
    toToken: {
      address: toAddress,
      symbol: toSymbol,
      decimals: toDecimals,
      priceUsd: "0",
    },
    fromAmount: amount,
    fromAmountUsd: "0", // Would need price feed
    toAmount: toAmountNum.toFixed(toDecimals > 6 ? 6 : toDecimals),
    toAmountUsd: "0",
    toAmountMin: toAmountMinNum.toFixed(6),
    exchangeRate,
    priceImpact: "0", // 0x doesn't provide this directly
    estimatedGas: gasEstimate,
    estimatedGasUsd: gasCostUsd,
    approvalAddress,
    needsApproval,
    transactionRequest: data.transaction ? {
      to: data.transaction.to,
      data: data.transaction.data,
      value: data.transaction.value,
      gasLimit: data.transaction.gas,
    } : undefined,
    tool: "0x",
    toolDetails,
  };
}

/**
 * Get the best swap quote from multiple aggregators (meta-aggregation)
 * Queries Li.Fi and 0x in parallel, returns the quote with best output
 *
 * @param fromToken - Token to sell (symbol or address)
 * @param toToken - Token to buy (symbol or address)
 * @param amount - Amount to swap (human-readable)
 * @param chain - Blockchain to swap on
 * @param options - Optional: slippage, preferredDex
 */
export async function getSwapQuoteBest(
  fromToken: string,
  toToken: string,
  amount: string,
  chain: SupportedChain,
  options: SwapQuoteOptions = {}
): Promise<SwapQuote> {
  console.error(`[clara] Meta-aggregation: querying Li.Fi + 0x for best quote...`);

  // Query both aggregators in parallel
  const [lifiResult, zeroxResult] = await Promise.allSettled([
    getSwapQuote(fromToken, toToken, amount, chain, options),
    getSwapQuoteFrom0x(fromToken, toToken, amount, chain, options),
  ]);

  const quotes: SwapQuote[] = [];

  if (lifiResult.status === "fulfilled") {
    quotes.push(lifiResult.value);
    console.error(`[clara] Li.Fi quote: ${lifiResult.value.toAmount} ${lifiResult.value.toToken.symbol}`);
  } else {
    console.error(`[clara] Li.Fi failed: ${lifiResult.reason}`);
  }

  if (zeroxResult.status === "fulfilled") {
    quotes.push(zeroxResult.value);
    console.error(`[clara] 0x quote: ${zeroxResult.value.toAmount} ${zeroxResult.value.toToken.symbol}`);
  } else {
    console.error(`[clara] 0x failed: ${zeroxResult.reason}`);
  }

  if (quotes.length === 0) {
    throw new Error("All aggregators failed to provide a quote");
  }

  // Find the best quote (highest output amount)
  const bestQuote = quotes.reduce((best, current) => {
    const bestAmount = parseFloat(best.toAmount);
    const currentAmount = parseFloat(current.toAmount);
    return currentAmount > bestAmount ? current : best;
  });

  console.error(`[clara] Best quote: ${bestQuote.source} with ${bestQuote.toAmount} ${bestQuote.toToken.symbol}`);

  return bestQuote;
}

// ============================================================================
// Cross-Chain Bridging (via Li.Fi)
// ============================================================================

/**
 * Bridge quote from Li.Fi (supports bridging + cross-chain swaps)
 */
export interface BridgeQuote {
  id: string;
  fromChain: SupportedChain;
  toChain: SupportedChain;
  fromToken: {
    address: string;
    symbol: string;
    decimals: number;
    priceUsd: string;
  };
  toToken: {
    address: string;
    symbol: string;
    decimals: number;
    priceUsd: string;
  };
  fromAmount: string;
  fromAmountUsd: string;
  toAmount: string;
  toAmountUsd: string;
  toAmountMin: string;
  exchangeRate: string;
  estimatedTime: number; // seconds
  estimatedGasUsd: string;
  approvalAddress?: string;
  needsApproval: boolean;
  currentAllowance?: string;
  transactionRequest?: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  };
  tool: string;        // Bridge used (e.g., "stargate", "across", "hop")
  toolDetails?: string;
  steps: Array<{       // Route breakdown
    type: "swap" | "bridge" | "cross";
    tool: string;
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
  }>;
}

/**
 * Options for bridge quote request
 */
export interface BridgeQuoteOptions {
  /** Max slippage percentage (default 0.5%) */
  slippage?: number;
  /** Preferred bridges to use */
  preferredBridges?: string[];
  /** Bridges to exclude */
  denyBridges?: string[];
}

/**
 * Get a cross-chain bridge quote from Li.Fi
 * Supports same-token bridging and cross-chain swaps
 *
 * @param fromToken - Token to send (symbol or address)
 * @param toToken - Token to receive (symbol or address, can be different)
 * @param amount - Amount to bridge (human-readable)
 * @param fromChain - Source blockchain
 * @param toChain - Destination blockchain
 * @param options - Optional: slippage, preferred bridges
 */
export async function getBridgeQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  fromChain: SupportedChain,
  toChain: SupportedChain,
  options: BridgeQuoteOptions = {}
): Promise<BridgeQuote> {
  const slippage = options.slippage ?? 0.5;

  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  const fromChainId = CHAIN_IDS[fromChain];
  const toChainId = CHAIN_IDS[toChain];

  if (!fromChainId) {
    throw new Error(`Bridging not supported from ${fromChain}`);
  }
  if (!toChainId) {
    throw new Error(`Bridging not supported to ${toChain}`);
  }

  // Resolve source token address
  let fromAddress: string;
  const nativeSymbols = ["ETH", "MATIC", "NATIVE"];

  if (nativeSymbols.includes(fromToken.toUpperCase())) {
    fromAddress = NATIVE_TOKEN_ADDRESS;
  } else if (fromToken.startsWith("0x")) {
    fromAddress = fromToken;
  } else {
    const resolved = resolveToken(fromToken, fromChain);
    if (!resolved) {
      throw new Error(`Unknown token: ${fromToken} on ${fromChain}`);
    }
    fromAddress = resolved.address;
  }

  // Resolve destination token address
  let toAddress: string;
  if (nativeSymbols.includes(toToken.toUpperCase())) {
    toAddress = NATIVE_TOKEN_ADDRESS;
  } else if (toToken.startsWith("0x")) {
    toAddress = toToken;
  } else {
    const resolved = resolveToken(toToken, toChain);
    if (!resolved) {
      throw new Error(`Unknown token: ${toToken} on ${toChain}`);
    }
    toAddress = resolved.address;
  }

  // Get token metadata for amount conversion
  let fromDecimals = 18;
  if (fromAddress !== NATIVE_TOKEN_ADDRESS) {
    const metadata = await getTokenMetadata(fromAddress, fromChain);
    fromDecimals = metadata.decimals;
  }

  // Convert amount to raw units
  const amountRaw = parseAmountToBigInt(amount, fromDecimals);

  const isCrossChainSwap = fromToken.toUpperCase() !== toToken.toUpperCase();
  const actionType = isCrossChainSwap ? "cross-chain swap" : "bridge";
  console.error(`[clara] Getting ${actionType} quote: ${amount} ${fromToken} (${fromChain}) → ${toToken} (${toChain})`);

  // Call Li.Fi quote endpoint with different chains
  const params = new URLSearchParams({
    fromChain: fromChainId.toString(),
    toChain: toChainId.toString(),
    fromToken: fromAddress,
    toToken: toAddress,
    fromAmount: amountRaw.toString(),
    fromAddress: session.address,
    slippage: (slippage / 100).toString(),
  });

  // Add bridge preferences
  if (options.preferredBridges && options.preferredBridges.length > 0) {
    params.append("bridges", options.preferredBridges.join(","));
  }
  if (options.denyBridges && options.denyBridges.length > 0) {
    params.append("denyBridges", options.denyBridges.join(","));
  }

  try {
    const response = await fetch(`${LIFI_API}/quote?${params}`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[clara] Li.Fi bridge API error: ${response.status} - ${error}`);
      throw new Error(`Bridge quote failed: ${response.status}`);
    }

    const data = await response.json() as {
      id: string;
      action: {
        fromToken: { address: string; symbol: string; decimals: number; priceUSD: string };
        toToken: { address: string; symbol: string; decimals: number; priceUSD: string };
        fromAmount: string;
        toAmount: string;
        slippage: number;
      };
      estimate: {
        toAmount: string;
        toAmountMin: string;
        fromAmountUSD: string;
        toAmountUSD: string;
        gasCosts: Array<{ amountUSD: string; estimate: string }>;
        executionDuration: number;
        approvalAddress?: string;
      };
      includedSteps: Array<{
        type: string;
        tool: string;
        action: {
          fromChainId: number;
          toChainId: number;
          fromToken: { symbol: string };
          toToken: { symbol: string };
        };
      }>;
      transactionRequest?: {
        to: string;
        data: string;
        value: string;
        gasLimit: string;
      };
      tool: string;
      toolDetails?: { name: string };
    };

    // Calculate exchange rate
    const fromAmountNum = parseFloat(amount);
    const toAmountNum = Number(BigInt(data.estimate.toAmount)) / Math.pow(10, data.action.toToken.decimals);
    const exchangeRate = (toAmountNum / fromAmountNum).toFixed(6);

    // Check if approval is needed
    let needsApproval = false;
    let currentAllowance: string | undefined;

    if (fromAddress !== NATIVE_TOKEN_ADDRESS && data.estimate.approvalAddress) {
      const approval = await getAllowance(fromAddress, data.estimate.approvalAddress, fromChain);
      const requiredAmount = BigInt(data.action.fromAmount);
      const currentAmount = BigInt(approval.allowanceRaw);
      needsApproval = currentAmount < requiredAmount;
      currentAllowance = approval.allowance;
    }

    // Sum up gas costs
    const totalGasUsd = data.estimate.gasCosts.reduce((sum, g) => sum + parseFloat(g.amountUSD || "0"), 0);

    // Build steps array
    const steps = (data.includedSteps || []).map(step => ({
      type: step.type as "swap" | "bridge" | "cross",
      tool: step.tool,
      fromChain: Object.entries(CHAIN_IDS).find(([, id]) => id === step.action.fromChainId)?.[0] || "unknown",
      toChain: Object.entries(CHAIN_IDS).find(([, id]) => id === step.action.toChainId)?.[0] || "unknown",
      fromToken: step.action.fromToken.symbol,
      toToken: step.action.toToken.symbol,
    }));

    return {
      id: data.id,
      fromChain,
      toChain,
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
      estimatedTime: data.estimate.executionDuration,
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
      steps,
    };
  } catch (error) {
    console.error(`[clara] Bridge quote error:`, error);
    throw error;
  }
}

/**
 * Execute a bridge using the quote's transaction request
 * Note: This initiates the bridge on the source chain.
 * The tokens will arrive on the destination chain after the estimated time.
 */
export async function executeBridge(
  quote: BridgeQuote
): Promise<{ txHash: string; status: string; estimatedArrival: string }> {
  if (!quote.transactionRequest) {
    throw new Error("Quote does not include transaction data. Get a fresh quote.");
  }

  if (quote.needsApproval) {
    throw new Error(
      `Approval needed first. Approve ${quote.fromToken.symbol} for spender ${quote.approvalAddress}`
    );
  }

  console.error(`[clara] Executing bridge: ${quote.fromAmount} ${quote.fromToken.symbol} (${quote.fromChain}) → ${quote.toToken.symbol} (${quote.toChain})`);

  const txReq = quote.transactionRequest;

  // Sign the transaction
  const signed = await signTransaction(
    {
      to: txReq.to,
      value: txReq.value ? BigInt(txReq.value).toString() : "0",
      data: txReq.data,
      gasLimit: txReq.gasLimit,
      chainId: CHAIN_CONFIG[quote.fromChain].chainId,
    },
    quote.fromChain
  );

  // Broadcast via RPC
  const config = CHAIN_CONFIG[quote.fromChain];
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

  const result = await response.json() as {
    result?: string;
    error?: { message: string };
  };

  if (result.error) {
    throw new Error(`Bridge failed: ${result.error.message}`);
  }

  // Calculate estimated arrival time
  const arrivalTime = new Date(Date.now() + quote.estimatedTime * 1000);
  const estimatedArrival = arrivalTime.toLocaleTimeString();

  return {
    txHash: result.result || "",
    status: "pending",
    estimatedArrival,
  };
}

/**
 * Bridge status from Li.Fi status API
 */
export interface BridgeStatus {
  status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND";
  substatus?: string;
  sending?: {
    txHash: string;
    chainId: number;
    amount: string;
    token: { symbol: string };
  };
  receiving?: {
    txHash?: string;
    chainId: number;
    amount?: string;
    token?: { symbol: string };
  };
  tool?: string;
}

/**
 * Get the status of a bridge transaction
 * Uses Li.Fi's status endpoint to track cross-chain transfers
 *
 * @param txHash - Source chain transaction hash
 * @param fromChain - Source chain
 * @param toChain - Destination chain
 * @returns Bridge status object
 */
export async function getBridgeStatus(
  txHash: string,
  fromChain: SupportedChain,
  toChain: SupportedChain
): Promise<BridgeStatus> {
  const fromConfig = CHAIN_CONFIG[fromChain];
  const toConfig = CHAIN_CONFIG[toChain];

  if (!fromConfig?.chainId || !toConfig?.chainId) {
    throw new Error(`Unsupported chain: ${fromChain} or ${toChain}`);
  }

  const params = new URLSearchParams({
    txHash,
    fromChain: fromConfig.chainId.toString(),
    toChain: toConfig.chainId.toString(),
  });

  const response = await fetch(`${LIFI_API}/status?${params}`);

  if (!response.ok) {
    if (response.status === 404) {
      return { status: "NOT_FOUND" };
    }
    throw new Error(`Failed to get bridge status: ${response.status}`);
  }

  const data = await response.json() as {
    status: string;
    substatus?: string;
    sending?: { txHash: string; chainId: number; amount: string; token: { symbol: string } };
    receiving?: { txHash?: string; chainId: number; amount?: string; token?: { symbol: string } };
    tool?: string;
  };

  return {
    status: data.status as BridgeStatus["status"],
    substatus: data.substatus,
    sending: data.sending,
    receiving: data.receiving,
    tool: data.tool,
  };
}

/**
 * Wait for a bridge to complete with polling
 * Returns when the bridge is complete or timeout is reached
 *
 * @param txHash - Source chain transaction hash
 * @param fromChain - Source chain
 * @param toChain - Destination chain
 * @param options - Polling options
 * @returns Final bridge status
 */
export async function waitForBridge(
  txHash: string,
  fromChain: SupportedChain,
  toChain: SupportedChain,
  options: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (status: BridgeStatus) => void;
  } = {}
): Promise<BridgeStatus> {
  const pollInterval = options.pollIntervalMs || 15000; // 15 seconds
  const timeout = options.timeoutMs || 10 * 60 * 1000; // 10 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getBridgeStatus(txHash, fromChain, toChain);

    if (options.onUpdate) {
      options.onUpdate(status);
    }

    if (status.status === "DONE" || status.status === "FAILED") {
      return status;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { status: "PENDING", substatus: "TIMEOUT" };
}

/**
 * Execute a swap using the quote's transaction request
 */
export async function executeSwap(
  quote: SwapQuote,
  chain: SupportedChain
): Promise<{ txHash: string; status: string }> {
  if (!quote.transactionRequest) {
    throw new Error("Quote does not include transaction data. Get a fresh quote.");
  }

  if (quote.needsApproval) {
    throw new Error(
      `Approval needed first. Approve ${quote.fromToken.symbol} for spender ${quote.approvalAddress}`
    );
  }

  console.error(`[clara] Executing swap: ${quote.fromAmount} ${quote.fromToken.symbol} → ${quote.toToken.symbol}`);

  const txReq = quote.transactionRequest;

  // Sign the transaction with the full parameters from the quote
  const signed = await signTransaction(
    {
      to: txReq.to,
      value: txReq.value ? BigInt(txReq.value).toString() : "0",
      data: txReq.data,
      gasLimit: txReq.gasLimit, // Use gas limit from quote
      chainId: CHAIN_CONFIG[chain].chainId,
    },
    chain
  );

  // Broadcast via RPC
  const config = CHAIN_CONFIG[chain];
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

  const rpcResult = (await response.json()) as {
    result?: string;
    error?: { message: string; code?: number };
  };

  if (rpcResult.error) {
    throw new Error(`Swap failed: ${rpcResult.error.message}`);
  }

  return {
    txHash: rpcResult.result || "",
    status: "pending",
  };
}

/**
 * Get supported tokens for swapping on a chain
 * Returns common tokens that Li.Fi supports
 */
export function getSwappableTokens(chain: SupportedChain): Array<{ symbol: string; address: string }> {
  const tokens: Array<{ symbol: string; address: string }> = [];

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
const AAVE_V3_POOLS: Record<string, { pool: string; poolDataProvider: string } | null> = {
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
  supply: "0x617ba037",      // supply(address,uint256,address,uint16)
  withdraw: "0x69328dec",    // withdraw(address,uint256,address)
};

/**
 * Yield opportunity from DeFiLlama
 */
export interface YieldOpportunity {
  pool: string;           // DeFiLlama pool ID
  chain: SupportedChain;
  protocol: string;       // e.g., "aave-v3"
  symbol: string;         // e.g., "USDC"
  apy: number;            // Base APY (not including rewards)
  apyReward: number | null;
  apyTotal: number;       // Base + rewards
  tvlUsd: number;
  stablecoin: boolean;
  underlyingTokens: string[];
}

/**
 * Yield action plan (what we'll execute)
 */
export interface YieldPlan {
  action: "deposit" | "withdraw";
  protocol: string;
  chain: SupportedChain;
  asset: string;
  assetAddress: string;
  amount: string;
  amountRaw: string;
  apy: number;
  tvlUsd: number;
  poolContract: string;
  transactionData: string;
  needsApproval: boolean;
  approvalAddress?: string;
  estimatedGasUsd: string;
}

/**
 * Fetch yield opportunities from DeFiLlama
 * Filters for supported protocols and chains
 */
export async function getYieldOpportunities(
  asset: string,
  options: {
    chains?: SupportedChain[];
    minTvl?: number;
    protocols?: string[];
  } = {}
): Promise<YieldOpportunity[]> {
  const {
    chains = ["base", "arbitrum"],
    minTvl = 1_000_000, // $1M minimum TVL for safety
    protocols = ["aave-v3", "compound-v3", "morpho-v1"], // Support major protocols
  } = options;

  console.error(`[clara] Fetching yields for ${asset} on ${chains.join(", ")}`);

  try {
    const response = await fetch(`${DEFILLAMA_YIELDS_API}/pools`);
    if (!response.ok) {
      throw new Error(`DeFiLlama API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: Array<{
        pool: string;
        chain: string;
        project: string;
        symbol: string;
        tvlUsd: number;
        apy: number;
        apyBase: number | null;
        apyReward: number | null;
        stablecoin: boolean;
        underlyingTokens: string[];
      }>;
    };

    // Filter for matching opportunities
    const assetUpper = asset.toUpperCase();
    const opportunities: YieldOpportunity[] = [];

    for (const pool of data.data) {
      // Check chain
      const chainLower = pool.chain.toLowerCase();
      if (!chains.includes(chainLower as SupportedChain)) continue;

      // Check protocol
      if (!protocols.includes(pool.project)) continue;

      // Check asset (symbol contains our asset)
      if (!pool.symbol.toUpperCase().includes(assetUpper)) continue;

      // Check TVL
      if (pool.tvlUsd < minTvl) continue;

      opportunities.push({
        pool: pool.pool,
        chain: chainLower as SupportedChain,
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
  } catch (error) {
    console.error(`[clara] Yield fetch error:`, error);
    return [];
  }
}

/**
 * Get the best yield opportunity for an asset
 */
export async function getBestYield(
  asset: string,
  chains: SupportedChain[] = ["base", "arbitrum"]
): Promise<YieldOpportunity | null> {
  const opportunities = await getYieldOpportunities(asset, { chains });
  return opportunities[0] || null;
}

/**
 * Parse a decimal amount string to BigInt with the specified decimals.
 * Handles arbitrary precision without floating-point errors.
 *
 * Examples:
 *   parseAmountToBigInt("100", 6)      -> 100000000n (100 USDC)
 *   parseAmountToBigInt("0.01", 6)     -> 10000n (0.01 USDC)
 *   parseAmountToBigInt("1000000", 18) -> 1000000000000000000000000n (1M DAI, precise)
 */
export function parseAmountToBigInt(amount: string, decimals: number): bigint {
  // Handle edge cases
  if (!amount || amount === "0") return BigInt(0);

  // Remove any whitespace and handle negative (shouldn't happen but be safe)
  const cleanAmount = amount.trim();
  if (cleanAmount.startsWith("-")) {
    throw new Error("Negative amounts not supported");
  }

  // Split into whole and fractional parts
  const parts = cleanAmount.split(".");
  const wholePart = parts[0] || "0";
  const fracPart = parts[1] || "";

  // Validate: only digits allowed
  if (!/^\d+$/.test(wholePart) || (fracPart && !/^\d+$/.test(fracPart))) {
    throw new Error(`Invalid amount format: ${amount}`);
  }

  // Pad or truncate fractional part to match decimals
  // If fracPart is longer than decimals, we truncate (floor behavior)
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);

  // Combine: wholePart + paddedFrac gives us the raw amount
  const rawString = wholePart + paddedFrac;

  // Remove leading zeros (but keep at least one digit)
  const trimmed = rawString.replace(/^0+/, "") || "0";

  return BigInt(trimmed);
}

/**
 * Encode Aave v3 supply transaction
 * supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
 */
export function encodeAaveSupply(
  assetAddress: string,
  amount: string,
  decimals: number,
  onBehalfOf: string
): string {
  // Pad asset address (32 bytes)
  const paddedAsset = assetAddress.slice(2).toLowerCase().padStart(64, "0");

  // Pad amount (32 bytes) - using precise BigInt parsing
  const amountRaw = parseAmountToBigInt(amount, decimals);
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
export function encodeAaveWithdraw(
  assetAddress: string,
  amount: string,
  decimals: number,
  to: string
): string {
  const paddedAsset = assetAddress.slice(2).toLowerCase().padStart(64, "0");

  // Use max uint256 for "withdraw all"
  let paddedAmount: string;
  if (amount === "max" || amount === "all") {
    paddedAmount = MAX_UINT256.toString(16).padStart(64, "0");
  } else {
    // Use precise BigInt parsing
    const amountRaw = parseAmountToBigInt(amount, decimals);
    paddedAmount = amountRaw.toString(16).padStart(64, "0");
  }

  const paddedTo = to.slice(2).toLowerCase().padStart(64, "0");

  return AAVE_SELECTORS.withdraw + paddedAsset + paddedAmount + paddedTo;
}

/**
 * Create a yield deposit plan for the best available opportunity
 * Falls back to next-best option if the highest-APY adapter fails
 */
export async function createYieldPlan(
  asset: string,
  amount: string,
  preferredChains: SupportedChain[] = ["base", "arbitrum"]
): Promise<YieldPlan | null> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Get all opportunities sorted by APY
  const opportunities = await getYieldOpportunities(asset, { chains: preferredChains });
  if (opportunities.length === 0) {
    return null;
  }

  // Try each opportunity until one works
  for (const opp of opportunities) {
    try {
      const plan = await tryCreatePlanForOpportunity(opp, asset, amount, session.address);
      if (plan) {
        return plan;
      }
    } catch (error) {
      console.error(`[clara] Skipping ${opp.protocol} on ${opp.chain}: ${error instanceof Error ? error.message : "unknown error"}`);
      continue;
    }
  }

  return null;
}

/**
 * Try to create a plan for a specific opportunity
 * Returns null if the adapter can't handle this opportunity
 */
async function tryCreatePlanForOpportunity(
  opp: YieldOpportunity,
  asset: string,
  amount: string,
  userAddress: string
): Promise<YieldPlan | null> {
  // Get the protocol adapter
  const adapter = getProtocolAdapter(opp.protocol);
  if (!adapter) {
    console.error(`[clara] Unsupported protocol: ${opp.protocol}`);
    return null;
  }

  // Verify chain is supported by this adapter
  if (!adapter.supportedChains.includes(opp.chain)) {
    console.error(`[clara] ${adapter.displayName} not available on ${opp.chain}`);
    return null;
  }

  // Get asset address on this chain
  const tokenInfo = resolveToken(asset, opp.chain);
  if (!tokenInfo) {
    console.error(`[clara] Token ${asset} not found on ${opp.chain}`);
    return null;
  }

  // Encode the supply transaction using the adapter
  // Pass the pool symbol (e.g., "HYPERUSDC") for vault-based protocols like Morpho
  const encoded = adapter.encodeSupply({
    assetAddress: tokenInfo.address,
    amount,
    decimals: tokenInfo.decimals,
    onBehalfOf: userAddress,
    chain: opp.chain,
    poolSymbol: opp.symbol, // DeFiLlama pool symbol for vault lookup
  });

  // Use the target contract from encoded tx for approval check
  // This ensures we check approval against the actual vault address
  const poolAddress = encoded.to;

  // Check if approval is needed
  const approval = await getAllowance(tokenInfo.address, poolAddress, opp.chain);
  const amountRaw = parseAmountToBigInt(amount, tokenInfo.decimals);
  const needsApproval = BigInt(approval.allowanceRaw) < amountRaw;

  return {
    action: "deposit",
    protocol: adapter.displayName,
    chain: opp.chain,
    asset: tokenInfo.symbol,
    assetAddress: tokenInfo.address,
    amount,
    amountRaw: encoded.amountRaw,
    apy: opp.apyTotal,
    tvlUsd: opp.tvlUsd,
    poolContract: encoded.to,
    transactionData: encoded.data,
    needsApproval,
    approvalAddress: needsApproval ? encoded.to : undefined,
    estimatedGasUsd: "0.50", // Rough estimate
  };
}

/**
 * Execute a yield deposit
 * Records the transaction for earnings tracking
 */
export async function executeYieldDeposit(
  plan: YieldPlan
): Promise<{ txHash: string; status: string }> {
  if (plan.needsApproval) {
    throw new Error("Approval needed first");
  }

  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  console.error(`[clara] Executing yield deposit: ${plan.amount} ${plan.asset} → ${plan.protocol} on ${plan.chain}`);

  const result = await sendTransaction(
    plan.poolContract,
    "0", // No ETH value for ERC-20 supply
    plan.chain,
    undefined,
    plan.transactionData
  );

  // Record transaction for earnings tracking
  try {
    await recordYieldTransaction(session.address, {
      action: "deposit",
      protocol: plan.protocol.toLowerCase().replace(/\s+/g, "-"), // "Aave v3" -> "aave-v3"
      chain: plan.chain,
      asset: plan.asset,
      amount: plan.amount,
      amountRaw: plan.amountRaw,
      txHash: result.txHash,
    });
    console.error(`[clara] Recorded deposit transaction for earnings tracking`);
  } catch (error) {
    console.error(`[clara] Failed to record deposit transaction:`, error);
    // Don't fail the deposit if recording fails
  }

  return {
    txHash: result.txHash,
    status: "pending",
  };
}

/**
 * User's position in a yield protocol
 */
export interface YieldPosition {
  protocol: string;
  chain: SupportedChain;
  asset: string;
  assetAddress: string;
  aTokenAddress: string;
  deposited: string;
  depositedRaw: string;
  currentApy: number;
  valueUsd: string;
}

// Aave v3 aToken addresses (receipt tokens for deposits)
const AAVE_ATOKENS: Record<string, Record<string, string>> = {
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
 * Get user's yield positions across chains and protocols
 * Now supports Aave V3 and Compound V3 via adapter pattern
 * Includes USD valuation via price oracle
 */
export async function getYieldPositions(
  chains: SupportedChain[] = ["base", "arbitrum"],
  protocols: string[] = ["aave-v3", "compound-v3"]
): Promise<YieldPosition[]> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  const positions: YieldPosition[] = [];

  // Collect all positions with balances (without prices yet)
  const positionsWithoutPrice: Array<{
    protocol: string;
    protocolId: string;
    chain: SupportedChain;
    symbol: string;
    receiptTokenAddress: string;
    balance: string;
    balanceRaw: string;
    underlying: { address: string } | null;
    currentApy: number;
  }> = [];

  // Check each protocol
  for (const protocolId of protocols) {
    const adapter = getProtocolAdapter(protocolId);
    if (!adapter) continue;

    // Check each chain for this protocol
    for (const chain of chains) {
      if (!adapter.supportedChains.includes(chain)) continue;

      // Get assets to check for this protocol/chain
      // For Aave, check aTokens; for Compound, check Comet balances
      const assetsToCheck = getAssetsForProtocol(protocolId, chain);

      for (const symbol of assetsToCheck) {
        const receiptToken = adapter.getReceiptToken(symbol, chain);
        if (!receiptToken || receiptToken === "0x0000000000000000000000000000000000000000") {
          continue;
        }

        try {
          const balance = await getTokenBalance(receiptToken, chain, session.address);
          const balanceNum = parseFloat(balance.balance);

          if (balanceNum > 0.0001) { // Only show positions above dust
            const underlying = resolveToken(symbol, chain);
            const yields = await getYieldOpportunities(symbol, {
              chains: [chain],
              protocols: [protocolId],
            });
            const currentApy = yields[0]?.apyTotal || 0;

            positionsWithoutPrice.push({
              protocol: adapter.displayName,
              protocolId,
              chain,
              symbol,
              receiptTokenAddress: receiptToken,
              balance: balance.balance,
              balanceRaw: balance.balanceRaw,
              underlying,
              currentApy,
            });
          }
        } catch (error) {
          console.error(`[clara] Error checking ${symbol} in ${adapter.displayName} on ${chain}:`, error);
          continue;
        }
      }
    }
  }

  // Batch fetch prices for all position symbols
  const symbols = [...new Set(positionsWithoutPrice.map(p => p.symbol))];
  const prices = await getTokenPricesUsd(symbols);

  // Build final positions with USD values
  for (const pos of positionsWithoutPrice) {
    const price = prices[pos.symbol];
    const balanceNum = parseFloat(pos.balance);
    const valueUsd = price !== undefined
      ? (balanceNum * price).toFixed(2)
      : "—";

    positions.push({
      protocol: pos.protocol,
      chain: pos.chain,
      asset: pos.symbol,
      assetAddress: pos.underlying?.address || "",
      aTokenAddress: pos.receiptTokenAddress, // Keep field name for compatibility
      deposited: pos.balance,
      depositedRaw: pos.balanceRaw,
      currentApy: pos.currentApy,
      valueUsd,
    });
  }

  return positions;
}

/**
 * Get the list of assets to check for a protocol on a chain
 * This is needed because each protocol supports different assets
 */
function getAssetsForProtocol(protocolId: string, chain: SupportedChain): string[] {
  // Common stablecoins and assets across protocols
  const commonAssets = ["USDC", "USDT", "DAI", "WETH"];

  // Protocol-specific additions
  if (protocolId === "aave-v3") {
    if (chain === "base") return ["USDC", "USDbC", "WETH"];
    if (chain === "arbitrum") return ["USDC", "USDC.e", "USDT", "DAI", "WETH"];
    return commonAssets;
  }

  if (protocolId === "compound-v3") {
    // Compound V3 has specific Comet markets
    if (chain === "base") return ["USDC", "USDbC", "WETH"];
    if (chain === "arbitrum") return ["USDC", "USDC.e", "WETH"];
    if (chain === "ethereum") return ["USDC", "WETH"];
    if (chain === "polygon") return ["USDC"];
    if (chain === "optimism") return ["USDC", "WETH"];
    return ["USDC"];
  }

  return commonAssets;
}

/**
 * Create a withdrawal plan for yield positions
 * Now supports multiple protocols via adapter pattern
 */
export async function createWithdrawPlan(
  asset: string,
  amount: string, // "all" or specific amount
  chain: SupportedChain,
  protocol: string = "aave-v3" // Default to Aave for backwards compatibility
): Promise<YieldPlan | null> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Get the protocol adapter
  const adapter = getProtocolAdapter(protocol);
  if (!adapter) {
    console.error(`[clara] Unsupported protocol: ${protocol}`);
    return null;
  }

  // Verify chain support
  if (!adapter.supportedChains.includes(chain)) {
    console.error(`[clara] ${adapter.displayName} not available on ${chain}`);
    return null;
  }

  // Get pool address
  const poolAddress = adapter.getPoolAddress(chain);
  if (!poolAddress) {
    console.error(`[clara] ${adapter.displayName} not configured for ${chain}`);
    return null;
  }

  // Get token info
  const tokenInfo = resolveToken(asset, chain);
  if (!tokenInfo) {
    console.error(`[clara] Token ${asset} not found on ${chain}`);
    return null;
  }

  // Get receipt token address (aToken for Aave, Comet for Compound)
  const receiptTokenAddress = adapter.getReceiptToken(tokenInfo.symbol, chain);
  if (!receiptTokenAddress || receiptTokenAddress === "0x0000000000000000000000000000000000000000") {
    console.error(`[clara] No receipt token for ${asset} on ${chain} in ${adapter.displayName}`);
    return null;
  }

  // Check deposited balance
  const receiptBalance = await getTokenBalance(receiptTokenAddress, chain, session.address);
  const depositedNum = parseFloat(receiptBalance.balance);

  if (depositedNum < 0.0001) {
    console.error(`[clara] No ${asset} deposited in ${adapter.displayName} on ${chain}`);
    return null;
  }

  // Determine withdrawal amount
  const isWithdrawAll = amount === "all" || amount === "max";
  const withdrawAmount = isWithdrawAll ? receiptBalance.balance : amount;
  const withdrawNum = parseFloat(withdrawAmount);

  if (withdrawNum > depositedNum) {
    console.error(`[clara] Cannot withdraw ${withdrawAmount}, only ${receiptBalance.balance} deposited`);
    return null;
  }

  // Get current APY for display
  const yields = await getYieldOpportunities(asset, { chains: [chain], protocols: [protocol] });
  const currentApy = yields[0]?.apyTotal || 0;
  const tvlUsd = yields[0]?.tvlUsd || 0;

  // Encode withdraw transaction using adapter
  const encoded = adapter.encodeWithdraw({
    assetAddress: tokenInfo.address,
    amount: isWithdrawAll ? "max" : withdrawAmount,
    decimals: tokenInfo.decimals,
    to: session.address,
    chain,
  });

  return {
    action: "withdraw",
    protocol: adapter.displayName,
    chain,
    asset: tokenInfo.symbol,
    assetAddress: tokenInfo.address,
    amount: withdrawAmount,
    amountRaw: encoded.amountRaw,
    apy: currentApy,
    tvlUsd,
    poolContract: encoded.to,
    transactionData: encoded.data,
    needsApproval: false, // No approval needed for withdraws
    estimatedGasUsd: "0.30",
  };
}

/**
 * Execute a yield withdrawal
 * Records the transaction for earnings tracking
 */
export async function executeYieldWithdraw(
  plan: YieldPlan
): Promise<{ txHash: string; status: string }> {
  if (plan.action !== "withdraw") {
    throw new Error("Invalid plan - not a withdraw action");
  }

  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  console.error(`[clara] Executing yield withdraw: ${plan.amount} ${plan.asset} from ${plan.protocol} on ${plan.chain}`);

  const result = await sendTransaction(
    plan.poolContract,
    "0",
    plan.chain,
    undefined,
    plan.transactionData
  );

  // Record transaction for earnings tracking
  try {
    await recordYieldTransaction(session.address, {
      action: "withdraw",
      protocol: plan.protocol.toLowerCase().replace(/\s+/g, "-"),
      chain: plan.chain,
      asset: plan.asset,
      amount: plan.amount,
      amountRaw: plan.amountRaw,
      txHash: result.txHash,
    });
    console.error(`[clara] Recorded withdrawal transaction for earnings tracking`);
  } catch (error) {
    console.error(`[clara] Failed to record withdrawal transaction:`, error);
  }

  return {
    txHash: result.txHash,
    status: "pending",
  };
}

/**
 * Format a yield opportunity for display
 */
export function formatYieldOpportunity(opp: YieldOpportunity): string {
  const apyStr = opp.apyTotal.toFixed(2);
  const tvlStr = (opp.tvlUsd / 1_000_000).toFixed(1);
  return `${opp.protocol} on ${opp.chain}: ${apyStr}% APY ($${tvlStr}M TVL)`;
}

/**
 * Yield earnings for a single position
 */
export interface YieldEarnings {
  asset: string;
  chain: SupportedChain;
  protocol: string;
  totalDeposited: string;      // Sum of all deposits
  totalWithdrawn: string;      // Sum of all withdrawals
  netDeposited: string;        // deposited - withdrawn
  currentBalance: string;      // Current aToken balance
  earnedYield: string;         // currentBalance - netDeposited
  earnedYieldUsd: string;      // USD value of earnings
  earnedYieldPercent: string;  // Percentage gain
  periodDays: number;          // Days since first deposit
  effectiveApy: string | null; // Realized APY
}

/**
 * Get earnings for a specific yield position
 */
export async function getYieldEarnings(
  asset: string,
  chain: SupportedChain,
  protocol: string = "aave-v3"
): Promise<YieldEarnings | null> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Get current position
  const positions = await getYieldPositions([chain]);
  const position = positions.find(
    (p) =>
      p.asset.toUpperCase() === asset.toUpperCase() &&
      p.chain === chain &&
      p.protocol.toLowerCase().replace(/\s+/g, "-") === protocol.toLowerCase()
  );

  if (!position) {
    return null;
  }

  // Get transaction history
  const transactions = await getTransactionsForPosition(
    session.address,
    asset,
    chain,
    protocol
  );

  const currentBalance = parseFloat(position.deposited);
  const earnings = calculateEarnings(transactions, currentBalance);

  // Get USD price for earnings
  const price = await getTokenPriceUsd(asset);
  const earnedYieldUsd = price !== null
    ? (earnings.earnedYield * price).toFixed(2)
    : "—";

  return {
    asset: position.asset,
    chain: position.chain,
    protocol: position.protocol,
    totalDeposited: earnings.netDeposited >= 0
      ? (earnings.netDeposited + Math.max(0, -earnings.earnedYield)).toFixed(6)
      : "0",
    totalWithdrawn: "0", // Simplified for now
    netDeposited: earnings.netDeposited.toFixed(6),
    currentBalance: position.deposited,
    earnedYield: earnings.earnedYield.toFixed(6),
    earnedYieldUsd,
    earnedYieldPercent: earnings.earnedYieldPercent.toFixed(2),
    periodDays: Math.floor(earnings.periodDays),
    effectiveApy: earnings.effectiveApy !== null
      ? earnings.effectiveApy.toFixed(2)
      : null,
  };
}

/**
 * Get earnings summary for all positions
 */
export async function getAllYieldEarnings(): Promise<{
  positions: YieldEarnings[];
  totalEarnedUsd: string;
}> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Get all current positions
  const positions = await getYieldPositions();

  const earningsPromises = positions.map((pos) =>
    getYieldEarnings(pos.asset, pos.chain, pos.protocol)
  );

  const allEarnings = await Promise.all(earningsPromises);
  const validEarnings = allEarnings.filter((e): e is YieldEarnings => e !== null);

  // Calculate total earned USD
  let totalEarned = 0;
  for (const e of validEarnings) {
    const usd = parseFloat(e.earnedYieldUsd);
    if (!isNaN(usd)) {
      totalEarned += usd;
    }
  }

  return {
    positions: validEarnings,
    totalEarnedUsd: totalEarned.toFixed(2),
  };
}

// Re-export history types and functions for external use
export type { YieldTransaction };
export {
  recordYieldTransaction,
  getTransactionsForPosition,
  calculateEarnings,
  getYieldEarningsSummary,
};

export { CHAIN_CONFIG, EXPLORER_CONFIG, NATIVE_TOKEN_ADDRESS, AAVE_V3_POOLS };

// Re-export protocol adapter utilities
export { getProtocolAdapter, getSupportedProtocols };

// ============================================================================
// Dashboard / Onboarding
// ============================================================================

/**
 * Dashboard data for the /clara command
 */
export interface ClaraDashboard {
  authenticated: boolean;
  wallet?: {
    address: string;
    shortAddress: string;
  };
  portfolio?: {
    totalValueUsd: string;
    chains: Array<{
      chain: SupportedChain;
      nativeBalance: string;
      nativeValueUsd: string;
      tokens: Array<{
        symbol: string;
        balance: string;
        valueUsd: string;
      }>;
    }>;
  };
  yieldPositions?: {
    positions: Array<{
      protocol: string;
      chain: SupportedChain;
      asset: string;
      deposited: string;
      valueUsd: string;
      apy: number;
    }>;
    totalValueUsd: string;
    weightedApy: number;
    lifetimeEarnings: string;
  };
  pendingApprovals?: Array<{
    chain: SupportedChain;
    token: string;
    spender: string;
    spenderName: string | null;
    allowance: string;
    isUnlimited: boolean;
    isRisky: boolean;
  }>;
  recentActivity?: Array<{
    type: string;
    description: string;
    timestamp: string;
    chain: SupportedChain;
  }>;
}

/**
 * Get complete dashboard data for the /clara command
 * Gathers portfolio, yield positions, approvals, and activity in parallel
 */
export async function getClaraDashboard(): Promise<ClaraDashboard> {
  const session = await getSession();

  if (!session?.authenticated || !session.address) {
    return { authenticated: false };
  }

  const address = session.address;
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  // Gather data in parallel for speed
  const [portfolioData, yieldData, earningsData] = await Promise.all([
    getPortfolioData(address),
    getYieldPositions(["base", "arbitrum"]).catch(() => []),
    getAllYieldEarnings().catch(() => ({ positions: [], totalEarnedUsd: "0" })),
  ]);

  // Build portfolio section
  const portfolio = portfolioData ? {
    totalValueUsd: portfolioData.totalValueUsd,
    chains: portfolioData.chains,
  } : undefined;

  // Build yield positions section
  let yieldPositions: ClaraDashboard["yieldPositions"] = undefined;
  if (yieldData && yieldData.length > 0) {
    const positions = yieldData.map(p => ({
      protocol: p.protocol,
      chain: p.chain,
      asset: p.asset,
      deposited: p.deposited,
      valueUsd: p.valueUsd,
      apy: p.currentApy,
    }));

    // Calculate weighted APY
    let totalValue = 0;
    let weightedApySum = 0;
    for (const p of positions) {
      const value = parseFloat(p.valueUsd) || 0;
      totalValue += value;
      weightedApySum += value * p.apy;
    }
    const weightedApy = totalValue > 0 ? weightedApySum / totalValue : 0;

    yieldPositions = {
      positions,
      totalValueUsd: totalValue.toFixed(2),
      weightedApy: Math.round(weightedApy * 100) / 100,
      lifetimeEarnings: earningsData.totalEarnedUsd,
    };
  }

  return {
    authenticated: true,
    wallet: { address, shortAddress },
    portfolio,
    yieldPositions,
    pendingApprovals: [], // Would need to implement approval scanning
    recentActivity: [], // Would need to implement activity fetching
  };
}

/**
 * Helper to get portfolio data across chains
 */
async function getPortfolioData(address: string): Promise<{
  totalValueUsd: string;
  chains: Array<{
    chain: SupportedChain;
    nativeBalance: string;
    nativeValueUsd: string;
    tokens: Array<{ symbol: string; balance: string; valueUsd: string }>;
  }>;
} | null> {
  const chains: SupportedChain[] = ["base", "arbitrum", "ethereum"];
  const chainData: Array<{
    chain: SupportedChain;
    nativeBalance: string;
    nativeValueUsd: string;
    tokens: Array<{ symbol: string; balance: string; valueUsd: string }>;
  }> = [];

  let totalValue = 0;

  for (const chain of chains) {
    try {
      // Get native balance
      const nativeBalance = await getNativeBalance(chain);
      const nativeNum = parseFloat(nativeBalance.balance);

      // Get ETH price
      const ethPrice = await getTokenPriceUsd("ETH");
      const nativeValueUsd = ethPrice ? (nativeNum * ethPrice).toFixed(2) : "0";
      totalValue += parseFloat(nativeValueUsd);

      // Get major token balances
      const tokens: Array<{ symbol: string; balance: string; valueUsd: string }> = [];
      const tokensToCheck = ["USDC", "USDT", "DAI"];

      for (const symbol of tokensToCheck) {
        const tokenInfo = resolveToken(symbol, chain);
        if (tokenInfo) {
          try {
            const balance = await getTokenBalance(tokenInfo.address, chain, address);
            const balanceNum = parseFloat(balance.balance);
            if (balanceNum > 0.01) {
              const price = await getTokenPriceUsd(symbol);
              const valueUsd = price ? (balanceNum * price).toFixed(2) : "0";
              totalValue += parseFloat(valueUsd);
              tokens.push({ symbol, balance: balance.balance, valueUsd });
            }
          } catch {
            // Token not found or error, skip
          }
        }
      }

      if (nativeNum > 0.0001 || tokens.length > 0) {
        chainData.push({
          chain,
          nativeBalance: nativeBalance.balance,
          nativeValueUsd,
          tokens,
        });
      }
    } catch (error) {
      console.error(`[clara] Error fetching portfolio for ${chain}:`, error);
    }
  }

  if (chainData.length === 0) {
    return null;
  }

  return {
    totalValueUsd: totalValue.toFixed(2),
    chains: chainData,
  };
}

/**
 * Format the dashboard as ASCII art
 */
export function formatClaraDashboard(dashboard: ClaraDashboard): string {
  if (!dashboard.authenticated) {
    return `
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│      ██████╗██╗      █████╗ ██████╗  █████╗                     │
│     ██╔════╝██║     ██╔══██╗██╔══██╗██╔══██╗                    │
│     ██║     ██║     ███████║██████╔╝███████║                    │
│     ██║     ██║     ██╔══██║██╔══██╗██╔══██║                    │
│     ╚██████╗███████╗██║  ██║██║  ██║██║  ██║                    │
│      ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝                    │
│                                                                 │
│              Your AI-powered DeFi companion                     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ⚠️  Wallet not connected                                       │
│                                                                 │
│   Get started by saying:                                        │
│   → "Set up my wallet"                                          │
│   → "Create a wallet with my email"                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘`;
  }

  const lines: string[] = [];

  // Header
  lines.push(`┌─────────────────────────────────────────────────────────────────┐`);
  lines.push(`│                                                                 │`);
  lines.push(`│      ██████╗██╗      █████╗ ██████╗  █████╗                     │`);
  lines.push(`│     ██╔════╝██║     ██╔══██╗██╔══██╗██╔══██╗                    │`);
  lines.push(`│     ██║     ██║     ███████║██████╔╝███████║                    │`);
  lines.push(`│     ██║     ██║     ██╔══██║██╔══██╗██╔══██║                    │`);
  lines.push(`│     ╚██████╗███████╗██║  ██║██║  ██║██║  ██║                    │`);
  lines.push(`│      ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝                    │`);
  lines.push(`│                                                                 │`);
  lines.push(`│              Your AI-powered DeFi companion                     │`);
  lines.push(`│                                                                 │`);
  lines.push(`├─────────────────────────────────────────────────────────────────┤`);

  // Wallet address
  if (dashboard.wallet) {
    lines.push(`│  WALLET                                                         │`);
    lines.push(`│  ${dashboard.wallet.shortAddress.padEnd(61)}│`);
    lines.push(`├─────────────────────────────────────────────────────────────────┤`);
  }

  // Total balance
  if (dashboard.portfolio) {
    lines.push(`│                                                                 │`);
    lines.push(`│  💰 TOTAL BALANCE                                               │`);
    const balanceStr = `$${dashboard.portfolio.totalValueUsd}`;
    const padding = Math.floor((55 - balanceStr.length) / 2);
    lines.push(`│  ┌───────────────────────────────────────────────────────────┐  │`);
    lines.push(`│  │${' '.repeat(padding)}${balanceStr}${' '.repeat(55 - padding - balanceStr.length)}│  │`);
    lines.push(`│  └───────────────────────────────────────────────────────────┘  │`);
    lines.push(`│                                                                 │`);
  }

  // Yield positions
  if (dashboard.yieldPositions && dashboard.yieldPositions.positions.length > 0) {
    lines.push(`├─────────────────────────────────────────────────────────────────┤`);
    lines.push(`│                                                                 │`);
    lines.push(`│  🌾 YIELD POSITIONS                                             │`);
    lines.push(`│  ┌─────────────┬──────────────┬─────────────┬────────────────┐  │`);
    lines.push(`│  │ Protocol    │ Asset        │ Deposited   │ APY            │  │`);
    lines.push(`│  ├─────────────┼──────────────┼─────────────┼────────────────┤  │`);

    for (const pos of dashboard.yieldPositions.positions.slice(0, 5)) {
      const protocol = pos.protocol.slice(0, 11).padEnd(11);
      const asset = `${pos.asset} (${pos.chain.slice(0, 4)})`.slice(0, 12).padEnd(12);
      const deposited = `$${pos.valueUsd}`.slice(0, 11).padEnd(11);
      const apy = `${pos.apy.toFixed(2)}%`.padEnd(14);
      lines.push(`│  │ ${protocol} │ ${asset} │ ${deposited} │ ${apy} │  │`);
    }

    lines.push(`│  └─────────────┴──────────────┴─────────────┴────────────────┘  │`);
    lines.push(`│  Total: $${dashboard.yieldPositions.totalValueUsd} @ ${dashboard.yieldPositions.weightedApy.toFixed(2)}% APY | Earned: +$${dashboard.yieldPositions.lifetimeEarnings}`.slice(0, 63).padEnd(63) + `│`);
    lines.push(`│                                                                 │`);
  }

  lines.push(`└─────────────────────────────────────────────────────────────────┘`);

  return lines.join('\n');
}

// ============================================================================
// Gas Management - Auto-swap for Gas
// ============================================================================

/**
 * Gas check result
 * Returns whether the user has enough gas and what steps are needed
 */
export interface GasCheckResult {
  /** Does user have enough native token for gas? */
  hasEnoughGas: boolean;
  /** Native token balance in human units (e.g., "0.01") */
  nativeBalance: string;
  /** Native token symbol (ETH, MATIC) */
  nativeSymbol: string;
  /** Estimated gas cost in native units */
  estimatedGasCost: string;
  /** Estimated gas cost in USD */
  estimatedGasUsd: string;
  /** If gas insufficient, suggested swap details */
  suggestedSwap?: {
    fromToken: string;
    fromAmount: string;
    fromAmountUsd: string;
    toAmount: string; // Native token amount
    swapQuote?: SwapQuote;
  };
  /** Tokens available for gas swap (with balances) */
  availableForSwap?: Array<{
    symbol: string;
    balance: string;
    balanceUsd: string;
  }>;
}

/**
 * Gas plan for a transaction (or batch of transactions)
 * Includes any necessary pre-swap for gas
 */
export interface GasPlan {
  /** Original transaction(s) to execute */
  transactions: Array<{
    description: string;
    to: string;
    data?: string;
    value?: string;
    estimatedGas: string;
  }>;
  /** Pre-swap transaction if needed for gas */
  gasSwap?: {
    quote: SwapQuote;
    fromToken: string;
    fromAmount: string;
    toAmount: string;
    description: string;
  };
  /** Total gas cost estimate (in native + USD) */
  totalGasCost: {
    native: string;
    symbol: string;
    usd: string;
  };
  /** Net cost deducted from user's token balance (for gas swap) */
  netTokenCost?: {
    token: string;
    amount: string;
    usd: string;
  };
  /** Summary message for the user */
  summary: string;
}

// Preferred tokens to swap from for gas (in order of preference)
const GAS_SWAP_PRIORITY = ["USDC", "USDT", "DAI", "WETH"];

// Minimum gas buffer - add 30% to estimated gas cost
const GAS_BUFFER_PERCENT = 30;

/**
 * Get native token balance for a chain
 */
export async function getNativeBalance(chain: SupportedChain): Promise<{
  balance: string;
  balanceRaw: bigint;
  symbol: string;
}> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  if (chain === "solana") {
    // Handle Solana separately
    const balances = await getBalances("solana");
    return {
      balance: balances[0]?.balance || "0",
      balanceRaw: BigInt(Math.floor(parseFloat(balances[0]?.balance || "0") * 1e9)),
      symbol: "SOL",
    };
  }

  const config = CHAIN_CONFIG[chain];
  const symbol = chain === "polygon" ? "MATIC" : "ETH";

  try {
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

    const data = (await response.json()) as { result?: string };
    const balanceRaw = BigInt(data.result || "0");
    const balance = (Number(balanceRaw) / 1e18).toFixed(6);

    return { balance, balanceRaw, symbol };
  } catch (error) {
    console.error(`[clara] Error getting native balance on ${chain}:`, error);
    return { balance: "0", balanceRaw: 0n, symbol };
  }
}

/**
 * Get current gas price for a chain
 * Returns gas price in wei and gwei
 */
export async function getGasPrice(chain: SupportedChain): Promise<{
  gasPriceWei: bigint;
  gasPriceGwei: number;
}> {
  if (chain === "solana") {
    // Solana uses different fee model
    return { gasPriceWei: 5000n, gasPriceGwei: 0 };
  }

  const config = CHAIN_CONFIG[chain];

  try {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_gasPrice",
        params: [],
        id: 1,
      }),
    });

    const data = (await response.json()) as { result?: string };
    const gasPriceWei = BigInt(data.result || "1000000000"); // Default 1 gwei
    const gasPriceGwei = Number(gasPriceWei) / 1e9;

    return { gasPriceWei, gasPriceGwei };
  } catch (error) {
    console.error(`[clara] Error getting gas price on ${chain}:`, error);
    // Default fallback: 30 gwei
    return { gasPriceWei: 30000000000n, gasPriceGwei: 30 };
  }
}

/**
 * Check if user has enough gas for a transaction
 * If not, returns details about which tokens can be swapped for gas
 */
export async function checkGasForTransaction(
  chain: SupportedChain,
  estimatedGasUnits: bigint | number = 100000n
): Promise<GasCheckResult> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Get native balance and gas price
  const [nativeBalanceResult, gasPriceResult] = await Promise.all([
    getNativeBalance(chain),
    getGasPrice(chain),
  ]);

  const { balance: nativeBalance, balanceRaw, symbol: nativeSymbol } = nativeBalanceResult;
  const { gasPriceWei } = gasPriceResult;

  // Calculate estimated gas cost with buffer
  const gasUnits = typeof estimatedGasUnits === 'number' ? BigInt(estimatedGasUnits) : estimatedGasUnits;
  const baseCost = gasUnits * gasPriceWei;
  const bufferedCost = (baseCost * BigInt(100 + GAS_BUFFER_PERCENT)) / 100n;

  const estimatedGasCost = (Number(bufferedCost) / 1e18).toFixed(6);

  // Get ETH price for USD conversion
  const prices = await fetchPrices();
  const ethPrice = prices["ethereum"]?.usd || 3000;
  const estimatedGasUsd = (Number(bufferedCost) / 1e18 * ethPrice).toFixed(2);

  // Check if user has enough
  const hasEnoughGas = balanceRaw >= bufferedCost;

  if (hasEnoughGas) {
    return {
      hasEnoughGas: true,
      nativeBalance,
      nativeSymbol,
      estimatedGasCost,
      estimatedGasUsd,
    };
  }

  // User doesn't have enough gas - find tokens to swap
  console.error(`[clara] Insufficient gas on ${chain}. Need ${estimatedGasCost} ${nativeSymbol}, have ${nativeBalance}`);

  // Check balances of preferred tokens
  const availableForSwap: GasCheckResult["availableForSwap"] = [];

  for (const tokenSymbol of GAS_SWAP_PRIORITY) {
    const tokenInfo = POPULAR_TOKENS[tokenSymbol]?.[chain];
    if (!tokenInfo) continue;

    try {
      const tokenBalance = await getTokenBalance(tokenInfo.address, chain);
      const balanceNum = parseFloat(tokenBalance.balance);

      if (balanceNum > 0) {
        // Get USD value (stablecoins ~$1, WETH ~ethPrice)
        const priceUsd = STABLE_TOKENS.has(tokenSymbol) ? 1 : ethPrice;
        const balanceUsd = (balanceNum * priceUsd).toFixed(2);

        availableForSwap.push({
          symbol: tokenSymbol,
          balance: tokenBalance.balance,
          balanceUsd,
        });
      }
    } catch (error) {
      console.error(`[clara] Error checking ${tokenSymbol} balance:`, error);
    }
  }

  // Calculate how much gas is needed (what we're short)
  const shortfall = bufferedCost - balanceRaw;
  const shortfallNative = (Number(shortfall) / 1e18).toFixed(6);
  const shortfallUsd = (Number(shortfall) / 1e18 * ethPrice).toFixed(2);

  // Find best token to swap from
  let suggestedSwap: GasCheckResult["suggestedSwap"] | undefined;

  if (availableForSwap.length > 0) {
    // Pick first available token with sufficient balance
    for (const token of availableForSwap) {
      const tokenBalanceUsd = parseFloat(token.balanceUsd);
      const neededUsd = parseFloat(shortfallUsd) * 1.1; // Add 10% buffer for slippage

      if (tokenBalanceUsd >= neededUsd) {
        // Calculate amount to swap
        const priceUsd = STABLE_TOKENS.has(token.symbol) ? 1 : ethPrice;
        const fromAmount = (neededUsd / priceUsd).toFixed(token.symbol === "WETH" ? 6 : 2);

        suggestedSwap = {
          fromToken: token.symbol,
          fromAmount,
          fromAmountUsd: neededUsd.toFixed(2),
          toAmount: shortfallNative,
        };

        // Try to get an actual quote
        try {
          const quote = await getSwapQuote(token.symbol, "ETH", fromAmount, chain);
          suggestedSwap.swapQuote = quote;
          suggestedSwap.toAmount = quote.toAmount;
        } catch (error) {
          console.error(`[clara] Could not get swap quote:`, error);
        }

        break;
      }
    }
  }

  return {
    hasEnoughGas: false,
    nativeBalance,
    nativeSymbol,
    estimatedGasCost,
    estimatedGasUsd,
    suggestedSwap,
    availableForSwap,
  };
}

/**
 * Create a gas plan for a transaction
 * Automatically includes swap-for-gas step if needed
 */
export async function createGasPlan(
  chain: SupportedChain,
  transactions: Array<{
    description: string;
    to: string;
    data?: string;
    value?: string;
  }>
): Promise<GasPlan> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  // Estimate gas for all transactions
  let totalGasUnits = 0n;
  const txsWithGas: GasPlan["transactions"] = [];

  for (const tx of transactions) {
    const gasEstimate = await estimateGas(
      { to: tx.to, data: tx.data, value: tx.value },
      chain
    );

    const gasUnits = BigInt(gasEstimate.gasLimit);
    totalGasUnits += gasUnits;

    txsWithGas.push({
      ...tx,
      estimatedGas: gasEstimate.gasLimit,
    });
  }

  // Check if user has enough gas
  const gasCheck = await checkGasForTransaction(chain, totalGasUnits);

  // Get native token symbol
  const nativeSymbol = chain === "polygon" ? "MATIC" : "ETH";

  // Build the plan
  const plan: GasPlan = {
    transactions: txsWithGas,
    totalGasCost: {
      native: gasCheck.estimatedGasCost,
      symbol: nativeSymbol,
      usd: gasCheck.estimatedGasUsd,
    },
    summary: "",
  };

  if (gasCheck.hasEnoughGas) {
    plan.summary = `Ready to execute ${transactions.length} transaction(s). Gas: ~$${gasCheck.estimatedGasUsd}`;
  } else if (gasCheck.suggestedSwap?.swapQuote) {
    // Need to swap for gas first
    plan.gasSwap = {
      quote: gasCheck.suggestedSwap.swapQuote,
      fromToken: gasCheck.suggestedSwap.fromToken,
      fromAmount: gasCheck.suggestedSwap.fromAmount,
      toAmount: gasCheck.suggestedSwap.toAmount,
      description: `Swap ${gasCheck.suggestedSwap.fromAmount} ${gasCheck.suggestedSwap.fromToken} → ${gasCheck.suggestedSwap.toAmount} ${nativeSymbol} for gas`,
    };

    plan.netTokenCost = {
      token: gasCheck.suggestedSwap.fromToken,
      amount: gasCheck.suggestedSwap.fromAmount,
      usd: gasCheck.suggestedSwap.fromAmountUsd,
    };

    plan.summary = `Insufficient ${nativeSymbol} for gas. Will swap ~$${gasCheck.suggestedSwap.fromAmountUsd} of ${gasCheck.suggestedSwap.fromToken} to cover gas costs.`;
  } else {
    // No tokens available to swap
    const availableTokens = gasCheck.availableForSwap?.map(t => t.symbol).join(", ") || "none";
    plan.summary = `Insufficient ${nativeSymbol} for gas. Available tokens to swap: ${availableTokens}. Please add more funds.`;
  }

  return plan;
}

/**
 * Execute a gas plan (including any necessary swap-for-gas)
 * Returns transaction hashes for all executed transactions
 */
export async function executeGasPlan(
  plan: GasPlan,
  chain: SupportedChain
): Promise<Array<{ description: string; txHash: string; status: string }>> {
  const results: Array<{ description: string; txHash: string; status: string }> = [];

  // Step 1: Execute gas swap if needed
  if (plan.gasSwap && plan.gasSwap.quote) {
    console.error(`[clara] Executing gas swap: ${plan.gasSwap.description}`);

    try {
      const swapResult = await executeSwap(plan.gasSwap.quote, chain);
      results.push({
        description: plan.gasSwap.description,
        txHash: swapResult.txHash,
        status: "completed",
      });

      // Wait a moment for the swap to settle
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`[clara] Gas swap failed:`, error);
      results.push({
        description: plan.gasSwap.description,
        txHash: "",
        status: "failed",
      });
      throw new Error(`Gas swap failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Step 2: Execute main transactions
  for (const tx of plan.transactions) {
    console.error(`[clara] Executing: ${tx.description}`);

    try {
      const txResult = await sendTransaction(
        tx.to,
        tx.value || "0",
        chain,
        undefined,
        tx.data
      );

      results.push({
        description: tx.description,
        txHash: txResult.txHash,
        status: "pending",
      });
    } catch (error) {
      console.error(`[clara] Transaction failed:`, error);
      results.push({
        description: tx.description,
        txHash: "",
        status: "failed",
      });
    }
  }

  return results;
}

/**
 * Quick helper: Ensure gas is available for a simple transaction
 * Returns true if ready, or details about what's needed
 */
export async function ensureGas(
  chain: SupportedChain,
  estimatedGasUnits: number = 100000
): Promise<{ ready: boolean; message: string; swapNeeded?: SwapQuote }> {
  const gasCheck = await checkGasForTransaction(chain, BigInt(estimatedGasUnits));

  if (gasCheck.hasEnoughGas) {
    return { ready: true, message: "Gas available" };
  }

  if (gasCheck.suggestedSwap?.swapQuote) {
    return {
      ready: false,
      message: `Need to swap ${gasCheck.suggestedSwap.fromAmount} ${gasCheck.suggestedSwap.fromToken} for gas`,
      swapNeeded: gasCheck.suggestedSwap.swapQuote,
    };
  }

  return {
    ready: false,
    message: `Insufficient gas and no tokens available to swap. Add ${gasCheck.nativeSymbol} or stablecoins.`,
  };
}

// Re-export Solana module for direct access
export {
  getSolanaAssets,
  getSolanaTransactions,
  isHeliusAvailable,
  type SolanaBalance,
  type SolanaPortfolio,
  type SolanaTransaction,
} from "./solana.js";
