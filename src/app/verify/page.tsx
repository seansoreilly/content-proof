"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { sha256Hash } from "@/lib/hash";
import {
  verifyLegacyPayload,
  verifyRecord,
  type VerificationFailure,
  type VerificationResult,
} from "@/lib/crypto/verify";
import { loadPublicKeys, type PublicKeysLoad } from "@/lib/keyset-client";
import { verifyLogHead, verifyRecordInclusion, type InclusionProofResponse, type SignedLogHead } from "@/lib/log-verify";
import { decodeQrFile } from "@/lib/qr-decode";
import { extractPayloadFromUrl, type SignatureRecord } from "@/lib/record";
import { parseVerificationInput, type LoadedInput as Loaded } from "@/lib/verify-input";
import { trackVerifySignature } from "@/lib/analytics";

const parseInput = parseVerificationInput;

type LogStatus =
  | { kind: "checking" }
  | { kind: "included"; index: number; size: number }
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/**
 * Ask the service for an inclusion proof and a signed tree head, then check
 * both locally. A record can be perfectly valid and still absent from the log
 * (storage not configured), which is reported as such rather than as failure.
 */
async function checkLogInclusion(record: SignatureRecord, keys: PublicKeysLoad["keys"]): Promise<LogStatus> {
  try {
    const proofRes = await fetch(`/api/log/proof?signature=${encodeURIComponent(record.s)}`, { cache: "no-store" });
    if (proofRes.status === 404) return { kind: "absent" };
    if (!proofRes.ok) return { kind: "unavailable" };
    const proof = (await proofRes.json()) as InclusionProofResponse;
    if (!verifyRecordInclusion(record, proof)) return { kind: "invalid" };

    const headRes = await fetch("/api/log/head", { cache: "no-store" });
    if (!headRes.ok) return { kind: "unavailable" };
    const head = (await headRes.json()) as SignedLogHead;
    // The head may be newer than the proof's tree; only trust a head that is signed
    // by a published key. A root mismatch with a larger tree is normal growth.
    if (!verifyLogHead(head, keys)) return { kind: "invalid" };
    if (head.size === proof.size && head.root !== proof.root) return { kind: "invalid" };
    return { kind: "included", index: proof.index, size: proof.size };
  } catch {
    return { kind: "unavailable" };
  }
}

const FAILURE_MESSAGES: Record<VerificationFailure, string> = {
  "unknown-key":
    "This record was not signed with any key ContentProof has published. Treat it as a forgery.",
  "hash-mismatch":
    "The file you selected is not the file that was attested. It may have been modified, re-saved or converted.",
  "bad-signature":
    "The signature does not match the record. The record was altered after it was issued.",
  "bad-user-signature":
    "The service countersignature is valid but the account holder's own signature does not verify. Treat the record as invalid.",
  malformed: "The record is malformed and cannot be checked.",
};

