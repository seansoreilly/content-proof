import { describe, expect, it, vi } from "vitest";
import { makeKeyPair, sha256Hex, type TestKeyPair } from "@/test/fixtures";
import { stringToBase64Url } from "@/lib/base64";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";
import {
  buildServiceMessageV3,
  buildSignedMessage,
  createVerificationUrl,
  encodeRecord,
  hashHexToB64url,
  type SignatureRecord,
} from "@/lib/record";
import {
  MAX_RECORD_INPUT_LENGTH,
  PUBLIC_KEYS_PATH,
  fetchPublicKeys,
  parseRecordInput,
  verifyFile,
  verifyRecordAgainstHash,
} from "@/lib/verifier";

const email = "signer@gmail.com";
const t = 1_760_000_000_000;
const fileText = "the real file";
const fileHex = sha256Hex(fileText);

function publish(...pairs: TestKeyPair[]): PublicKeysJson {
  const entries = pairs.map(({ publicKeyBase64: publicKey }) => {
    const keyId = keyIdFromSpkiBase64(publicKey);
    return [keyId, { keyId, algorithm: "Ed25519" as const, publicKey }] as const;
  });
  return { current: entries[0][0], keys: Object.fromEntries(entries) };
}

function v2Record(service: TestKeyPair, hashHex = fileHex): SignatureRecord {
  return {
    v: 2,
    k: keyIdFromSpkiBase64(service.publicKeyBase64),
    h: hashHexToB64url(hashHex),
    e: email,
    t,
    s: service.signHex(buildSignedMessage(hashHex, email, t)),
  };
}

function v3Record(service: TestKeyPair, holder: TestKeyPair = makeKeyPair()): SignatureRecord {
  const u = Buffer.from(holder.publicKeyBase64, "base64").subarray(-32).toString("base64url");
  const us = holder.signHex(buildSignedMessage(fileHex, email, t));
  return {
    v: 3,
    k: keyIdFromSpkiBase64(service.publicKeyBase64),
    h: hashHexToB64url(fileHex),
    e: email,
    t,
    s: service.signHex(buildServiceMessageV3(fileHex, email, t, u, us)),
    u,
    us,
  };
}

/** A fetch stub serving `keys` (or a status/body) for the well-known path only. */
function keysFetch(body: unknown, status = 200): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("parseRecordInput", () => {
  const service = makeKeyPair();

  it("parses a compact v2 and v3 record", () => {
    const r2 = v2Record(service);
    const r3 = v3Record(service);
    expect(parseRecordInput(encodeRecord(r2))).toEqual({ ok: true, record: r2 });
    expect(parseRecordInput(encodeRecord(r3))).toEqual({ ok: true, record: r3 });
  });

  it("parses a verification URL, a bare fragment and wrapped or broken forms", () => {
    const r = v2Record(service);
    const encoded = encodeRecord(r);
    const url = createVerificationUrl(encoded, "https://www.contentproof.app");
    for (const text of [
      url,
      `#P=${encoded}`,
      `<${url}>`,
      `Please check [this](${url}) thanks`,
      `${url.slice(0, 40)}\n${url.slice(40)}`,
    ]) {
      expect(parseRecordInput(text)).toEqual({ ok: true, record: r });
    }
  });

  it("rejects empty input, garbage and legacy payloads with distinct errors", () => {
    expect(parseRecordInput("   ")).toMatchObject({ ok: false, error: "empty" });
    expect(parseRecordInput("garbage")).toMatchObject({ ok: false, error: "unparseable" });
    const legacy = stringToBase64Url(JSON.stringify({ signature: "x", publicKey: "y", timestamp: t }));
    const result = parseRecordInput(`https://www.contentproof.app/verify?data=${legacy}`);
    expect(result).toMatchObject({ ok: false, error: "legacy" });
    expect(result.ok ? "" : result.message).toMatch(/legacy/i);
    expect(parseRecordInput(legacy)).toMatchObject({ ok: false, error: "legacy" });
  });

  it("rejects oversized input before parsing it", () => {
    const r = encodeRecord(v2Record(service));
    expect(parseRecordInput(`${r}${" ".repeat(MAX_RECORD_INPUT_LENGTH)}`)).toMatchObject({
      ok: false,
      error: "too-long",
    });
    expect(parseRecordInput(">".repeat(100_000))).toMatchObject({ ok: false, error: "too-long" });
  });
});

