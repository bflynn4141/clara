/**
 * Yield History Storage Tests
 *
 * Tests for earnings tracking and calculation functions.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadYieldHistory, saveYieldHistory, recordYieldTransaction, getTransactionsForPosition, calculateNetDeposited, calculateEarnings, clearYieldHistory, } from "./yield-history.js";
// Test wallet address
const TEST_WALLET = "0x742d35Cc6634C0532925a3b844Bc9e7595f1e9A6";
describe("Yield History Storage", () => {
    // Clear history before each test
    beforeEach(async () => {
        await clearYieldHistory();
    });
    afterEach(async () => {
        await clearYieldHistory();
    });
    describe("loadYieldHistory", () => {
        it("should create new history for new wallet", async () => {
            const history = await loadYieldHistory(TEST_WALLET);
            expect(history.walletAddress).toBe(TEST_WALLET.toLowerCase());
            expect(history.transactions).toEqual([]);
            expect(history.version).toBe(1);
        });
        it("should return cached history for same wallet", async () => {
            const history1 = await loadYieldHistory(TEST_WALLET);
            history1.transactions.push({
                id: "test-1",
                timestamp: Date.now(),
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "USDC",
                amount: "100",
                amountRaw: "100000000",
            });
            await saveYieldHistory(history1);
            const history2 = await loadYieldHistory(TEST_WALLET);
            expect(history2.transactions.length).toBe(1);
        });
    });
    describe("recordYieldTransaction", () => {
        it("should record a deposit transaction", async () => {
            const tx = await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "USDC",
                amount: "100",
                amountRaw: "100000000",
                txHash: "0x123abc",
            });
            expect(tx.action).toBe("deposit");
            expect(tx.asset).toBe("USDC");
            expect(tx.amount).toBe("100");
            expect(tx.txHash).toBe("0x123abc");
            expect(tx.id).toBeDefined();
            expect(tx.timestamp).toBeDefined();
        });
        it("should record a withdrawal transaction", async () => {
            const tx = await recordYieldTransaction(TEST_WALLET, {
                action: "withdraw",
                protocol: "aave-v3",
                chain: "arbitrum",
                asset: "DAI",
                amount: "50",
                amountRaw: "50000000000000000000",
            });
            expect(tx.action).toBe("withdraw");
            expect(tx.asset).toBe("DAI");
        });
        it("should persist transactions to history", async () => {
            await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "USDC",
                amount: "100",
                amountRaw: "100000000",
            });
            await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "USDC",
                amount: "200",
                amountRaw: "200000000",
            });
            const history = await loadYieldHistory(TEST_WALLET);
            expect(history.transactions.length).toBe(2);
        });
    });
    describe("getTransactionsForPosition", () => {
        it("should filter by asset and chain", async () => {
            // Add various transactions
            await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "USDC",
                amount: "100",
                amountRaw: "100000000",
            });
            await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "arbitrum", // Different chain
                asset: "USDC",
                amount: "200",
                amountRaw: "200000000",
            });
            await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "DAI", // Different asset
                amount: "300",
                amountRaw: "300000000000000000000",
            });
            const baseUsdcTxs = await getTransactionsForPosition(TEST_WALLET, "USDC", "base", "aave-v3");
            expect(baseUsdcTxs.length).toBe(1);
            expect(baseUsdcTxs[0].amount).toBe("100");
        });
        it("should be case-insensitive", async () => {
            await recordYieldTransaction(TEST_WALLET, {
                action: "deposit",
                protocol: "aave-v3",
                chain: "base",
                asset: "USDC",
                amount: "100",
                amountRaw: "100000000",
            });
            const txs = await getTransactionsForPosition(TEST_WALLET, "usdc", // Lowercase
            "BASE", // Uppercase
            "AAVE-V3");
            expect(txs.length).toBe(1);
        });
    });
    describe("calculateNetDeposited", () => {
        it("should calculate deposits minus withdrawals", () => {
            const transactions = [
                {
                    id: "1",
                    timestamp: Date.now(),
                    action: "deposit",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "1000",
                    amountRaw: "1000000000",
                },
                {
                    id: "2",
                    timestamp: Date.now(),
                    action: "deposit",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "500",
                    amountRaw: "500000000",
                },
                {
                    id: "3",
                    timestamp: Date.now(),
                    action: "withdraw",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "300",
                    amountRaw: "300000000",
                },
            ];
            const result = calculateNetDeposited(transactions);
            expect(result.totalDeposited).toBe(1500);
            expect(result.totalWithdrawn).toBe(300);
            expect(result.netDeposited).toBe(1200);
        });
        it("should handle empty transactions", () => {
            const result = calculateNetDeposited([]);
            expect(result.totalDeposited).toBe(0);
            expect(result.totalWithdrawn).toBe(0);
            expect(result.netDeposited).toBe(0);
        });
    });
    describe("calculateEarnings", () => {
        it("should calculate positive earnings", () => {
            const transactions = [
                {
                    id: "1",
                    timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
                    action: "deposit",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "1000",
                    amountRaw: "1000000000",
                },
            ];
            // Current balance is 1010 (earned 10)
            const result = calculateEarnings(transactions, 1010);
            expect(result.netDeposited).toBe(1000);
            expect(result.currentBalance).toBe(1010);
            expect(result.earnedYield).toBe(10);
            expect(result.earnedYieldPercent).toBe(1); // 1% gain
            expect(result.periodDays).toBeGreaterThan(29);
            expect(result.effectiveApy).toBeGreaterThan(0);
        });
        it("should handle multiple deposits and withdrawals", () => {
            const now = Date.now();
            const transactions = [
                {
                    id: "1",
                    timestamp: now - 60 * 24 * 60 * 60 * 1000, // 60 days ago
                    action: "deposit",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "1000",
                    amountRaw: "1000000000",
                },
                {
                    id: "2",
                    timestamp: now - 30 * 24 * 60 * 60 * 1000, // 30 days ago
                    action: "deposit",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "500",
                    amountRaw: "500000000",
                },
                {
                    id: "3",
                    timestamp: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
                    action: "withdraw",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "200",
                    amountRaw: "200000000",
                },
            ];
            // Net deposited: 1000 + 500 - 200 = 1300
            // Current balance: 1350 (earned 50)
            const result = calculateEarnings(transactions, 1350);
            expect(result.netDeposited).toBe(1300);
            expect(result.earnedYield).toBe(50);
        });
        it("should handle no transactions (current balance is all yield)", () => {
            const result = calculateEarnings([], 100);
            expect(result.netDeposited).toBe(0);
            expect(result.earnedYield).toBe(100);
            expect(result.effectiveApy).toBeNull();
        });
        it("should cap unreasonable APY values", () => {
            const transactions = [
                {
                    id: "1",
                    timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
                    action: "deposit",
                    protocol: "aave-v3",
                    chain: "base",
                    asset: "USDC",
                    amount: "1000",
                    amountRaw: "1000000000",
                },
            ];
            // 100% gain in 1 day would be astronomical APY
            const result = calculateEarnings(transactions, 2000);
            // Should be null because it's unreasonably high
            expect(result.effectiveApy).toBeNull();
        });
    });
});
//# sourceMappingURL=yield-history.test.js.map