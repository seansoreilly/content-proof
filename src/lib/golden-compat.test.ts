/**
 * GOLDEN COMPATIBILITY TESTS.
 *
 * If this test fails, a change broke compatibility with records, links and
 * log heads that have already been issued. Fix the code, not the fixtures.
 *
 * The fixtures in src/test/fixtures/golden/*.json were produced once by
 * scripts/generate-golden-fixtures.mjs, an independent implementation of the
 * documented formats, and committed. These tests only read them; nothing here
 * may regenerate or rewrite them. Every other test generates fresh keys on
 * each run, so a silent change to a wire format or a signed message layout
 * could pass them all; these bytes cannot drift.
 */
import { execFile } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import keysFixture from "@/test/fixtures/golden/keys.json";
import legacyFixture from "@/test/fixtures/golden/legacy.json";
import logFixture from "@/test/fixtures/golden/log.json";
import recordsFixture from "@/test/fixtures/golden/records.json";
import productionKeys from "@/lib/production-keys.json";
import { bytesToHex, hexToBytes } from "@/lib/base64";
import { verifyLegacyPayload, verifyRecord, type LegacyPayload, type VerificationResult } from "@/lib/crypto/verify";
import { keyIdFromSpkiBase64, parsePublicKeysJson, type PublicKeysJson } from "@/lib/keyset";
import { createMemoryLogStore } from "@/lib/log-store";
import {
  logHeadMessage,
  recordLeafHash,
  verifyConsistencyResponse,
  verifyInclusionProof,
  verifyLogConsistency,
  verifyLogHead,
  type ConsistencyProofResponse,
  type InclusionProofResponse,
  type SignedLogHead,
} from "@/lib/log-verify";
import { computeRoot, consistencyProof, inclusionProof } from "@/lib/merkle";
import { createMemoryStore } from "@/lib/rate-limit";
import {
  buildServiceMessageV3,
  buildSignedMessage,
  createVerificationUrl,
  decodeRecord,
  encodeRecord,
  hashB64urlToHex,
  parseRecordObject,
  serviceMessageFor,
  type SignatureRecord,
} from "@/lib/record";
import { parseRecordInput, verifyFile, verifyRecordAgainstHash } from "@/lib/verifier";
import { parseVerificationInput } from "@/lib/verify-input";
import { jsonRequest } from "@/test/fixtures";

vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getLogStore: () => createMemoryLogStore(),
}));

interface GoldenFile {
  utf8: string;
  sha256: string;
}

interface GoldenPositive {
  name: string;
  file: GoldenFile;
  record: SignatureRecord;
  wire: string;
  verificationUrl: string;
  messages: { service: string; user?: string };
  leafHash: string;
  expected: VerificationResult;
  signedBy: "service" | "service+user" | "rotated";
}

interface GoldenNegative {
  name: string;
  file: GoldenFile;
  record: SignatureRecord;
  wire: string;
  expected: VerificationResult;
  expectedWithoutFileHash: VerificationResult;
}

interface GoldenServiceKey {
  seedLabel: string;
  keyId: string;
  publicKeySpkiBase64: string;
}

/**
 * The fixtures store no private keys. Each test key is rebuilt from its
 * public seed label exactly as the generator made it: the Ed25519 seed is
 * SHA-256(label), and PKCS#8 DER is a constant prefix plus that seed.
 */
function pkcs8FromSeedLabel(seedLabel: string): Buffer {
  const seed = createHash("sha256").update(seedLabel, "utf8").digest();
  return Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
}

const keys = keysFixture as unknown as {
  service: GoldenServiceKey;
  rotatedOut: GoldenServiceKey;
  unpublished: GoldenServiceKey;
  user: { seedLabel: string; publicKeyRawBase64Url: string };
  publicKeysDocument: PublicKeysJson;
};
const records = recordsFixture as unknown as { baseUrl: string; positive: GoldenPositive[]; negative: GoldenNegative[] };
const legacy = legacyFixture as unknown as {
  file: GoldenFile;
  email: string;
  payload: LegacyPayload;
  signedMessage: string;
  encoded: string;
  link: string;
  expected: VerificationResult;
  wrongEmail: { email: string; expected: VerificationResult };
};
const log = logFixture as unknown as {
  entries: string[];
  root: string;
  head: SignedLogHead;
  headMessage: string;
  inclusion: { name: string; proof: InclusionProofResponse }[];
  consistency: { oldHead: SignedLogHead; oldHeadMessage: string; response: ConsistencyProofResponse };
};

