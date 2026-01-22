/**
 * Yield History Storage
 *
 * Tracks deposit/withdrawal transactions for yield positions to calculate:
 * - Total earnings over time
 * - Effective realized APY
 * - Historical performance
 *
 * Data stored in: ~/.claude/para-wallet/yield-history.json
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Types for yield history tracking
export interface YieldTransaction {
  id: string;           // Unique ID: timestamp-action-asset-chain
  timestamp: number;    // Unix timestamp (ms)
  action: "deposit" | "withdraw";
  protocol: string;     // e.g., "aave-v3"
  chain: string;        // e.g., "base", "arbitrum"
  asset: string;        // e.g., "USDC"
  amount: string;       // Human-readable amount (e.g., "100.00")
  amountRaw: string;    // Raw amount in smallest units
  txHash?: string;      // Transaction hash if available
  priceUsd?: number;    // Price at time of transaction (for non-stables)
}

export interface YieldHistoryData {
  version: number;
  walletAddress: string;
  transactions: YieldTransaction[];
  lastUpdated: number;
}

// Storage path
const STORAGE_DIR = path.join(os.homedir(), ".claude", "para-wallet");
const HISTORY_FILE = path.join(STORAGE_DIR, "yield-history.json");

// In-memory cache
let cachedHistory: YieldHistoryData | null = null;

/**
 * Load yield history from disk
 */
export async function loadYieldHistory(walletAddress: string): Promise<YieldHistoryData> {
  // Return cache if valid for this wallet
  if (cachedHistory && cachedHistory.walletAddress === walletAddress.toLowerCase()) {
    return cachedHistory;
  }

  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const data = await fs.readFile(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(data) as YieldHistoryData;

    // Validate it's for the same wallet
    if (parsed.walletAddress?.toLowerCase() === walletAddress.toLowerCase()) {
      cachedHistory = parsed;
      return parsed;
    }
  } catch {
    // File doesn't exist or is invalid - create new
  }

  // Create new history for this wallet
  const newHistory: YieldHistoryData = {
    version: 1,
    walletAddress: walletAddress.toLowerCase(),
    transactions: [],
    lastUpdated: Date.now(),
  };

  cachedHistory = newHistory;
  return newHistory;
}

/**
 * Save yield history to disk
 */
export async function saveYieldHistory(history: YieldHistoryData): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  history.lastUpdated = Date.now();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  cachedHistory = history;
}

/**
 * Record a deposit or withdrawal transaction
 */
export async function recordYieldTransaction(
  walletAddress: string,
  transaction: Omit<YieldTransaction, "id" | "timestamp">
): Promise<YieldTransaction> {
  const history = await loadYieldHistory(walletAddress);

  const fullTransaction: YieldTransaction = {
    ...transaction,
    id: `${Date.now()}-${transaction.action}-${transaction.asset}-${transaction.chain}`,
    timestamp: Date.now(),
  };

  history.transactions.push(fullTransaction);
  await saveYieldHistory(history);

  return fullTransaction;
}

/**
 * Get transactions for a specific asset/chain
 */
export async function getTransactionsForPosition(
  walletAddress: string,
  asset: string,
  chain: string,
  protocol: string = "aave-v3"
): Promise<YieldTransaction[]> {
  const history = await loadYieldHistory(walletAddress);

  return history.transactions.filter(
    (tx) =>
      tx.asset.toUpperCase() === asset.toUpperCase() &&
      tx.chain.toLowerCase() === chain.toLowerCase() &&
      tx.protocol.toLowerCase() === protocol.toLowerCase()
  );
}

/**
 * Calculate net deposited amount for a position (deposits - withdrawals)
 */
export function calculateNetDeposited(transactions: YieldTransaction[]): {
  totalDeposited: number;
  totalWithdrawn: number;
  netDeposited: number;
} {
  let totalDeposited = 0;
  let totalWithdrawn = 0;

  for (const tx of transactions) {
    const amount = parseFloat(tx.amount);
    if (tx.action === "deposit") {
      totalDeposited += amount;
    } else {
      totalWithdrawn += amount;
    }
  }

  return {
    totalDeposited,
    totalWithdrawn,
    netDeposited: totalDeposited - totalWithdrawn,
  };
}

