"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { Button, FileField, Panel, TextArea, TextField, VerifyResult } from "@/components/ui";

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
  const attestedFor = loaded?.kind === "record" ? loaded.record.e : legacyEmail.trim();
  const attestedAt = new Date(
    loaded?.kind === "record" ? loaded.record.t : loaded?.payload.timestamp ?? 0
  ).toLocaleString();

  return (
    <main className="mx-auto flex w-full max-w-[42rem] flex-col gap-6 px-4 py-10 md:py-16">
      <h1>Verify</h1>

      {(inputError || keysError) && (
        <Panel>
          <p className="font-medium text-void" role="alert">
            {inputError ?? keysError}
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
                      <span className="break-words font-medium">{loaded.record.e}</span>
                    </p>
                    <p>
                      <span className="text-mute">At:</span>{" "}
                      <span className="font-medium">{new Date(loaded.record.t).toLocaleString()}</span>
                    </p>
                    <p>
                      <span className="text-mute">Key:</span>{" "}
                      <code className="break-all font-mono text-[13px]">{loaded.record.k}</code>
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p>
                      <span className="text-mute">Legacy record from:</span>{" "}
                      <span className="font-medium">{new Date(loaded.payload.timestamp).toLocaleString()}</span>
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

          <FileField id="fileInput" label="Select the file to check" onChange={onFileChange} />

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
            <section>
              {result.ok ? (
                <VerifyResult tone="sealed" title="Attestation verified">
                  <div className="flex flex-col gap-2">
                    <p>
                      ContentProof attests that <span className="break-words font-medium">{attestedFor}</span>{" "}
                      submitted this exact file on {attestedAt}.
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
                          `Included in the transparency log as entry ${logStatus.index} of ${logStatus.size}; inclusion proof and signed tree head verified.`}
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
        The file and the record stay in your browser. The only request made is for
        ContentProof&apos;s published keys.
      </p>

      <div>
        <Button variant="secondary" href="/">
          Back to home
        </Button>
      </div>
    </main>
  );
}

export default function VerifyPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[42rem] px-4 py-10 md:py-16">
          <Panel>
            <p className="eyebrow">Loading verification…</p>
          </Panel>
        </main>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
