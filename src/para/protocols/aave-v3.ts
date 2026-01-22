/**
 * Aave V3 Protocol Adapter
 *
 * Aave v3 is one of the most battle-tested lending protocols:
 * - ~$15B TVL across chains
 * - supply() to deposit, withdraw() to redeem
 * - aTokens are interest-bearing receipt tokens
 *
 * Function signatures:
 * - supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
 * - withdraw(address asset, uint256 amount, address to)
 */

import type { SupportedChain } from "../client.js";
import type {
  ProtocolAdapter,
  SupplyParams,
  WithdrawParams,
  EncodedTransaction,
} from "./index.js";

// Aave v3 function selectors
const SELECTORS = {
  supply: "0x617ba037",   // supply(address,uint256,address,uint16)
  withdraw: "0x69328dec", // withdraw(address,uint256,address)
};

// MAX_UINT256 for "withdraw all"
const MAX_UINT256 = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);

// Pool addresses per chain
const POOL_ADDRESSES: Partial<Record<SupportedChain, string>> = {
  ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  polygon: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

// aToken addresses (receipt tokens for deposits)
const ATOKENS: Partial<Record<SupportedChain, Record<string, string>>> = {
  base: {
    USDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
    USDbC: "0x0a1d576f3eFeF75b330424287a95A366e8281D54",
    WETH: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7",
  },
  arbitrum: {
    USDC: "0x724dc807b04555b71ed48a6896b6F41593b8C637",
    "USDC.e": "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
    USDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
    DAI: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
    WETH: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
  },
  ethereum: {
    USDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
    USDT: "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a",
    DAI: "0x018008bfb33d285247A21d44E50697654f754e63",
    WETH: "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8",
  },
  optimism: {
    USDC: "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
    USDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
    DAI: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
    WETH: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
  },
  polygon: {
    USDC: "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
    USDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
    DAI: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
    WETH: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
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

export class AaveV3Adapter implements ProtocolAdapter {
  readonly protocolId = "aave-v3";
  readonly displayName = "Aave V3";
  readonly supportedChains: SupportedChain[] = [
    "ethereum",
    "base",
    "arbitrum",
    "optimism",
    "polygon",
  ];

  getPoolAddress(chain: SupportedChain): string | null {
    return POOL_ADDRESSES[chain] || null;
  }

  getReceiptToken(asset: string, chain: SupportedChain): string | null {
    const chainTokens = ATOKENS[chain];
    if (!chainTokens) return null;
    return chainTokens[asset] || null;
  }

  encodeSupply(params: SupplyParams): EncodedTransaction {
    const poolAddress = this.getPoolAddress(params.chain);
    if (!poolAddress) {
      throw new Error(`Aave v3 not available on ${params.chain}`);
    }

    // Pad asset address (32 bytes)
    const paddedAsset = params.assetAddress.slice(2).toLowerCase().padStart(64, "0");

    // Pad amount (32 bytes)
    const amountRaw = parseAmountToBigInt(params.amount, params.decimals);
    const paddedAmount = amountRaw.toString(16).padStart(64, "0");

    // Pad onBehalfOf address (32 bytes)
    const paddedOnBehalfOf = params.onBehalfOf.slice(2).toLowerCase().padStart(64, "0");

    // Referral code = 0 (32 bytes)
    const paddedReferral = "0".padStart(64, "0");

    const data =
      SELECTORS.supply +
      paddedAsset +
      paddedAmount +
      paddedOnBehalfOf +
      paddedReferral;

    return {
      to: poolAddress,
      data,
      amountRaw: amountRaw.toString(),
    };
  }

  encodeWithdraw(params: WithdrawParams): EncodedTransaction {
    const poolAddress = this.getPoolAddress(params.chain);
    if (!poolAddress) {
      throw new Error(`Aave v3 not available on ${params.chain}`);
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

    const paddedTo = params.to.slice(2).toLowerCase().padStart(64, "0");

    const data = SELECTORS.withdraw + paddedAsset + paddedAmount + paddedTo;

    return {
      to: poolAddress,
      data,
      amountRaw,
    };
  }
}

// Export for direct access
export const AAVE_V3_SELECTORS = SELECTORS;
export const AAVE_V3_POOLS = POOL_ADDRESSES;
export const AAVE_V3_ATOKENS = ATOKENS;
