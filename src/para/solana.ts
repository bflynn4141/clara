/**
 * Solana Client - Helius DAS API Integration
 *
 * Uses Helius Digital Asset Standard (DAS) API for:
 * - All token balances (SOL + SPL) in one call
 * - USD prices for each token
 * - NFT holdings
 * - Transaction history
 *
 * Why Helius DAS API?
 * - Single call replaces multiple RPC requests
 * - Includes USD prices (no need for separate price API)
 * - Returns fungible tokens, NFTs, and native SOL together
 * - Better rate limits than public Solana RPC
 */

import { getSession } from "../storage/session.js";

// Types for Helius DAS API responses
export interface HeliusToken {
  interface: "FungibleToken" | "FungibleAsset" | "ProgrammableNFT" | "V1_NFT" | "V2_NFT";
  id: string; // Mint address
  content: {
    metadata: {
      name: string;
      symbol: string;
    };
    links?: {
      image?: string;
    };
  };
  token_info?: {
    balance: number;
    decimals: number;
    price_info?: {
      price_per_token: number;
      currency: string;
    };
  };
  ownership: {
    owner: string;
  };
}

export interface HeliusAssetResponse {
  jsonrpc: "2.0";
  result: {
    total: number;
    limit: number;
    page: number;
    items: HeliusToken[];
    nativeBalance?: {
      lamports: number;
      price_per_sol: number;
      total_price: number;
    };
  };
  id: string;
}

export interface SolanaBalance {
  symbol: string;
  name: string;
  balance: string;
  rawBalance: number;
  decimals: number;
  mintAddress: string;
  priceUsd: number | null;
  valueUsd: number | null;
  type: "native" | "spl" | "nft";
  imageUrl?: string;
}

export interface SolanaPortfolio {
  address: string;
  totalValueUsd: number;
  nativeBalance: SolanaBalance;
  tokens: SolanaBalance[];
  nfts: SolanaBalance[];
}

// Helius API configuration
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : null;

// Fallback to public Solana RPC for basic operations
const PUBLIC_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/**
 * Check if Helius API is available
 */
export function isHeliusAvailable(): boolean {
  return !!HELIUS_API_KEY;
}

/**
 * Get Solana address from session
 */
export async function getSolanaAddress(): Promise<string | null> {
  const session = await getSession();
  return session?.solanaAddress || null;
}

/**
 * Get all Solana assets using Helius DAS API
 *
 * This single call returns:
 * - Native SOL balance with USD price
 * - All SPL token balances with prices
 * - NFT holdings
 */
export async function getSolanaAssets(
  address?: string
): Promise<SolanaPortfolio> {
  const walletAddress = address || (await getSolanaAddress());
  if (!walletAddress) {
    throw new Error("No Solana wallet configured");
  }

  // If Helius is available, use DAS API for rich data
  if (isHeliusAvailable()) {
    return getSolanaAssetsHelius(walletAddress);
  }

  // Fallback to basic RPC
  return getSolanaAssetsBasic(walletAddress);
}

/**
 * Get assets via Helius DAS API
 */
