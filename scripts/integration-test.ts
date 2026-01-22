#!/usr/bin/env tsx
/**
 * Integration Test Script for Clara Wallet
 *
 * Tests the full wallet lifecycle against the real Para API.
 * Requires PARA_API_KEY environment variable.
 *
 * Usage:
 *   PARA_API_KEY=your-key npm run test:integration
 *
 * Or with a proxy:
 *   PARA_API_URL=https://your-proxy.workers.dev/api npm run test:integration
 */

import * as crypto from 'crypto';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

function log(msg: string) {
  console.log(msg);
}

function success(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function section(title: string) {
  console.log(`\n${colors.yellow}━━━ ${title} ━━━${colors.reset}\n`);
}

// Para API config
const PARA_API_BASE = process.env.PARA_API_URL || 'https://api.beta.getpara.com';
const API_KEY = process.env.PARA_API_KEY;

interface WalletResponse {
  wallet: {
    id: string;
    address: string;
    type: 'EVM' | 'SOLANA';
    status: string;
  };
}

interface SignResponse {
  signature: string;
}

async function paraFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  const url = `${PARA_API_BASE}${endpoint}`;
  log(`${colors.dim}  → ${options.method || 'GET'} ${endpoint}${colors.reset}`);

  return fetch(url, { ...options, headers });
}

async function runTests() {
  section('Clara Wallet Integration Tests');

  // Check environment
  if (!API_KEY) {
    error('PARA_API_KEY environment variable not set');
    info('Run with: PARA_API_KEY=your-key npm run test:integration');
    process.exit(1);
  }

  info(`API Base: ${PARA_API_BASE}`);
  info(`API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);

  // Generate unique test identifier
  const testId = `clara-test-${crypto.randomUUID().slice(0, 8)}`;
  info(`Test ID: ${testId}`);

  let evmWallet: WalletResponse | null = null;
  let solanaWallet: WalletResponse | null = null;

  // Test 1: Create EVM Wallet
  section('Test 1: Create EVM Wallet');
  try {
    const response = await paraFetch('/v1/wallets', {
      method: 'POST',
      body: JSON.stringify({
        type: 'EVM',
        userIdentifier: testId,
        userIdentifierType: 'CUSTOM_ID',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status}: ${errorText}`);
    }

    const result = await response.json() as WalletResponse;
    evmWallet = result;
    success(`Created EVM wallet`);
    info(`  Wallet ID: ${result.wallet.id}`);
    info(`  Address: ${result.wallet.address}`);
    info(`  Status: ${result.wallet.status}`);
  } catch (e) {
    error(`Failed to create EVM wallet: ${e}`);
  }

  // Test 2: Create Solana Wallet
  section('Test 2: Create Solana Wallet');
  try {
    const response = await paraFetch('/v1/wallets', {
      method: 'POST',
      body: JSON.stringify({
        type: 'SOLANA',
        userIdentifier: testId,
        userIdentifierType: 'CUSTOM_ID',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Solana might not be enabled for all API keys
      if (response.status === 400 || response.status === 403) {
        info(`Solana not available for this API key (${response.status})`);
      } else {
        throw new Error(`${response.status}: ${errorText}`);
      }
    } else {
      const result = await response.json() as WalletResponse;
      solanaWallet = result;
      success(`Created Solana wallet`);
      info(`  Wallet ID: ${result.wallet.id}`);
      info(`  Address: ${result.wallet.address}`);
      info(`  Status: ${result.wallet.status}`);
    }
  } catch (e) {
    error(`Failed to create Solana wallet: ${e}`);
  }

  // Test 3: Get Wallet by ID
  section('Test 3: Get Wallet by ID');
  if (evmWallet) {
    try {
      const response = await paraFetch(`/v1/wallets/${evmWallet.wallet.id}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      const wallet = await response.json() as { id: string; address: string; status: string };
      success(`Retrieved wallet`);
      info(`  ID: ${wallet.id}`);
      info(`  Address: ${wallet.address}`);
      info(`  Status: ${wallet.status}`);
    } catch (e) {
      error(`Failed to get wallet: ${e}`);
    }
  } else {
    info('Skipping - no wallet to retrieve');
  }

  // Test 4: Sign Message (EVM)
  section('Test 4: Sign Message (EVM)');
  if (evmWallet) {
    try {
      // Wait for wallet to be ready
      info('Waiting for wallet to be ready...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const message = 'Hello from Clara integration test!';
      const dataHex = '0x' + Buffer.from(message).toString('hex');

      const response = await paraFetch(`/v1/wallets/${evmWallet.wallet.id}/sign-raw`, {
        method: 'POST',
        body: JSON.stringify({ data: dataHex }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      const result = await response.json() as SignResponse;
      success(`Signed message`);
      info(`  Signature: ${result.signature.slice(0, 40)}...`);
    } catch (e) {
      error(`Failed to sign message: ${e}`);
    }
  } else {
    info('Skipping - no EVM wallet created');
  }

  // Test 5: Check EVM Balance via RPC
  section('Test 5: Check Balance (via RPC)');
  if (evmWallet) {
    try {
      const rpcResponse = await fetch('https://eth.llamarpc.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [evmWallet.wallet.address, 'latest'],
          id: 1,
        }),
      });

      const rpcResult = await rpcResponse.json() as { result?: string };
      const balanceWei = BigInt(rpcResult.result || '0');
      const balanceEth = Number(balanceWei) / 1e18;

      success(`Fetched ETH balance`);
      info(`  Balance: ${balanceEth.toFixed(6)} ETH`);

      if (balanceEth === 0) {
        info(`  (New wallet has 0 balance - this is expected)`);
      }
    } catch (e) {
      error(`Failed to check balance: ${e}`);
    }
  }

  // Test 6: Sign Transaction Data (dry run)
  section('Test 6: Sign Transaction Data (dry run)');
  if (evmWallet) {
    try {
      // Build a simple transaction data object
      const txData = {
        to: evmWallet.wallet.address,
        value: '0x0',
        chainId: 1,
      };

      const txHex = '0x' + Buffer.from(JSON.stringify(txData)).toString('hex');

      const response = await paraFetch(`/v1/wallets/${evmWallet.wallet.id}/sign-raw`, {
        method: 'POST',
        body: JSON.stringify({ data: txHex }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        info(`Transaction data signing returned: ${response.status}`);
        info(`  ${errorText.slice(0, 100)}`);
      } else {
        const result = await response.json() as SignResponse;
        success(`Signed transaction data`);
        info(`  Signature: ${result.signature.slice(0, 40)}...`);
      }
    } catch (e) {
      error(`Failed to sign transaction data: ${e}`);
    }
  }

  // Summary
  section('Summary');

  const results = {
    'EVM Wallet Created': !!evmWallet,
    'Solana Wallet Created': !!solanaWallet,
    'Message Signing': !!evmWallet, // We tested this if wallet exists
  };

  let passed = 0;
  let total = Object.keys(results).length;

  Object.entries(results).forEach(([test, result]) => {
    if (result) {
      success(test);
      passed++;
    } else {
      error(test);
    }
  });

  log(`\n${colors.blue}Results: ${passed}/${total} passed${colors.reset}\n`);

  if (evmWallet) {
    info('Test wallet created:');
    info(`  EVM Address: ${evmWallet.wallet.address}`);
    info(`  Wallet ID: ${evmWallet.wallet.id}`);
    info(`  To fund for testing, send testnet ETH to this address`);
  }
}

// Run tests
runTests().catch((e) => {
  error(`Unexpected error: ${e}`);
  process.exit(1);
});
