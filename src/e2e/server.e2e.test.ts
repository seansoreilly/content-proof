import { describe, expect, it } from "vitest";
import { api, base, login, provider, setClientIp } from "@/e2e/helpers";
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
 * Runs only when E2E_BASE_URL is set.
 *
 * Against a local dev server started with DEBUG_AUTH=true:
 *   E2E_BASE_URL=http://localhost:3100 npx vitest run src/e2e
 *
 * Against a Vercel preview configured for the preview test login (see
 * README, "End-to-end tests on a preview"):
 *   E2E_BASE_URL=https://<preview-host> E2E_AUTH_PROVIDER=preview-test \
 *   E2E_AUTH_SECRET=... E2E_VERCEL_BYPASS=... npx vitest run src/e2e
 */
setClientIp(10);
const expectedEmail =
  process.env.E2E_EXPECT_EMAIL ?? (provider === "preview-test" ? "e2e@preview.contentproof.test" : "e2e@example.com");

describe.skipIf(!base)("live server flow", () => {
  it("signs in, signs a hash, publishes keys, verifies, and rejects a forgery", async () => {
    // 1-2. CSRF token, then a credentials sign-in: the dev-only debug
    //      provider, or the preview-only test login with its secret
    const { cookie } = await login();

    // 3. Sign a hash
    const fileHex = sha256Hex("e2e file contents");
    const signRes = await api(`/api/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fileHash: fileHex }),
    });
    expect(signRes.status).toBe(200);
    const record = parseRecordObject(((await signRes.json()) as { record: unknown }).record);
    expect(record).not.toBeNull();
    expect(record!.e).toBe(expectedEmail);

    // 4. Published keys verify it client-side
    const keysRes = await api(`/.well-known/public-keys.json`);
    expect(keysRes.headers.get("access-control-allow-origin")).toBe("*");
    const keys = parsePublicKeysJson(await keysRes.json());
    expect(keys).not.toBeNull();
    expect(verifyRecord(record!, fileHex, keys!)).toEqual({ ok: true, keyId: record!.k, userSigned: false });

    // The QR payload round-trips
    expect(decodeRecord(encodeRecord(record!))).toEqual(record);

    // 5. Server-side verify agrees, and rejects a forgery
    const okRes = await api(`/api/verify`, {
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
    const forgedRes = await api(`/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(forged),
    });
    expect(await forgedRes.json()).toMatchObject({ valid: false, reason: "unknown-key" });

    // 6. Record lookup and removed endpoints
    const lookup = await api(`/api/sig/${record!.s}`);
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toEqual(record);
    expect((await api(`/api/trust/${encodeURIComponent("x@gmail.com")}`)).status).toBe(404);

    // 7. Pages serve
    expect((await api(`/verify`)).status).toBe(200);
    expect((await api(`/sig/${record!.s}`)).status).toBe(200);
    expect((await api(`/sig/${"A".repeat(86)}`)).status).toBe(404);

    // 7b. Version 3: a browser-held key signs, the service countersigns
    const { generateUserKeyPair, toUserSigningKey } = await import("@/lib/user-keys");
    const userKey = await toUserSigningKey(await generateUserKeyPair());
    const t3 = Date.now();
    const email3 = expectedEmail;
    const userSignature = await userKey.sign(buildSignedMessage(fileHex, email3, t3));
    const v3Res = await api(`/api/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ fileHash: fileHex, timestamp: t3, userPublicKey: userKey.publicKey, userSignature }),
    });
    expect(v3Res.status).toBe(200);
    const v3 = parseRecordObject(((await v3Res.json()) as { record: unknown }).record);
    expect(v3).toMatchObject({ v: 3, u: userKey.publicKey });
    expect(verifyRecord(v3!, fileHex, keys!)).toMatchObject({ ok: true, userSigned: true, userKey: userKey.publicKey });

    // 8. Transparency log: signed head verifies, inclusion proof verifies
    const head = (await (await api(`/api/log/head`)).json()) as SignedLogHead;
    expect(verifyLogHead(head, keys!)).toBe(true);
    expect(head.size).toBeGreaterThanOrEqual(1);
    const proof = (await (
      await api(`/api/log/proof?signature=${encodeURIComponent(record!.s)}`)
    ).json()) as InclusionProofResponse;
    expect(verifyRecordInclusion(record!, proof)).toBe(true);
    const entries = (await (await api(`/api/log/entries?from=0&limit=5`)).json()) as { size: number };
    // Other e2e files sign in parallel, so the log may have grown since the head.
    expect(entries.size).toBeGreaterThanOrEqual(head.size);
  }, 60_000);
});