async function getSolanaAssetsHelius(address: string): Promise<SolanaPortfolio> {
  console.error("[clara] Fetching Solana assets via Helius DAS API...");

  const response = await fetch(HELIUS_RPC_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clara-portfolio",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: address,
        page: 1,
        limit: 100,
        displayOptions: {
          showFungible: true,
          showNativeBalance: true,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as HeliusAssetResponse;

  if (!data.result) {
    throw new Error("Invalid response from Helius API");
  }

  // Parse native SOL balance
  const nativeBal = data.result.nativeBalance;
  const solBalance = nativeBal ? nativeBal.lamports / 1e9 : 0;
  const solPrice = nativeBal?.price_per_sol || null;
  const solValue = nativeBal?.total_price || null;

  const nativeBalance: SolanaBalance = {
    symbol: "SOL",
    name: "Solana",
    balance: solBalance.toFixed(6),
    rawBalance: solBalance,
    decimals: 9,
    mintAddress: "So11111111111111111111111111111111111111112", // Wrapped SOL mint
    priceUsd: solPrice,
    valueUsd: solValue,
    type: "native",
  };

  // Parse SPL tokens and NFTs
  const tokens: SolanaBalance[] = [];
  const nfts: SolanaBalance[] = [];

  for (const item of data.result.items) {
    // Skip if no token info (might be compressed NFT without balance)
    if (!item.token_info && item.interface !== "V1_NFT" && item.interface !== "V2_NFT") {
      continue;
    }

    const isFungible = item.interface === "FungibleToken" || item.interface === "FungibleAsset";
    const isNft = item.interface.includes("NFT");

    if (isFungible && item.token_info) {
      const decimals = item.token_info.decimals || 0;
      const rawBalance = item.token_info.balance / Math.pow(10, decimals);
      const priceInfo = item.token_info.price_info;

      // Skip dust amounts (less than $0.01)
      const valueUsd = priceInfo ? rawBalance * priceInfo.price_per_token : null;
      if (valueUsd !== null && valueUsd < 0.01) continue;

      tokens.push({
        symbol: item.content.metadata.symbol || "UNKNOWN",
        name: item.content.metadata.name || "Unknown Token",
        balance: rawBalance.toFixed(decimals > 6 ? 6 : decimals),
        rawBalance,
        decimals,
        mintAddress: item.id,
        priceUsd: priceInfo?.price_per_token || null,
        valueUsd,
        type: "spl",
        imageUrl: item.content.links?.image,
      });
    } else if (isNft) {
      nfts.push({
        symbol: item.content.metadata.symbol || "NFT",
        name: item.content.metadata.name || "Unknown NFT",
        balance: "1",
        rawBalance: 1,
        decimals: 0,
        mintAddress: item.id,
        priceUsd: null,
        valueUsd: null,
        type: "nft",
        imageUrl: item.content.links?.image,
      });
    }
  }

  // Sort tokens by USD value (highest first)
  tokens.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));

  // Calculate total portfolio value
  const totalValueUsd =
    (solValue || 0) +
    tokens.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

  return {
    address,
    totalValueUsd,
    nativeBalance,
    tokens,
    nfts,
  };
}

/**
 * Fallback: Get basic SOL balance via public RPC
 * Used when Helius API key is not configured
 */
async function getSolanaAssetsBasic(address: string): Promise<SolanaPortfolio> {
  console.error("[clara] Fetching Solana balance via public RPC (no Helius key)...");

  const response = await fetch(PUBLIC_SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address],
    }),
  });

  const data = (await response.json()) as { result?: { value: number } };
  const lamports = data.result?.value || 0;
  const solBalance = lamports / 1e9;

  // Try to get SOL price from CoinGecko
  let solPrice: number | null = null;
  try {
    const priceRes = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    );
    const priceData = (await priceRes.json()) as { solana?: { usd: number } };
    solPrice = priceData.solana?.usd || null;
  } catch {
    console.error("[clara] Failed to fetch SOL price");
  }

  const solValue = solPrice ? solBalance * solPrice : null;

  const nativeBalance: SolanaBalance = {
    symbol: "SOL",
    name: "Solana",
    balance: solBalance.toFixed(6),
    rawBalance: solBalance,
    decimals: 9,
    mintAddress: "So11111111111111111111111111111111111111112",
    priceUsd: solPrice,
    valueUsd: solValue,
    type: "native",
  };

  return {
    address,
    totalValueUsd: solValue || 0,
    nativeBalance,
    tokens: [], // No SPL tokens without Helius
    nfts: [],
  };
}

/**
 * Get SPL token balance for a specific mint
 */
export async function getSplTokenBalance(
  mintAddress: string,
  walletAddress?: string
): Promise<SolanaBalance | null> {
  const address = walletAddress || (await getSolanaAddress());
  if (!address) {
    throw new Error("No Solana wallet configured");
  }

  // Get all assets and find the specific token
  const portfolio = await getSolanaAssets(address);

  // Check if it's SOL
  if (
    mintAddress.toLowerCase() === "sol" ||
    mintAddress === "So11111111111111111111111111111111111111112"
  ) {
    return portfolio.nativeBalance;
  }

  // Find in tokens
  return portfolio.tokens.find(
    (t) => t.mintAddress.toLowerCase() === mintAddress.toLowerCase()
  ) || null;
}

