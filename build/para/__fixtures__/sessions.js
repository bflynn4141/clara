/**
 * Test session fixtures for authentication states
 *
 * These fixtures simulate different authentication states
 * for testing yield/lending operations that require wallet access.
 */
/**
 * Fully authenticated session with EVM wallet
 */
export const AUTHENTICATED_SESSION = {
    walletId: "wallet-evm-test-123",
    solanaWalletId: "wallet-sol-test-456",
    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f1e9A6",
    solanaAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    identifier: {
        type: "email",
        value: "test@example.com",
    },
    authenticated: true,
    createdAt: Date.now() - 86400000, // 1 day ago
    lastUsed: Date.now(),
};
/**
 * Session that's not fully authenticated (wallet created but not verified)
 */
export const UNAUTHENTICATED_SESSION = {
    walletId: "wallet-evm-pending-789",
    address: "0x1234567890123456789012345678901234567890",
    identifier: {
        type: "email",
        value: "pending@example.com",
    },
    authenticated: false,
    createdAt: Date.now(),
    lastUsed: Date.now(),
};
/**
 * No session (null) - user never set up wallet
 */
export const NO_SESSION = null;
/**
 * Session with custom ID identifier (non-email)
 */
export const CUSTOM_ID_SESSION = {
    walletId: "wallet-evm-custom-abc",
    address: "0xDEADBEEF1234567890123456789012345678DEAD",
    identifier: {
        type: "customId",
        value: "user-12345",
    },
    authenticated: true,
    createdAt: Date.now() - 3600000, // 1 hour ago
    lastUsed: Date.now(),
};
/**
 * Session with a different address (for testing multi-user scenarios)
 */
export const ALTERNATE_USER_SESSION = {
    walletId: "wallet-evm-alt-xyz",
    address: "0xABCDEF1234567890123456789012345678ABCDEF",
    identifier: {
        type: "email",
        value: "alice@example.com",
    },
    authenticated: true,
    createdAt: Date.now() - 172800000, // 2 days ago
    lastUsed: Date.now() - 3600000, // 1 hour ago
};
/**
 * Helper function to create a mock getSession that returns the specified session
 */
export function createMockGetSession(session) {
    return vi.fn().mockResolvedValue(session);
}
/**
 * Helper to create a fresh session with custom values
 */
export function createTestSession(overrides = {}) {
    return {
        walletId: "wallet-test-" + Math.random().toString(36).slice(2),
        address: "0x" + Math.random().toString(16).slice(2).padStart(40, "0"),
        identifier: {
            type: "email",
            value: "test@example.com",
        },
        authenticated: true,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        ...overrides,
    };
}
/**
 * Combined fixture export
 */
export const SESSION_FIXTURES = {
    authenticated: AUTHENTICATED_SESSION,
    unauthenticated: UNAUTHENTICATED_SESSION,
    noSession: NO_SESSION,
    customId: CUSTOM_ID_SESSION,
    alternateUser: ALTERNATE_USER_SESSION,
    createMockGetSession,
    createTestSession,
};
// Need to import vi for the mock helper
import { vi } from "vitest";
export default SESSION_FIXTURES;
//# sourceMappingURL=sessions.js.map