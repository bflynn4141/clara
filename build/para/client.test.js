/**
 * Unit tests for Para REST API client
 *
 * These tests mock fetch() to avoid hitting the real API.
 * For live API testing, use: npm run test:integration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;
// Mock session storage
vi.mock('../storage/session.js', () => ({
    getSession: vi.fn(),
    updateSession: vi.fn(),
}));
import { createPregenWallet, completeWalletSetup, getWalletAddress, getBalances, signMessage, simulateTransaction, CHAIN_CONFIG, } from './client.js';
import { getSession, updateSession } from '../storage/session.js';
describe('Para REST API Client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set API key for tests
        process.env.PARA_API_KEY = 'test-api-key';
    });
    afterEach(() => {
        delete process.env.PARA_API_KEY;
    });
    describe('createPregenWallet', () => {
        it('should create EVM and Solana wallets with email identifier', async () => {
            // Mock successful wallet creation responses (nested wallet object)
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    wallet: {
                        id: 'wallet-evm-123',
                        address: '0x1234567890abcdef1234567890abcdef12345678',
                        type: 'EVM',
                        status: 'ready',
                    },
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    wallet: {
                        id: 'wallet-sol-456',
                        address: 'SoLaNaAdDrEsS123456789',
                        type: 'SOLANA',
                        status: 'ready',
                    },
                }),
            });
            const result = await createPregenWallet({
                type: 'email',
                value: 'test@example.com',
            });
            expect(result.isExisting).toBe(false);
            expect(result.sessionId).toContain('new_email_test@example.com');
            // Verify fetch was called with correct params
            expect(mockFetch).toHaveBeenCalledTimes(2);
            // Check EVM wallet creation call
            const evmCall = mockFetch.mock.calls[0];
            expect(evmCall[0]).toContain('/v1/wallets');
            const evmBody = JSON.parse(evmCall[1].body);
            expect(evmBody.type).toBe('EVM');
            expect(evmBody.userIdentifier).toBe('test@example.com');
            expect(evmBody.userIdentifierType).toBe('EMAIL');
            // Check session was updated
            expect(updateSession).toHaveBeenCalledWith(expect.objectContaining({
                walletId: 'wallet-evm-123',
                solanaWalletId: 'wallet-sol-456',
                address: '0x1234567890abcdef1234567890abcdef12345678',
            }));
        });
        it('should create wallet with customId identifier', async () => {
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    wallet: {
                        id: 'wallet-evm-789',
                        address: '0xabcdef1234567890abcdef1234567890abcdef12',
                        type: 'EVM',
                        status: 'ready',
                    },
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    wallet: {
                        id: 'wallet-sol-012',
                        address: 'SoLaNa789012345',
                        type: 'SOLANA',
                        status: 'ready',
                    },
                }),
            });
            const customId = 'uuid-12345-67890';
            const result = await createPregenWallet({
                type: 'customId',
                value: customId,
            });
            expect(result.isExisting).toBe(false);
            const evmCall = mockFetch.mock.calls[0];
            const evmBody = JSON.parse(evmCall[1].body);
            expect(evmBody.userIdentifierType).toBe('CUSTOM_ID');
            expect(evmBody.userIdentifier).toBe(customId);
        });
        it('should handle existing wallet gracefully', async () => {
            // First call fails with 409 (already exists)
            mockFetch
                .mockResolvedValueOnce({
                ok: false,
                status: 409,
                text: () => Promise.resolve('Wallet already exists'),
            })
                // Then fetch existing wallets (wrapped in wallets array)
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    wallets: [
                        { id: 'existing-evm', address: '0xexisting', type: 'EVM' },
                        { id: 'existing-sol', address: 'ExistingSol', type: 'SOLANA' },
                    ],
                }),
            });
            const result = await createPregenWallet({
                type: 'email',
                value: 'existing@example.com',
            });
            expect(result.isExisting).toBe(true);
            expect(result.sessionId).toContain('existing_email_');
        });
    });
    describe('completeWalletSetup', () => {
        it('should return wallet info from session', async () => {
            vi.mocked(getSession).mockResolvedValue({
                authenticated: true,
                address: '0xtest123',
                solanaAddress: 'SolTest456',
                walletId: 'wallet-123',
                chains: [],
                createdAt: new Date().toISOString(),
                lastActiveAt: new Date().toISOString(),
            });
            const result = await completeWalletSetup('new_email_test@example.com');
            expect(result.address).toBe('0xtest123');
            expect(result.solanaAddress).toBe('SolTest456');
            expect(result.isNewWallet).toBe(true);
        });
        it('should throw if no wallet in session', async () => {
            vi.mocked(getSession).mockResolvedValue(null);
            await expect(completeWalletSetup('new_email_test@example.com')).rejects.toThrow('No wallet found in session');
        });
    });
    describe('getWalletAddress', () => {
        beforeEach(() => {
            vi.mocked(getSession).mockResolvedValue({
                authenticated: true,
                address: '0xEvmAddress',
                solanaAddress: 'SolanaAddress',
                walletId: 'evm-wallet',
                solanaWalletId: 'sol-wallet',
                chains: [],
                createdAt: new Date().toISOString(),
                lastActiveAt: new Date().toISOString(),
            });
        });
        it('should return EVM address for EVM chains', async () => {
            const address = await getWalletAddress('ethereum');
            expect(address).toBe('0xEvmAddress');
        });
        it('should return EVM address for Base', async () => {
            const address = await getWalletAddress('base');
            expect(address).toBe('0xEvmAddress');
        });
        it('should return Solana address for solana chain', async () => {
            const address = await getWalletAddress('solana');
            expect(address).toBe('SolanaAddress');
        });
        it('should throw if not authenticated', async () => {
            vi.mocked(getSession).mockResolvedValue(null);
            await expect(getWalletAddress('ethereum')).rejects.toThrow('Not authenticated');
        });
    });
    describe('getBalances', () => {
        beforeEach(() => {
            vi.mocked(getSession).mockResolvedValue({
                authenticated: true,
                address: '0xTest',
                walletId: 'wallet-1',
                chains: [],
                createdAt: new Date().toISOString(),
                lastActiveAt: new Date().toISOString(),
            });
        });
        it('should fetch EVM balance via RPC', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    result: '0xde0b6b3a7640000', // 1 ETH in wei (hex)
                }),
            });
            const balances = await getBalances('ethereum');
            expect(balances).toHaveLength(1);
            expect(balances[0].symbol).toBe('ETH');
            expect(parseFloat(balances[0].balance)).toBeCloseTo(1.0, 4);
        });
        it('should return MATIC for polygon', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x0' }),
            });
            const balances = await getBalances('polygon');
            expect(balances[0].symbol).toBe('MATIC');
        });
        it('should handle RPC errors gracefully', async () => {
            mockFetch.mockRejectedValueOnce(new Error('RPC error'));
            const balances = await getBalances('ethereum');
            expect(balances[0].balance).toBe('0.0');
        });
    });
    describe('signMessage', () => {
        beforeEach(() => {
            vi.mocked(getSession).mockResolvedValue({
                authenticated: true,
                address: '0xTest',
                walletId: 'wallet-evm-123',
                solanaWalletId: 'wallet-sol-456',
                chains: [],
                createdAt: new Date().toISOString(),
                lastActiveAt: new Date().toISOString(),
            });
        });
        it('should sign message via Para API using sign-raw endpoint', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    signature: 'abcdef123456signature',
                }),
            });
            const signature = await signMessage('Hello, World!');
            expect(signature).toBe('abcdef123456signature');
            // Verify correct API call to sign-raw endpoint
            const call = mockFetch.mock.calls[0];
            expect(call[0]).toContain('/v1/wallets/wallet-evm-123/sign-raw');
            expect(call[1].method).toBe('POST');
            const body = JSON.parse(call[1].body);
            // Data should be 0x-prefixed hex
            expect(body.data).toMatch(/^0x[0-9a-f]+$/i);
        });
        it('should use Solana wallet for solana chain', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ signature: 'solana-sig' }),
            });
            await signMessage('Hello Solana', 'solana');
            const call = mockFetch.mock.calls[0];
            expect(call[0]).toContain('wallet-sol-456');
            expect(call[0]).toContain('sign-raw');
        });
        it('should throw if not authenticated', async () => {
            vi.mocked(getSession).mockResolvedValue(null);
            await expect(signMessage('test')).rejects.toThrow('Not authenticated');
        });
    });
    describe('CHAIN_CONFIG', () => {
        it('should have all supported chains', () => {
            expect(CHAIN_CONFIG).toHaveProperty('ethereum');
            expect(CHAIN_CONFIG).toHaveProperty('base');
            expect(CHAIN_CONFIG).toHaveProperty('arbitrum');
            expect(CHAIN_CONFIG).toHaveProperty('optimism');
            expect(CHAIN_CONFIG).toHaveProperty('polygon');
            expect(CHAIN_CONFIG).toHaveProperty('solana');
        });
        it('should have correct chain IDs for EVM chains', () => {
            expect(CHAIN_CONFIG.ethereum.chainId).toBe(1);
            expect(CHAIN_CONFIG.base.chainId).toBe(8453);
            expect(CHAIN_CONFIG.arbitrum.chainId).toBe(42161);
            expect(CHAIN_CONFIG.polygon.chainId).toBe(137);
        });
        it('should not have chainId for Solana', () => {
            expect(CHAIN_CONFIG.solana.chainId).toBeUndefined();
        });
    });
    describe('simulateTransaction', () => {
        beforeEach(() => {
            vi.mocked(getSession).mockResolvedValue({
                authenticated: true,
                address: '0xTestAddress1234567890abcdef1234567890ab',
                walletId: 'wallet-evm-123',
                solanaWalletId: 'wallet-sol-456',
                solanaAddress: 'SolanaTestAddress123',
                chains: [],
                createdAt: new Date().toISOString(),
                lastActiveAt: new Date().toISOString(),
            });
        });
        it('should simulate a simple ETH transfer', async () => {
            // Mock eth_call (simulation) - success
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x' }),
            })
                // Mock eth_estimateGas
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x5208' }), // 21000 gas
            })
                // Mock CoinGecko price fetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    ethereum: { usd: 2500, usd_24h_change: 1.5 },
                }),
            });
            const result = await simulateTransaction({
                to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
                value: '1000000000000000000', // 1 ETH
            }, 'ethereum');
            expect(result.success).toBe(true);
            expect(result.action).toBe('Native Transfer');
            expect(result.description).toContain('Send');
            // 1 ETH is exactly at threshold, so no warning (warning is for > 1 ETH)
            expect(result.gasEstimate).toBeDefined();
        });
        it('should detect unlimited token approval', async () => {
            // Unlimited approval calldata
            const unlimitedApproval = '0x095ea7b3' +
                '0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d' +
                'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x' }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0xea60' }), // 60000 gas
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    ethereum: { usd: 2500, usd_24h_change: 1.5 },
                }),
            });
            const result = await simulateTransaction({
                to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
                data: unlimitedApproval,
            }, 'ethereum');
            expect(result.success).toBe(true);
            expect(result.action).toBe('approve');
            expect(result.warnings).toContainEqual(expect.stringContaining('UNLIMITED APPROVAL'));
        });
        it('should detect known contracts', async () => {
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x' }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x5208' }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    ethereum: { usd: 2500, usd_24h_change: 1.5 },
                }),
            });
            const result = await simulateTransaction({
                to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
                value: '1000000000000000000',
            }, 'ethereum');
            expect(result.details.contract).toBe('WETH');
        });
        it('should handle simulation failure (revert)', async () => {
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    error: { message: 'execution reverted: insufficient balance' },
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result: '0x5208' }),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    ethereum: { usd: 2500, usd_24h_change: 1.5 },
                }),
            });
            const result = await simulateTransaction({
                to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
                value: '1000000000000000000000000', // Way too much ETH
            }, 'ethereum');
            expect(result.success).toBe(false);
            expect(result.warnings).toContainEqual(expect.stringContaining('REVERT'));
        });
        it('should throw if not authenticated', async () => {
            vi.mocked(getSession).mockResolvedValue(null);
            await expect(simulateTransaction({ to: '0x123' }, 'ethereum')).rejects.toThrow('Not authenticated');
        });
        it('should handle Solana transactions with limited simulation', async () => {
            const result = await simulateTransaction({
                to: 'SomeSOLAddress',
                value: '1000000000', // 1 SOL in lamports
            }, 'solana');
            expect(result.success).toBe(true);
            expect(result.action).toBe('Solana Transaction');
            expect(result.warnings).toContainEqual(expect.stringContaining('Solana simulation limited'));
        });
    });
});
//# sourceMappingURL=client.test.js.map