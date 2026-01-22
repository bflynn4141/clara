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
    from: string;
    to: string;
    value: string;
    valueEth: number;
    timestamp: number;
    date: string;
    action: string;
    status: "success" | "failed";
    gasUsed: string;
    gasPrice: string;
    functionName?: string;
    tokenSymbol?: string;
    tokenAmount?: string;
    isIncoming: boolean;
    explorerUrl: string;
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
 * Fetch transaction history from block explorer API
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
 * Swap quote from Li.Fi aggregator
 */
export interface SwapQuote {
    id: string;
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
 * Get a swap quote from Li.Fi
 * Finds the best route across multiple DEXs
 */
export declare function getSwapQuote(fromToken: string, toToken: string, amount: string, chain: SupportedChain, slippage?: number): Promise<SwapQuote>;
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
 */
export declare function createYieldPlan(asset: string, amount: string, preferredChains?: SupportedChain[]): Promise<YieldPlan | null>;
/**
 * Execute a yield deposit
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
 * Get user's yield positions across chains
 */
export declare function getYieldPositions(chains?: SupportedChain[]): Promise<YieldPosition[]>;
/**
 * Create a withdrawal plan for yield positions
 */
export declare function createWithdrawPlan(asset: string, amount: string, // "all" or specific amount
chain: SupportedChain): Promise<YieldPlan | null>;
/**
 * Execute a yield withdrawal
 */
export declare function executeYieldWithdraw(plan: YieldPlan): Promise<{
    txHash: string;
    status: string;
}>;
/**
 * Format a yield opportunity for display
 */
export declare function formatYieldOpportunity(opp: YieldOpportunity): string;
export { CHAIN_CONFIG, EXPLORER_CONFIG, NATIVE_TOKEN_ADDRESS, AAVE_V3_POOLS };
//# sourceMappingURL=client.d.ts.map