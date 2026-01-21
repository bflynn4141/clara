/**
 * Para SDK Client
 *
 * Uses Para's pregenerated wallets for CLI-native wallet creation.
 * MPC (Multi-Party Computation) ensures keys are never stored in one place.
 *
 * Flow:
 * 1. Create pregen wallet for email (no browser auth needed)
 * 2. Store encrypted user share locally
 * 3. Sign messages/transactions using stored share
 * 4. User can optionally claim wallet later via browser
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
 * Identifier types supported by Para pregen wallets
 */
export type PregenIdentifier = {
    type: 'email';
    value: string;
} | {
    type: 'customId';
    value: string;
};
/**
 * Create pregen wallet with flexible identifier
 * Supports: email (portable) or customId (zero-friction)
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
 * OTP parameter is ignored - pregen wallets don't need verification
 */
export declare function verifyEmailOTP(sessionId: string, _otp: string): Promise<{
    address: string;
    solanaAddress?: string;
    isNewWallet: boolean;
}>;
/**
 * Complete wallet setup and retrieve wallet info
 * For pregen wallets, this retrieves the already-created wallet
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
 * Note: Para doesn't provide balance APIs - we use RPC directly
 */
export declare function getBalances(chain: SupportedChain, _tokenAddress?: string): Promise<TokenBalance[]>;
/**
 * Sign an arbitrary message using Para MPC
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
 * Sign a transaction (does not broadcast)
 *
 * For EVM: Para SDK requires RLP-encoded transactions in base64.
 * For Solana: Expects serialized transaction in base64 or builds a simple transfer.
 *
 * For production use, integrate with ethers.js/viem (EVM) or @solana/web3.js (Solana).
 */
export declare function signTransaction(tx: TransactionRequest | SolanaTransactionRequest, chain: SupportedChain): Promise<SignedTransaction>;
/**
 * Send tokens (sign + broadcast)
 *
 * For Solana: Signs intent and provides instructions for manual broadcast
 * (full Solana tx building requires @solana/web3.js)
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
export { CHAIN_CONFIG };
//# sourceMappingURL=client.d.ts.map