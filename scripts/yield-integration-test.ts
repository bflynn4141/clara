#!/usr/bin/env tsx
/**
 * Yield Integration Test
 *
 * This script validates Clara's yield functionality against real APIs:
 * - DeFiLlama Yields API availability
 * - Aave v3 pool existence
 * - USDC opportunity availability
 *
 * Run: npm run test:yield-integration
 *
 * NOT run in CI - for manual validation only.
 */

const DEFILLAMA_API = "https://yields.llama.fi/pools";

// Expected Aave v3 pool addresses (should match client.ts)
const EXPECTED_POOLS = {
  base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

// USDC addresses per chain
const USDC_ADDRESSES = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

interface Pool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  underlyingTokens: string[];
}

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

async function runTests(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Clara Yield Integration Test");
  console.log("  Testing against real DeFiLlama API");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results: TestResult[] = [];

  // Test 1: DeFiLlama API is reachable
  console.log("📡 Test 1: DeFiLlama API reachability...");
  try {
    const response = await fetch(DEFILLAMA_API);
    if (response.ok) {
      results.push({ name: "DeFiLlama API reachable", passed: true });
      console.log("   ✅ API responded with status 200\n");
    } else {
      results.push({
        name: "DeFiLlama API reachable",
        passed: false,
        error: `Status ${response.status}`,
      });
      console.log(`   ❌ API returned status ${response.status}\n`);
    }
  } catch (error) {
    results.push({
      name: "DeFiLlama API reachable",
      passed: false,
      error: String(error),
    });
    console.log(`   ❌ Network error: ${error}\n`);
  }

  // Test 2: Response schema is valid
  console.log("📋 Test 2: Response schema validation...");
  let pools: Pool[] = [];
  try {
    const response = await fetch(DEFILLAMA_API);
    const data = (await response.json()) as { data: Pool[] };

    if (Array.isArray(data.data)) {
      pools = data.data;
      results.push({
        name: "Response has data array",
        passed: true,
        details: `Found ${pools.length} total pools`,
      });
      console.log(`   ✅ Response contains ${pools.length} pools\n`);
    } else {
      results.push({
        name: "Response has data array",
        passed: false,
        error: "data.data is not an array",
      });
      console.log("   ❌ Response schema invalid\n");
    }
  } catch (error) {
    results.push({
      name: "Response has data array",
      passed: false,
      error: String(error),
    });
    console.log(`   ❌ Parse error: ${error}\n`);
  }

  // Test 3: Aave v3 pools exist
  console.log("🏦 Test 3: Aave v3 protocol pools exist...");
  const aaveV3Pools = pools.filter((p) => p.project === "aave-v3");
  if (aaveV3Pools.length > 0) {
    results.push({
      name: "Aave v3 pools exist",
      passed: true,
      details: `Found ${aaveV3Pools.length} Aave v3 pools`,
    });
    console.log(`   ✅ Found ${aaveV3Pools.length} Aave v3 pools\n`);
  } else {
    results.push({
      name: "Aave v3 pools exist",
      passed: false,
      error: "No aave-v3 pools found",
    });
    console.log("   ❌ No Aave v3 pools found\n");
  }

  // Test 4: USDC opportunities on Base
  console.log("💵 Test 4: USDC opportunities on Base...");
  const baseUsdc = aaveV3Pools.filter(
    (p) =>
      p.chain.toLowerCase() === "base" && p.symbol.toUpperCase().includes("USDC")
  );
  if (baseUsdc.length > 0) {
    const best = baseUsdc.sort((a, b) => b.apy - a.apy)[0];
    results.push({
      name: "USDC on Base available",
      passed: true,
      details: `Best APY: ${best.apy.toFixed(2)}%, TVL: $${(best.tvlUsd / 1e6).toFixed(1)}M`,
    });
    console.log(`   ✅ Found ${baseUsdc.length} USDC pool(s)`);
    console.log(`      Best: ${best.apy.toFixed(2)}% APY, $${(best.tvlUsd / 1e6).toFixed(1)}M TVL\n`);
  } else {
    results.push({
      name: "USDC on Base available",
      passed: false,
      error: "No USDC pools on Base",
    });
    console.log("   ❌ No USDC opportunities on Base\n");
  }

  // Test 5: USDC opportunities on Arbitrum
  console.log("💵 Test 5: USDC opportunities on Arbitrum...");
  const arbUsdc = aaveV3Pools.filter(
    (p) =>
      p.chain.toLowerCase() === "arbitrum" && p.symbol.toUpperCase().includes("USDC")
  );
  if (arbUsdc.length > 0) {
    const best = arbUsdc.sort((a, b) => b.apy - a.apy)[0];
    results.push({
      name: "USDC on Arbitrum available",
      passed: true,
      details: `Best APY: ${best.apy.toFixed(2)}%, TVL: $${(best.tvlUsd / 1e6).toFixed(1)}M`,
    });
    console.log(`   ✅ Found ${arbUsdc.length} USDC pool(s)`);
    console.log(`      Best: ${best.apy.toFixed(2)}% APY, $${(best.tvlUsd / 1e6).toFixed(1)}M TVL\n`);
  } else {
    results.push({
      name: "USDC on Arbitrum available",
      passed: false,
      error: "No USDC pools on Arbitrum",
    });
    console.log("   ❌ No USDC opportunities on Arbitrum\n");
  }

  // Test 6: TVL is above minimum threshold
  console.log("📊 Test 6: TVL meets minimum threshold ($1M)...");
  const highTvlPools = [...baseUsdc, ...arbUsdc].filter(
    (p) => p.tvlUsd >= 1_000_000
  );
  if (highTvlPools.length > 0) {
    results.push({
      name: "Pools meet TVL threshold",
      passed: true,
      details: `${highTvlPools.length} pools above $1M TVL`,
    });
    console.log(`   ✅ ${highTvlPools.length} pools have TVL >= $1M\n`);
  } else {
    results.push({
      name: "Pools meet TVL threshold",
      passed: false,
      error: "No pools above $1M TVL",
    });
    console.log("   ❌ No pools meet minimum TVL\n");
  }

  // Test 7: Verify pool schema has required fields
  console.log("🔍 Test 7: Pool schema has required fields...");
  const samplePool = aaveV3Pools[0];
  const requiredFields = [
    "pool",
    "chain",
    "project",
    "symbol",
    "tvlUsd",
    "apy",
  ];
  const missingFields = requiredFields.filter(
    (f) => !(f in (samplePool || {}))
  );

  if (samplePool && missingFields.length === 0) {
    results.push({
      name: "Pool schema valid",
      passed: true,
      details: "All required fields present",
    });
    console.log("   ✅ All required fields present\n");
  } else {
    results.push({
      name: "Pool schema valid",
      passed: false,
      error: missingFields.length > 0 ? `Missing: ${missingFields.join(", ")}` : "No pools to validate",
    });
    console.log(`   ❌ Missing fields: ${missingFields.join(", ")}\n`);
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  results.forEach((r) => {
    const status = r.passed ? "✅" : "❌";
    const detail = r.passed ? (r.details || "") : (r.error || "");
    console.log(`  ${status} ${r.name}${detail ? `: ${detail}` : ""}`);
  });

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("───────────────────────────────────────────────────────────────\n");

  // Exit with error code if any tests failed
  if (failed > 0) {
    console.log("⚠️  Some tests failed. Check DeFiLlama API status.\n");
    process.exit(1);
  } else {
    console.log("🎉 All integration tests passed!\n");
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
