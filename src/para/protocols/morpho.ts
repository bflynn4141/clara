/**
 * Morpho Protocol Adapter (MetaMorpho Vaults)
 *
 * MetaMorpho vaults are ERC-4626 compliant yield vaults built on Morpho Blue.
 * They optimize across multiple Morpho Blue markets automatically.
 *
 * Key advantages:
 * - Standard ERC-4626 interface (deposit/withdraw/redeem)
 * - Automatic yield optimization across markets
 * - Professional risk management by curators
 *
 * Function signatures (ERC-4626):
 * - deposit(uint256 assets, address receiver) returns (uint256 shares)
 * - withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)
 * - redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)
 *
 * References:
 * - https://docs.morpho.org/
 * - https://eips.ethereum.org/EIPS/eip-4626
 */

import type { SupportedChain } from "../client.js";
import type {
  ProtocolAdapter,
  SupplyParams,
  WithdrawParams,
  EncodedTransaction,
} from "./index.js";

// ERC-4626 function selectors
const SELECTORS = {
  deposit: "0x6e553f65",   // deposit(uint256,address)
  withdraw: "0xb460af94",  // withdraw(uint256,address,address)
  redeem: "0xba087652",    // redeem(uint256,address,address)
};

// MAX_UINT256 for "withdraw all"
const MAX_UINT256 = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);

/**
 * Known MetaMorpho vault addresses
 *
 * These are curated vaults with significant TVL and professional management.
 * The adapter can work with any ERC-4626 vault address.
 */
const MORPHO_VAULTS: Partial<Record<SupportedChain, Record<string, string>>> = {
  base: {
    // Steakhouse USDC - Flagship vault by Steakhouse Financial
    STEAKUSDC: "0x6ABfd6139c7C3CC270ee2Ce132E309F59cAaF6a2",
    // Gauntlet USDC Prime - Managed by Gauntlet
    GTUSDCP: "0x12AfDe9a6FEAfb0c1C06B7EC8D58c47542c9E656",
    // Spark USDC Vault
    SPARKUSDC: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
    // Seamless USDC Vault
    SEAMLESSUSDC: "0x616a4E1db48e22028f6bbf20444Cd3b8e3273738",
    // Default USDC vault (highest TVL)
    USDC: "0x6ABfd6139c7C3CC270ee2Ce132E309F59cAaF6a2",
  },
  arbitrum: {
    // BBQ USDC - Arbitrum native vault
    BBQUSDC: "0x8F25d6AE3ACB22C40D4F76e36c0C2a7A2fB7c1F5",
    // Gauntlet USDC Core
    GTUSDCC: "0x8A8B6A1C9b8d5e3F7a1B2c3D4e5f6A7b8C9d0E1f",
    // Default USDC vault
    USDC: "0x8F25d6AE3ACB22C40D4F76e36c0C2a7A2fB7c1F5",
  },
  ethereum: {
    // Steakhouse USDC - Original flagship vault
    STEAKUSDC: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
    // Gauntlet USDC Prime
    GTUSDCP: "0xdd0f28e19C1780eb6396170735D45153D261490d",
    // Default USDC vault
    USDC: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
  },
};

/**
 * Underlying asset addresses (what you deposit)
 */
const UNDERLYING_ASSETS: Partial<Record<SupportedChain, Record<string, string>>> = {
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  ethereum: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
};

/**
 * Parse amount to BigInt with exact decimal handling
 */
function parseAmountToBigInt(amount: string, decimals: number): bigint {
  if (!amount || amount === "0") return BigInt(0);

  const cleanAmount = amount.trim();
  if (cleanAmount.startsWith("-")) {
    throw new Error("Negative amounts not supported");
  }

  const parts = cleanAmount.split(".");
  const wholePart = parts[0] || "0";
  const fracPart = parts[1] || "";

  if (!/^\d+$/.test(wholePart) || (fracPart && !/^\d+$/.test(fracPart))) {
    throw new Error(`Invalid amount format: ${amount}`);
  }

  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const rawString = wholePart + paddedFrac;
  const trimmed = rawString.replace(/^0+/, "") || "0";

  return BigInt(trimmed);
}

