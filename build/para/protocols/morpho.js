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
// ERC-4626 function selectors
const SELECTORS = {
    deposit: "0x6e553f65", // deposit(uint256,address)
    withdraw: "0xb460af94", // withdraw(uint256,address,address)
    redeem: "0xba087652", // redeem(uint256,address,address)
};
// MAX_UINT256 for "withdraw all"
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
/**
 * Known MetaMorpho vault addresses
 *
 * Sourced from Morpho Blue API (https://blue-api.morpho.org/graphql)
 * These are curated vaults with significant TVL and professional management.
 * The adapter can work with any ERC-4626 vault address.
 *
 * Vault symbols from DeFiLlama are case-insensitive matched.
 */
const MORPHO_VAULTS = {
    base: {
        // Steakhouse Prime USDC - $451M TVL, ~4% APY
        STEAKUSDC: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2",
        // Gauntlet USDC Prime - $395M TVL, ~4% APY
        GTUSDCP: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
        // Spark USDC Vault - $33M TVL, ~4% APY
        SPARKUSDC: "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
        // Seamless USDC Vault - $28M TVL, ~4% APY
        SMUSDC: "0x616a4E1db48e22028f6bbf20444Cd3b8e3273738",
        SEAMLESSUSDC: "0x616a4E1db48e22028f6bbf20444Cd3b8e3273738",
        // Moonwell Flagship USDC - $24M TVL, ~4% APY
        MWUSDC: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
        // Pangolins USDC - $13M TVL, ~4% APY
        PUSDC: "0x1401d1271C47648AC70cBcdfA3776D4A87CE006B",
        // Gauntlet USDC Frontier - $11M TVL, ~4% APY
        GTUSDCF: "0x236919F11ff9eA9550A4287696C2FC9e18E6e890",
        // Froge's USDC - $33M TVL
        FRUSDC: "0x2C6D169782bF18Cc634D076Fe639092227B82fdA",
        // Default USDC vault (highest TVL - Steakhouse Prime)
        USDC: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2",
    },
    arbitrum: {
        // Steakhouse High Yield USDC (BBQ) - $52M TVL, ~3.5% APY
        BBQUSDC: "0x5c0C306Aaa9F877de636f4d5822cA9F2E81563BA",
        // Gauntlet USDC Core - $41M TVL, ~5.2% APY
        GTUSDCC: "0x7e97fa6893871A2751B5fE961978DCCb2c201E65",
        // Hyperithm USDC - $20M TVL, ~7.4% APY (highest yield!)
        HYPERUSDC: "0x4B6F1C9E5d470b97181786b26da0d0945A7cf027",
        // Default USDC vault (highest TVL - BBQ)
        USDC: "0x5c0C306Aaa9F877de636f4d5822cA9F2E81563BA",
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
const UNDERLYING_ASSETS = {
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
function parseAmountToBigInt(amount, decimals) {
    if (!amount || amount === "0")
        return BigInt(0);
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
export class MorphoAdapter {
    protocolId = "morpho-v1";
    displayName = "Morpho";
    supportedChains = [
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
    getPoolAddress(chain, asset) {
        const chainVaults = MORPHO_VAULTS[chain];
        if (!chainVaults)
            return null;
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
    getReceiptToken(asset, chain) {
        return this.getPoolAddress(chain, asset);
    }
    /**
     * Get underlying asset address
     */
    getUnderlyingAsset(asset, chain) {
        const chainAssets = UNDERLYING_ASSETS[chain];
        if (!chainAssets)
            return null;
        // Extract base asset from vault symbol (STEAKUSDC -> USDC)
        const baseAsset = asset.replace(/STAK|GT|SPARK|SEAMLESS|BBQ/gi, "").toUpperCase();
        return chainAssets[baseAsset] || null;
    }
    /**
     * Encode a deposit transaction (ERC-4626)
     *
     * deposit(uint256 assets, address receiver) returns (uint256 shares)
     */
    encodeSupply(params) {
        // Use poolSymbol if provided (from DeFiLlama), otherwise fall back to asset lookup
        const vaultAddress = params.poolSymbol
            ? this.getPoolAddress(params.chain, params.poolSymbol)
            : this.getPoolAddress(params.chain);
        if (!vaultAddress) {
            throw new Error(`Morpho vault not available for ${params.poolSymbol || "USDC"} on ${params.chain}`);
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
    encodeWithdraw(params) {
        const vaultAddress = this.getPoolAddress(params.chain);
        if (!vaultAddress) {
            throw new Error(`Morpho vault not available on ${params.chain}`);
        }
        const paddedReceiver = params.to.slice(2).toLowerCase().padStart(64, "0");
        const paddedOwner = params.to.slice(2).toLowerCase().padStart(64, "0"); // owner = receiver for simple case
        let data;
        let amountRaw;
        if (params.amount === "max" || params.amount === "all") {
            // Use redeem with MAX_UINT256 shares to withdraw everything
            const paddedShares = MAX_UINT256.toString(16).padStart(64, "0");
            data = SELECTORS.redeem + paddedShares + paddedReceiver + paddedOwner;
            amountRaw = MAX_UINT256.toString();
        }
        else {
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
//# sourceMappingURL=morpho.js.map