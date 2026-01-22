/**
 * Compound V3 (Comet) Protocol Adapter
 *
 * Compound V3 uses isolated Comet markets:
 * - Each market has a single base asset (e.g., USDC)
 * - Users supply the base asset to earn yield
 * - Simpler interface than Aave: no separate receipt tokens
 *
 * Function signatures:
 * - supply(address asset, uint256 amount)
 * - withdraw(address asset, uint256 amount)
 *
 * Note: Compound V3 tracks balances internally (no cToken)
 */

import type { SupportedChain } from "../client.js";
import type {
  ProtocolAdapter,
  SupplyParams,
  WithdrawParams,
  EncodedTransaction,
} from "./index.js";

// Compound V3 function selectors
const SELECTORS = {
  supply: "0xf2b9fdb8",   // supply(address,uint256)
  withdraw: "0xf3fef3a3", // withdraw(address,uint256)
};

// MAX_UINT256 for "withdraw all"
const MAX_UINT256 = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);

// Comet market addresses per chain
// Each chain can have multiple Comet markets (one per base asset)
const COMET_MARKETS: Partial<Record<SupportedChain, Record<string, string>>> = {
  ethereum: {
    USDC: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",  // cUSDCv3
    WETH: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",  // cWETHv3
  },
  base: {
    USDC: "0xb125E6687d4313864e53df431d5425969c15Eb2F",  // cUSDCv3
    USDbC: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", // cUSDbCv3
    WETH: "0x46e6b214b524310239732D51387075E0e70970bf",  // cWETHv3
  },
  arbitrum: {
    USDC: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",  // cUSDCv3 (native USDC)
    "USDC.e": "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", // cUSDC.ev3
    WETH: "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486",  // cWETHv3
  },
  polygon: {
    USDC: "0xF25212E676D1F7F89Cd72fFEe66158f541246445",  // cUSDCv3
  },
  optimism: {
    USDC: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",  // cUSDCv3
    WETH: "0xE36A30D249f7761327fd973001A32010b521b6Fd",  // cWETHv3
  },
};

// Base asset addresses per chain (what Compound accepts)
const BASE_ASSETS: Partial<Record<SupportedChain, Record<string, string>>> = {
  ethereum: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "USDC.e": "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  polygon: {
    USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  },
  optimism: {
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    WETH: "0x4200000000000000000000000000000000000006",
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

export class CompoundV3Adapter implements ProtocolAdapter {
  readonly protocolId = "compound-v3";
  readonly displayName = "Compound V3";
  readonly supportedChains: SupportedChain[] = [
    "ethereum",
    "base",
    "arbitrum",
    "polygon",
    "optimism",
  ];

  /**
   * Get the Comet market address for a specific asset on a chain
   */
  getPoolAddress(chain: SupportedChain, asset?: string): string | null {
    const markets = COMET_MARKETS[chain];
    if (!markets) return null;

    // If asset specified, return that market
    if (asset) {
      return markets[asset] || markets[asset.toUpperCase()] || null;
    }

    // Default to USDC market
    return markets["USDC"] || Object.values(markets)[0] || null;
  }

  /**
   * Compound V3 doesn't have separate receipt tokens - balances are tracked internally
   * Returns the Comet market address itself for balance queries
   */
  getReceiptToken(asset: string, chain: SupportedChain): string | null {
    // In Compound V3, the Comet contract itself tracks balances
    return this.getPoolAddress(chain, asset);
  }

  /**
   * Get the base asset address for a Comet market
   */
  getBaseAsset(asset: string, chain: SupportedChain): string | null {
    const assets = BASE_ASSETS[chain];
    if (!assets) return null;
    return assets[asset] || assets[asset.toUpperCase()] || null;
  }

  encodeSupply(params: SupplyParams): EncodedTransaction {
    // For Compound V3, we need to find the right Comet market based on the asset
    // We'll extract the asset symbol from the address or use a mapping
    const assetSymbol = this.getAssetSymbolFromAddress(params.assetAddress, params.chain);
    const cometAddress = this.getPoolAddress(params.chain, assetSymbol);

    if (!cometAddress) {
      throw new Error(`Compound V3 market not available for this asset on ${params.chain}`);
    }

    // Pad asset address (32 bytes)
    const paddedAsset = params.assetAddress.slice(2).toLowerCase().padStart(64, "0");

    // Pad amount (32 bytes)
    const amountRaw = parseAmountToBigInt(params.amount, params.decimals);
    const paddedAmount = amountRaw.toString(16).padStart(64, "0");

    const data = SELECTORS.supply + paddedAsset + paddedAmount;

    return {
      to: cometAddress,
      data,
      amountRaw: amountRaw.toString(),
    };
  }

  encodeWithdraw(params: WithdrawParams): EncodedTransaction {
    const assetSymbol = this.getAssetSymbolFromAddress(params.assetAddress, params.chain);
    const cometAddress = this.getPoolAddress(params.chain, assetSymbol);

    if (!cometAddress) {
      throw new Error(`Compound V3 market not available for this asset on ${params.chain}`);
    }

    const paddedAsset = params.assetAddress.slice(2).toLowerCase().padStart(64, "0");

    // Use max uint256 for "withdraw all"
    let paddedAmount: string;
    let amountRaw: string;

    if (params.amount === "max" || params.amount === "all") {
      paddedAmount = MAX_UINT256.toString(16).padStart(64, "0");
      amountRaw = MAX_UINT256.toString();
    } else {
      const amount = parseAmountToBigInt(params.amount, params.decimals);
      paddedAmount = amount.toString(16).padStart(64, "0");
      amountRaw = amount.toString();
    }

    const data = SELECTORS.withdraw + paddedAsset + paddedAmount;

    return {
      to: cometAddress,
      data,
      amountRaw,
    };
  }

  /**
   * Helper to get asset symbol from address
   */
  private getAssetSymbolFromAddress(address: string, chain: SupportedChain): string | null {
    const assets = BASE_ASSETS[chain];
    if (!assets) return null;

    const addressLower = address.toLowerCase();
    for (const [symbol, addr] of Object.entries(assets)) {
      if (addr.toLowerCase() === addressLower) {
        return symbol;
      }
    }
    return null;
  }
}

// Export for direct access
export const COMPOUND_V3_SELECTORS = SELECTORS;
export const COMPOUND_V3_MARKETS = COMET_MARKETS;
export const COMPOUND_V3_BASE_ASSETS = BASE_ASSETS;
