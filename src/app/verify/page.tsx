"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { MAX_FILE_SIZE_BYTES, sha256Hash } from "@/lib/hash";
import {
  verifyLegacyPayload,
  verifyRecord,
  type VerificationFailure,
  type VerificationResult,
} from "@/lib/crypto/verify";
import { loadPublicKeys, type PublicKeysLoad } from "@/lib/keyset-client";
import { verifyInclusionProof, type InclusionProofResponse } from "@/lib/log-verify";
import { formatLocalTime, toIsoUtc } from "@/lib/format-time";
import { decodeQrFile } from "@/lib/qr-decode";
import { extractPayloadFromUrl, type SignatureRecord } from "@/lib/record";
import { parseVerificationInput, type LoadedInput as Loaded } from "@/lib/verify-input";
import { trackVerifySignature } from "@/lib/analytics";
import { Button, FileField, Panel, TextArea, TextField, VerifyResult } from "@/components/ui";

const parseInput = parseVerificationInput;

type LogStatus =
  | { kind: "checking" }
  | { kind: "included"; index: number; size: number }
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/**
 * Ask the service for an inclusion proof and check it locally, including the
 * signed tree head it carries. A record can be perfectly valid and still absent
 * from the log (storage not configured), which is reported as such rather than
 * as failure.
 */
async function checkLogInclusion(record: SignatureRecord, keys: PublicKeysLoad["keys"]): Promise<LogStatus> {
  try {
    const res = await fetch(`/api/log/proof?signature=${encodeURIComponent(record.s)}`, { cache: "no-store" });
    if (res.status === 404) return { kind: "absent" };
    if (!res.ok) return { kind: "unavailable" };
    const proof = (await res.json()) as InclusionProofResponse;
    return verifyInclusionProof(record, proof, keys)
      ? { kind: "included", index: proof.index, size: proof.size }
      : { kind: "invalid" };
  } catch {
    return { kind: "unavailable" };
  }
}

const MAX_FILE_SIZE_LABEL = `${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB`;

const HIDDEN_CHARS =/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/**
 * An email as it should be read, not as it was typed: bidi overrides and
 * zero-width characters can make `moc.live@x` look like a trusted address.
 * They are stripped for display only; verification signs the raw bytes.
 */
function DisplayEmail({ email }: { email: string }): React.JSX.Element {
  const clean = email.replace(HIDDEN_CHARS, "");
  return (
    <span className="break-words font-medium">
      {clean}
      {clean !== email && <span className="text-void"> (hidden characters removed)</span>}
    </span>
  );
}

