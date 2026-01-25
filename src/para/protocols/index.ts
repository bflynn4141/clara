/**
 * Protocol Adapters for Yield/Lending
 *
 * Each adapter implements the ProtocolAdapter interface to standardize
 * transaction encoding across different DeFi protocols.
 *
 * Supported protocols:
 * - Aave v3: Battle-tested lending protocol with broad chain support
 * - Compound V3: Comet markets with isolated collateral
 */

import type { SupportedChain } from "../client.js";

/**
 * Protocol adapter interface for yield operations
 */
export interface ProtocolAdapter {
  /** Protocol identifier (must match DeFiLlama project name) */
  readonly protocolId: string;

  /** Human-readable name */
  readonly displayName: string;

  /** Chains this adapter supports */
  readonly supportedChains: SupportedChain[];

  /**
   * Encode a supply/deposit transaction
   */
  encodeSupply(params: SupplyParams): EncodedTransaction;

  /**
   * Encode a withdraw transaction
   */
  encodeWithdraw(params: WithdrawParams): EncodedTransaction;

  /**
   * Get the pool/market contract address for a chain
   */
  getPoolAddress(chain: SupportedChain): string | null;

  /**
   * Get the receipt token address (aToken, cToken, etc.)
   */
  getReceiptToken(asset: string, chain: SupportedChain): string | null;
}

export interface SupplyParams {
  assetAddress: string;
  amount: string;      // Human-readable amount
  decimals: number;
  onBehalfOf: string;  // Recipient of receipt tokens
  chain: SupportedChain;
  poolSymbol?: string; // Pool/vault symbol from DeFiLlama (e.g., "HYPERUSDC" for Morpho)
}

export interface WithdrawParams {
  assetAddress: string;
  amount: string;      // "max" or specific amount
  decimals: number;
  to: string;          // Recipient of withdrawn tokens
  chain: SupportedChain;
}

export interface EncodedTransaction {
  to: string;          // Contract to call
  data: string;        // Encoded calldata
  amountRaw: string;   // Raw amount (for tracking)
}

// Re-export adapters
export { AaveV3Adapter } from "./aave-v3.js";
export { CompoundV3Adapter } from "./compound-v3.js";
export { MorphoAdapter } from "./morpho.js";

// Protocol registry
import { AaveV3Adapter } from "./aave-v3.js";
import { CompoundV3Adapter } from "./compound-v3.js";
import { MorphoAdapter } from "./morpho.js";

const adapters: Record<string, ProtocolAdapter> = {
  "aave-v3": new AaveV3Adapter(),
  "compound-v3": new CompoundV3Adapter(),
  "morpho-v1": new MorphoAdapter(),
};

/**
 * Get adapter for a protocol
 */
export function getProtocolAdapter(protocolId: string): ProtocolAdapter | null {
  return adapters[protocolId.toLowerCase()] || null;
}

/**
 * Get all supported protocol IDs
 */
export function getSupportedProtocols(): string[] {
  return Object.keys(adapters);
}

/**
 * Check if a protocol is supported
 */
export function isProtocolSupported(protocolId: string): boolean {
  return protocolId.toLowerCase() in adapters;
}
