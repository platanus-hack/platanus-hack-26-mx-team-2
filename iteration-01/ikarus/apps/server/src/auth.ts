import { jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.js";

/**
 * Supabase Auth verification. The SPA logs in with @supabase/supabase-js and sends
 * the access token as `Authorization: Bearer <jwt>`. Supabase signs these HS256
 * with the project JWT secret (SUPABASE_JWT_SECRET); we verify locally — no network
 * round-trip. The token's `sub` is the user UID, `email` the address; we upsert a
 * local User on first sight (see store).
 */

export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

export class AuthError extends Error {}

function jwtSecret(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET is not set — cannot verify auth tokens.");
  return new TextEncoder().encode(secret);
}

/** Verify a Bearer token and return the authenticated user, or throw AuthError. */
export async function verifyToken(authorization: string | undefined): Promise<AuthUser> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("missing or malformed Authorization header");
  }
  const token = authorization.slice("Bearer ".length).trim();
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    const id = typeof payload.sub === "string" ? payload.sub : undefined;
    const email = typeof payload.email === "string" ? payload.email : undefined;
    if (!id) throw new AuthError("token has no subject");
    return { id, email: email ?? "" };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("invalid or expired token");
  }
}

/**
 * Per-user MCP key auth. The MCP endpoint is not browser-authenticated; instead
 * each user gets a personal key (shown once) that their MCP client sends as a
 * Bearer token. We store only sha256(key); look it up to resolve the workspace.
 */
const KEY_PREFIX = "ikr_";

export function generateMcpKey(): { plaintext: string; hash: string; last4: string } {
  const plaintext = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { plaintext, hash: hashMcpKey(plaintext), last4: plaintext.slice(-4) };
}

export function hashMcpKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Resolve the user behind an MCP-key Bearer token, or throw AuthError. */
export async function verifyMcpKey(authorization: string | undefined): Promise<AuthUser> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("missing or malformed Authorization header");
  }
  const key = authorization.slice("Bearer ".length).trim();
  const user = await db().user.findUnique({ where: { mcpKeyHash: hashMcpKey(key) } });
  if (!user) throw new AuthError("invalid MCP key");
  return { id: user.id, email: user.email };
}
