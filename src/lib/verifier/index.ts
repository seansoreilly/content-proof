/**
 * ContentProof verifier: the one module to vendor or embed when checking
 * ContentProof records outside this app (a CLI, another site, a CI job), and
 * the entry point the app itself can use. It is environment-agnostic: no Next,
 * no `node:crypto`, no DOM and no worker, so it runs unchanged in browsers,
 * Node 18+, Deno, Bun and edge runtimes. Its only dependencies are the noble
 * hash and curve libraries, through the `@/lib` modules it re-uses.
 *
 * Trust comes only from the service's published key document,
 * `<origin>/.well-known/public-keys.json`, or from keys the caller passes in
 * after fetching that document themselves. A key is never taken from the
 * record being verified: a record names its signing key by id, and that id
 * must resolve in the published set, or the result is `unknown-key`. Anyone
 * can mint a self-consistent record with their own key; only the published
 * set makes a record the service's.
 *
 * Failure handling, deliberately split in two:
 *  - A record or link that cannot be parsed is an answer about the input, so
 *    it comes back as a result (`ok: false`, `reason: "malformed"`, plus an
 *    `inputError` saying why), never as an exception.
 *  - Keys that cannot be loaded (no network, a non-2xx response, a document
 *    that is not a key set) throw. That says nothing about the record, and
 *    reporting it as `unknown-key` would make a network outage look like a
 *    forgery.
 *
 * Legacy pre-version-2 payloads carry no email or file hash and cannot be
 * verified from the record alone, so this module rejects them with
 * `inputError: "legacy"`; the in-app verify page still handles them.
 */
import { verifyRecord, type VerificationFailure, type VerificationResult } from "@/lib/crypto/verify";
import { hashBlobStreaming } from "@/lib/hash-stream";
import { parsePublicKeysJson, type PublicKeyEntry, type PublicKeysJson } from "@/lib/keyset";
import { PUBLIC_KEYS_PATH } from "@/lib/keyset-client";
import { parseRecordObject, type SignatureRecord } from "@/lib/record";
import { parseVerificationInput } from "@/lib/verify-input";

export type { PublicKeyEntry, PublicKeysJson, SignatureRecord, VerificationFailure, VerificationResult };

/** Path of the published key document, relative to the service origin. */
export { PUBLIC_KEYS_PATH };

/**
 * A version 3 record is about 330 characters and a link adds its origin;
 * anything far longer is not a record. The cap also bounds the work the
 * pasted-form parser does on hostile input, which matters on the server.
 */
export const MAX_RECORD_INPUT_LENGTH = 4096;

/** Why a pasted record or link was not accepted. */
export type RecordInputError = "empty" | "too-long" | "unparseable" | "legacy";

export type ParsedRecordInput =
  | { ok: true; record: SignatureRecord }
  | { ok: false; error: RecordInputError; message: string };

const INPUT_ERROR_MESSAGES: Record<RecordInputError, string> = {
  empty: "No record or verification link was given",
  "too-long": `Longer than ${MAX_RECORD_INPUT_LENGTH} characters, so not a ContentProof record or verification link`,
  unparseable: "Not a ContentProof record or verification link",
  legacy:
    "This is a legacy (pre-version-2) payload. It carries no file hash or email, so it can only be checked on the ContentProof verify page",
};

function inputError(error: RecordInputError): ParsedRecordInput {
  return { ok: false, error, message: INPUT_ERROR_MESSAGES[error] };
}

/**
 * Parse anything a person might paste: a compact `2~…` or `3~…` record, a
 * full verification URL, a bare `#P=` fragment, or any of those wrapped in
 * quotes, angle brackets or a markdown link, or broken across lines by a mail
 * client. Only current (version 2 and 3) records are returned.
 */
export function parseRecordInput(text: string): ParsedRecordInput {
  if (typeof text !== "string" || !text.trim()) return inputError("empty");
  if (text.length > MAX_RECORD_INPUT_LENGTH) return inputError("too-long");
  const loaded = parseVerificationInput(text);
  if (!loaded) return inputError("unparseable");
  if (loaded.kind === "legacy") return inputError("legacy");
  return { ok: true, record: loaded.record };
}