function VerifyPageContent() {
  const searchParams = useSearchParams();
  const legacyQuery = searchParams.get("data") ?? "";
  const { data: session, status: authStatus } = useSession();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [legacyEmail, setLegacyEmail] = useState("");
  const [keys, setKeys] = useState<PublicKeysLoad | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "verifying" | "done">("idle");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [logStatus, setLogStatus] = useState<LogStatus | null>(null);
  const [decodingQr, setDecodingQr] = useState(false);

  // The record rides in the URL fragment, which Next's search params cannot see.
  useEffect(() => {
    const fromFragment = typeof window !== "undefined" ? extractPayloadFromUrl(window.location.hash) : null;
    const source = fromFragment ?? (legacyQuery ? `?data=${legacyQuery}` : "");
    if (!source) return;
    const parsed = parseInput(source);
    if (parsed) setLoaded(parsed);
    else setInputError("The verification link is not valid.");
  }, [legacyQuery]);

  // Fetch the published keys once; fall back to the cached copy when offline.
  useEffect(() => {
    let cancelled = false;
    loadPublicKeys()
      .then((load) => {
        if (!cancelled) setKeys(load);
      })
      .catch((err: unknown) => {
        if (!cancelled) setKeysError(err instanceof Error ? err.message : "Keys unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated" && session?.user?.email && !legacyEmail) {
      setLegacyEmail(session.user.email);
    }
  }, [authStatus, session, legacyEmail]);

  const loadManual = useCallback(() => {
    const parsed = parseInput(manualInput);
    if (!parsed) {
      setInputError("That is not a ContentProof record or verification link.");
      return;
    }
    setInputError(null);
    setResult(null);
    setStatus("idle");
    setLoaded(parsed);
  }, [manualInput]);

  const clearLoaded = useCallback(() => {
    setLoaded(null);
    setManualInput("");
    setResult(null);
    setStatus("idle");
    setInputError(null);
    setLogStatus(null);
  }, []);

  const onQrImageChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const image = e.target.files?.[0];
    e.target.value = "";
    if (!image) return;
    setDecodingQr(true);
    setInputError(null);
    try {
      const text = await decodeQrFile(image);
      const parsed = text ? parseInput(text) : null;
      if (!parsed) {
        setInputError(text ? "That QR code is not a ContentProof record." : "No QR code was found in that image.");
        return;
      }
      setResult(null);
      setStatus("idle");
      setLogStatus(null);
      setLoaded(parsed);
    } catch {
      setInputError("Could not read that image.");
    } finally {
      setDecodingQr(false);
    }
  };

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setStatus("idle");
  };

  const verify = useCallback(async () => {
    if (!loaded || !file || !keys) return;
    if (loaded.kind === "legacy" && !legacyEmail.trim()) {
      setInputError("Older records do not carry the signer's address; enter the email used when signing.");
      return;
    }
    setInputError(null);
    setStatus("verifying");
    try {
      const fileHash = await sha256Hash(file);
      const outcome =
        loaded.kind === "record"
          ? verifyRecord(loaded.record, fileHash, keys.keys)
          : verifyLegacyPayload(loaded.payload, legacyEmail.trim(), fileHash, keys.keys);
      trackVerifySignature(outcome.ok ? "success" : "failure");
      setResult(outcome);
      if (outcome.ok && loaded.kind === "record") {
        setLogStatus({ kind: "checking" });
        void checkLogInclusion(loaded.record, keys.keys).then(setLogStatus);
      } else {
        setLogStatus(null);
      }
    } catch (err) {
      console.error(err);
      setResult({ ok: false, reason: "malformed" });
    } finally {
      setStatus("done");
    }
  }, [loaded, file, keys, legacyEmail]);

  const canVerify = Boolean(loaded && file && keys) && status !== "verifying";

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden p-4">
      <div className="absolute top-6 left-6">
        <Link href="/" aria-label="Back to home" className="btn-secondary">
          ← Home
        </Link>
      </div>

      <h1 className="text-blue-600 text-3xl md:text-5xl font-extrabold mb-8 text-center">Verify</h1>

      {(inputError || keysError) && (
        <div className="glass p-4 border border-red-400/30 bg-red-50 max-w-md mb-6">
          <p className="text-red-400 font-medium text-center">{inputError ?? keysError}</p>
        </div>
      )}

      <div className="glass p-6 w-full max-w-md space-y-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-light-600">Step 1: Load the record</h2>

          {!loaded ? (
            <div className="space-y-3">
              <label htmlFor="recordInput" className="block text-sm font-medium text-light-600">
                Paste a verification link or record
              </label>
              <textarea
                id="recordInput"
                className="glass w-full px-3 py-2 text-light-600 min-h-[100px] resize-y"
                placeholder="https://…/verify#P=2~…  or  2~…"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
              />
              <button className="btn-primary w-full" onClick={loadManual} disabled={!manualInput.trim()}>
                Load record
              </button>
              <div className="space-y-2 pt-2">
                <label htmlFor="qrImageInput" className="block text-sm font-medium text-light-600">
                  Or upload a picture of the QR code
                </label>
                <input
                  id="qrImageInput"
                  type="file"
                  accept="image/*"
                  disabled={decodingQr}
                  onChange={onQrImageChange}
                  className="glass w-full px-3 py-2 text-light-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                />
                {decodingQr && <p className="text-xs text-light-500">Reading QR code…</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Neutral until verified: nothing in a record is trustworthy before the check. */}
              <div className="glass p-4 border border-white/20 bg-white/5 text-sm space-y-1">
                <p className="text-light-500 text-xs uppercase tracking-wide">Record loaded, not yet verified</p>
                {loaded.kind === "record" ? (
                  <>
                    <p className="text-light-600">
                      <span className="text-light-500">Claims to be for:</span>{" "}
                      <span className="font-medium break-all">{loaded.record.e}</span>
                    </p>
                    <p className="text-light-600">
                      <span className="text-light-500">At:</span>{" "}
                      <span className="font-medium">{new Date(loaded.record.t).toLocaleString()}</span>
                    </p>
                    <p className="text-light-600">
                      <span className="text-light-500">Key:</span> <code className="text-xs">{loaded.record.k}</code>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-light-600">
                      <span className="text-light-500">Legacy record from:</span>{" "}
                      <span className="font-medium">{new Date(loaded.payload.timestamp).toLocaleString()}</span>
                    </p>
                    <p className="text-light-500 text-xs">
                      Older records do not include the signer&apos;s address, so you will need to enter it.
                    </p>
                  </>
                )}
              </div>
              <button className="btn-secondary w-full text-sm" onClick={clearLoaded}>
                Load a different record
              </button>
            </div>
          )}
        </section>

        <div className="border-t border-light-300/20"></div>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-light-600">Step 2: Check the file</h2>

          <div className="space-y-3">
            <div className="space-y-2">
              <label htmlFor="fileInput" className="block text-sm font-medium text-light-600">
                Select the file to check
              </label>
              <input
                id="fileInput"
                type="file"
                onChange={onFileChange}
                className="glass w-full px-3 py-2 text-light-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700"
              />
            </div>

            {loaded?.kind === "legacy" && (
              <div className="space-y-2">
                <label htmlFor="emailInput" className="block text-sm font-medium text-light-600">
                  Signer&apos;s Google account email
                </label>
                <input
                  id="emailInput"
                  type="email"
                  className="glass w-full px-3 py-2 text-light-600"
                  placeholder="Email used when the file was signed"
                  value={legacyEmail}
                  onChange={(e) => setLegacyEmail(e.target.value)}
                />
              </div>
            )}

            <button className="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2" disabled={!canVerify} onClick={verify}>
              {status === "verifying" && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              )}
              {status === "verifying" ? "Checking…" : "Verify"}
            </button>

            <p className="text-xs text-light-400">
              {keys
                ? keys.source === "network"
                  ? "Using ContentProof's currently published keys."
                  : "Offline: using the last published keys this browser saw."
                : keysError
                  ? "Published keys could not be loaded."
                  : "Loading published keys…"}
            </p>
          </div>
        </section>

        {status === "done" && result && (
          <>
            <div className="border-t border-light-300/20"></div>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-light-600">Result</h2>
              {result.ok ? (
                <div className="glass p-4 border border-green-400/30 bg-green-400/10 space-y-1">
                  <p className="text-green-400 font-medium">Attestation verified</p>
                  <p className="text-light-600 text-sm">
                    ContentProof attests that{" "}
                    <span className="font-medium">
                      {loaded?.kind === "record" ? loaded.record.e : legacyEmail.trim()}
                    </span>{" "}
                    submitted this exact file on{" "}
                    {new Date(
                      loaded?.kind === "record" ? loaded.record.t : loaded?.payload.timestamp ?? 0
                    ).toLocaleString()}
                    .
                  </p>
                  {result.userSigned ? (
                    <p className="text-light-500 text-xs" data-testid="user-signature">
                      Also signed by the account holder&apos;s own key{" "}
                      <code className="break-all">{result.userKey}</code>, which the service never holds.
                      Service countersignature by published key <code>{result.keyId}</code>.
                    </p>
                  ) : (
                    <p className="text-light-500 text-xs" data-testid="user-signature">
                      Signed with published key <code>{result.keyId}</code>. This is an attestation by the
                      service only; the record carries no signature from a key the account holder controls.
                    </p>
                  )}
                  {logStatus && (
                    <p className="text-light-500 text-xs" data-testid="log-status">
                      {logStatus.kind === "checking" && "Checking the transparency log…"}
                      {logStatus.kind === "included" &&
                        `Included in the transparency log as entry ${logStatus.index} of ${logStatus.size}; inclusion proof and signed tree head verified.`}
                      {logStatus.kind === "absent" &&
                        "Not present in the transparency log (the service may not have storage configured)."}
                      {logStatus.kind === "invalid" &&
                        "The transparency log proof did not verify. The record is valid, but the log should be treated with suspicion."}
                      {logStatus.kind === "unavailable" && "Transparency log could not be reached."}
                    </p>
                  )}
                </div>
              ) : (
                <div className="glass p-4 border border-red-400/30 bg-red-400/10 space-y-1">
                  <p className="text-red-400 font-medium">Not verified</p>
                  <p className="text-light-600 text-sm">{FAILURE_MESSAGES[result.reason ?? "malformed"]}</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="mt-8 max-w-md text-center">
        <p className="text-sm text-light-500">
          🔒 The file and the record stay in your browser. The only request made is for
          ContentProof&apos;s published keys.
        </p>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="glass p-8 flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin"></div>
            <span className="text-light-600">Loading verification…</span>
          </div>
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