/** A record time in the viewer's zone, with the ISO value in `dateTime`. */
function TimeText({ ms }: { ms: number }): React.JSX.Element {
  const iso = toIsoUtc(ms);
  if (!iso) return <span>unknown time</span>;
  return <time dateTime={iso}>{formatLocalTime(ms)}</time>;
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
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  // Kept apart from inputError so a later valid selection clears it without
  // hiding a problem with the record.
  const [fileError, setFileError] = useState<string | null>(null);

  // Bumped whenever the file or record changes or a check starts, so a slower
  // earlier check cannot overwrite the current state.
  const runId = useRef(0);

  // The record rides in the URL fragment, which Next's search params cannot see.
  // Listen for hash changes too, so following a second link in the same tab loads it.
  useEffect(() => {
    const apply = (): void => {
      const fromFragment = extractPayloadFromUrl(window.location.hash);
      const source = fromFragment ?? (legacyQuery ? `?data=${legacyQuery}` : "");
      if (!source) return;
      runId.current += 1;
      setResult(null);
      setStatus("idle");
      setLogStatus(null);
      setVerifiedEmail(null);
      const parsed = parseInput(source);
      if (parsed) {
        setInputError(null);
        setLoaded(parsed);
      } else {
        setLoaded(null);
        setInputError("The verification link is not valid.");
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
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
    runId.current += 1;
    setInputError(null);
    setResult(null);
    setStatus("idle");
    setLogStatus(null);
    setLoaded(parsed);
  }, [manualInput]);

  const clearLoaded = useCallback(() => {
    runId.current += 1;
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
      runId.current += 1;
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
    runId.current += 1;
    const chosen = e.target.files?.[0] ?? null;
    setResult(null);
    setStatus("idle");
    setLogStatus(null);
    if (chosen && chosen.size > MAX_FILE_SIZE_BYTES) {
      setFile(null);
      setFileInputKey((k) => k + 1);
      setFileError(`Files larger than ${MAX_FILE_SIZE_LABEL} are not supported.`);
      return;
    }
    setFileError(null);
    setFile(chosen);
  };

  // Remounting the input is the only reliable way to clear a native file field.
  const clearFile = useCallback(() => {
    runId.current += 1;
    setFile(null);
    setFileError(null);
    setFileInputKey((k) => k + 1);
    setResult(null);
    setStatus("idle");
    setLogStatus(null);
  }, []);

  const verify = useCallback(async () => {
    if (!loaded || !file || !keys) return;
    runId.current += 1;
    const myRun = runId.current;
    if (loaded.kind === "legacy" && !legacyEmail.trim()) {
      setResult(null);
      setStatus("idle");
      setLogStatus(null);
      setInputError("Older records do not carry the signer's address; enter the email used when signing.");
      return;
    }
    setInputError(null);
    setStatus("verifying");
    try {
      const fileHash = await sha256Hash(file);
      if (runId.current !== myRun) return;
      const email = loaded.kind === "record" ? loaded.record.e : legacyEmail.trim();
      const outcome =
        loaded.kind === "record"
          ? verifyRecord(loaded.record, fileHash, keys.keys)
          : verifyLegacyPayload(loaded.payload, email, fileHash, keys.keys);
      trackVerifySignature(outcome.ok ? "success" : "failure");
      setVerifiedEmail(email);
      setResult(outcome);
      if (outcome.ok && loaded.kind === "record") {
        setLogStatus({ kind: "checking" });
        void checkLogInclusion(loaded.record, keys.keys).then((next) => {
          if (runId.current === myRun) setLogStatus(next);
        });
      } else {
        setLogStatus(null);
      }
    } catch (err) {
      console.error(err);
      if (runId.current === myRun) setResult({ ok: false, reason: "malformed" });
    } finally {
      if (runId.current === myRun) setStatus("done");
    }
  }, [loaded, file, keys, legacyEmail]);

  const canVerify = Boolean(loaded && file && keys) && status !== "verifying";
  const attestedFor = verifiedEmail ?? "";
  const attestedMs = loaded?.kind === "record" ? loaded.record.t : (loaded?.payload.timestamp ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-6 px-4 py-10 md:py-16">
      <h1>Verify</h1>

      {(inputError || keysError || fileError) && (
        <Panel>
          <p className="font-medium text-void" role="alert">
            {inputError ?? keysError ?? fileError}
          </p>
        </Panel>
      )}

      <Panel className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h2 className="eyebrow">Load the record</h2>

          {!loaded ? (
            <div className="flex flex-col gap-4">
              <TextArea
                id="recordInput"
                label="Paste a verification link or record"
                className="min-h-[100px] resize-y break-all"
                placeholder="https://…/verify#P=2~…  or  2~…"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
              />
              <div>
                <Button onClick={loadManual} disabled={!manualInput.trim()}>
                  Load record
                </Button>
              </div>
              <FileField
                id="qrImageInput"
                label="Or upload a picture of the QR code"
                accept="image/*"
                disabled={decodingQr}
                onChange={onQrImageChange}
                hint={decodingQr ? "Reading QR code…" : undefined}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Neutral until verified: nothing in a record is trustworthy before the check. */}
              <VerifyResult tone="pending" title="Record loaded, not yet verified">
                {loaded.kind === "record" ? (
                  <div className="flex flex-col gap-1">
                    <p>
                      <span className="text-mute">Claims to be for:</span>{" "}
                      <DisplayEmail email={loaded.record.e} />
                    </p>
                    <p>
                      <span className="text-mute">At:</span>{" "}
                      <span className="font-medium">
                        <TimeText ms={loaded.record.t} />
                      </span>
                    </p>
                    <p>
                      <span className="text-mute">Service key id:</span>{" "}
                      <code className="break-all font-mono text-[13px]">{loaded.record.k}</code>
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p>
                      <span className="text-mute">Legacy record from:</span>{" "}
                      <span className="font-medium">
                        <TimeText ms={loaded.payload.timestamp} />
                      </span>
                    </p>
                    <p className="text-sm text-mute">
                      Older records do not include the signer&apos;s address, so you will need to enter it.
                    </p>
                  </div>
                )}
              </VerifyResult>
              <div>
                <Button variant="secondary" onClick={clearLoaded}>
                  Load a different record
                </Button>
              </div>
            </div>
          )}
        </section>

        <div className="h-px bg-relief" aria-hidden="true"></div>

        <section className="flex flex-col gap-4">
          <h2 className="eyebrow">Check the file</h2>

          <FileField key={fileInputKey} id="fileInput" label="Select the file to check" onChange={onFileChange} />
          {file && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-mute">
              <span className="break-all">{file.name}</span>
              <Button variant="secondary" onClick={clearFile}>
                Remove file
              </Button>
            </div>
          )}

          {loaded?.kind === "legacy" && (
            <TextField
              id="emailInput"
              type="email"
              label="Signer's Google account email"
              placeholder="Email used when the file was signed"
              value={legacyEmail}
              onChange={(e) => setLegacyEmail(e.target.value)}
            />
          )}

          <div>
            <Button disabled={!canVerify} onClick={verify}>
              {status === "verifying" ? "Verifying…" : "Verify"}
            </Button>
          </div>

          <p className="text-sm text-mute">
            {keys
              ? keys.source === "network"
                ? "Using ContentProof's currently published keys."
                : "Offline: using the last published keys this browser saw."
              : keysError
                ? "Published keys could not be loaded."
                : "Loading published keys…"}
          </p>
        </section>

        {status === "done" && result && (
          <>
            <div className="h-px bg-relief" aria-hidden="true"></div>
            <section aria-live="polite">
              {result.ok ? (
                <VerifyResult tone="sealed" title="Attestation verified">
                  <div className="flex flex-col gap-2">
                    <p>
                      ContentProof attests that <DisplayEmail email={attestedFor} />{" "}
                      submitted this exact file on <TimeText ms={attestedMs} />.
                    </p>
                    {result.userSigned ? (
                      <p className="text-sm text-mute" data-testid="user-signature">
                        Also signed by the account holder&apos;s own key{" "}
                        <code className="break-all font-mono text-[13px]">{result.userKey}</code>, which the
                        service never holds. Service countersignature by published key{" "}
                        <code className="break-all font-mono text-[13px]">{result.keyId}</code>.
                      </p>
                    ) : (
                      <p className="text-sm text-mute" data-testid="user-signature">
                        Signed with published key{" "}
                        <code className="break-all font-mono text-[13px]">{result.keyId}</code>. This is an
                        attestation by the service only; the record carries no signature from a key the
                        account holder controls.
                      </p>
                    )}
                    {logStatus && (
                      <p className="text-sm text-mute" data-testid="log-status">
                        {logStatus.kind === "checking" && "Checking the transparency log…"}
                        {logStatus.kind === "included" &&
                          `Included in the transparency log as entry ${logStatus.index + 1} of ${logStatus.size}; inclusion proof and signed tree head verified.`}
                        {logStatus.kind === "absent" &&
                          "Not present in the transparency log (the service may not have storage configured)."}
                        {logStatus.kind === "invalid" &&
                          "The transparency log proof did not verify. The record is valid, but the log should be treated with suspicion."}
                        {logStatus.kind === "unavailable" && "Transparency log could not be reached."}
                      </p>
                    )}
                  </div>
                </VerifyResult>
              ) : (
                <VerifyResult tone="void" title="Not verified">
                  <p>{FAILURE_MESSAGES[result.reason ?? "malformed"]}</p>
                </VerifyResult>
              )}
            </section>
          </>
        )}
      </Panel>

      <p className="text-sm text-mute">
        The file and the record stay in your browser. The page fetches
        ContentProof&apos;s published keys and, after a successful check, asks
        the transparency log for an inclusion proof, which sends the record&apos;s
        signature. Usage analytics go to Google Analytics.
      </p>

      <div>
        <Button variant="secondary" href="/">
          Back to home
        </Button>
      </div>
    </div>
  );
}

export default function VerifyPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[42rem] px-4 py-10 md:py-16">
          <Panel>
            <p className="eyebrow">Loading verification…</p>
          </Panel>
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