/**
 * Verify a record against a file's SHA-256 (64 hex characters) and a key set
 * the caller already holds. The same function the app's verify page and
 * `POST /api/verify` use, so results never disagree. Checks run in a fixed
 * order (unknown-key, bad-signature, bad-user-signature, hash-mismatch), so
 * `hash-mismatch` always means "genuine record, different file".
 */
export function verifyRecordAgainstHash(
  record: SignatureRecord,
  fileHashHex: string,
  keys: PublicKeysJson
): VerificationResult {
  return verifyRecord(record, fileHashHex, keys);
}

export interface VerifyFileOptions {
  /** A key set the caller already fetched and trusts. When given, nothing is fetched. */
  keys?: PublicKeysJson;
  /**
   * Service origin, e.g. `https://www.contentproof.app`. The key document is
   * fetched from `${baseUrl}/.well-known/public-keys.json`. Required when
   * `keys` is not given, except in a browser on the service's own origin,
   * where an empty base resolves against the page.
   */
  baseUrl?: string;
  /** Fetch implementation, for tests or runtimes without a global fetch. */
  fetch?: typeof fetch;
}

export interface VerifyFileResult extends VerificationResult {
  /** The parsed record, or null when the input could not be parsed. */
  record: SignatureRecord | null;
  /** SHA-256 of the file as lowercase hex, or null when the input was rejected before hashing. */
  fileHash: string | null;
  /** Set when the input was not a usable record; `reason` is then "malformed". */
  inputError?: RecordInputError;
}

/**
 * Fetch and validate the published key set. Throws when it cannot be loaded,
 * so an outage is never mistaken for an unknown key.
 */
export async function fetchPublicKeys(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<PublicKeysJson> {
  const url = `${baseUrl.replace(/\/+$/, "")}${PUBLIC_KEYS_PATH}`;
  let response: Response;
  try {
    // No RequestInit: some edge runtimes reject `cache`, and the service sends no-cache headers itself.
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`Could not fetch the published keys from ${url}: ${(error as Error)?.message ?? String(error)}`);
  }
  if (!response.ok) throw new Error(`Could not fetch the published keys from ${url}: HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The document at ${url} is not JSON`);
  }
  const keys = parsePublicKeysJson(body);
  if (!keys) throw new Error(`The document at ${url} is not a valid ContentProof key set`);
  return keys;
}

/**
 * Verify a file against a record or verification link, end to end: parse the
 * input, hash the file (streamed, so large files are not buffered whole), load
 * the published keys unless `options.keys` is given, and verify. A record
 * object is validated as strictly as a parsed one, so an untyped object (say,
 * from `JSON.parse`) gets `malformed` rather than a loose check or a throw.
 * The keys are loaded before the file is hashed, so a key failure surfaces
 * without first reading a possibly large file.
 */
export async function verifyFile(
  input: string | SignatureRecord,
  file: Blob,
  options: VerifyFileOptions = {}
): Promise<VerifyFileResult> {
  let record: SignatureRecord;
  if (typeof input === "string") {
    const parsed = parseRecordInput(input);
    if (!parsed.ok) return { ok: false, reason: "malformed", record: null, fileHash: null, inputError: parsed.error };
    record = parsed.record;
  } else {
    const parsed = parseRecordObject(input);
    if (!parsed) return { ok: false, reason: "malformed", record: null, fileHash: null, inputError: "unparseable" };
    record = parsed;
  }

  // A relative key URL only resolves where there is a page origin (a window or worker on the service's site).
  if (!options.keys && options.baseUrl === undefined && typeof globalThis.location === "undefined") {
    throw new Error("verifyFile needs options.keys or options.baseUrl when there is no page origin");
  }
  const keys = options.keys ?? (await fetchPublicKeys(options.baseUrl ?? "", options.fetch ?? fetch));
  const fileHash = await hashBlobStreaming(file);
  return { ...verifyRecord(record, fileHash, keys), record, fileHash };
}
