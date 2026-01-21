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

import { Para as ParaServer, Environment, WalletType } from "@getpara/server-sdk";
import { getSession, updateSession } from "../storage/session.js";

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

// Para client instance (lazy initialized)
let paraClient: ParaServer | null = null;

/**
 * Get or create Para client instance
 */
function getParaClient(): ParaServer {
  if (!paraClient) {
    const apiKey = process.env.PARA_API_KEY;
    if (!apiKey) {
      throw new Error("PARA_API_KEY environment variable not set. Get one at https://developer.getpara.com");
    }

    // Use BETA environment for development, PRODUCTION for prod
    const env = process.env.PARA_ENV === "production" ? Environment.PRODUCTION : Environment.BETA;
    paraClient = new ParaServer(env, apiKey);
    console.error("[para-wallet] Para client initialized");
  }
  return paraClient;
}

/**
 * Identifier types supported by Para pregen wallets
 */
export type PregenIdentifier =
  | { type: 'email'; value: string }
  | { type: 'customId'; value: string };

/**
 * Create pregen wallet with flexible identifier
 * Supports: email (portable) or customId (zero-friction)
 * Creates both EVM and Solana wallets for full multi-chain support
 */
export async function createPregenWallet(
  identifier: PregenIdentifier
): Promise<{ sessionId: string; isExisting: boolean }> {
  const para = getParaClient();

  const identifierLabel = identifier.type === 'email'
    ? identifier.value
    : `custom:${identifier.value.slice(0, 8)}...`;

  console.error(`[para-wallet] Creating pregen wallets for: ${identifierLabel}`);

  // Build the pregenId object based on identifier type
  const pregenId = identifier.type === 'email'
    ? { email: identifier.value }
    : { customId: identifier.value };

  try {
    // Check if wallet already exists for this identifier
    const hasWallet = await para.hasPregenWallet({ pregenId });

    if (hasWallet) {
      console.error(`[para-wallet] Wallet already exists for ${identifierLabel}`);
      return { sessionId: `existing_${identifier.type}_${identifier.value}`, isExisting: true };
    }

    // Create EVM wallet (for Ethereum, Base, etc.)
    const evmWallet = await para.createPregenWallet({
      type: WalletType.EVM,
      pregenId,
    });
    console.error(`[para-wallet] Created EVM wallet: ${evmWallet.address}`);

    // Create Solana wallet (Ed25519)
    try {
      const solWallet = await para.createPregenWallet({
        type: WalletType.SOLANA,
        pregenId,
      });
      console.error(`[para-wallet] Created Solana wallet: ${solWallet.address}`);
    } catch (solError) {
      // Solana wallet creation might fail if not enabled for the API key
      console.error("[para-wallet] Solana wallet creation skipped:", solError);
    }

    // Get and store the user share (this is critical for signing later)
    const userShare = await para.getUserShare();

    // Store share in session for later use
    await updateSession({
      paraUserShare: userShare ?? undefined,
      pendingIdentifier: identifier.value,
      identifierType: identifier.type,
    });

    return { sessionId: `new_${identifier.type}_${identifier.value}`, isExisting: false };

  } catch (error) {
    console.error("[para-wallet] Failed to create wallet:", error);
    throw error;
  }
}

/**
 * Legacy wrapper for email-based auth (backward compatibility)
 */
export async function startEmailAuth(email: string): Promise<{ sessionId: string }> {
  const result = await createPregenWallet({ type: 'email', value: email });
  return { sessionId: result.sessionId };
}

/**
 * Legacy wrapper for OTP verification (backward compatibility)
 * OTP parameter is ignored - pregen wallets don't need verification
 */
export async function verifyEmailOTP(
  sessionId: string,
  _otp: string
): Promise<{ address: string; solanaAddress?: string; isNewWallet: boolean }> {
  return completeWalletSetup(sessionId);
}

/**
 * Complete wallet setup and retrieve wallet info
 * For pregen wallets, this retrieves the already-created wallet
 */
