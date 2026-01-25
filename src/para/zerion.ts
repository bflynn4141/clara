/**
 * Zerion API Client
 *
 * Uses Zerion's Wallet API for:
 * - Transaction history (decoded, across chains)
 * - Token positions (all balances in one call)
 * - Portfolio values (aggregated USD values)
 *
 * Free tier: 2,000 requests/day, 10 RPS
 * Docs: https://developers.zerion.io/reference
 */

import type { SupportedChain } from "./client.js";

// Zerion API base URL
const ZERION_API_BASE = "https://api.zerion.io/v1";

// API key from environment (optional - enables richer transaction data)
// Free tier: 3,000 requests/day, 2 RPS, no credit card required
const ZERION_API_KEY = process.env.ZERION_API_KEY || "";

/**
 * Check if Zerion API is available (has API key configured)
 */
export function isZerionAvailable(): boolean {
  return !!ZERION_API_KEY;
}

// Chain ID mapping (Zerion uses chain names)
const CHAIN_TO_ZERION: Record<SupportedChain, string> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  solana: "solana", // Note: Zerion has limited Solana support
};

// Explorer URLs for linking
const EXPLORER_URLS: Record<SupportedChain, string> = {
  ethereum: "https://etherscan.io",
  base: "https://basescan.org",
  arbitrum: "https://arbiscan.io",
  optimism: "https://optimistic.etherscan.io",
  polygon: "https://polygonscan.com",
  solana: "https://solscan.io",
};

/**
 * Make authenticated request to Zerion API
 */
