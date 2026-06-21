import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { AuthError, verifyToken } from "../src/auth.js";

const SECRET = "test-jwt-secret-please-ignore-0123456789";
const key = new TextEncoder().encode(SECRET);

async function mint(claims: Record<string, unknown>, opts: { expSecondsFromNow?: number } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600));
  return jwt.sign(key);
}

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.SUPABASE_JWT_SECRET;
});

describe("verifyToken (Supabase JWT)", () => {
  it("accepts a valid token and returns the user id + email", async () => {
    const token = await mint({ sub: "user-123", email: "ada@ikarus.local" });
    const user = await verifyToken(`Bearer ${token}`);
    expect(user).toEqual({ id: "user-123", email: "ada@ikarus.local" });
  });

  it("defaults email to empty string when absent", async () => {
    const token = await mint({ sub: "user-123" });
    const user = await verifyToken(`Bearer ${token}`);
    expect(user.email).toBe("");
  });

  it("rejects a missing or malformed header", async () => {
    await expect(verifyToken(undefined)).rejects.toBeInstanceOf(AuthError);
    await expect(verifyToken("token-without-bearer")).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrong = new TextEncoder().encode("a-totally-different-secret-value-99");
    const token = await new SignJWT({ sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(wrong);
    await expect(verifyToken(`Bearer ${token}`)).rejects.toThrow(/invalid or expired/);
  });

  it("rejects an expired token", async () => {
    const token = await mint({ sub: "user-123" }, { expSecondsFromNow: -10 });
    await expect(verifyToken(`Bearer ${token}`)).rejects.toThrow(/invalid or expired/);
  });

  it("rejects a token with no subject", async () => {
    const token = await mint({ email: "no-sub@ikarus.local" });
    await expect(verifyToken(`Bearer ${token}`)).rejects.toBeInstanceOf(AuthError);
  });
});