const keyDoc = keys.publicKeysDocument;
const all = [...records.positive, ...records.negative];
const byName = new Map(records.positive.map((p) => [p.name, p]));
/** The file as a Blob: a string part is encoded as UTF-8, the exact bytes that were hashed. */
const fileBlob = (f: GoldenFile): Blob => new Blob([f.utf8]);

function stubKey(key: GoldenServiceKey, previous: string[] = []): void {
  vi.stubEnv("ED25519_PRIVATE_KEY", pkcs8FromSeedLabel(key.seedLabel).toString("base64"));
  vi.stubEnv("ED25519_PUBLIC_KEY", key.publicKeySpkiBase64);
  vi.stubEnv("ED25519_PUBLIC_KEYS_PREVIOUS", previous.join(","));
}

/** The keys the service runs with: the current key, with the rotated-out key still published. */
function stubServiceKeys(): void {
  stubKey(keys.service, [keys.rotatedOut.publicKeySpkiBase64]);
}

describe("golden fixtures: sanity of the fixtures themselves", () => {
  it("covers every case the compatibility contract names", () => {
    expect(records.positive.map((p) => p.name)).toEqual([
      "v2-plain-email",
      "v2-special-email",
      "v2-min-timestamp",
      "v2-max-timestamp",
      "v3-user-signed",
      "v2-rotated-out-key",
    ]);
    expect(records.negative.map((n) => [n.name, n.expected.reason])).toEqual([
      ["v2-tampered-email", "bad-signature"],
      ["v3-tampered-user-signature", "bad-signature"],
      ["v3-countersigned-bad-user-signature", "bad-user-signature"],
      ["unknown-key-id", "unknown-key"],
      ["wrong-file", "hash-mismatch"],
    ]);
    expect(byName.get("v2-special-email")?.wire).toContain("%7E");
    expect(byName.get("v2-min-timestamp")?.record.t).toBe(1);
    expect(byName.get("v2-max-timestamp")?.record.t).toBe(9007199254740991);
  });

  it("stores file hashes and key ids that match their inputs", () => {
    for (const f of [...all.map((r) => r.file), legacy.file]) {
      expect(createHash("sha256").update(f.utf8, "utf8").digest("hex")).toBe(f.sha256);
    }
    for (const key of [keys.service, keys.rotatedOut, keys.unpublished]) {
      expect(keyIdFromSpkiBase64(key.publicKeySpkiBase64)).toBe(key.keyId);
    }
    expect(parsePublicKeysJson(keyDoc)).toEqual(keyDoc);
    expect(keyDoc.current).toBe(keys.service.keyId);
    expect(Object.keys(keyDoc.keys).sort()).toEqual([keys.service.keyId, keys.rotatedOut.keyId].sort());
  });
});

describe("golden fixtures: wire format", () => {
  it.each(all.map((r) => [r.name, r] as const))("%s round-trips byte for byte", (_name, golden) => {
    const decoded = decodeRecord(golden.wire);
    expect(decoded).toEqual(golden.record);
    expect(encodeRecord(decoded!)).toBe(golden.wire);
    expect(encodeRecord(golden.record)).toBe(golden.wire);
    // The JSON form, as POST /api/verify and the account API carry it.
    expect(parseRecordObject(JSON.parse(JSON.stringify(golden.record)))).toEqual(golden.record);
  });

  it.each(all.map((r) => [r.name, r] as const))("%s parses from every pasted form", (_name, golden) => {
    const forms = [
      golden.wire,
      createVerificationUrl(golden.wire, records.baseUrl),
      `${records.baseUrl}/verify#P=${golden.wire}`,
      `#P=${golden.wire}`,
      `P=${golden.wire}`,
    ];
    for (const form of forms) {
      expect(parseVerificationInput(form), form).toEqual({ kind: "record", record: golden.record });
      expect(parseRecordInput(form), form).toEqual({ ok: true, record: golden.record });
    }
  });

  it("stores the verification URL the app builds", () => {
    for (const golden of records.positive) {
      expect(createVerificationUrl(golden.wire, records.baseUrl)).toBe(golden.verificationUrl);
    }
  });
});

