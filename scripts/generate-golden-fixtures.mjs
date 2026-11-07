#!/usr/bin/env node
/**
 * One-off generator for the golden compatibility fixtures in
 * src/test/fixtures/golden/*.json, which src/lib/golden-compat.test.ts reads.
 *
 *   node scripts/generate-golden-fixtures.mjs
 *
 * Run once; the output is committed and the tests never regenerate it. The
 * fixtures pin the formats of records that are already in people's hands, so
 * if the test fails, a change broke compatibility: fix the code, never rerun
 * this to make the fixtures agree with it.
 *
 * Every primitive is implemented here from the documented formats with plain
 * node:crypto, independently of src/lib, so the test cross-checks the app's
 * code against a second implementation rather than against itself. Keys are
 * derived from fixed, public seeds, so a rerun reproduces the same bytes
 * (Ed25519 signing is deterministic) and a diff shows any drift.
 *
 * ALL KEYS HERE ARE TEST-ONLY AND NOT SECRET. They must never be configured
 * on a real deployment.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "test", "fixtures", "golden");
const BASE_URL = "https://www.contentproof.app";
const TEST_ONLY = "TEST-ONLY key derived from a public seed. NOT SECRET. Never configure it on a real deployment.";

// ---- primitives ----

const sha256 = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

/** Ed25519 key pair from a fixed seed: PKCS#8 DER is a constant prefix plus the 32-byte seed. */
function keyFromSeed(label) {
  const seed = sha256(Buffer.from(`contentproof-golden-fixture/${label}`, "utf8"));
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return {
    privateKey,
    seedLabel: `contentproof-golden-fixture/${label}`,
    pkcs8Base64: pkcs8.toString("base64"),
    spkiBase64: spki.toString("base64"),
    rawPublicKeyBase64Url: spki.subarray(-32).toString("base64url"),
    rawPrivateSeedBase64Url: seed.toString("base64url"),
    keyId: sha256(spki).toString("base64url").slice(0, 16),
  };
}

const signText = (key, text) => sign(null, Buffer.from(text, "utf8"), key.privateKey).toString("base64url");

// Signed message layouts (src/lib/record.ts).
const userMessage = (hashHex, email, t) => `${hashHex}:${email}:${t}`;
const serviceMessageV2 = userMessage;
const serviceMessageV3 = (hashHex, email, t, u, us) => `${hashHex}:${email}:${t}:${u}:${us}`;

// Wire format (src/lib/record.ts).
const encodeEmail = (email) => encodeURIComponent(email).replace(/~/g, "%7E");
function encodeWire(r) {
  const fields = [String(r.v), r.k, r.h, encodeEmail(r.e), String(r.t), r.s];
  if (r.v === 3) fields.push(r.u, r.us);
  return fields.join("~");
}

