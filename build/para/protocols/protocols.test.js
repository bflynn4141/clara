/**
 * Protocol Adapter Tests
 *
 * Tests for multi-protocol yield support (Aave V3, Compound V3)
 */
import { describe, it, expect } from "vitest";
import { getProtocolAdapter, getSupportedProtocols, isProtocolSupported, AaveV3Adapter, CompoundV3Adapter, MorphoAdapter, } from "./index.js";
import { AAVE_V3_SELECTORS, AAVE_V3_POOLS } from "./aave-v3.js";
import { COMPOUND_V3_SELECTORS, COMPOUND_V3_MARKETS } from "./compound-v3.js";
import { MORPHO_SELECTORS, MORPHO_VAULTS_ADDRESSES } from "./morpho.js";
// Test addresses
const TEST_USER = "0x742d35Cc6634C0532925a3b844Bc9e7595f1e9A6";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
describe("Protocol Registry", () => {
    it("should list supported protocols", () => {
        const protocols = getSupportedProtocols();
        expect(protocols).toContain("aave-v3");
        expect(protocols).toContain("compound-v3");
        expect(protocols).toContain("morpho-v1");
    });
    it("should check protocol support", () => {
        expect(isProtocolSupported("aave-v3")).toBe(true);
        expect(isProtocolSupported("compound-v3")).toBe(true);
        expect(isProtocolSupported("morpho-v1")).toBe(true);
        expect(isProtocolSupported("unknown-protocol")).toBe(false);
    });
    it("should get adapter by protocol ID", () => {
        const aaveAdapter = getProtocolAdapter("aave-v3");
        expect(aaveAdapter).not.toBeNull();
        expect(aaveAdapter?.protocolId).toBe("aave-v3");
        const compoundAdapter = getProtocolAdapter("compound-v3");
        expect(compoundAdapter).not.toBeNull();
        expect(compoundAdapter?.protocolId).toBe("compound-v3");
        const morphoAdapter = getProtocolAdapter("morpho-v1");
        expect(morphoAdapter).not.toBeNull();
        expect(morphoAdapter?.protocolId).toBe("morpho-v1");
    });
    it("should return null for unknown protocol", () => {
        const adapter = getProtocolAdapter("morpho-blue");
        expect(adapter).toBeNull();
    });
    it("should be case-insensitive", () => {
        expect(getProtocolAdapter("AAVE-V3")).not.toBeNull();
        expect(getProtocolAdapter("Compound-V3")).not.toBeNull();
        expect(getProtocolAdapter("MORPHO-V1")).not.toBeNull();
    });
});
describe("Aave V3 Adapter", () => {
    const adapter = new AaveV3Adapter();
    describe("Configuration", () => {
        it("should have correct protocol ID", () => {
            expect(adapter.protocolId).toBe("aave-v3");
            expect(adapter.displayName).toBe("Aave V3");
        });
        it("should support expected chains", () => {
            expect(adapter.supportedChains).toContain("base");
            expect(adapter.supportedChains).toContain("arbitrum");
            expect(adapter.supportedChains).toContain("ethereum");
        });
        it("should return pool addresses for supported chains", () => {
            expect(adapter.getPoolAddress("base")).toBe(AAVE_V3_POOLS.base);
            expect(adapter.getPoolAddress("arbitrum")).toBe(AAVE_V3_POOLS.arbitrum);
        });
        it("should return null for unsupported chains", () => {
            expect(adapter.getPoolAddress("solana")).toBeNull();
        });
        it("should return aToken addresses", () => {
            const aToken = adapter.getReceiptToken("USDC", "base");
            expect(aToken).toBe("0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB");
        });
    });
    describe("Supply Encoding", () => {
        it("should encode supply with correct selector", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.data.startsWith(AAVE_V3_SELECTORS.supply)).toBe(true);
        });
        it("should encode correct pool address", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.to).toBe(AAVE_V3_POOLS.base);
        });
        it("should calculate correct raw amount for 6 decimals", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.amountRaw).toBe("100000000"); // 100 * 10^6
        });
        it("should calculate correct raw amount for 18 decimals", () => {
            const DAI_ARBITRUM = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1";
            const result = adapter.encodeSupply({
                assetAddress: DAI_ARBITRUM,
                amount: "500",
                decimals: 18,
                onBehalfOf: TEST_USER,
                chain: "arbitrum",
            });
            expect(result.amountRaw).toBe("500000000000000000000"); // 500 * 10^18
        });
        it("should produce correct calldata structure", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            // Verify calldata length: selector (10) + 4 params * 64 = 266 chars
            expect(result.data.length).toBe(10 + 64 * 4);
            // Verify selector
            expect(result.data.slice(0, 10)).toBe(AAVE_V3_SELECTORS.supply);
            // Verify asset address is in calldata
            const assetInCalldata = result.data.slice(10, 74);
            expect(assetInCalldata).toContain(USDC_BASE.slice(2).toLowerCase());
        });
    });
    describe("Withdraw Encoding", () => {
        it("should encode withdraw with correct selector", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "50",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            expect(result.data.startsWith(AAVE_V3_SELECTORS.withdraw)).toBe(true);
        });
        it("should encode max withdraw correctly", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // Max uint256 in hex
            const maxUint256Hex = "f".repeat(64);
            expect(result.data).toContain(maxUint256Hex);
        });
        it("should handle 'all' as alias for max", () => {
            const resultAll = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "all",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            const resultMax = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            expect(resultAll.data).toBe(resultMax.data);
        });
        it("should produce correct calldata structure", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "50",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // Verify calldata length: selector (10) + 3 params * 64 = 202 chars
            expect(result.data.length).toBe(10 + 64 * 3);
        });
    });
    describe("Error Handling", () => {
        it("should throw for unsupported chain", () => {
            expect(() => adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "solana",
            })).toThrow(/not available/);
        });
        it("should throw for negative amounts", () => {
            expect(() => adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "-100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            })).toThrow(/Negative/);
        });
        it("should throw for invalid amount format", () => {
            expect(() => adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "abc",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            })).toThrow(/Invalid amount/);
        });
    });
});
describe("Compound V3 Adapter", () => {
    const adapter = new CompoundV3Adapter();
    describe("Configuration", () => {
        it("should have correct protocol ID", () => {
            expect(adapter.protocolId).toBe("compound-v3");
            expect(adapter.displayName).toBe("Compound V3");
        });
        it("should support expected chains", () => {
            expect(adapter.supportedChains).toContain("base");
            expect(adapter.supportedChains).toContain("arbitrum");
            expect(adapter.supportedChains).toContain("ethereum");
        });
        it("should return Comet market addresses", () => {
            const baseMarket = adapter.getPoolAddress("base", "USDC");
            expect(baseMarket).toBe(COMPOUND_V3_MARKETS.base?.USDC);
            const arbMarket = adapter.getPoolAddress("arbitrum", "USDC");
            expect(arbMarket).toBe(COMPOUND_V3_MARKETS.arbitrum?.USDC);
        });
        it("should default to USDC market when no asset specified", () => {
            const market = adapter.getPoolAddress("base");
            expect(market).toBe(COMPOUND_V3_MARKETS.base?.USDC);
        });
    });
    describe("Supply Encoding", () => {
        it("should encode supply with correct selector", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.data.startsWith(COMPOUND_V3_SELECTORS.supply)).toBe(true);
        });
        it("should use correct Comet market address", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.to).toBe(COMPOUND_V3_MARKETS.base?.USDC);
        });
        it("should calculate correct raw amount", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.amountRaw).toBe("100000000");
        });
        it("should produce simpler calldata than Aave (2 params vs 4)", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            // Compound: selector (10) + 2 params * 64 = 138 chars
            expect(result.data.length).toBe(10 + 64 * 2);
        });
    });
    describe("Withdraw Encoding", () => {
        it("should encode withdraw with correct selector", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "50",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            expect(result.data.startsWith(COMPOUND_V3_SELECTORS.withdraw)).toBe(true);
        });
        it("should encode max withdraw correctly", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            const maxUint256Hex = "f".repeat(64);
            expect(result.data).toContain(maxUint256Hex);
        });
        it("should produce correct calldata structure", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "50",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // Compound withdraw: selector (10) + 2 params * 64 = 138 chars
            expect(result.data.length).toBe(10 + 64 * 2);
        });
    });
    describe("Market Resolution", () => {
        it("should resolve USDC market on Base", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_BASE,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.to).toBe("0xb125E6687d4313864e53df431d5425969c15Eb2F");
        });
        it("should resolve USDC market on Arbitrum", () => {
            const result = adapter.encodeSupply({
                assetAddress: USDC_ARBITRUM,
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "arbitrum",
            });
            expect(result.to).toBe("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf");
        });
    });
});
describe("Morpho V1 Adapter (ERC-4626)", () => {
    const adapter = new MorphoAdapter();
    describe("Configuration", () => {
        it("should have correct protocol ID", () => {
            expect(adapter.protocolId).toBe("morpho-v1");
            expect(adapter.displayName).toBe("Morpho");
        });
        it("should support expected chains", () => {
            expect(adapter.supportedChains).toContain("base");
            expect(adapter.supportedChains).toContain("arbitrum");
            expect(adapter.supportedChains).toContain("ethereum");
        });
        it("should return vault addresses for supported chains", () => {
            const baseVault = adapter.getPoolAddress("base", "USDC");
            expect(baseVault).toBe(MORPHO_VAULTS_ADDRESSES.base?.USDC);
            const ethVault = adapter.getPoolAddress("ethereum", "USDC");
            expect(ethVault).toBe(MORPHO_VAULTS_ADDRESSES.ethereum?.USDC);
        });
        it("should resolve specific vault symbols", () => {
            // Steakhouse USDC vault on Base
            const steakVault = adapter.getPoolAddress("base", "STEAKUSDC");
            expect(steakVault).toBe("0x6ABfd6139c7C3CC270ee2Ce132E309F59cAaF6a2");
        });
        it("should return null for unsupported chains", () => {
            expect(adapter.getPoolAddress("solana")).toBeNull();
            expect(adapter.getPoolAddress("polygon")).toBeNull();
        });
        it("should return vault as receipt token (ERC-4626 shares = vault)", () => {
            const receiptToken = adapter.getReceiptToken("USDC", "base");
            const vaultAddress = adapter.getPoolAddress("base", "USDC");
            expect(receiptToken).toBe(vaultAddress);
        });
    });
    describe("Supply/Deposit Encoding (ERC-4626)", () => {
        it("should encode deposit with correct selector", () => {
            const result = adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            // ERC-4626 deposit selector: 0x6e553f65
            expect(result.data.startsWith(MORPHO_SELECTORS.deposit)).toBe(true);
        });
        it("should target the vault address (not a pool)", () => {
            const result = adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.to).toBe(MORPHO_VAULTS_ADDRESSES.base?.USDC);
        });
        it("should calculate correct raw amount for 6 decimals", () => {
            const result = adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            expect(result.amountRaw).toBe("100000000"); // 100 * 10^6
        });
        it("should produce ERC-4626 calldata structure (2 params)", () => {
            const result = adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            // ERC-4626 deposit: selector (10) + 2 params * 64 = 138 chars
            // deposit(uint256 assets, address receiver)
            expect(result.data.length).toBe(10 + 64 * 2);
        });
        it("should encode receiver address correctly", () => {
            const result = adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            });
            // Receiver should be in the second parameter slot (after amount)
            const receiverSlot = result.data.slice(74, 138);
            expect(receiverSlot.toLowerCase()).toContain(TEST_USER.slice(2).toLowerCase());
        });
    });
    describe("Withdraw Encoding (ERC-4626)", () => {
        it("should encode withdraw with correct selector for specific amounts", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "50",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // ERC-4626 withdraw selector: 0xb460af94
            expect(result.data.startsWith(MORPHO_SELECTORS.withdraw)).toBe(true);
        });
        it("should use redeem selector for max withdrawals", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // ERC-4626 redeem selector: 0xba087652
            expect(result.data.startsWith(MORPHO_SELECTORS.redeem)).toBe(true);
        });
        it("should handle 'all' as alias for max", () => {
            const resultAll = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "all",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            const resultMax = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            expect(resultAll.data).toBe(resultMax.data);
        });
        it("should encode MAX_UINT256 for redeem max shares", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            const maxUint256Hex = "f".repeat(64);
            expect(result.data).toContain(maxUint256Hex);
        });
        it("should produce ERC-4626 withdraw calldata (3 params)", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "50",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // ERC-4626 withdraw: selector (10) + 3 params * 64 = 202 chars
            // withdraw(uint256 assets, address receiver, address owner)
            expect(result.data.length).toBe(10 + 64 * 3);
        });
        it("should produce ERC-4626 redeem calldata (3 params)", () => {
            const result = adapter.encodeWithdraw({
                assetAddress: USDC_BASE,
                amount: "max",
                decimals: 6,
                to: TEST_USER,
                chain: "base",
            });
            // ERC-4626 redeem: selector (10) + 3 params * 64 = 202 chars
            // redeem(uint256 shares, address receiver, address owner)
            expect(result.data.length).toBe(10 + 64 * 3);
        });
    });
    describe("Error Handling", () => {
        it("should throw for unsupported chain on supply", () => {
            expect(() => adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "solana",
            })).toThrow(/not available/);
        });
        it("should throw for negative amounts", () => {
            expect(() => adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "-100",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            })).toThrow(/Negative/);
        });
        it("should throw for invalid amount format", () => {
            expect(() => adapter.encodeSupply({
                assetAddress: "USDC",
                amount: "invalid",
                decimals: 6,
                onBehalfOf: TEST_USER,
                chain: "base",
            })).toThrow(/Invalid amount/);
        });
    });
    describe("Vault Symbol Resolution", () => {
        it("should resolve default USDC vault", () => {
            const vault = adapter.getPoolAddress("base", "USDC");
            expect(vault).toBeTruthy();
        });
        it("should resolve curated vault by symbol", () => {
            const steakVault = adapter.getPoolAddress("base", "STEAKUSDC");
            const gauntletVault = adapter.getPoolAddress("base", "GTUSDCP");
            expect(steakVault).toBe("0x6ABfd6139c7C3CC270ee2Ce132E309F59cAaF6a2");
            expect(gauntletVault).toBe("0x12AfDe9a6FEAfb0c1C06B7EC8D58c47542c9E656");
        });
        it("should strip vault prefix to resolve base asset", () => {
            // STEAKUSDC -> USDC
            const steakVault = adapter.getPoolAddress("base", "STEAKUSDC");
            const defaultVault = adapter.getPoolAddress("base", "USDC");
            // Steakhouse is the default USDC vault on Base
            expect(steakVault).toBe(defaultVault);
        });
    });
});
describe("Cross-Protocol Comparison", () => {
    const aave = new AaveV3Adapter();
    const compound = new CompoundV3Adapter();
    const morpho = new MorphoAdapter();
    it("all three should produce valid calldata for same input", () => {
        const params = {
            assetAddress: USDC_BASE,
            amount: "100",
            decimals: 6,
            onBehalfOf: TEST_USER,
            chain: "base",
        };
        const aaveResult = aave.encodeSupply(params);
        const compoundResult = compound.encodeSupply(params);
        const morphoResult = morpho.encodeSupply({ ...params, assetAddress: "USDC" });
        // All should have valid hex data
        expect(aaveResult.data).toMatch(/^0x[0-9a-f]+$/i);
        expect(compoundResult.data).toMatch(/^0x[0-9a-f]+$/i);
        expect(morphoResult.data).toMatch(/^0x[0-9a-f]+$/i);
        // All should calculate same raw amount
        expect(aaveResult.amountRaw).toBe(compoundResult.amountRaw);
        expect(compoundResult.amountRaw).toBe(morphoResult.amountRaw);
        // Different pool/vault addresses
        expect(aaveResult.to).not.toBe(compoundResult.to);
        expect(compoundResult.to).not.toBe(morphoResult.to);
        expect(aaveResult.to).not.toBe(morphoResult.to);
    });
    it("should have different function selectors", () => {
        expect(AAVE_V3_SELECTORS.supply).not.toBe(COMPOUND_V3_SELECTORS.supply);
        expect(AAVE_V3_SELECTORS.supply).not.toBe(MORPHO_SELECTORS.deposit);
        expect(COMPOUND_V3_SELECTORS.supply).not.toBe(MORPHO_SELECTORS.deposit);
    });
    it("Aave has longest calldata (4 params), Compound and Morpho shorter (2 params)", () => {
        const params = {
            assetAddress: USDC_BASE,
            amount: "100",
            decimals: 6,
            onBehalfOf: TEST_USER,
            chain: "base",
        };
        const aaveData = aave.encodeSupply(params).data;
        const compoundData = compound.encodeSupply(params).data;
        const morphoData = morpho.encodeSupply({ ...params, assetAddress: "USDC" }).data;
        // Aave: 4 params = 266 chars
        // Compound: 2 params = 138 chars
        // Morpho (ERC-4626): 2 params = 138 chars
        expect(compoundData.length).toBeLessThan(aaveData.length);
        expect(morphoData.length).toBeLessThan(aaveData.length);
        expect(compoundData.length).toBe(morphoData.length);
    });
    it("max withdraw uses different approaches", () => {
        const withdrawParams = {
            assetAddress: USDC_BASE,
            amount: "max",
            decimals: 6,
            to: TEST_USER,
            chain: "base",
        };
        const aaveWithdraw = aave.encodeWithdraw(withdrawParams);
        const compoundWithdraw = compound.encodeWithdraw(withdrawParams);
        const morphoWithdraw = morpho.encodeWithdraw(withdrawParams);
        // All use MAX_UINT256 approach, but Morpho uses redeem() instead of withdraw()
        const maxUint256Hex = "f".repeat(64);
        expect(aaveWithdraw.data).toContain(maxUint256Hex);
        expect(compoundWithdraw.data).toContain(maxUint256Hex);
        expect(morphoWithdraw.data).toContain(maxUint256Hex);
        // Morpho uses redeem selector for max withdrawals
        expect(morphoWithdraw.data.startsWith(MORPHO_SELECTORS.redeem)).toBe(true);
        // Aave and Compound use withdraw selector
        expect(aaveWithdraw.data.startsWith(AAVE_V3_SELECTORS.withdraw)).toBe(true);
        expect(compoundWithdraw.data.startsWith(COMPOUND_V3_SELECTORS.withdraw)).toBe(true);
    });
});
//# sourceMappingURL=protocols.test.js.map