/**
 * Get Solana transaction history
 * Uses Helius enhanced transaction API for rich data
 */
export async function getSolanaTransactions(
  address?: string,
  limit = 20
): Promise<SolanaTransaction[]> {
  const walletAddress = address || (await getSolanaAddress());
  if (!walletAddress) {
    throw new Error("No Solana wallet configured");
  }

  if (!isHeliusAvailable()) {
    console.error("[clara] Helius API key required for transaction history");
    return [];
  }

  console.error("[clara] Fetching Solana transactions via Helius...");

  // Use Helius parsed transaction history API
  const response = await fetch(
    `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error(`Helius API error: ${response.status}`);
  }

  const data = await response.json();
  return parseHeliusTransactions(data, walletAddress);
}

export interface SolanaTransaction {
  signature: string;
  type: string;
  description: string;
  timestamp: number;
  fee: number;
  feePayer: string;
  success: boolean;
  tokenTransfers: Array<{
    fromAddress: string;
    toAddress: string;
    tokenMint: string;
    tokenSymbol: string;
    amount: number;
  }>;
  nativeTransfers: Array<{
    fromAddress: string;
    toAddress: string;
    amount: number; // in SOL
  }>;
}

/**
 * Parse Helius enhanced transaction format
 */
function parseHeliusTransactions(data: any[], walletAddress: string): SolanaTransaction[] {
  return data.map((tx) => {
    const isIncoming = tx.nativeTransfers?.some(
      (t: any) => t.toUserAccount === walletAddress
    );

    return {
      signature: tx.signature,
      type: tx.type || "UNKNOWN",
      description: tx.description || formatTxType(tx.type, isIncoming),
      timestamp: tx.timestamp,
      fee: (tx.fee || 0) / 1e9, // Convert lamports to SOL
      feePayer: tx.feePayer,
      success: tx.transactionError === null,
      tokenTransfers:
        tx.tokenTransfers?.map((t: any) => ({
          fromAddress: t.fromUserAccount,
          toAddress: t.toUserAccount,
          tokenMint: t.mint,
          tokenSymbol: t.tokenStandard === "Fungible" ? "SPL" : "NFT",
          amount: t.tokenAmount,
        })) || [],
      nativeTransfers:
        tx.nativeTransfers?.map((t: any) => ({
          fromAddress: t.fromUserAccount,
          toAddress: t.toUserAccount,
          amount: t.amount / 1e9, // Convert lamports to SOL
        })) || [],
    };
  });
}

function formatTxType(type: string, isIncoming: boolean): string {
  const typeMap: Record<string, string> = {
    TRANSFER: isIncoming ? "Received" : "Sent",
    SWAP: "Swapped",
    NFT_SALE: "NFT Sale",
    NFT_MINT: "Minted NFT",
    STAKE: "Staked",
    UNSTAKE: "Unstaked",
    UNKNOWN: "Transaction",
  };
  return typeMap[type] || type;
}

/**
 * Lookup known SPL token info by symbol
 */
export const KNOWN_SPL_TOKENS: Record<string, { mint: string; decimals: number; name: string }> = {
  USDC: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    name: "USD Coin",
  },
  USDT: {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    name: "Tether USD",
  },
  SOL: {
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    name: "Wrapped SOL",
  },
  BONK: {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    name: "Bonk",
  },
  JUP: {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    name: "Jupiter",
  },
  WIF: {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    decimals: 6,
    name: "dogwifhat",
  },
  PYTH: {
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    decimals: 6,
    name: "Pyth Network",
  },
  RAY: {
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    decimals: 6,
    name: "Raydium",
  },
};

/**
 * Resolve token symbol to mint address
 */
export function resolveTokenMint(symbolOrMint: string): string {
  // If it looks like a mint address, return as-is
  if (symbolOrMint.length > 20) {
    return symbolOrMint;
  }

  const upper = symbolOrMint.toUpperCase();
  const known = KNOWN_SPL_TOKENS[upper];
  if (known) {
    return known.mint;
  }

  throw new Error(
    `Unknown token symbol: ${symbolOrMint}. Please provide the mint address directly.`
  );
}
