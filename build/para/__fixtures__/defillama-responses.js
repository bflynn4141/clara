/**
 * Mock DeFiLlama API responses for yield testing
 *
 * These fixtures simulate the /pools endpoint responses
 * with various scenarios for testing filtering and edge cases.
 */
/**
 * Normal case: Multiple USDC opportunities across Base and Arbitrum
 * Tests sorting by APY and chain filtering
 */
export const MULTIPLE_OPPORTUNITIES = {
    data: [
        {
            pool: "aave-v3-base-usdc",
            chain: "Base",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 150_000_000,
            apy: 4.25,
            apyBase: 3.75,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
        },
        {
            pool: "aave-v3-arbitrum-usdc",
            chain: "Arbitrum",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 250_000_000,
            apy: 5.12,
            apyBase: 4.62,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
        },
        {
            pool: "aave-v3-ethereum-usdc",
            chain: "Ethereum",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 500_000_000,
            apy: 3.85,
            apyBase: 3.35,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
        },
    ],
};
/**
 * Empty response - no pools match criteria
 */
export const NO_OPPORTUNITIES = {
    data: [],
};
/**
 * All pools filtered out - pools exist but don't match our criteria
 * Tests that filtering correctly removes unsupported chains/protocols
 */
export const ALL_FILTERED_OUT = {
    data: [
        {
            pool: "compound-v3-ethereum-usdc",
            chain: "Ethereum",
            project: "compound-v3", // Wrong protocol
            symbol: "USDC",
            tvlUsd: 200_000_000,
            apy: 4.5,
            apyBase: 4.5,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
        },
        {
            pool: "aave-v3-avalanche-usdc",
            chain: "Avalanche", // Wrong chain (not in Base/Arbitrum)
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 80_000_000,
            apy: 3.2,
            apyBase: 3.2,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: [],
        },
    ],
};
/**
 * Low TVL pools - should be filtered by $1M minimum
 */
export const LOW_TVL_POOLS = {
    data: [
        {
            pool: "aave-v3-base-usdc-low",
            chain: "Base",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 500_000, // Below $1M threshold
            apy: 8.5, // High APY but risky
            apyBase: 8.5,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: [],
        },
        {
            pool: "aave-v3-arbitrum-usdc-low",
            chain: "Arbitrum",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 100_000, // Way below threshold
            apy: 12.0,
            apyBase: 12.0,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: [],
        },
    ],
};
/**
 * Mixed assets - tests symbol filtering
 */
export const MIXED_ASSETS = {
    data: [
        {
            pool: "aave-v3-base-usdc",
            chain: "Base",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 150_000_000,
            apy: 4.25,
            apyBase: 3.75,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: [],
        },
        {
            pool: "aave-v3-base-weth",
            chain: "Base",
            project: "aave-v3",
            symbol: "WETH",
            tvlUsd: 100_000_000,
            apy: 2.1,
            apyBase: 1.8,
            apyReward: 0.3,
            stablecoin: false,
            underlyingTokens: [],
        },
        {
            pool: "aave-v3-arbitrum-dai",
            chain: "Arbitrum",
            project: "aave-v3",
            symbol: "DAI",
            tvlUsd: 80_000_000,
            apy: 3.8,
            apyBase: 3.8,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: [],
        },
        {
            pool: "aave-v3-arbitrum-usdc",
            chain: "Arbitrum",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 250_000_000,
            apy: 5.12,
            apyBase: 4.62,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: [],
        },
    ],
};
/**
 * Malformed response - tests error handling
 */
export const MALFORMED_RESPONSE = {
    invalid: "response",
    notData: [],
};
/**
 * Response with null APY values - tests null handling
 */
export const NULL_APY_VALUES = {
    data: [
        {
            pool: "aave-v3-base-usdc",
            chain: "Base",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 150_000_000,
            apy: 0, // No APY data
            apyBase: null,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: [],
        },
    ],
};
/**
 * Multi-protocol response - tests protocol selection and comparison
 * Includes both Aave V3 and Compound V3 opportunities
 */
export const MULTI_PROTOCOL = {
    data: [
        {
            pool: "aave-v3-base-usdc",
            chain: "Base",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 150_000_000,
            apy: 4.25,
            apyBase: 3.75,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
        },
        {
            pool: "compound-v3-base-usdc",
            chain: "Base",
            project: "compound-v3",
            symbol: "USDC",
            tvlUsd: 120_000_000,
            apy: 4.85, // Compound has better rate in this scenario
            apyBase: 4.85,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
        },
        {
            pool: "aave-v3-arbitrum-usdc",
            chain: "Arbitrum",
            project: "aave-v3",
            symbol: "USDC",
            tvlUsd: 250_000_000,
            apy: 5.12,
            apyBase: 4.62,
            apyReward: 0.5,
            stablecoin: true,
            underlyingTokens: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
        },
        {
            pool: "compound-v3-arbitrum-usdc",
            chain: "Arbitrum",
            project: "compound-v3",
            symbol: "USDC",
            tvlUsd: 180_000_000,
            apy: 4.95,
            apyBase: 4.95,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
        },
        {
            pool: "compound-v3-ethereum-usdc",
            chain: "Ethereum",
            project: "compound-v3",
            symbol: "USDC",
            tvlUsd: 500_000_000,
            apy: 3.65,
            apyBase: 3.65,
            apyReward: null,
            stablecoin: true,
            underlyingTokens: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
        },
    ],
};
/**
 * Combined fixture export for easy imports
 */
export const DEFILLAMA_FIXTURES = {
    multipleOpportunities: MULTIPLE_OPPORTUNITIES,
    noOpportunities: NO_OPPORTUNITIES,
    allFilteredOut: ALL_FILTERED_OUT,
    lowTvlPools: LOW_TVL_POOLS,
    mixedAssets: MIXED_ASSETS,
    malformed: MALFORMED_RESPONSE,
    nullApyValues: NULL_APY_VALUES,
    multiProtocol: MULTI_PROTOCOL,
};
export default DEFILLAMA_FIXTURES;
//# sourceMappingURL=defillama-responses.js.map