async function zerionFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${ZERION_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };

  // Add API key if available (Basic auth with empty password)
  if (ZERION_API_KEY) {
    headers["Authorization"] = `Basic ${Buffer.from(ZERION_API_KEY + ":").toString("base64")}`;
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zerion API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// ============================================
// Transaction History Types
// ============================================

interface ZerionTransaction {
  id: string;
  type: "transaction";
  attributes: {
    operation_type: "trade" | "send" | "receive" | "approve" | "mint" | "burn" | "deploy" | "execute" | "stake" | "unstake" | "borrow" | "repay" | "deposit" | "withdraw";
    hash: string;
    mined_at_block: number;
    mined_at: string; // ISO timestamp
    sent_from: string;
    sent_to: string;
    status: "confirmed" | "pending" | "failed";
    nonce: number;
    fee: {
      fungible_info?: {
        symbol: string;
      };
      quantity: {
        float: number;
      };
      price: number;
    };
    transfers: Array<{
      direction: "in" | "out" | "self";
      fungible_info?: {
        symbol: string;
        name: string;
        icon?: { url: string };
        implementations: Array<{
          chain_id: string;
          address: string;
          decimals: number;
        }>;
      };
      nft_info?: {
        name: string;
        content?: { preview?: { url: string } };
      };
      quantity: {
        float: number;
        numeric: string;
      };
      value: number | null;
      price: number | null;
    }>;
    approvals: Array<{
      fungible_info?: {
        symbol: string;
        name: string;
      };
      quantity: {
        float: number;
        numeric: string;
      } | "unlimited";
      sender: string;
      spender: string;
    }>;
  };
  relationships: {
    chain: {
      data: {
        id: string; // e.g., "base", "ethereum"
      };
    };
    dapp?: {
      data?: {
        id: string;
      };
    };
  };
}

interface ZerionTransactionsResponse {
  links: {
    self: string;
    next?: string;
  };
  data: ZerionTransaction[];
}

// ============================================
// Transformed Transaction Types (for Clara)
// ============================================

export interface TransactionHistoryItem {
  hash: string;
  chain: string;
  from: string;
  to: string;
  timestamp: number;
  date: string;
  action: string;
  actionType: ZerionTransaction["attributes"]["operation_type"];
  status: "success" | "failed" | "pending";

  // Native currency (ETH, etc.)
  valueEth: number;

  // Token transfers
  transfers: Array<{
    direction: "in" | "out" | "self";
    symbol: string;
    name: string;
    amount: number;
    usdValue: number | null;
    isNft: boolean;
  }>;

  // Approvals
  approvals: Array<{
    symbol: string;
    spender: string;
    amount: number | "unlimited";
  }>;

  // Gas
  gasUsedEth: number;
  gasUsedUsd: number;

  // Links
  explorerUrl: string;
  dappName?: string;
}

export interface TransactionHistory {
  transactions: TransactionHistoryItem[];
  address: string;
  chain: string;
  hasMore: boolean;
  nextCursor?: string;
}

// ============================================
// Get Transaction History
// ============================================

/**
 * Fetch transaction history using Zerion API
 *
 * Benefits over block explorer APIs:
 * - Pre-decoded operation types (swap, send, approve, etc.)
 * - Token transfer amounts and USD values
 * - Cross-chain support in one API
 * - Reliable uptime (no API key required for basic tier)
 */
export async function getTransactionHistoryZerion(
  address: string,
  chain: SupportedChain,
  options: {
    limit?: number;
    cursor?: string;
  } = {}
): Promise<TransactionHistory> {
  const { limit = 20, cursor } = options;
  const zerionChain = CHAIN_TO_ZERION[chain];

  if (!zerionChain) {
    throw new Error(`Chain ${chain} not supported by Zerion`);
  }

  console.error(`[zerion] Fetching transactions for ${address} on ${chain}`);

  const params: Record<string, string> = {
    "filter[chain_ids]": zerionChain,
    "page[size]": Math.min(limit, 100).toString(),
  };

  if (cursor) {
    params["page[after]"] = cursor;
  }

  const response = await zerionFetch<ZerionTransactionsResponse>(
    `/wallets/${address}/transactions`,
    params
  );

  const transactions: TransactionHistoryItem[] = response.data.map((tx) => {
    const attrs = tx.attributes;
    const timestamp = new Date(attrs.mined_at).getTime();

    // Calculate native ETH value from transfers
    const nativeTransfer = attrs.transfers.find(
      (t) => !t.fungible_info?.implementations?.length && t.fungible_info?.symbol
    );
    const valueEth = nativeTransfer?.quantity.float || 0;

    // Build action string
    let action = formatOperationType(attrs.operation_type);
    if (attrs.transfers.length > 0) {
      const mainTransfer = attrs.transfers[0];
      if (mainTransfer.direction === "in") {
        action = `Receive ${mainTransfer.fungible_info?.symbol || mainTransfer.nft_info?.name || "token"}`;
      } else if (mainTransfer.direction === "out") {
        action = `Send ${mainTransfer.fungible_info?.symbol || mainTransfer.nft_info?.name || "token"}`;
      }
      if (attrs.operation_type === "trade" && attrs.transfers.length >= 2) {
        const outToken = attrs.transfers.find((t) => t.direction === "out");
        const inToken = attrs.transfers.find((t) => t.direction === "in");
        if (outToken && inToken) {
          action = `Swap ${outToken.fungible_info?.symbol} → ${inToken.fungible_info?.symbol}`;
        }
      }
    }

    // Transform transfers
    const transfers = attrs.transfers.map((t) => ({
      direction: t.direction,
      symbol: t.fungible_info?.symbol || t.nft_info?.name || "Unknown",
      name: t.fungible_info?.name || t.nft_info?.name || "Unknown",
      amount: t.quantity.float,
      usdValue: t.value,
      isNft: !!t.nft_info,
    }));

    // Transform approvals
    const approvals = attrs.approvals.map((a) => ({
      symbol: a.fungible_info?.symbol || "Unknown",
      spender: a.spender,
      amount: a.quantity === "unlimited" ? ("unlimited" as const) : a.quantity.float,
    }));

    // Build explorer URL
    const explorerUrl = `${EXPLORER_URLS[chain]}/tx/${attrs.hash}`;

    return {
      hash: attrs.hash,
      chain: tx.relationships.chain.data.id,
      from: attrs.sent_from,
      to: attrs.sent_to,
      timestamp,
      date: new Date(timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      action,
      actionType: attrs.operation_type,
      status: attrs.status === "confirmed" ? "success" : attrs.status === "failed" ? "failed" : "pending",
      valueEth,
      transfers,
      approvals,
      gasUsedEth: attrs.fee?.quantity.float || 0,
      gasUsedUsd: (attrs.fee?.quantity.float || 0) * (attrs.fee?.price || 0),
      explorerUrl,
      dappName: tx.relationships.dapp?.data?.id,
    };
  });

  // Extract cursor for pagination
  const nextCursor = response.links.next
    ? new URL(response.links.next).searchParams.get("page[after]") || undefined
    : undefined;

  return {
    transactions,
    address,
    chain,
    hasMore: !!response.links.next,
    nextCursor,
  };
}

/**
 * Format operation type to human-readable action
 */
function formatOperationType(type: ZerionTransaction["attributes"]["operation_type"]): string {
  const labels: Record<typeof type, string> = {
    trade: "Swap",
    send: "Send",
    receive: "Receive",
    approve: "Approve",
    mint: "Mint",
    burn: "Burn",
    deploy: "Deploy Contract",
    execute: "Contract Call",
    stake: "Stake",
    unstake: "Unstake",
    borrow: "Borrow",
    repay: "Repay",
    deposit: "Deposit",
    withdraw: "Withdraw",
  };
  return labels[type] || type;
}

// ============================================
// Format Transaction for Display
// ============================================

// ============================================
// Portfolio Positions Types
// ============================================

interface ZerionPosition {
  type: "positions";
  id: string;
  attributes: {
    parent: null | string;
    protocol: null | string;
    name: string;
    position_type: "wallet" | "staked" | "deposit" | "locked" | "reward";
    quantity: {
      int: string;
      decimals: number;
      float: number;
      numeric: string;
    };
    value: number | null; // USD value
    price: number; // Price per token in USD
    changes: {
      absolute_1d: number | null;
      percent_1d: number | null;
    } | null;
    fungible_info: {
      name: string;
      symbol: string;
      icon: { url: string } | null;
      flags: {
        verified: boolean;
      };
      implementations: Array<{
        chain_id: string;
        address: string | null; // null for native tokens
        decimals: number;
      }>;
    };
  };
  relationships: {
    chain: {
      data: {
        type: "chains";
        id: string; // e.g., "base", "ethereum"
      };
    };
    fungible: {
      data: {
        type: "fungibles";
        id: string;
      };
    };
  };
}

interface ZerionPositionsResponse {
  links: {
    self: string;
    next?: string;
  };
  data: ZerionPosition[];
}

// ============================================
// Portfolio Position Types (for Clara)
// ============================================

export interface PortfolioPosition {
  chain: string;
  symbol: string;
  name: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  change24h: number | null;
  changePercent24h: number | null;
  contractAddress: string | null; // null for native tokens
  isVerified: boolean;
  positionType: "wallet" | "staked" | "deposit" | "locked" | "reward";
  protocol: string | null;
}

export interface ZerionPortfolio {
  positions: PortfolioPosition[];
  totalValueUsd: number;
  totalChange24hUsd: number | null;
  totalChangePercent24h: number | null;
  lastUpdated: string;
  source: "zerion";
}

// ============================================
// Get Portfolio Positions (All Chains, One Call!)
// ============================================

/**
 * Fetch all token positions across all EVM chains in ONE API call
 *
 * This is the key optimization - replaces 5+ RPC calls with 1 Zerion call
 *
 * @param address - Wallet address
 * @param options - Filter options
 * @returns Portfolio with all positions across all chains
 */
export async function getPortfolioZerion(
  address: string,
  options: {
    includeStaked?: boolean; // Include staked/deposited positions (default: true)
    minValueUsd?: number;    // Filter out dust (default: 0.01)
  } = {}
): Promise<ZerionPortfolio> {
  const { includeStaked = true, minValueUsd = 0.01 } = options;

  if (!ZERION_API_KEY) {
    throw new Error("Zerion API key not configured");
  }

  console.error(`[zerion] Fetching portfolio for ${address.slice(0, 8)}...`);

  const params: Record<string, string> = {
    "currency": "usd",
    "filter[positions]": includeStaked ? "no_filter" : "only_simple",
    "filter[trash]": "only_non_trash", // Filter out spam tokens
    "sort": "value", // Sort by USD value descending
  };

  const response = await zerionFetch<ZerionPositionsResponse>(
    `/wallets/${address}/positions`,
    params
  );

  // Transform to our format
  const positions: PortfolioPosition[] = [];
  let totalValueUsd = 0;
  let totalChange24hUsd = 0;
  let hasChangeData = false;

  for (const pos of response.data) {
    const attrs = pos.attributes;
    const valueUsd = attrs.value ?? 0;

    // Skip dust
    if (valueUsd < minValueUsd && valueUsd > 0) {
      continue;
    }

    // Get contract address for this chain
    const chainId = pos.relationships.chain.data.id;
    const impl = attrs.fungible_info.implementations.find(
      i => i.chain_id === chainId
    );

    const position: PortfolioPosition = {
      chain: chainId,
      symbol: attrs.fungible_info.symbol,
      name: attrs.fungible_info.name,
      balance: attrs.quantity.float.toString(),
      balanceRaw: attrs.quantity.numeric,
      decimals: attrs.quantity.decimals,
      priceUsd: attrs.price > 0 ? attrs.price : null,
      valueUsd: valueUsd > 0 ? valueUsd : null,
      change24h: attrs.changes?.absolute_1d ?? null,
      changePercent24h: attrs.changes?.percent_1d ?? null,
      contractAddress: impl?.address ?? null,
      isVerified: attrs.fungible_info.flags.verified,
      positionType: attrs.position_type,
      protocol: attrs.protocol,
    };

    positions.push(position);
    totalValueUsd += valueUsd;

    if (attrs.changes?.absolute_1d !== null) {
      totalChange24hUsd += attrs.changes?.absolute_1d ?? 0;
      hasChangeData = true;
    }
  }

  // Calculate percent change
  const totalChangePercent24h = hasChangeData && totalValueUsd > 0
    ? (totalChange24hUsd / (totalValueUsd - totalChange24hUsd)) * 100
    : null;

  console.error(`[zerion] Found ${positions.length} positions, total $${totalValueUsd.toFixed(2)}`);

  return {
    positions,
    totalValueUsd,
    totalChange24hUsd: hasChangeData ? totalChange24hUsd : null,
    totalChangePercent24h,
    lastUpdated: new Date().toISOString(),
    source: "zerion",
  };
}

// ============================================
// Format Transaction for Display
// ============================================

/**
 * Format a transaction for terminal display
 */
export function formatTransactionZerion(tx: TransactionHistoryItem): string {
  const lines: string[] = [];

  // Status icon
  const statusIcon = tx.status === "success" ? "✓" : tx.status === "failed" ? "✗" : "⏳";

  // Main line: action and value
  let mainLine = `${statusIcon} ${tx.action}`;

  // Add USD value if available
  const totalUsdValue = tx.transfers.reduce((sum, t) => sum + (t.usdValue || 0), 0);
  if (totalUsdValue > 0.01) {
    mainLine += ` ($${totalUsdValue.toFixed(2)})`;
  }

  lines.push(mainLine);

  // Details for trades (swaps)
  if (tx.actionType === "trade" && tx.transfers.length >= 2) {
    const outTransfer = tx.transfers.find((t) => t.direction === "out");
    const inTransfer = tx.transfers.find((t) => t.direction === "in");
    if (outTransfer && inTransfer) {
      lines.push(
        `   ${outTransfer.amount.toFixed(4)} ${outTransfer.symbol} → ${inTransfer.amount.toFixed(4)} ${inTransfer.symbol}`
      );
    }
  }

  // Gas cost for non-trivial amounts
  if (tx.gasUsedUsd > 0.10) {
    lines.push(`   Gas: $${tx.gasUsedUsd.toFixed(2)}`);
  }

  // Dapp name if available
  if (tx.dappName) {
    lines.push(`   via ${tx.dappName}`);
  }

  // Time
  lines.push(`   ${tx.date}`);

  return lines.join("\n");
}
