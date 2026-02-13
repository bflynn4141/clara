/**
 * Aave v3 calldata test vectors
 *
 * These are known-good calldata values derived from:
 * 1. Manual calculation following Aave v3 ABI
 * 2. Cross-reference with Etherscan transaction decoding
 *
 * The calldata format for supply():
 *   0x617ba037 (selector)
 *   + asset address (32 bytes, padded)
 *   + amount (32 bytes, uint256)
 *   + onBehalfOf address (32 bytes, padded)
 *   + referralCode (32 bytes, uint16 padded to 32)
 *
 * The calldata format for withdraw():
 *   0x69328dec (selector)
 *   + asset address (32 bytes, padded)
 *   + amount (32 bytes, uint256)
 *   + to address (32 bytes, padded)
 */
// Aave v3 function selectors
export const AAVE_SELECTORS = {
    supply: "0x617ba037", // supply(address,uint256,address,uint16)
    withdraw: "0x69328dec", // withdraw(address,uint256,address)
};
// MAX_UINT256 for "withdraw all"
export const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
// Test addresses (checksummed)
export const TEST_ADDRESSES = {
    user: "0x742d35Cc6634C0532925a3b844Bc9e7595f1e9A6",
    usdc: {
        base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    },
    dai: {
        arbitrum: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    },
    aavePool: {
        base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    },
};
/**
 * Supply test vectors
 * Each vector includes input parameters and expected output calldata
 */
export const SUPPLY_TEST_VECTORS = [
    {
        name: "USDC supply 100 on Base (6 decimals)",
        input: {
            assetAddress: TEST_ADDRESSES.usdc.base,
            amount: "100",
            decimals: 6,
            onBehalfOf: TEST_ADDRESSES.user,
        },
        // 100 USDC = 100 * 10^6 = 100000000 = 0x5F5E100
        expectedCalldata: "0x617ba037" + // selector
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" + // asset
            "0000000000000000000000000000000000000000000000000000000005f5e100" + // amount
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6" + // onBehalfOf
            "0000000000000000000000000000000000000000000000000000000000000000", // referral=0
        expectedAmountRaw: "100000000",
    },
    {
        name: "USDC supply 1000 on Arbitrum (6 decimals)",
        input: {
            assetAddress: TEST_ADDRESSES.usdc.arbitrum,
            amount: "1000",
            decimals: 6,
            onBehalfOf: TEST_ADDRESSES.user,
        },
        // 1000 USDC = 1000 * 10^6 = 1000000000 = 0x3B9ACA00
        expectedCalldata: "0x617ba037" +
            "000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831" +
            "000000000000000000000000000000000000000000000000000000003b9aca00" +
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6" +
            "0000000000000000000000000000000000000000000000000000000000000000",
        expectedAmountRaw: "1000000000",
    },
    {
        name: "DAI supply 500 on Arbitrum (18 decimals)",
        input: {
            assetAddress: TEST_ADDRESSES.dai.arbitrum,
            amount: "500",
            decimals: 18,
            onBehalfOf: TEST_ADDRESSES.user,
        },
        // 500 DAI = 500 * 10^18 = 500000000000000000000 = 0x1B1AE4D6E2EF500000
        // Padded to 64 hex chars (32 bytes)
        expectedCalldata: "0x617ba037" +
            "000000000000000000000000da10009cbd5d07dd0cecc66161fc93d7c9000da1" +
            "00000000000000000000000000000000000000000000001b1ae4d6e2ef500000" +
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6" +
            "0000000000000000000000000000000000000000000000000000000000000000",
        expectedAmountRaw: "500000000000000000000",
    },
    {
        name: "USDC supply 0.01 (small amount, 6 decimals)",
        input: {
            assetAddress: TEST_ADDRESSES.usdc.base,
            amount: "0.01",
            decimals: 6,
            onBehalfOf: TEST_ADDRESSES.user,
        },
        // 0.01 USDC = 0.01 * 10^6 = 10000 = 0x2710
        expectedCalldata: "0x617ba037" +
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" +
            "0000000000000000000000000000000000000000000000000000000000002710" +
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6" +
            "0000000000000000000000000000000000000000000000000000000000000000",
        expectedAmountRaw: "10000",
    },
];
/**
 * Withdraw test vectors
 */
