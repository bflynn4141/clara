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
import { recordYieldTransaction, getTransactionsForPosition, calculateEarnings, getYieldEarningsSummary, type YieldTransaction } from "../storage/yield-history.js";
import { getProtocolAdapter, getSupportedProtocols } from "./protocols/index.js";
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
declare const EXPLORER_CONFIG: Record<SupportedChain, {
    apiUrl: string;
    explorerUrl: string;
} | null>;
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
 * Repair a session that is missing walletId
 * This can happen if the session was created with an older version
 * or if there was a bug in the setup flow.
 *
 * Returns true if repair was successful, false otherwise.
 */
export declare function repairMissingWalletId(): Promise<boolean>;
/**
 * Get wallet address for a specific chain
 */
export declare function getWalletAddress(chain: SupportedChain): Promise<string>;
/**
 * Get token balances for a chain (legacy - native token only)
 */
export declare function getBalances(chain: SupportedChain, _tokenAddress?: string): Promise<TokenBalance[]>;
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
export declare function getAllBalancesMulticall(chain: SupportedChain): Promise<MultiTokenBalance[]>;
/**
 * Get complete portfolio - uses Zerion API when available (1 call vs 5+)
 * Falls back to Multicall3 per-chain if Zerion unavailable
 */
export declare function getPortfolioFast(): Promise<Portfolio>;
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
 *
 * For native tokens: sendTransaction(to, amount, chain)
 * For ERC-20 tokens: sendTransaction(tokenContract, "0", chain, undefined, transferData)
 */
export declare function sendTransaction(to: string, amount: string, chain: SupportedChain, _tokenAddress?: string, data?: string): Promise<{
    txHash: string;
    signature?: string;
    requiresManualBroadcast?: boolean;
}>;
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
export declare function waitForTransaction(txHash: string, chain: SupportedChain, options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    confirmations?: number;
}): Promise<TransactionReceipt>;
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
 * Get USD price for a token
 * Stablecoins return 1.0, others fetch from CoinGecko
 */
export declare function getTokenPriceUsd(symbol: string): Promise<number | null>;
/**
 * Batch fetch prices for multiple tokens (efficient for portfolio)
 */
export declare function getTokenPricesUsd(symbols: string[]): Promise<Record<string, number>>;
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
/**
 * Popular tokens database with addresses across chains
 * Tokens are keyed by symbol, with chain-specific addresses
 */
export declare const POPULAR_TOKENS: Record<string, Record<SupportedChain, {
    address: string;
    decimals: number;
} | null>>;
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
export declare function getTokenMetadata(tokenAddress: string, chain: SupportedChain): Promise<TokenMetadata>;
/**
 * Get ERC-20 token balance for an address
 */
export declare function getTokenBalance(tokenAddress: string, chain: SupportedChain, ownerAddress?: string): Promise<{
    balance: string;
    balanceRaw: string;
    symbol: string;
    decimals: number;
}>;
/**
 * Encode ERC-20 transfer calldata
 * transfer(address to, uint256 amount)
 */
export declare function encodeERC20Transfer(to: string, amount: string, decimals: number): string;
/**
 * Resolve a token symbol or address to token info for a chain
 * Accepts: "USDC", "usdc", or "0xa0b86991..."
 */
export declare function resolveToken(tokenInput: string, chain: SupportedChain): {
    address: string;
    symbol: string;
    decimals: number;
} | null;
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
export declare function simulateTransaction(tx: TransactionRequest, chain: SupportedChain): Promise<SimulationResult>;
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
    actionType?: string;
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
    transfers?: Array<{
        direction: "in" | "out" | "self";
        symbol: string;
        name: string;
        amount: number;
        usdValue: number | null;
        isNft: boolean;
    }>;
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
export declare function getTransactionHistory(chain: SupportedChain, options?: {
    limit?: number;
    includeTokenTransfers?: boolean;
}): Promise<TransactionHistory>;
/**
 * Format a transaction for display
 */
export declare function formatTransaction(tx: TransactionHistoryItem): string;
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
/**
 * Check current allowance for a specific token and spender
 */
export declare function getAllowance(tokenAddress: string, spenderAddress: string, chain: SupportedChain, ownerAddress?: string): Promise<TokenApproval>;
/**
 * Get approval history from block explorer
 * Fetches all Approval events for the user's address
 */
