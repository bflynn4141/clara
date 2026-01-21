/**
 * Encrypted Session Storage
 *
 * Persists wallet session data to ~/.claude/para-wallet/session.enc
 * Uses AES-256-GCM encryption with a key derived from machine ID.
 *
 * Session data includes:
 * - Authentication state
 * - Wallet address
 * - Para session token (for refreshing auth)
 * - Last active timestamp
 */
export interface WalletSession {
    authenticated: boolean;
    address?: string;
    solanaAddress?: string;
    email?: string;
    identifierType?: 'email' | 'customId';
    identifier?: string;
    paraSessionToken?: string;
    paraUserShare?: string;
    pendingEmail?: string;
    pendingIdentifier?: string;
    chains: string[];
    createdAt: string;
    lastActiveAt: string;
}
/**
 * Get current wallet session
 */
export declare function getSession(): Promise<WalletSession | null>;
/**
 * Save wallet session
 */
export declare function saveSession(session: WalletSession): Promise<void>;
/**
 * Update session with partial data
 */
export declare function updateSession(updates: Partial<WalletSession>): Promise<WalletSession>;
/**
 * Clear session (logout)
 */
export declare function clearSession(): Promise<void>;
/**
 * Check if session is valid and not expired
 */
export declare function isSessionValid(): Promise<boolean>;
/**
 * Refresh session timestamp
 */
export declare function touchSession(): Promise<void>;
//# sourceMappingURL=session.d.ts.map