// RFC 6962 Merkle tree (src/lib/merkle.ts), written recursively from the RFC.
const leafHash = (bytes) => sha256(Buffer.of(0x00), bytes);
const nodeHash = (l, r) => sha256(Buffer.of(0x01), l, r);
const split = (n) => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
};
function mth(leaves) {
  if (leaves.length === 0) return sha256(Buffer.alloc(0));
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}
function auditPath(m, leaves) {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k
    ? [...auditPath(m, leaves.slice(0, k)), mth(leaves.slice(k))]
    : [...auditPath(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}
function subproof(m, leaves, complete) {
  const n = leaves.length;
  if (m === n) return complete ? [] : [mth(leaves)];
  const k = split(n);
  return m <= k
    ? [...subproof(m, leaves.slice(0, k), complete), mth(leaves.slice(k))]
    : [...subproof(m - k, leaves.slice(k), false), mth(leaves.slice(0, k))];
}
const consistency = (m, leaves) => (m === 0 || m === leaves.length ? [] : subproof(m, leaves, true));
const logHeadMessage = (size, root, t) => `contentproof-log/v1\n${size}\n${root}\n${t}`;

// ---- keys ----

const service = keyFromSeed("service-key-current");
const rotated = keyFromSeed("service-key-rotated-out");
const unpublished = keyFromSeed("service-key-never-published");
const user = keyFromSeed("user-browser-key");

const publicKeysDocument = {
  current: service.keyId,
  keys: {
    [service.keyId]: { keyId: service.keyId, algorithm: "Ed25519", publicKey: service.spkiBase64 },
    [rotated.keyId]: { keyId: rotated.keyId, algorithm: "Ed25519", publicKey: rotated.spkiBase64 },
  },
};

const serviceKeyJson = (k, role) => ({
  role,
  notice: TEST_ONLY,
  seedLabel: k.seedLabel,
  keyId: k.keyId,
  // No private key is stored: tests rebuild it from seedLabel (SHA-256 of the
  // label is the Ed25519 seed), so no key material is committed and secret
  // scanners stay quiet.
  publicKeySpkiBase64: k.spkiBase64,
});

// ---- records ----

function file(utf8) {
  return { utf8, sha256: sha256(Buffer.from(utf8, "utf8")).toString("hex") };
}

/** Build a record the way the service would, signed with `key` (and the user key for v3). */
function issue({ key, fileText, email, t, userSigned = false }) {
  const f = file(fileText);
  const h = Buffer.from(f.sha256, "hex").toString("base64url");
  const messages = {};
  let record;
  if (!userSigned) {
    messages.service = serviceMessageV2(f.sha256, email, t);
    record = { v: 2, k: key.keyId, h, e: email, t, s: signText(key, messages.service) };
  } else {
    messages.user = userMessage(f.sha256, email, t);
    const us = signText(user, messages.user);
    messages.service = serviceMessageV3(f.sha256, email, t, user.rawPublicKeyBase64Url, us);
    record = { v: 3, k: key.keyId, h, e: email, t, s: signText(key, messages.service), u: user.rawPublicKeyBase64Url, us };
  }
  return { file: f, record, messages };
}

const ok = (k, userKey) =>
  userKey ? { ok: true, keyId: k, userSigned: true, userKey } : { ok: true, keyId: k, userSigned: false };

function positive(name, description, issued, signedBy) {
  const wire = encodeWire(issued.record);
  return {
    name,
    description,
    signedBy,
    file: issued.file,
    record: issued.record,
    wire,
    verificationUrl: `${BASE_URL}/verify#P=${wire}`,
    messages: issued.messages,
    leafHash: leafHash(Buffer.from(wire, "utf8")).toString("hex"),
    expected: ok(issued.record.k, issued.record.v === 3 ? issued.record.u : undefined),
  };
}

const T = 1_762_473_600_000; // 2025-11-07T00:00:00Z

const positives = [
  positive(
    "v2-plain-email",
    "Version 2 record, plain email",
    issue({ key: service, fileText: "ContentProof golden fixture: plain v2 record\n", email: "alice@example.com", t: T }),
    "service"
  ),
  positive(
    "v2-special-email",
    "Version 2 record whose email has ~, + and non-ASCII characters (percent-encoded on the wire, ~ as %7E)",
    issue({
      key: service,
      fileText: "ContentProof golden fixture: special email ~+ ü\n",
      email: "zoë+proof~2026@exämple.org",
      t: T + 1,
    }),
    "service"
  ),
  positive(
    "v2-min-timestamp",
    "Version 2 record at the smallest valid timestamp (1)",
    issue({ key: service, fileText: "ContentProof golden fixture: t = 1\n", email: "edge@example.com", t: 1 }),
    "service"
  ),
  positive(
    "v2-max-timestamp",
    "Version 2 record at the largest valid 16-digit timestamp (Number.MAX_SAFE_INTEGER)",
    issue({
      key: service,
      fileText: "ContentProof golden fixture: t = 9007199254740991\n",
      email: "edge@example.com",
      t: Number.MAX_SAFE_INTEGER,
    }),
    "service"
  ),
  positive(
    "v3-user-signed",
    "Version 3 record signed by the account holder's browser key and countersigned by the service",
    issue({
      key: service,
      fileText: "ContentProof golden fixture: v3 user-signed record\n",
      email: "bob@example.com",
      t: T + 2,
      userSigned: true,
    }),
    "service+user"
  ),
  positive(
    "v2-rotated-out-key",
    "Version 2 record signed by a service key that has since been rotated out but is still listed in the key document",
    issue({ key: rotated, fileText: "ContentProof golden fixture: rotated-out key\n", email: "carol@example.com", t: T - 86_400_000 }),
    "rotated"
  ),
];

const byName = Object.fromEntries(positives.map((p) => [p.name, p]));

// Flip the first character of a base64url string: still well-formed, different bytes.
// (The last character of an 86-char signature carries padding bits, so it is left alone.)
const flipFirst = (s) => (s[0] === "A" ? "B" : "A") + s.slice(1);

function negative(name, description, record, fileText, expected, apiWithoutFileHash) {
  return {
    name,
    description,
    file: file(fileText),
    record,
    wire: encodeWire(record),
    expected,
    /** What POST /api/verify reports when no fileHash is sent (it then checks the record's own hash). */
    expectedWithoutFileHash: apiWithoutFileHash,
  };
}

const v2 = byName["v2-plain-email"];
const v3 = byName["v3-user-signed"];

// A v3 record whose user signature is wrong but which the service did countersign
// (signFileHash refuses to do this; the generator does it by hand).
const badUser = (() => {
  const f = file("ContentProof golden fixture: countersigned bad user signature\n");
  const email = "dave@example.com";
  const t = T + 3;
  const us = signText(user, userMessage(f.sha256, email, t + 1)); // signs the wrong timestamp
  const h = Buffer.from(f.sha256, "hex").toString("base64url");
  const s = signText(service, serviceMessageV3(f.sha256, email, t, user.rawPublicKeyBase64Url, us));
  return { f, record: { v: 3, k: service.keyId, h, e: email, t, s, u: user.rawPublicKeyBase64Url, us } };
})();

const unknownKeyRecord = issue({
  key: unpublished,
  fileText: "ContentProof golden fixture: unpublished key\n",
  email: "eve@example.com",
  t: T + 4,
});

const negatives = [
  negative(
    "v2-tampered-email",
    "The plain v2 record with its email changed after signing",
    { ...v2.record, e: "mallory@example.com" },
    v2.file.utf8,
    { ok: false, reason: "bad-signature" },
    { ok: false, reason: "bad-signature" }
  ),
  negative(
    "v3-tampered-user-signature",
    "The v3 record with `us` altered after signing. The service signature covers `u` and `us`, so this is bad-signature, not bad-user-signature",
    { ...v3.record, us: flipFirst(v3.record.us) },
    v3.file.utf8,
    { ok: false, reason: "bad-signature" },
    { ok: false, reason: "bad-signature" }
  ),
  negative(
    "v3-countersigned-bad-user-signature",
    "A v3 record the service countersigned although the user signature covers a different timestamp",
    badUser.record,
    badUser.f.utf8,
    { ok: false, reason: "bad-user-signature" },
    { ok: false, reason: "bad-user-signature" }
  ),
  negative(
    "unknown-key-id",
    "A well-formed v2 record signed by a key whose id is not in the key document",
    unknownKeyRecord.record,
    unknownKeyRecord.file.utf8,
    { ok: false, reason: "unknown-key" },
    { ok: false, reason: "unknown-key" }
  ),
  negative(
    "wrong-file",
    "The genuine plain v2 record checked against a different file",
    v2.record,
    "ContentProof golden fixture: not the file that was signed\n",
    { ok: false, reason: "hash-mismatch" },
    ok(v2.record.k)
  ),
];

// ---- legacy pre-v2 payload ----

const legacy = (() => {
  const f = file("ContentProof golden fixture: legacy pre-v2 payload\n");
  const email = "legacy@example.com";
  const timestamp = 1_700_000_000_000;
  const message = userMessage(f.sha256, email, timestamp);
  const payload = { signature: signText(service, message), publicKey: service.spkiBase64, timestamp };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    description:
      "Pre-version-2 QR payload: base64url JSON {signature, publicKey, timestamp}. The verifier supplies the email and the file.",
    file: f,
    email,
    payload,
    signedMessage: message,
    encoded,
    link: `${BASE_URL}/verify?data=${encoded}`,
    expected: { ok: true, keyId: service.keyId, userSigned: false },
    wrongEmail: { email: "someone-else@example.com", expected: { ok: false, reason: "bad-signature" } },
  };
})();

// ---- log ----

const leaves = positives.map((p) => Buffer.from(p.leafHash, "hex"));
const LOG_T = 1_762_560_000_000; // 2025-11-08T00:00:00Z
const head = (size, t) => {
  const root = mth(leaves.slice(0, size)).toString("hex");
  const message = logHeadMessage(size, root, t);
  return { size, root, timestamp: t, keyId: service.keyId, signature: signText(service, message), message };
};
const fullHead = head(leaves.length, LOG_T);
const CONSISTENCY_FROM = 3;
const oldHead = head(CONSISTENCY_FROM, LOG_T - 60_000);
const stripMessage = (h) => Object.fromEntries(Object.entries(h).filter(([key]) => key !== "message"));

const log = {
  description: "The positive records, in order, as a transparency log. Heads are signed by the current service key.",
  entries: positives.map((p) => p.name),
  root: fullHead.root,
  head: stripMessage(fullHead),
  headMessage: fullHead.message,
  inclusion: positives.map((p, index) => ({
    name: p.name,
    proof: {
      index,
      size: leaves.length,
      root: fullHead.root,
      leafHash: p.leafHash,
      proof: auditPath(index, leaves).map((b) => b.toString("hex")),
      head: stripMessage(fullHead),
    },
  })),
  consistency: {
    oldHead: stripMessage(oldHead),
    oldHeadMessage: oldHead.message,
    response: {
      from: CONSISTENCY_FROM,
      to: leaves.length,
      proof: consistency(CONSISTENCY_FROM, leaves).map((b) => b.toString("hex")),
      head: stripMessage(fullHead),
    },
  },
};

// ---- write ----

const keys = {
  notice: TEST_ONLY,
  service: serviceKeyJson(service, "current service key"),
  rotatedOut: serviceKeyJson(rotated, "service key rotated out but still published"),
  unpublished: serviceKeyJson(unpublished, "service key that was never published (for the unknown-key fixture)"),
  user: {
    role: "account holder's browser key (v3 records)",
    notice: TEST_ONLY,
    seedLabel: user.seedLabel,
    publicKeyRawBase64Url: user.rawPublicKeyBase64Url,
  },
  publicKeysDocument,
};

mkdirSync(OUT_DIR, { recursive: true });
const write = (name, value) => writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
write("keys.json", keys);
write("records.json", { baseUrl: BASE_URL, positive: positives, negative: negatives });
write("legacy.json", legacy);
write("log.json", log);
console.log(`wrote golden fixtures to ${OUT_DIR}`);