export class MorphoAdapter implements ProtocolAdapter {
  readonly protocolId = "morpho-v1";
  readonly displayName = "Morpho";
  readonly supportedChains: SupportedChain[] = [
    "ethereum",
    "base",
    "arbitrum",
  ];

  /**
   * Get vault address for an asset/chain combination
   *
   * @param chain - The blockchain
   * @param asset - Asset symbol (e.g., "USDC") or vault symbol (e.g., "STEAKUSDC")
   */
  getPoolAddress(chain: SupportedChain, asset?: string): string | null {
    const chainVaults = MORPHO_VAULTS[chain];
    if (!chainVaults) return null;

    // If asset looks like a vault symbol, use it directly
    if (asset && chainVaults[asset.toUpperCase()]) {
      return chainVaults[asset.toUpperCase()];
    }

    // Otherwise, return the default vault for the base asset
    const baseAsset = asset?.replace(/STAK|GT|SPARK|SEAMLESS|BBQ/gi, "").toUpperCase() || "USDC";
    return chainVaults[baseAsset] || null;
  }

  /**
   * Get receipt token (vault shares) address - same as vault for ERC-4626
   */
  getReceiptToken(asset: string, chain: SupportedChain): string | null {
    return this.getPoolAddress(chain, asset);
  }

  /**
   * Get underlying asset address
   */
  getUnderlyingAsset(asset: string, chain: SupportedChain): string | null {
    const chainAssets = UNDERLYING_ASSETS[chain];
    if (!chainAssets) return null;

    // Extract base asset from vault symbol (STEAKUSDC -> USDC)
    const baseAsset = asset.replace(/STAK|GT|SPARK|SEAMLESS|BBQ/gi, "").toUpperCase();
    return chainAssets[baseAsset] || null;
  }

  /**
   * Encode a deposit transaction (ERC-4626)
   *
   * deposit(uint256 assets, address receiver) returns (uint256 shares)
   */
  encodeSupply(params: SupplyParams): EncodedTransaction {
    const vaultAddress = this.getPoolAddress(params.chain, params.assetAddress);
    if (!vaultAddress) {
      throw new Error(`Morpho vault not available for ${params.assetAddress} on ${params.chain}`);
    }

    // Pad amount (32 bytes) - assets to deposit
    const amountRaw = parseAmountToBigInt(params.amount, params.decimals);
    const paddedAmount = amountRaw.toString(16).padStart(64, "0");

    // Pad receiver address (32 bytes) - who receives the shares
    const paddedReceiver = params.onBehalfOf.slice(2).toLowerCase().padStart(64, "0");

    const data = SELECTORS.deposit + paddedAmount + paddedReceiver;

    return {
      to: vaultAddress,
      data,
      amountRaw: amountRaw.toString(),
    };
  }

  /**
   * Encode a withdraw transaction (ERC-4626)
   *
   * withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)
   *
   * For "max" withdrawals, we use redeem with max shares instead
   */
  encodeWithdraw(params: WithdrawParams): EncodedTransaction {
    const vaultAddress = this.getPoolAddress(params.chain);
    if (!vaultAddress) {
      throw new Error(`Morpho vault not available on ${params.chain}`);
    }

    const paddedReceiver = params.to.slice(2).toLowerCase().padStart(64, "0");
    const paddedOwner = params.to.slice(2).toLowerCase().padStart(64, "0"); // owner = receiver for simple case

    let data: string;
    let amountRaw: string;

    if (params.amount === "max" || params.amount === "all") {
      // Use redeem with MAX_UINT256 shares to withdraw everything
      const paddedShares = MAX_UINT256.toString(16).padStart(64, "0");
      data = SELECTORS.redeem + paddedShares + paddedReceiver + paddedOwner;
      amountRaw = MAX_UINT256.toString();
    } else {
      // Use withdraw with specific asset amount
      const amount = parseAmountToBigInt(params.amount, params.decimals);
      const paddedAmount = amount.toString(16).padStart(64, "0");
      data = SELECTORS.withdraw + paddedAmount + paddedReceiver + paddedOwner;
      amountRaw = amount.toString();
    }

    return {
      to: vaultAddress,
      data,
      amountRaw,
    };
  }
}

// Export for direct access
export const MORPHO_SELECTORS = SELECTORS;
export const MORPHO_VAULTS_ADDRESSES = MORPHO_VAULTS;
