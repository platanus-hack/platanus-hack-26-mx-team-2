import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secret-at-rest crypto (§7.7). AES-256-GCM with a 32-byte master key that lives
 * ONLY in process.env.IKARUS_ENC_KEY — never in the DB. Each write gets a fresh
 * random 12-byte IV (never reused). On-disk layout is a single buffer:
 *
 *     [ version(1) | iv(12) | authTag(16) | ciphertext(...) ]
 *
 * The 1-byte version prefix lets us rotate the key/algorithm later without a data
 * migration. Secrets are write-only at the API boundary (see `redactSecret`): the
 * UI may see only `{ configured, last4 }`, never the plaintext, and secrets are
 * NEVER logged or placed in traces.
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

/** Load + validate the master key from env (base64, 32 bytes). Cached per process. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.IKARUS_ENC_KEY;
  if (!raw) {
    throw new Error("IKARUS_ENC_KEY is not set — cannot encrypt/decrypt secrets.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`IKARUS_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}).`);
  }
  cachedKey = key;
  return key;
}

/** Encrypt a UTF-8 secret into the versioned blob described above. */
export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, authTag, ciphertext]);
}

/** Decrypt a blob produced by `encryptSecret`. Throws on tamper (GCM auth fail). */
export function decryptSecret(blob: Buffer): string {
  const version = blob[0];
  if (version !== VERSION) {
    throw new Error(`unsupported secret version: ${version}`);
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const authTag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

/** The last 4 chars of a secret — the ONLY fragment ever shown back to the UI. */
export function last4(secret: string): string {
  return secret.length <= 4 ? secret : secret.slice(-4);
}

export interface RedactedSecret {
  readonly configured: boolean;
  readonly last4: string | null;
}

/**
 * Write-only serializer for any secret-bearing field. The API must run stored
 * secrets through this before responding — the plaintext never crosses the wire.
 */
export function redactSecret(stored: { last4: string | null } | null | undefined): RedactedSecret {
  return { configured: Boolean(stored), last4: stored?.last4 ?? null };
}

/** Reset the cached key (tests only). */
export function __resetKeyCache(): void {
  cachedKey = null;
}
