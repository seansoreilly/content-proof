#!/usr/bin/env node
/**
 * Verify a freshly archived transparency-log head before it is committed.
 *
 *   node scripts/verify-log-head.mjs --base-url https://contentproof.app NEW.json [PREVIOUS.json]
 *
 * (`--base-url` may instead come from CONTENTPROOF_BASE_URL.)
 *
 * 1. Fetches /.well-known/public-keys.json and checks NEW's Ed25519 signature.
 * 2. With PREVIOUS: checks its signature too when its key is still published
 *    (an unknown key, after a rotation, is reported and skipped, as in
 *    src/lib/log-heads-archive.test.ts), refuses a log that shrank, then
 *    fetches /api/log/consistency?from=<previous size>&to=<new size> and checks
 *    the RFC 6962 proof links PREVIOUS's root to NEW's root.
 *
 * The service only proves consistency to its current size. If the log grew
 * between fetching NEW and asking for the proof, both heads are instead
 * proven against a fresher signed head: two trees that are prefixes of the
 * same tree, the smaller no larger than the other, are prefixes of each other.
 *
 * Exit codes: 0 verified; 1 verification failed (a bad signature, a log that
 * shrank or was rewritten, a malformed response); 2 usage; 3 the service
 * could not be reached after retries (network error, 429 or 5xx), which says
 * nothing either way about the log. Plain Node (18+), no
 * dependencies: this mirrors src/lib/merkle.ts (verifyConsistency) and
 * src/lib/log-verify.ts (logHeadMessage, verifyLogHead) using node:crypto.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOG_HEAD_DOMAIN = "contentproof-log/v1";
const HEX64 = /^[0-9a-f]{64}$/;

class VerificationError extends Error {}
class ServiceUnavailable extends Error {}

function fail(message) {
  throw new VerificationError(message);
}

// ---- Merkle (RFC 6962 / RFC 9162), mirrors src/lib/merkle.ts ----

const sha256 = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const nodeHash = (left, right) => sha256(Buffer.of(0x01), left, right);
const EMPTY_ROOT = sha256(Buffer.alloc(0));
const isPowerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;
const isTreeSize = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 0x7fffffff;

/** RFC 9162 §2.1.4.2. Arguments are Buffers; sizes are integers. */
export function verifyConsistency(m, n, oldRoot, newRoot, proof) {
  if (!isTreeSize(m) || !isTreeSize(n) || m > n) return false;
  if (m === n) return proof.length === 0 && oldRoot.equals(newRoot);
  if (m === 0) return proof.length === 0 && oldRoot.equals(EMPTY_ROOT);
  if (proof.length === 0) return false;
  const path = isPowerOfTwo(m) ? [oldRoot, ...proof] : proof;
  let fn = m - 1;
  let sn = n - 1;
  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = path[0];
  let sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      if ((fn & 1) === 0) {
        while (!((fn & 1) === 1 || fn === 0)) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && fr.equals(oldRoot) && sr.equals(newRoot);
}

// ---- Signed heads, mirrors src/lib/log-verify.ts ----

function parseHead(value, label) {
  const ok =
    value &&
    typeof value === "object" &&
    isTreeSize(value.size) &&
    typeof value.root === "string" &&
    HEX64.test(value.root) &&
    Number.isSafeInteger(value.timestamp) &&
    typeof value.keyId === "string" &&
    typeof value.signature === "string";
  if (!ok) fail(`${label} is not a signed log head ({size, root, timestamp, keyId, signature})`);
  return value;
}

function findKey(keys, keyId) {
  return keyId && Object.prototype.hasOwnProperty.call(keys.keys, keyId) ? keys.keys[keyId] : undefined;
}

function headSignatureValid(head, entry) {
  try {
    const key = createPublicKey({ key: Buffer.from(entry.publicKey, "base64"), format: "der", type: "spki" });
    const message = `${LOG_HEAD_DOMAIN}\n${head.size}\n${head.root}\n${head.timestamp}`;
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(head.signature, "base64url"));
  } catch {
    return false;
  }
}

