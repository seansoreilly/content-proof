import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEd25519, verifyEd25519Raw } from "@/lib/crypto/verify";

/**
 * The server signs with node:crypto (OpenSSL) while verification runs on
 * @noble/curves in strict RFC 8032 mode. These tests pin the two together so a
 * library or option change can never silently reject genuine signatures.
 */
function freshSigner(): {
  spkiBase64: string;
  rawBase64Url: string;
  signB64Url: (message: Uint8Array) => string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  return {
    spkiBase64: spki.toString("base64"),
    rawBase64Url: spki.subarray(-32).toString("base64url"),
    signB64Url: (message) => sign(null, message, privateKey).toString("base64url"),
  };
}

function flipBit(bytes: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[index % copy.length] ^= 0x01;
  return copy;
}

describe("node:crypto signatures verify with the browser-safe verifier", () => {
  it("accepts random messages through both SPKI and raw key entry points", () => {
    for (let i = 0; i < 64; i++) {
      const signer = freshSigner();
      const message = new Uint8Array(randomBytes(i * 7));
      const signature = signer.signB64Url(message);
      expect(verifyEd25519(message, signature, signer.spkiBase64)).toBe(true);
      expect(verifyEd25519Raw(message, signature, signer.rawBase64Url)).toBe(true);
    }
  });

  it("accepts string messages signed as UTF-8", () => {
    const signer = freshSigner();
    const text = "contentproof/v3\nhash\nsigner@gmail.com\n1760000000000 – ünïcode";
    const signature = signer.signB64Url(new TextEncoder().encode(text));
    expect(verifyEd25519(text, signature, signer.spkiBase64)).toBe(true);
    expect(verifyEd25519Raw(text, signature, signer.rawBase64Url)).toBe(true);
  });

  it("rejects tampered signatures, tampered messages and the wrong key", () => {
    const signer = freshSigner();
    const other = freshSigner();
    const message = new Uint8Array(randomBytes(100));
    const signature = signer.signB64Url(message);
    const sigBytes = Buffer.from(signature, "base64url");

    for (const index of [0, 31, 32, 63]) {
      const badSig = Buffer.from(flipBit(sigBytes, index)).toString("base64url");
      expect(verifyEd25519(message, badSig, signer.spkiBase64)).toBe(false);
      expect(verifyEd25519Raw(message, badSig, signer.rawBase64Url)).toBe(false);
    }
    for (const index of [0, 50, 99]) {
      const badMessage = flipBit(message, index);
      expect(verifyEd25519(badMessage, signature, signer.spkiBase64)).toBe(false);
      expect(verifyEd25519Raw(badMessage, signature, signer.rawBase64Url)).toBe(false);
    }
    expect(verifyEd25519(message, signature, other.spkiBase64)).toBe(false);
    expect(verifyEd25519Raw(message, signature, other.rawBase64Url)).toBe(false);
  });

  it("returns false rather than throwing on malformed input", () => {
    const signer = freshSigner();
    const message = new Uint8Array(randomBytes(16));
    const signature = signer.signB64Url(message);
    const truncated = Buffer.from(signature, "base64url").subarray(0, 63).toString("base64url");
    expect(verifyEd25519(message, truncated, signer.spkiBase64)).toBe(false);
    expect(verifyEd25519Raw(message, signature, "AAAA")).toBe(false);
    expect(verifyEd25519(message, "!!not base64!!", signer.spkiBase64)).toBe(false);
    expect(verifyEd25519(message, signature, "")).toBe(false);
  });

  it("rejects a malleated signature with S + L (strict mode)", () => {
    // The group order L; S and S + L give the same verification equation, so a
    // verifier that skips the S < L check would accept both.
    const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
    const signer = freshSigner();
    const message = new Uint8Array(randomBytes(32));
    const sig = Buffer.from(signer.signB64Url(message), "base64url");
    const toLittleEndian = (n: bigint): Buffer =>
      Buffer.from(n.toString(16).padStart(64, "0"), "hex").reverse();
    const s = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex"));
    // Sanity: S was decoded correctly (it is reduced, and re-encodes to the same bytes).
    expect(s < L).toBe(true);
    expect(toLittleEndian(s).equals(sig.subarray(32))).toBe(true);
    // S < L < 2^253, so S + L is unreduced but still fits in 32 bytes.
    const out = Buffer.concat([sig.subarray(0, 32), toLittleEndian(s + L)]);
    expect(out.length).toBe(64);
    expect(verifyEd25519(message, sig.toString("base64url"), signer.spkiBase64)).toBe(true);
    expect(verifyEd25519(message, out.toString("base64url"), signer.spkiBase64)).toBe(false);
  });
});