describe("verifyRecordAgainstHash", () => {
  const service = makeKeyPair();
  const keys = publish(service);

  it("accepts a valid v2 record", () => {
    const r = v2Record(service);
    expect(verifyRecordAgainstHash(r, fileHex, keys)).toEqual({ ok: true, keyId: r.k, userSigned: false });
  });

  it("accepts a valid v3 record and reports the holder key", () => {
    const r = v3Record(service);
    expect(verifyRecordAgainstHash(r, fileHex.toUpperCase(), keys)).toEqual({
      ok: true,
      keyId: r.k,
      userSigned: true,
      userKey: r.u,
    });
  });

  it("reports a tampered record as a bad signature, not a file change", () => {
    const r = { ...v2Record(service), e: "ceo@gmail.com" };
    expect(verifyRecordAgainstHash(r, fileHex, keys)).toEqual({ ok: false, reason: "bad-signature" });
    const r3 = v3Record(service);
    const otherHolder = v3Record(service);
    expect(verifyRecordAgainstHash({ ...r3, us: otherHolder.us }, fileHex, keys)).toMatchObject({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("reports a wrong file as hash-mismatch", () => {
    expect(verifyRecordAgainstHash(v2Record(service), sha256Hex("another file"), keys)).toEqual({
      ok: false,
      reason: "hash-mismatch",
    });
  });

  it("refuses a self-consistent record signed with an unpublished key", () => {
    const rogue = makeKeyPair();
    expect(verifyRecordAgainstHash(v2Record(rogue), fileHex, keys)).toEqual({ ok: false, reason: "unknown-key" });
  });
});

describe("verifyFile", () => {
  const service = makeKeyPair();
  const keys = publish(service);
  const file = new Blob([fileText]);

  it("verifies a v2 record object with explicit keys and fetches nothing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const r = v2Record(service);
    const result = await verifyFile(r, file, { keys, fetch: fetchImpl });
    expect(result).toEqual({ ok: true, keyId: r.k, userSigned: false, record: r, fileHash: fileHex });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verifies a v3 compact record against keys fetched from the base URL", async () => {
    const fetchImpl = keysFetch(keys);
    const r = v3Record(service);
    const result = await verifyFile(encodeRecord(r), file, { baseUrl: "https://cp.example/", fetch: fetchImpl });
    expect(result).toMatchObject({ ok: true, userSigned: true, userKey: r.u, record: r, fileHash: fileHex });
    expect(fetchImpl).toHaveBeenCalledWith(`https://cp.example${PUBLIC_KEYS_PATH}`);
  });

  it("verifies a full verification URL", async () => {
    const r = v2Record(service);
    const url = createVerificationUrl(encodeRecord(r), "https://www.contentproof.app");
    expect(await verifyFile(url, file, { keys })).toMatchObject({ ok: true, record: r });
  });

  it("reports a tampered record, a wrong file and an unknown key", async () => {
    const tampered = encodeRecord({ ...v2Record(service), t: t + 1 });
    expect(await verifyFile(tampered, file, { keys })).toMatchObject({ ok: false, reason: "bad-signature" });

    const wrong = await verifyFile(v2Record(service), new Blob(["not the file"]), { keys });
    expect(wrong).toMatchObject({ ok: false, reason: "hash-mismatch", fileHash: sha256Hex("not the file") });

    const rogue = makeKeyPair();
    expect(await verifyFile(encodeRecord(v2Record(rogue)), file, { keys })).toMatchObject({
      ok: false,
      reason: "unknown-key",
    });
  });

  it("returns malformed for unparseable or legacy input without hashing or fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await verifyFile("garbage", file, { baseUrl: "https://cp.example", fetch: fetchImpl })).toEqual({
      ok: false,
      reason: "malformed",
      record: null,
      fileHash: null,
      inputError: "unparseable",
    });
    const legacy = stringToBase64Url(JSON.stringify({ signature: "x", publicKey: "y", timestamp: t }));
    expect(await verifyFile(legacy, file, { keys })).toMatchObject({ reason: "malformed", inputError: "legacy" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates a record object strictly instead of trusting its shape", async () => {
    const r = v2Record(service);
    const loose = { ...r, t: String(r.t) } as unknown as SignatureRecord;
    expect(await verifyFile(loose, file, { keys })).toMatchObject({ ok: false, reason: "malformed", record: null });
    const missing = { ...r, e: undefined } as unknown as SignatureRecord;
    expect(await verifyFile(missing, file, { keys })).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("throws, rather than reporting unknown-key, when the keys cannot be loaded", async () => {
    const r = v2Record(service);
    const opts = (fetchImpl: typeof fetch): { baseUrl: string; fetch: typeof fetch } => ({
      baseUrl: "https://cp.example",
      fetch: fetchImpl,
    });
    await expect(verifyFile(r, file, opts(keysFetch({}, 503)))).rejects.toThrow(/HTTP 503/);
    await expect(verifyFile(r, file, opts(keysFetch({ current: "x", keys: {} })))).rejects.toThrow(/valid/);
    await expect(
      verifyFile(r, file, opts(vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline")))))
    ).rejects.toThrow(/offline/);
    await expect(verifyFile(r, file)).rejects.toThrow(/baseUrl/);
  });

  it("fetchPublicKeys accepts a published document", async () => {
    expect(await fetchPublicKeys("https://cp.example", keysFetch(keys))).toEqual(keys);
  });
});