export declare function getApprovalHistory(chain: SupportedChain, options?: {
    limit?: number;
}): Promise<ApprovalHistory>;
/**
 * Encode ERC-20 approve calldata
 * approve(address spender, uint256 amount)
 * Use amount = "0" to revoke approval
 */
export declare function encodeApproveCalldata(spenderAddress: string, amount: string, decimals: number): string;
/**
 * Format an approval for display
 */
export declare function formatApproval(approval: TokenApproval): string;
declare const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/**
 * Swap quote from aggregator (Li.Fi or 0x)
 */
export interface SwapQuote {
    id: string;
    source: "lifi" | "0x";
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
export declare function getSwapQuote(fromToken: string, toToken: string, amount: string, chain: SupportedChain, options?: SwapQuoteOptions | number): Promise<SwapQuote>;
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
export declare function getSwapQuoteBest(fromToken: string, toToken: string, amount: string, chain: SupportedChain, options?: SwapQuoteOptions): Promise<SwapQuote>;
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
    estimatedTime: number;
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
    steps: Array<{
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
export declare function getBridgeQuote(fromToken: string, toToken: string, amount: string, fromChain: SupportedChain, toChain: SupportedChain, options?: BridgeQuoteOptions): Promise<BridgeQuote>;
/**
 * Execute a bridge using the quote's transaction request
 * Note: This initiates the bridge on the source chain.
 * The tokens will arrive on the destination chain after the estimated time.
 */
export declare function executeBridge(quote: BridgeQuote): Promise<{
    txHash: string;
    status: string;
    estimatedArrival: string;
}>;
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
        token: {
            symbol: string;
        };
    };
    receiving?: {
        txHash?: string;
        chainId: number;
        amount?: string;
        token?: {
            symbol: string;
        };
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
export declare function getBridgeStatus(txHash: string, fromChain: SupportedChain, toChain: SupportedChain): Promise<BridgeStatus>;
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
export declare function waitForBridge(txHash: string, fromChain: SupportedChain, toChain: SupportedChain, options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (status: BridgeStatus) => void;
}): Promise<BridgeStatus>;
/**
 * Execute a swap using the quote's transaction request
 */
export declare function executeSwap(quote: SwapQuote, chain: SupportedChain): Promise<{
    txHash: string;
    status: string;
}>;
/**
 * Get supported tokens for swapping on a chain
 * Returns common tokens that Li.Fi supports
 */
export declare function getSwappableTokens(chain: SupportedChain): Array<{
    symbol: string;
    address: string;
}>;
declare const AAVE_V3_POOLS: Record<string, {
    pool: string;
    poolDataProvider: string;
} | null>;
/**
 * Yield opportunity from DeFiLlama
 */
export interface YieldOpportunity {
    pool: string;
    chain: SupportedChain;
    protocol: string;
    symbol: string;
    apy: number;
    apyReward: number | null;
    apyTotal: number;
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
export declare function getYieldOpportunities(asset: string, options?: {
    chains?: SupportedChain[];
    minTvl?: number;
    protocols?: string[];
}): Promise<YieldOpportunity[]>;
/**
 * Get the best yield opportunity for an asset
 */
export declare function getBestYield(asset: string, chains?: SupportedChain[]): Promise<YieldOpportunity | null>;
/**
 * Parse a decimal amount string to BigInt with the specified decimals.
 * Handles arbitrary precision without floating-point errors.
 *
 * Examples:
 *   parseAmountToBigInt("100", 6)      -> 100000000n (100 USDC)
 *   parseAmountToBigInt("0.01", 6)     -> 10000n (0.01 USDC)
 *   parseAmountToBigInt("1000000", 18) -> 1000000000000000000000000n (1M DAI, precise)
 */
export declare function parseAmountToBigInt(amount: string, decimals: number): bigint;
/**
 * Encode Aave v3 supply transaction
 * supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
 */
export declare function encodeAaveSupply(assetAddress: string, amount: string, decimals: number, onBehalfOf: string): string;
/**
 * Encode Aave v3 withdraw transaction
 * withdraw(address asset, uint256 amount, address to)
 */
export declare function encodeAaveWithdraw(assetAddress: string, amount: string, decimals: number, to: string): string;
/**
 * Create a yield deposit plan for the best available opportunity
 * Falls back to next-best option if the highest-APY adapter fails
 */
export declare function createYieldPlan(asset: string, amount: string, preferredChains?: SupportedChain[]): Promise<YieldPlan | null>;
/**
 * Execute a yield deposit
 * Records the transaction for earnings tracking
 */
export declare function executeYieldDeposit(plan: YieldPlan): Promise<{
    txHash: string;
    status: string;
}>;
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
/**
 * Get user's yield positions across chains and protocols
 * Now supports Aave V3 and Compound V3 via adapter pattern
 * Includes USD valuation via price oracle
 */
export declare function getYieldPositions(chains?: SupportedChain[], protocols?: string[]): Promise<YieldPosition[]>;
/**
 * Create a withdrawal plan for yield positions
 * Now supports multiple protocols via adapter pattern
 */
export declare function createWithdrawPlan(asset: string, amount: string, // "all" or specific amount
chain: SupportedChain, protocol?: string): Promise<YieldPlan | null>;
/**
 * Execute a yield withdrawal
 * Records the transaction for earnings tracking
 */
export declare function executeYieldWithdraw(plan: YieldPlan): Promise<{
    txHash: string;
    status: string;
}>;
/**
 * Format a yield opportunity for display
 */
export declare function formatYieldOpportunity(opp: YieldOpportunity): string;
/**
 * Yield earnings for a single position
 */
export interface YieldEarnings {
    asset: string;
    chain: SupportedChain;
    protocol: string;
    totalDeposited: string;
    totalWithdrawn: string;
    netDeposited: string;
    currentBalance: string;
    earnedYield: string;
    earnedYieldUsd: string;
    earnedYieldPercent: string;
    periodDays: number;
    effectiveApy: string | null;
}
/**
 * Get earnings for a specific yield position
 */
export declare function getYieldEarnings(asset: string, chain: SupportedChain, protocol?: string): Promise<YieldEarnings | null>;
/**
 * Get earnings summary for all positions
 */
export declare function getAllYieldEarnings(): Promise<{
    positions: YieldEarnings[];
    totalEarnedUsd: string;
}>;
export type { YieldTransaction };
export { recordYieldTransaction, getTransactionsForPosition, calculateEarnings, getYieldEarningsSummary, };
export { CHAIN_CONFIG, EXPLORER_CONFIG, NATIVE_TOKEN_ADDRESS, AAVE_V3_POOLS };
export { getProtocolAdapter, getSupportedProtocols };
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
export declare function getClaraDashboard(): Promise<ClaraDashboard>;
/**
 * Format the dashboard as ASCII art
 */
export declare function formatClaraDashboard(dashboard: ClaraDashboard): string;
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
        toAmount: string;
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
/**
 * Get native token balance for a chain
 */
export declare function getNativeBalance(chain: SupportedChain): Promise<{
    balance: string;
    balanceRaw: bigint;
    symbol: string;
}>;
/**
 * Get current gas price for a chain
 * Returns gas price in wei and gwei
 */
export declare function getGasPrice(chain: SupportedChain): Promise<{
    gasPriceWei: bigint;
    gasPriceGwei: number;
}>;
/**
 * Check if user has enough gas for a transaction
 * If not, returns details about which tokens can be swapped for gas
 */
export declare function checkGasForTransaction(chain: SupportedChain, estimatedGasUnits?: bigint | number): Promise<GasCheckResult>;
/**
 * Create a gas plan for a transaction
 * Automatically includes swap-for-gas step if needed
 */
export declare function createGasPlan(chain: SupportedChain, transactions: Array<{
    description: string;
    to: string;
    data?: string;
    value?: string;
}>): Promise<GasPlan>;
/**
 * Execute a gas plan (including any necessary swap-for-gas)
 * Returns transaction hashes for all executed transactions
 */
export declare function executeGasPlan(plan: GasPlan, chain: SupportedChain): Promise<Array<{
    description: string;
    txHash: string;
    status: string;
}>>;
/**
 * Quick helper: Ensure gas is available for a simple transaction
 * Returns true if ready, or details about what's needed
 */
export declare function ensureGas(chain: SupportedChain, estimatedGasUnits?: number): Promise<{
    ready: boolean;
    message: string;
    swapNeeded?: SwapQuote;
}>;
export { getSolanaAssets, getSolanaTransactions, isHeliusAvailable, type SolanaBalance, type SolanaPortfolio, type SolanaTransaction, } from "./solana.js";
//# sourceMappingURL=client.d.ts.map