describe("golden fixtures: signed messages", () => {
  it.each(records.positive.map((r) => [r.name, r] as const))("%s builds exactly the stored strings", (_name, golden) => {
    const { record, file, messages } = golden;
    expect(hashB64urlToHex(record.h)).toBe(file.sha256);
    expect(serviceMessageFor(record, file.sha256)).toBe(messages.service);
    if (record.v === 3) {
      expect(buildSignedMessage(file.sha256, record.e, record.t)).toBe(messages.user);
      expect(buildServiceMessageV3(file.sha256, record.e, record.t, record.u!, record.us!)).toBe(messages.service);
      expect(record.u).toBe(keys.user.publicKeyRawBase64Url);
    } else {
      expect(buildSignedMessage(file.sha256, record.e, record.t)).toBe(messages.service);
    }
  });
});

describe("golden fixtures: verification", () => {
  it.each(records.positive.map((r) => [r.name, r] as const))("%s verifies", (_name, golden) => {
    expect(verifyRecord(golden.record, golden.file.sha256, keyDoc)).toEqual(golden.expected);
    expect(verifyRecordAgainstHash(golden.record, golden.file.sha256.toUpperCase(), keyDoc)).toEqual(golden.expected);
  });

  it.each(records.negative.map((r) => [r.name, r] as const))("%s fails with its stored reason", (_name, golden) => {
    expect(verifyRecord(golden.record, golden.file.sha256, keyDoc)).toEqual(golden.expected);
  });

  it("verifies only against the published document, never a key the record names", () => {
    const withoutRotated: PublicKeysJson = {
      current: keyDoc.current,
      keys: { [keys.service.keyId]: keyDoc.keys[keys.service.keyId] },
    };
    const rotated = byName.get("v2-rotated-out-key")!;
    expect(verifyRecord(rotated.record, rotated.file.sha256, withoutRotated)).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("verifies the legacy payload as a bare blob and as a ?data= link", () => {
    for (const form of [legacy.encoded, legacy.link, `?data=${legacy.encoded}`]) {
      expect(parseVerificationInput(form), form).toEqual({ kind: "legacy", payload: legacy.payload });
      expect(parseRecordInput(form).ok).toBe(false);
    }
    expect(buildSignedMessage(legacy.file.sha256, legacy.email, legacy.payload.timestamp)).toBe(legacy.signedMessage);
    expect(verifyLegacyPayload(legacy.payload, legacy.email, legacy.file.sha256, keyDoc)).toEqual(legacy.expected);
    expect(verifyLegacyPayload(legacy.payload, legacy.wrongEmail.email, legacy.file.sha256, keyDoc)).toEqual(
      legacy.wrongEmail.expected
    );
  });

  it("agrees with the standalone verifier's verifyFile, hashing the exact file bytes", async () => {
    for (const golden of [...records.positive, ...records.negative]) {
      const result = await verifyFile(golden.wire, fileBlob(golden.file), { keys: keyDoc });
      expect(result, golden.name).toEqual({ ...golden.expected, record: golden.record, fileHash: golden.file.sha256 });
    }
    const legacyResult = await verifyFile(legacy.link, fileBlob(legacy.file), { keys: keyDoc });
    expect(legacyResult).toMatchObject({ ok: false, reason: "malformed", inputError: "legacy" });
  });
});

describe("golden fixtures: POST /api/verify and the published key document", () => {
  beforeEach(() => {
    vi.resetModules();
    stubServiceKeys();
  });

  const api = (r: VerificationResult): Record<string, unknown> => ({
    valid: r.ok,
    keyId: r.keyId ?? null,
    userSigned: r.userSigned ?? false,
    userKey: r.userKey ?? null,
    reason: r.reason ?? null,
  });

  it("publishes exactly the fixture key document", async () => {
    const wellKnown = await import("@/app/.well-known/public-keys.json/route");
    const response = await wellKnown.GET();
    expect(await response.json()).toEqual(keyDoc);
  });

  it("reports the stored result for every record, with and without fileHash", async () => {
    const { POST } = await import("@/app/api/verify/route");
    const call = async (body: unknown): Promise<unknown> => {
      const response = await POST(jsonRequest("http://t/api/verify", body));
      expect(response.status).toBe(200);
      return response.json();
    };
    for (const golden of records.positive) {
      const expected = api(golden.expected);
      expect(await call({ record: golden.wire, fileHash: golden.file.sha256 }), golden.name).toEqual(expected);
      expect(await call({ record: golden.wire }), golden.name).toEqual(expected);
      expect(await call({ record: golden.verificationUrl }), golden.name).toEqual(expected);
      expect(await call({ ...golden.record, fileHash: golden.file.sha256 }), golden.name).toEqual(expected);
    }
    for (const golden of records.negative) {
      expect(await call({ record: golden.wire, fileHash: golden.file.sha256 }), golden.name).toEqual(api(golden.expected));
      expect(await call({ record: golden.wire }), golden.name).toEqual(api(golden.expectedWithoutFileHash));
    }
  });
});

describe("golden fixtures: signing reproduces the issued bytes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(records.positive.map((r) => [r.name, r] as const))("signFileHash reproduces %s", async (_name, golden) => {
    stubKey(golden.signedBy === "rotated" ? keys.rotatedOut : keys.service);
    const { signFileHash } = await import("@/lib/crypto/ed25519");
    const { record, file } = golden;
    const user = record.v === 3 ? { publicKey: record.u!, signature: record.us! } : undefined;
    const signed = signFileHash(file.sha256, record.e, record.t, user);
    expect(signed).toEqual(record);
    expect(encodeRecord(signed)).toBe(golden.wire);
  });

  it("the user key reproduces the stored v3 user signature", () => {
    const golden = byName.get("v3-user-signed")!;
    const userKey = createPrivateKey({
      key: pkcs8FromSeedLabel(keys.user.seedLabel),
      format: "der",
      type: "pkcs8",
    });
    expect(sign(null, Buffer.from(golden.messages.user!, "utf8"), userKey).toString("base64url")).toBe(golden.record.us);
  });

  it("buildSignedLogHead reproduces the stored heads from the same records and timestamps", async () => {
    stubKey(keys.service);
    const { buildSignedLogHead, buildConsistencyProof, buildInclusionProof } = await import("@/lib/log-head");
    const store = createMemoryLogStore();
    const oldStore = createMemoryLogStore();
    for (const [i, name] of log.entries.entries()) {
      await store.append(byName.get(name)!.record);
      if (i < log.consistency.oldHead.size) await oldStore.append(byName.get(name)!.record);
    }
    expect(await buildSignedLogHead(store, log.head.timestamp)).toEqual(log.head);
    expect(await buildSignedLogHead(oldStore, log.consistency.oldHead.timestamp)).toEqual(log.consistency.oldHead);

    // The served proofs carry a head signed now, so compare everything else.
    for (const { proof } of log.inclusion) {
      const served = await buildInclusionProof(store, proof.index);
      expect({ ...served, head: undefined }).toEqual({ ...proof, head: undefined });
    }
    const consistency = await buildConsistencyProof(store, log.consistency.response.from, log.consistency.response.to);
    expect(consistency.ok && consistency.response.proof).toEqual(log.consistency.response.proof);
  });
});