/**
 * Calculate earnings for a position
 */
export function calculateEarnings(
  transactions: YieldTransaction[],
  currentBalance: number
): {
  netDeposited: number;
  currentBalance: number;
  earnedYield: number;
  earnedYieldPercent: number;
  periodDays: number;
  effectiveApy: number | null;
} {
  if (transactions.length === 0) {
    return {
      netDeposited: 0,
      currentBalance,
      earnedYield: currentBalance,
      earnedYieldPercent: 0,
      periodDays: 0,
      effectiveApy: null,
    };
  }

  const { netDeposited, totalDeposited } = calculateNetDeposited(transactions);

  // Calculate yield earned
  const earnedYield = currentBalance - netDeposited;
  const earnedYieldPercent = netDeposited > 0
    ? (earnedYield / netDeposited) * 100
    : 0;

  // Calculate period (from first deposit to now)
  const firstDeposit = transactions
    .filter((tx) => tx.action === "deposit")
    .sort((a, b) => a.timestamp - b.timestamp)[0];

  const periodMs = firstDeposit
    ? Date.now() - firstDeposit.timestamp
    : 0;
  const periodDays = periodMs / (1000 * 60 * 60 * 24);

  // Calculate effective APY
  // APY = (1 + yield/principal)^(365/days) - 1
  let effectiveApy: number | null = null;
  if (periodDays >= 1 && netDeposited > 0 && currentBalance > 0) {
    const yieldRatio = earnedYield / netDeposited;
    const periodsPerYear = 365 / periodDays;
    effectiveApy = (Math.pow(1 + yieldRatio, periodsPerYear) - 1) * 100;

    // Cap at reasonable APY (1000%) to avoid showing crazy numbers for very short periods
    if (effectiveApy > 1000) {
      effectiveApy = null; // Too short a period to be meaningful
    }
  }

  return {
    netDeposited,
    currentBalance,
    earnedYield,
    earnedYieldPercent,
    periodDays,
    effectiveApy,
  };
}

/**
 * Get summary of all yield earnings across positions
 */
export async function getYieldEarningsSummary(
  walletAddress: string,
  currentPositions: Array<{
    asset: string;
    chain: string;
    protocol: string;
    currentBalance: number;
  }>
): Promise<{
  positions: Array<{
    asset: string;
    chain: string;
    earnedYield: number;
    earnedYieldPercent: number;
    effectiveApy: number | null;
    periodDays: number;
  }>;
  totalEarnedUsd: number;
}> {
  const results: Array<{
    asset: string;
    chain: string;
    earnedYield: number;
    earnedYieldPercent: number;
    effectiveApy: number | null;
    periodDays: number;
  }> = [];

  let totalEarnedUsd = 0;

  for (const pos of currentPositions) {
    const transactions = await getTransactionsForPosition(
      walletAddress,
      pos.asset,
      pos.chain,
      pos.protocol
    );

    const earnings = calculateEarnings(transactions, pos.currentBalance);

    results.push({
      asset: pos.asset,
      chain: pos.chain,
      earnedYield: earnings.earnedYield,
      earnedYieldPercent: earnings.earnedYieldPercent,
      effectiveApy: earnings.effectiveApy,
      periodDays: earnings.periodDays,
    });

    // For stablecoins, 1 token ≈ $1
    totalEarnedUsd += earnings.earnedYield;
  }

  return {
    positions: results,
    totalEarnedUsd,
  };
}

/**
 * Clear all history (for testing or reset)
 */
export async function clearYieldHistory(): Promise<void> {
  try {
    await fs.unlink(HISTORY_FILE);
    cachedHistory = null;
  } catch {
    // File doesn't exist, that's fine
  }
}
