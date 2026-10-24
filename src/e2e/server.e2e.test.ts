import { describe, expect, it } from "vitest";
import { makeKeyPair, sha256Hex } from "@/test/fixtures";
import { keyIdFromSpkiBase64, parsePublicKeysJson } from "@/lib/keyset";
import { verifyRecord } from "@/lib/crypto/verify";
import { verifyLogHead, verifyRecordInclusion, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";
import {
  buildSignedMessage,
  decodeRecord,
  encodeRecord,
  hashHexToB64url,
  parseRecordObject,
  type SignatureRecord,
} from "@/lib/record";

/**
 * Runs only against a live dev server started with DEBUG_AUTH=true:
 *   E2E_BASE_URL=http://localhost:3100 npx vitest run src/e2e
 */
const base = process.env.E2E_BASE_URL;

function cookiesFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!base)("live server flow", () => {
  it("signs in, signs a hash, publishes keys, verifies, and rejects a forgery", async () => {
    // 1. CSRF token + cookie
    const csrfRes = await fetch(`${base}/api/auth/csrf`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    let cookie = cookiesFrom(csrfRes);

    // 2. Debug credentials sign-in (dev only)
    const loginRes = await fetch(`${base}/api/auth/callback/debug`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({ csrfToken, json: "true" }).toString(),
    });
    cookie = [cookie, cookiesFrom(loginRes)].filter(Boolean).join("; ");
    expect(cookie).toMatch(/session-token/);

    // 3. Sign a hash
    const fileHex = sha256Hex("e2e file contents");
    const signRes = await fetch(`${base}/api/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fileHash: fileHex }),
    });
    expect(signRes.status).toBe(200);
    const record = parseRecordObject(((await signRes.json()) as { record: unknown }).record);
    expect(record).not.toBeNull();
    expect(record!.e).toBe(process.env.E2E_EXPECT_EMAIL ?? "e2e@example.com");

    // 4. Published keys verify it client-side
    const keysRes = await fetch(`${base}/.well-known/public-keys.json`);
    expect(keysRes.headers.get("access-control-allow-origin")).toBe("*");
    const keys = parsePublicKeysJson(await keysRes.json());
    expect(keys).not.toBeNull();
    expect(verifyRecord(record!, fileHex, keys!)).toEqual({ ok: true, keyId: record!.k });

    // The QR payload round-trips
    expect(decodeRecord(encodeRecord(record!))).toEqual(record);

    // 5. Server-side verify agrees, and rejects a forgery
    const okRes = await fetch(`${base}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    expect(await okRes.json()).toMatchObject({ valid: true });

    const rogue = makeKeyPair();
    const t = Date.now();
    const forged: SignatureRecord = {
      v: 2,
      k: keyIdFromSpkiBase64(rogue.publicKeyBase64),
      h: hashHexToB64url(fileHex),
      e: "ceo@gmail.com",
      t,
      s: rogue.signHex(buildSignedMessage(fileHex, "ceo@gmail.com", t)),
    };
    const forgedRes = await fetch(`${base}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(forged),
    });
    expect(await forgedRes.json()).toMatchObject({ valid: false, reason: "unknown-key" });

    // 6. Record lookup and removed endpoints
    const lookup = await fetch(`${base}/api/sig/${record!.s}`);
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toEqual(record);
    expect((await fetch(`${base}/api/trust/${encodeURIComponent("x@gmail.com")}`)).status).toBe(404);

    // 7. Pages serve
    expect((await fetch(`${base}/verify`)).status).toBe(200);
    expect((await fetch(`${base}/sig/${record!.s}`)).status).toBe(200);
    expect((await fetch(`${base}/sig/${"A".repeat(86)}`)).status).toBe(404);

    // 8. Transparency log: signed head verifies, inclusion proof verifies
    const head = (await (await fetch(`${base}/api/log/head`)).json()) as SignedLogHead;
    expect(verifyLogHead(head, keys!)).toBe(true);
    expect(head.size).toBeGreaterThanOrEqual(1);
    const proof = (await (
      await fetch(`${base}/api/log/proof?signature=${encodeURIComponent(record!.s)}`)
    ).json()) as InclusionProofResponse;
    expect(verifyRecordInclusion(record!, proof)).toBe(true);
    const entries = (await (await fetch(`${base}/api/log/entries?from=0&limit=5`)).json()) as { size: number };
    expect(entries.size).toBe(head.size);
  }, 60_000);
});