describe("golden fixtures: transparency log", () => {
  const leaves = (): Uint8Array[] => log.entries.map((name) => recordLeafHash(byName.get(name)!.record));

  it("hashes each record to its stored leaf", () => {
    for (const golden of records.positive) {
      expect(bytesToHex(recordLeafHash(golden.record)), golden.name).toBe(golden.leafHash);
    }
  });

  it("computes the stored root, inclusion proofs and consistency proof", () => {
    const l = leaves();
    expect(bytesToHex(computeRoot(l))).toBe(log.root);
    expect(log.head.root).toBe(log.root);
    expect(bytesToHex(computeRoot(l.slice(0, log.consistency.oldHead.size)))).toBe(log.consistency.oldHead.root);
    for (const { name, proof } of log.inclusion) {
      expect(bytesToHex(l[proof.index]), name).toBe(proof.leafHash);
      expect(inclusionProof(l, proof.index).map(bytesToHex), name).toEqual(proof.proof);
    }
    const { from, to, proof } = log.consistency.response;
    expect(consistencyProof(l, from, to).map(bytesToHex)).toEqual(proof);
  });

  it("builds the stored head messages and verifies the heads", () => {
    expect(logHeadMessage(log.head.size, log.head.root, log.head.timestamp)).toBe(log.headMessage);
    const old = log.consistency.oldHead;
    expect(logHeadMessage(old.size, old.root, old.timestamp)).toBe(log.consistency.oldHeadMessage);
    expect(verifyLogHead(log.head, keyDoc)).toBe(true);
    expect(verifyLogHead(old, keyDoc)).toBe(true);
    expect(verifyLogHead({ ...log.head, timestamp: log.head.timestamp + 1 }, keyDoc)).toBe(false);
  });

  it("verifies every stored inclusion proof, and the consistency proof", () => {
    for (const { name, proof } of log.inclusion) {
      expect(verifyInclusionProof(byName.get(name)!.record, proof, keyDoc), name).toBe(true);
    }
    const { oldHead, response } = log.consistency;
    expect(verifyLogConsistency(oldHead, response.head, response.proof, keyDoc)).toBe(true);
    expect(verifyConsistencyResponse(oldHead, response, keyDoc)).toBe(true);
  });
});

