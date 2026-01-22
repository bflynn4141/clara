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
export type SupportedChain = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "solana";
declare const CHAIN_CONFIG: Record<SupportedChain, {
    name: string;
    chainId?: number;
    rpcUrl: string;
}>;
/**
 * Resolve ENS name to Ethereum address
 * Works with .eth names on Ethereum mainnet
 */
export declare function resolveEnsName(name: string): Promise<string | null>;
/**
 * Reverse resolve: get ENS name for an Ethereum address
 */
export declare function reverseResolveEns(address: string): Promise<string | null>;
/**
 * Check if a string looks like an ENS name
 */
export declare function isEnsName(input: string): boolean;
/**
 * Identifier types supported by Para wallets
 */
export type PregenIdentifier = {
    type: "email";
    value: string;
} | {
    type: "customId";
    value: string;
};
/**
 * Create wallet via Para REST API
 * Creates both EVM and Solana wallets for full multi-chain support
 */
export declare function createPregenWallet(identifier: PregenIdentifier): Promise<{
    sessionId: string;
    isExisting: boolean;
}>;
/**
 * Legacy wrapper for email-based auth (backward compatibility)
 */
export declare function startEmailAuth(email: string): Promise<{
    sessionId: string;
}>;
/**
 * Legacy wrapper for OTP verification (backward compatibility)
 * OTP parameter is ignored - REST API wallets don't need verification
 */
export declare function verifyEmailOTP(sessionId: string, _otp: string): Promise<{
    address: string;
    solanaAddress?: string;
    isNewWallet: boolean;
}>;
/**
 * Complete wallet setup and retrieve wallet info
 */
export declare function completeWalletSetup(sessionId: string): Promise<{
    address: string;
    solanaAddress?: string;
    isNewWallet: boolean;
}>;
/**
 * Get wallet address for a specific chain
 */
export declare function getWalletAddress(chain: SupportedChain): Promise<string>;
/**
 * Get token balances for a chain
 */
export declare function getBalances(chain: SupportedChain, _tokenAddress?: string): Promise<TokenBalance[]>;
/**
 * Sign an arbitrary message using Para REST API
 * Uses the /sign-raw endpoint which accepts 0x-prefixed hex data
 */
export declare function signMessage(message: string, chain?: SupportedChain): Promise<string>;
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
export declare function signTransaction(tx: TransactionRequest | SolanaTransactionRequest, chain: SupportedChain): Promise<SignedTransaction>;
/**
 * Send tokens (sign + broadcast)
 */
export declare function sendTransaction(to: string, amount: string, chain: SupportedChain, _tokenAddress?: string): Promise<{
    txHash: string;
    signature?: string;
    requiresManualBroadcast?: boolean;
}>;
/**
 * Estimate gas for a transaction
 */
export declare function estimateGas(tx: TransactionRequest, chain: SupportedChain): Promise<{
    gasLimit: string;
    maxFee: string;
    estimatedCostUsd: string;
}>;
/**
 * Get human-readable description of a transaction
 */
export declare function decodeTransaction(tx: TransactionRequest, _chain: SupportedChain): Promise<{
    action: string;
    details: string[];
}>;
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
export declare function fetchPrices(): Promise<Record<string, {
    usd: number;
    usd_24h_change: number;
}>>;
/**
 * Get portfolio across all chains
 * Fetches balances and current prices, calculates USD values
 */
export declare function getPortfolio(): Promise<Portfolio>;
/**
 * Format USD value for display
 */
export declare function formatUsd(value: number | null | undefined): string;
/**
 * Format percentage change for display
 */
export declare function formatChange(change: number | null | undefined): string;
export { CHAIN_CONFIG };
//# sourceMappingURL=client.d.ts.map