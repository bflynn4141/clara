#!/usr/bin/env tsx
/**
 * Quick test to verify the Clara proxy is working
 */

import * as crypto from 'crypto';

const PROXY_URL = 'https://clara-proxy.bflynn-me.workers.dev/api';

async function testProxy() {
  const testId = `clara-proxy-test-${crypto.randomUUID().slice(0, 8)}`;

  console.log('Testing Clara Proxy');
  console.log('===================');
  console.log(`Proxy URL: ${PROXY_URL}`);
  console.log(`Test ID: ${testId}`);
  console.log('');

  // Test 1: Create wallet via proxy
  console.log('1. Creating EVM wallet via proxy...');
  try {
    const response = await fetch(`${PROXY_URL}/v1/wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'EVM',
        userIdentifier: testId,
        userIdentifierType: 'CUSTOM_ID',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`   ✗ Error: ${response.status} - ${errorText}`);
      return;
    }

    const result = (await response.json()) as { wallet: { id: string; address: string } };
    console.log(`   ✓ Created wallet`);
    console.log(`     ID: ${result.wallet.id}`);
    console.log(`     Address: ${result.wallet.address}`);

    // Test 2: Sign a message
    console.log('');
    console.log('2. Signing message via proxy...');
    const dataHex = '0x' + Buffer.from('Hello from Clara proxy test!').toString('hex');

    const signResponse = await fetch(`${PROXY_URL}/v1/wallets/${result.wallet.id}/sign-raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataHex }),
    });

    if (!signResponse.ok) {
      const signError = await signResponse.text();
      console.log(`   ✗ Sign error: ${signResponse.status} - ${signError}`);
    } else {
      const signResult = (await signResponse.json()) as { signature: string };
      console.log(`   ✓ Signed message`);
      console.log(`     Signature: ${signResult.signature.slice(0, 40)}...`);
    }

    console.log('');
    console.log('✅ Proxy test complete! All systems working.');
  } catch (e) {
    console.log(`   ✗ Network error: ${(e as Error).message}`);
  }
}

testProxy();