describe("golden fixtures: the archive script's verifier agrees", () => {
  const scriptPath = path.join(process.cwd(), "scripts", "verify-log-head.mjs");
  let server: Server;
  let baseUrl: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "golden-log-head-"));
    const { from, to } = log.consistency.response;
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      let body: unknown = { error: "not found" };
      let status = 404;
      if (url === "/.well-known/public-keys.json") {
        [status, body] = [200, keyDoc];
      } else if (url === `/api/log/consistency?from=${from}&to=${to}`) {
        [status, body] = [200, log.consistency.response];
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  function run(...heads: unknown[]): Promise<{ code: number; output: string }> {
    const files = heads.map((head, i) => {
      const file = path.join(dir, `head-${i}.json`);
      writeFileSync(file, JSON.stringify(head));
      return file;
    });
    return new Promise((resolve) => {
      const env = { ...process.env, VERIFY_LOG_HEAD_RETRY_MS: "1,1" };
      execFile(process.execPath, [scriptPath, "--base-url", baseUrl, ...files], { env }, (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` });
      });
    });
  }

  it("verifies the stored consistency proof with its Merkle code", async () => {
    const { verifyConsistency } = (await import(pathToFileURL(scriptPath).href)) as {
      verifyConsistency: (m: number, n: number, oldRoot: Buffer, newRoot: Buffer, proof: Buffer[]) => boolean;
    };
    const { oldHead, response } = log.consistency;
    const hex = (h: string): Buffer => Buffer.from(hexToBytes(h));
    expect(verifyConsistency(oldHead.size, response.to, hex(oldHead.root), hex(response.head.root), response.proof.map(hex))).toBe(true);
  });

  it("accepts the stored heads end to end, and rejects a tampered head", async () => {
    const ok = await run(log.head, log.consistency.oldHead);
    expect(ok.code, ok.output).toBe(0);
    expect(ok.output).toContain("ok: new head signature verifies");
    expect(ok.output).toContain("is a prefix of the new head");

    const tampered = await run({ ...log.head, timestamp: log.head.timestamp + 1 }, log.consistency.oldHead);
    expect(tampered.code).toBe(1);
    expect(tampered.output).toContain("signature does not verify");
  });
});

describe("the committed production key document", () => {
  it("still parses, and every key id is derived from its key", () => {
    const parsed = parsePublicKeysJson(productionKeys);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!.keys).length).toBeGreaterThan(0);
    expect(parsed!.keys[parsed!.current]).toBeDefined();
    for (const [id, entry] of Object.entries(productionKeys.keys as Record<string, { keyId: string; publicKey: string }>)) {
      expect(entry.keyId, id).toBe(id);
      expect(keyIdFromSpkiBase64(entry.publicKey), id).toBe(id);
    }
  });
});
