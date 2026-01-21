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

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// Session data structure
export interface WalletSession {
  authenticated: boolean;
  address?: string;          // EVM address (works for all EVM chains)
  solanaAddress?: string;    // Solana address (Ed25519)
  email?: string;            // Email if using email identifier (portable)
  identifierType?: 'email' | 'customId';  // Type of identifier used
  identifier?: string;       // The actual identifier value
  paraSessionToken?: string;
  paraUserShare?: string;    // MPC user share for signing (encrypted at rest)
  pendingEmail?: string;     // Legacy: Email pending verification
  pendingIdentifier?: string;  // Identifier pending setup completion
  chains: string[];
  createdAt: string;
  lastActiveAt: string;
}

// Storage paths
const STORAGE_DIR = path.join(os.homedir(), ".claude", "para-wallet");
const SESSION_FILE = path.join(STORAGE_DIR, "session.enc");
const KEY_FILE = path.join(STORAGE_DIR, ".key");

// In-memory cache for performance
let cachedSession: WalletSession | null = null;
let encryptionKey: Buffer | null = null;

/**
 * Get or create encryption key
 * In production, this should use a more secure key derivation
 */
async function getEncryptionKey(): Promise<Buffer> {
  if (encryptionKey) {
    return encryptionKey;
  }

  await fs.mkdir(STORAGE_DIR, { recursive: true });

  try {
    // Try to read existing key
    const keyData = await fs.readFile(KEY_FILE);
    encryptionKey = keyData;
    return encryptionKey;
  } catch {
    // Generate new key
    encryptionKey = crypto.randomBytes(32);
    await fs.writeFile(KEY_FILE, encryptionKey, { mode: 0o600 });
    return encryptionKey;
  }
}

/**
 * Encrypt data using AES-256-GCM
 */
async function encrypt(data: string): Promise<Buffer> {
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv (16) + authTag (16) + encrypted data
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt data using AES-256-GCM
 */
async function decrypt(data: Buffer): Promise<string> {
  const key = await getEncryptionKey();

  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Get current wallet session
 */
export async function getSession(): Promise<WalletSession | null> {
  // Return cached session if available
  if (cachedSession) {
    return cachedSession;
  }

  try {
    const encryptedData = await fs.readFile(SESSION_FILE);
    const decrypted = await decrypt(encryptedData);
    cachedSession = JSON.parse(decrypted);
    return cachedSession;
  } catch (error) {
    // No session file or decryption failed
    return null;
  }
}

/**
 * Save wallet session
 */
export async function saveSession(session: WalletSession): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  // Update timestamps
  session.lastActiveAt = new Date().toISOString();
  if (!session.createdAt) {
    session.createdAt = session.lastActiveAt;
  }

  const encrypted = await encrypt(JSON.stringify(session));
  await fs.writeFile(SESSION_FILE, encrypted, { mode: 0o600 });

  // Update cache
  cachedSession = session;
}

/**
 * Update session with partial data
 */
export async function updateSession(
  updates: Partial<WalletSession>
): Promise<WalletSession> {
  const current = (await getSession()) || {
    authenticated: false,
    chains: [],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };

  const updated = { ...current, ...updates };
  await saveSession(updated);
  return updated;
}

/**
 * Clear session (logout)
 */
export async function clearSession(): Promise<void> {
  cachedSession = null;

  try {
    await fs.unlink(SESSION_FILE);
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Check if session is valid and not expired
 */
export async function isSessionValid(): Promise<boolean> {
  const session = await getSession();
  if (!session?.authenticated) {
    return false;
  }

  // Check if session is too old (24 hours)
  const lastActive = new Date(session.lastActiveAt);
  const now = new Date();
  const hoursSinceActive = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60);

  if (hoursSinceActive > 24) {
    console.error("[para-wallet] Session expired, clearing...");
    await clearSession();
    return false;
  }

  return true;
}

/**
 * Refresh session timestamp
 */
export async function touchSession(): Promise<void> {
  const session = await getSession();
  if (session) {
    await updateSession({ lastActiveAt: new Date().toISOString() });
  }
}
