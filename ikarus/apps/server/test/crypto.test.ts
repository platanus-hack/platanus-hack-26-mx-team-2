import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { __resetKeyCache, decryptSecret, encryptSecret, last4, redactSecret } from "../src/crypto.js";

const KEY = randomBytes(32).toString("base64");

beforeAll(() => {
  process.env.IKARUS_ENC_KEY = KEY;
  __resetKeyCache();
});
afterAll(() => {
  delete process.env.IKARUS_ENC_KEY;
  __resetKeyCache();
});

describe("crypto (AES-256-GCM, §7.7)", () => {
  it("round-trips a secret", () => {
    const secret = "sk-ant-supersecret-0xDEADBEEF";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("uses a fresh IV per encryption (ciphertexts differ for the same input)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a.equals(b)).toBe(false);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const blob = encryptSecret("trustme");
    blob[blob.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptSecret(blob)).toThrow();
  });

  it("rejects an unknown version byte", () => {
    const blob = encryptSecret("x");
    blob[0] = 0x09;
    expect(() => decryptSecret(blob)).toThrow(/unsupported secret version/);
  });

  it("last4 exposes only the tail (and never more than the whole short secret)", () => {
    expect(last4("abcdef")).toBe("cdef");
    expect(last4("ab")).toBe("ab");
  });

  it("redactSecret never returns plaintext — only {configured,last4}", () => {
    expect(redactSecret({ last4: "BEEF" })).toEqual({ configured: true, last4: "BEEF" });
    expect(redactSecret(null)).toEqual({ configured: false, last4: null });
  });

  it("fails loudly when the master key is the wrong size", () => {
    process.env.IKARUS_ENC_KEY = Buffer.from("too-short").toString("base64");
    __resetKeyCache();
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.IKARUS_ENC_KEY = KEY;
    __resetKeyCache();
  });
});