function requireSignedHead(head, keys, label) {
  const entry = findKey(keys, head.keyId);
  if (!entry) fail(`${label} is signed by key ${head.keyId}, which is not in the published key set`);
  if (!headSignatureValid(head, entry)) fail(`${label} signature does not verify (size ${head.size}, root ${head.root})`);
}

// ---- HTTP ----

const RETRY_DELAYS_MS = (process.env.VERIFY_LOG_HEAD_RETRY_MS ?? "1000,4000").split(",").map(Number);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON, retrying network errors, 429 and 5xx a couple of times. If the
 * service still cannot answer, that is an outage, not evidence of tampering,
 * so it ends the run with ServiceUnavailable (exit 3) rather than a failure.
 */
async function getJson(url) {
  let problem = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res;
    try {
      res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      problem = error.message;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      problem = `HTTP ${res.status}`;
      continue;
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      // reported by the caller as a malformed response
    }
    return { status: res.status, body };
  }
  throw new ServiceUnavailable(`GET ${url} failed: ${problem}`);
}

/** A 400 from the consistency route because the log is now larger than `size`. */
function grewPast(response, size) {
  return (
    response.status === 400 && response.body !== null && Number.isSafeInteger(response.body.size) && response.body.size > size
  );
}

async function fetchConsistency(baseUrl, from, to) {
  const query = to === undefined ? `from=${from}` : `from=${from}&to=${to}`;
  return getJson(`${baseUrl}/api/log/consistency?${query}`);
}

/** Check a 200 consistency response from `old` and return its (signed) head. */
function checkConsistencyResponse(old, body, keys, label) {
  if (!body || body.from !== old.size || !Array.isArray(body.proof)) {
    fail(`${label}: malformed consistency response ${JSON.stringify(body)}`);
  }
  const head = parseHead(body.head, `${label}: response head`);
  if (body.to !== head.size) fail(`${label}: response is for size ${body.to} but its head has size ${head.size}`);
  requireSignedHead(head, keys, `${label}: response head`);
  if (!body.proof.every((p) => typeof p === "string" && HEX64.test(p))) fail(`${label}: proof is not a list of hex hashes`);
  const proof = body.proof.map((p) => Buffer.from(p, "hex"));
  if (!verifyConsistency(old.size, head.size, Buffer.from(old.root, "hex"), Buffer.from(head.root, "hex"), proof)) {
    fail(`${label}: consistency proof from size ${old.size} to ${head.size} does not verify`);
  }
  return head;
}

// ---- Main ----

function parseArgs(argv) {
  const files = [];
  let baseUrl = process.env.CONTENTPROOF_BASE_URL;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") baseUrl = argv[++i];
    else if (argv[i].startsWith("--base-url=")) baseUrl = argv[i].slice("--base-url=".length);
    else files.push(argv[i]);
  }
  if (!baseUrl || files.length < 1 || files.length > 2) {
    console.error("usage: node scripts/verify-log-head.mjs --base-url <url> <new-head.json> [<previous-head.json>]");
    process.exit(2);
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), newFile: files[0], prevFile: files[1] };
}