export const WITHDRAW_TEST_VECTORS = [
    {
        name: "USDC withdraw 50 on Base (6 decimals)",
        input: {
            assetAddress: TEST_ADDRESSES.usdc.base,
            amount: "50",
            decimals: 6,
            to: TEST_ADDRESSES.user,
        },
        // 50 USDC = 50 * 10^6 = 50000000 = 0x2FAF080
        expectedCalldata: "0x69328dec" + // selector
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" + // asset
            "0000000000000000000000000000000000000000000000000000000002faf080" + // amount
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6", // to
        expectedAmountRaw: "50000000",
    },
    {
        name: "USDC withdraw max (all) on Base",
        input: {
            assetAddress: TEST_ADDRESSES.usdc.base,
            amount: "max",
            decimals: 6,
            to: TEST_ADDRESSES.user,
        },
        // max = type(uint256).max
        expectedCalldata: "0x69328dec" +
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" +
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" +
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6",
        expectedAmountRaw: MAX_UINT256.toString(),
    },
    {
        name: "USDC withdraw all (alias for max)",
        input: {
            assetAddress: TEST_ADDRESSES.usdc.arbitrum,
            amount: "all",
            decimals: 6,
            to: TEST_ADDRESSES.user,
        },
        expectedCalldata: "0x69328dec" +
            "000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831" +
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" +
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6",
        expectedAmountRaw: MAX_UINT256.toString(),
    },
    {
        name: "DAI withdraw 100 on Arbitrum (18 decimals)",
        input: {
            assetAddress: TEST_ADDRESSES.dai.arbitrum,
            amount: "100",
            decimals: 18,
            to: TEST_ADDRESSES.user,
        },
        // 100 DAI = 100 * 10^18 = 100000000000000000000 = 0x56BC75E2D63100000
        expectedCalldata: "0x69328dec" +
            "000000000000000000000000da10009cbd5d07dd0cecc66161fc93d7c9000da1" +
            "0000000000000000000000000000000000000000000000056bc75e2d63100000" +
            "000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f1e9a6",
        expectedAmountRaw: "100000000000000000000",
    },
];
/**
 * Helper to decode and verify calldata components
 */
export function decodeSupplyCalldata(calldata) {
    const clean = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
    return {
        selector: "0x" + clean.slice(0, 8),
        asset: "0x" + clean.slice(8 + 24, 8 + 64), // Remove 24 chars of padding
        amount: BigInt("0x" + clean.slice(72, 136)),
        onBehalfOf: "0x" + clean.slice(136 + 24, 136 + 64),
        referralCode: parseInt(clean.slice(200, 264), 16),
    };
}
export function decodeWithdrawCalldata(calldata) {
    const clean = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
    return {
        selector: "0x" + clean.slice(0, 8),
        asset: "0x" + clean.slice(8 + 24, 8 + 64),
        amount: BigInt("0x" + clean.slice(72, 136)),
        to: "0x" + clean.slice(136 + 24, 136 + 64),
    };
}
/**
 * Combined fixture export
 */
export const AAVE_TEST_VECTORS = {
    supply: SUPPLY_TEST_VECTORS,
    withdraw: WITHDRAW_TEST_VECTORS,
    selectors: AAVE_SELECTORS,
    addresses: TEST_ADDRESSES,
    maxUint256: MAX_UINT256,
    decodeSupply: decodeSupplyCalldata,
    decodeWithdraw: decodeWithdrawCalldata,
};
export default AAVE_TEST_VECTORS;
//# sourceMappingURL=aave-calldata.js.map