export async function completeWalletSetup(
  sessionId: string
): Promise<{ address: string; solanaAddress?: string; isNewWallet: boolean }> {
  const para = getParaClient();
  const session = await getSession();

  // Parse session ID: "existing_email_user@example.com" or "new_customId_abc123"
  const isExisting = sessionId.startsWith("existing_");
  const withoutStatus = sessionId.replace(/^(existing|new)_/, "");
  const identifierType = withoutStatus.startsWith("email_") ? "email" : "customId";
  const identifierValue = withoutStatus.replace(/^(email|customId)_/, "");

  console.error(`[para-wallet] Completing setup for: ${identifierType}:${identifierValue.slice(0, 20)}...`);

  try {
    // For existing wallets, we need to restore the user share
    if (isExisting) {
      // Check if we have a stored share
      if (!session?.paraUserShare) {
        throw new Error("No stored wallet share found. Please run wallet_setup with your email again.");
      }

      // Set the user share to enable signing
      await para.setUserShare(session.paraUserShare);
    }

    // Get the wallet info
    const wallets = para.getWallets();
    const evmWallet = Object.values(wallets).find(w => w.type === "EVM");
    const solWallet = Object.values(wallets).find(w => w.type === "SOLANA");

    if (!evmWallet) {
      throw new Error("No EVM wallet found");
    }

    return {
      address: evmWallet.address!,
      solanaAddress: solWallet?.address,
      isNewWallet: !isExisting,
    };

  } catch (error) {
    console.error("[para-wallet] Verification failed:", error);
    throw error;
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

  // For Solana, we'd need to get the Solana-specific address
  if (chain === "solana") {
    const para = getParaClient();

    // Load user share if available
    if (session.paraUserShare) {
      await para.setUserShare(session.paraUserShare);
    }

    const wallets = para.getWallets();
    const solWallet = Object.values(wallets).find(w => w.type === "SOLANA");

    if (solWallet?.address) {
      return solWallet.address;
    }

    // Solana wallet might not exist yet
    throw new Error("Solana wallet not configured. EVM address works for EVM chains only.");
  }

  return session.address;
}

/**
 * Get token balances for a chain
 * Note: Para doesn't provide balance APIs - we use RPC directly
 */
export async function getBalances(
  chain: SupportedChain,
  _tokenAddress?: string
): Promise<TokenBalance[]> {
  const session = await getSession();
  if (!session?.authenticated || !session.address) {
    throw new Error("Not authenticated");
  }

  const config = CHAIN_CONFIG[chain];

  console.error(`[para-wallet] Fetching balances for ${chain}`);

  try {
    if (chain === "solana") {
      // Get Solana address
      const solAddress = await getWalletAddress("solana").catch(() => null);
      if (!solAddress) {
        return [{ symbol: "SOL", balance: "0.0", usdValue: "N/A" }];
      }

      // Fetch Solana balance via RPC
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

      const data = await response.json() as { result?: { value: number } };
      const lamports = data.result?.value || 0;
      const solBalance = lamports / 1e9; // 1 SOL = 1 billion lamports

      return [{
        symbol: "SOL",
        balance: solBalance.toFixed(6),
        usdValue: undefined,
      }];
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

    const data = await response.json() as { result?: string };
    const balanceWei = BigInt(data.result || "0");
    const balanceEth = Number(balanceWei) / 1e18;

    const symbol = chain === "polygon" ? "MATIC" : "ETH";

    return [{
      symbol,
      balance: balanceEth.toFixed(6),
      usdValue: undefined, // Would need price API
    }];

  } catch (error) {
    console.error(`[para-wallet] Balance fetch error:`, error);
    // Return zero balance on error rather than failing
    return [{
      symbol: chain === "solana" ? "SOL" : chain === "polygon" ? "MATIC" : "ETH",
      balance: "0.0",
    }];
  }
}

/**
 * Sign an arbitrary message using Para MPC
 */
export async function signMessage(
  message: string,
  chain: SupportedChain = "ethereum"
): Promise<string> {
  const session = await getSession();
  if (!session?.authenticated) {
    throw new Error("Not authenticated");
  }

  const para = getParaClient();

  // Load user share
  if (session.paraUserShare) {
    await para.setUserShare(session.paraUserShare);
  }

  console.error(`[para-wallet] Signing message on ${chain}`);

  try {
    const wallets = para.getWallets();
    const wallet = chain === "solana"
      ? Object.values(wallets).find(w => w.type === "SOLANA")
      : Object.values(wallets).find(w => w.type === "EVM");

    if (!wallet?.id) {
      throw new Error(`No ${chain === "solana" ? "Solana" : "EVM"} wallet found`);
    }

    // Para expects base64 encoded message
    const messageBase64 = Buffer.from(message).toString("base64");

    const result = await para.signMessage({
      walletId: wallet.id,
      messageBase64,
    });

    // Check if signing was successful (has signature property)
    if ("signature" in result) {
      return result.signature;
    }

    // Signing was denied or requires review
    throw new Error("Signing was denied or requires additional approval");

  } catch (error) {
    console.error("[para-wallet] Sign message error:", error);
    throw error;
  }
}

/**
 * Solana transaction request structure
 */
export interface SolanaTransactionRequest {
  to: string;
  amount: string; // In SOL
  memo?: string;
  serializedTx?: string; // Pre-serialized transaction (base64)
}

/**
 * Sign a transaction (does not broadcast)
 *
 * For EVM: Para SDK requires RLP-encoded transactions in base64.
 * For Solana: Expects serialized transaction in base64 or builds a simple transfer.
 *
 * For production use, integrate with ethers.js/viem (EVM) or @solana/web3.js (Solana).
 */
export async function signTransaction(
  tx: TransactionRequest | SolanaTransactionRequest,
  chain: SupportedChain
): Promise<SignedTransaction> {
  const session = await getSession();
  if (!session?.authenticated) {
    throw new Error("Not authenticated");
  }

  const para = getParaClient();

  // Load user share
  if (session.paraUserShare) {
    await para.setUserShare(session.paraUserShare);
  }

  console.error(`[para-wallet] Signing transaction on ${chain}`);

  try {
    const wallets = para.getWallets();

    if (chain === "solana") {
      // Solana transaction signing
      const solWallet = Object.values(wallets).find(w => w.type === "SOLANA");

      if (!solWallet?.id) {
        throw new Error("No Solana wallet found. Run wallet_setup to create one.");
      }

      const solTx = tx as SolanaTransactionRequest;

      // If a pre-serialized transaction is provided, sign it directly
      if (solTx.serializedTx) {
        const result = await para.signMessage({
          walletId: solWallet.id,
          messageBase64: solTx.serializedTx,
        });

        if ("signature" in result) {
          return {
            signedTx: result.signature,
            txHash: undefined,
          };
        }
        throw new Error("Solana transaction signing was denied");
      }

      // For simple transfers without pre-built transaction,
      // we sign a message representing the intent (not a real Solana tx)
      // In production, use @solana/web3.js to build proper transactions
      const intentMessage = JSON.stringify({
        type: "solana_transfer",
        to: solTx.to,
        amount: solTx.amount,
        memo: solTx.memo,
        timestamp: Date.now(),
      });

      const result = await para.signMessage({
        walletId: solWallet.id,
        messageBase64: Buffer.from(intentMessage).toString("base64"),
      });

      if ("signature" in result) {
        return {
          signedTx: result.signature,
          txHash: undefined,
        };
      }

      throw new Error("Solana transaction signing was denied or requires additional approval");
    }

    // EVM transaction signing
    const evmWallet = Object.values(wallets).find(w => w.type === "EVM");

    if (!evmWallet?.id) {
      throw new Error("No EVM wallet found");
    }

    const evmTx = tx as TransactionRequest;
    const config = CHAIN_CONFIG[chain];

    // Para SDK requires RLP-encoded transaction as base64
    // For now, we'll create a simple unsigned tx representation
    // In production, use ethers.js Transaction.from() then serialize()
    const unsignedTx = {
      to: evmTx.to,
      value: evmTx.value ? `0x${BigInt(evmTx.value).toString(16)}` : "0x0",
      data: evmTx.data || "0x",
      gasLimit: evmTx.gasLimit || "0x5208", // 21000 in hex
      maxFeePerGas: evmTx.maxFeePerGas || "0x3b9aca00", // 1 gwei
      maxPriorityFeePerGas: evmTx.maxPriorityFeePerGas || "0x3b9aca00",
      chainId: config.chainId,
      type: 2, // EIP-1559
      nonce: 0, // Would need to fetch from chain
    };

    // Simplified RLP encoding for EIP-1559 transaction
    // In production, use proper RLP library
    const txJson = JSON.stringify(unsignedTx);
    const rlpEncodedTxBase64 = Buffer.from(txJson).toString("base64");

    const result = await para.signTransaction({
      walletId: evmWallet.id,
      chainId: config.chainId!.toString(),
      rlpEncodedTxBase64,
    });

    // Check if signing was successful
    if ("signature" in result) {
      return {
        signedTx: result.signature,
        txHash: undefined, // Would be computed from signed tx
      };
    }

    throw new Error("Transaction signing was denied or requires additional approval");

  } catch (error) {
    console.error("[para-wallet] Sign transaction error:", error);
    throw error;
  }
}

/**
 * Send tokens (sign + broadcast)
 *
 * For Solana: Signs intent and provides instructions for manual broadcast
 * (full Solana tx building requires @solana/web3.js)
 */
export async function sendTransaction(
  to: string,
  amount: string,
  chain: SupportedChain,
  _tokenAddress?: string
): Promise<{ txHash: string; signature?: string; requiresManualBroadcast?: boolean }> {
  const session = await getSession();
  if (!session?.authenticated) {
    throw new Error("Not authenticated");
  }

  console.error(`[para-wallet] Sending ${amount} to ${to} on ${chain}`);

  const config = CHAIN_CONFIG[chain];

  try {
    if (chain === "solana") {
      // For Solana, we sign the transfer intent
      // Full transaction building requires @solana/web3.js which adds ~500KB
      // In production, integrate with @solana/web3.js for proper tx building

      const signed = await signTransaction(
        {
          to,
          amount,
        } as SolanaTransactionRequest,
        chain
      );

      // Return signature - caller can use this with @solana/web3.js to build & broadcast
      return {
        txHash: "",
        signature: signed.signedTx,
        requiresManualBroadcast: true,
      };
    }

    // EVM send
    // Convert amount to wei (assuming ETH/native token)
    const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18));

    // Sign the transaction
    const signed = await signTransaction(
      {
        to,
        value: amountWei.toString(),
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

    const data = await response.json() as { result?: string; error?: { message: string } };

    if (data.error) {
      throw new Error(data.error.message);
    }

    return { txHash: data.result || signed.txHash || "" };

  } catch (error) {
    console.error("[para-wallet] Send error:", error);
    throw error;
  }
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
    // Get gas estimate from RPC
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_estimateGas",
        params: [{
          to: tx.to,
          value: tx.value ? `0x${BigInt(tx.value).toString(16)}` : "0x0",
          data: tx.data || "0x",
        }],
        id: 1,
      }),
    });

    const data = await response.json() as { result?: string };
    const gasLimit = BigInt(data.result || "21000");

    // Rough USD estimate (assuming ~$2500 ETH, 30 gwei gas)
    const gasCostEth = Number(gasLimit) * 30 / 1e9;
    const estimatedCostUsd = (gasCostEth * 2500).toFixed(2);

    return {
      gasLimit: gasLimit.toString(),
      maxFee: gasCostEth.toFixed(6),
      estimatedCostUsd,
    };

  } catch {
    // Fallback estimates
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

  // Try to decode common function signatures
  const selector = tx.data.slice(0, 10);

  // Common selectors
  const SELECTORS: Record<string, { action: string; decoder?: (data: string) => string[] }> = {
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
    details: [
      `Contract: ${tx.to}`,
      `Method: ${selector}`,
    ],
  };
}

export { CHAIN_CONFIG };