function readHead(file, label) {
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read ${label} ${file}: ${error.message}`);
  }
  return parseHead(json, `${label} ${file}`);
}

async function main() {
  const { baseUrl, newFile, prevFile } = parseArgs(process.argv.slice(2));
  const next = readHead(newFile, "new head");
  const prev = prevFile ? readHead(prevFile, "previous head") : null;

  const { status, body: keys } = await getJson(`${baseUrl}/.well-known/public-keys.json`);
  if (status !== 200 || !keys || typeof keys.keys !== "object" || keys.keys === null) {
    fail(`could not fetch the published keys (HTTP ${status})`);
  }

  requireSignedHead(next, keys, `new head ${newFile}`);
  console.log(`ok: new head signature verifies (size ${next.size}, key ${next.keyId})`);

  if (!prev) {
    console.log("no previous head given; skipping the consistency check");
    return;
  }
  if (findKey(keys, prev.keyId)) {
    requireSignedHead(prev, keys, `previous head ${prevFile}`);
    console.log(`ok: previous head signature verifies (size ${prev.size})`);
  } else {
    console.warn(`warning: previous head key ${prev.keyId} is no longer published; not checking its signature`);
  }
  if (prev.size > next.size) fail(`the log shrank: previous head has size ${prev.size}, new head ${next.size}`);

  // Two cases are consistent by definition and need no proof from the service
  // (RFC 9162 §2.1.4.2): an empty previous tree, and two heads of the same
  // size, which must then carry the same root. Deciding them locally also
  // keeps the archive working against a deployment without the consistency
  // endpoint while the log is still empty.
  if (prev.size === 0) {
    if (prev.root !== EMPTY_ROOT.toString("hex")) fail(`previous head has size 0 but is not the empty-tree root`);
    console.log(`ok: previous head (the empty tree) is a prefix of the new head (size ${next.size})`);
    return;
  }
  if (prev.size === next.size) {
    if (prev.root !== next.root) fail(`previous and new heads both have size ${next.size} but different roots: the log was rewritten`);
    console.log(`ok: previous head (size ${prev.size}, same root) is a prefix of the new head (size ${next.size})`);
    return;
  }

  const direct = await fetchConsistency(baseUrl, prev.size, next.size);
  if (direct.status === 200) {
    const head = checkConsistencyResponse(prev, direct.body, keys, `consistency ${prev.size} -> ${next.size}`);
    if (head.size !== next.size || head.root !== next.root) {
      fail(`the service's current tree of size ${head.size} has root ${head.root}, not the new head's ${next.root}`);
    }
    console.log(`ok: previous head (size ${prev.size}) is a prefix of the new head (size ${next.size})`);
    return;
  }

  if (!grewPast(direct, next.size)) {
    fail(`GET consistency ${prev.size} -> ${next.size}: HTTP ${direct.status} ${JSON.stringify(direct.body)}`);
  }

  // The log grew after NEW was fetched. Prove NEW, then PREVIOUS, against one
  // fresher signed head, retrying if it grows again in between.
  console.log(`the log grew to ${direct.body.size} since the new head was fetched; checking both against a fresher head`);
  for (let attempt = 1; ; attempt++) {
    const fromNew = await fetchConsistency(baseUrl, next.size);
    if (fromNew.status !== 200) fail(`GET consistency from ${next.size}: HTTP ${fromNew.status} ${JSON.stringify(fromNew.body)}`);
    const fresh = checkConsistencyResponse(next, fromNew.body, keys, `consistency ${next.size} -> latest`);
    const fromPrev = await fetchConsistency(baseUrl, prev.size, fresh.size);
    if (fromPrev.status === 200) {
      const fresh2 = checkConsistencyResponse(prev, fromPrev.body, keys, `consistency ${prev.size} -> ${fresh.size}`);
      if (fresh2.size !== fresh.size || fresh2.root !== fresh.root) {
        fail(`two signed heads of size ${fresh.size} disagree: ${fresh.root} and ${fresh2.root}`);
      }
      console.log(
        `ok: previous head (size ${prev.size}) and new head (size ${next.size}) are both prefixes of the signed head of size ${fresh.size}`
      );
      return;
    }
    if (!grewPast(fromPrev, fresh.size)) {
      fail(`GET consistency ${prev.size} -> ${fresh.size}: HTTP ${fromPrev.status} ${JSON.stringify(fromPrev.body)}`);
    }
    if (attempt >= 3) throw new ServiceUnavailable("the log kept growing during the check; rerun later");
    console.log(`the log grew again to ${fromPrev.body.size}; retrying`);
  }
}

// Run only when invoked directly, so tests can import verifyConsistency.
const invokedDirectly =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    if (error instanceof ServiceUnavailable) {
      console.error(`log head verification INCOMPLETE (service unavailable): ${error.message}`);
      process.exit(3);
    }
    if (error instanceof VerificationError) {
      console.error(`log head verification FAILED: ${error.message}`);
    } else {
      console.error("log head verification FAILED:", error);
    }
    process.exit(1);
  });
}
