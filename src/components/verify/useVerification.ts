"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { track } from "@/lib/analytics";
import { verifyLegacyPayload, verifyRecord } from "@/lib/crypto/verify";
import { isAbortError, sha256Hash } from "@/lib/hash";
import { loadPublicKeys } from "@/lib/keyset-client";
import { decodeQrFile } from "@/lib/qr-decode";
import { extractPayloadFromUrl } from "@/lib/record";
import { fetchUserKeyStatus } from "@/lib/user-key-status";
import { parseVerificationInput } from "@/lib/verify-input";
import { checkLogInclusion } from "./log-status";
import {
  canVerify,
  endsRun,
  initialVerifyState,
  verifyReducer,
  type VerifyAction,
  type VerifyState,
} from "./verify-reducer";

export interface UseVerificationOptions {
  /** The legacy `?data=` query value, if the page was opened with one. */
  legacyQuery: string;
  /** The signed-in address, offered as the signer of a legacy record. */
  sessionEmail: string | null;
}

export interface Verification {
  state: VerifyState;
  canVerify: boolean;
  setManualInput: (text: string) => void;
  loadManual: () => void;
  clearLoaded: () => void;
  loadQrImage: (image: File) => Promise<void>;
  chooseFile: (file: File | null) => void;
  clearFile: () => void;
  setLegacyEmail: (email: string) => void;
  verify: () => Promise<void>;
  cancel: () => void;
}

/**
 * Everything the verify page does, minus the markup: loading the published
 * keys, reading a record from the URL, a paste or a QR image, hashing the
 * chosen file, checking the signatures and then the transparency log.
 */
export function useVerification({ legacyQuery, sessionEmail }: UseVerificationOptions): Verification {
  const [state, dispatch] = useReducer(verifyReducer, initialVerifyState);
  const runCounter = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  // Bumped whenever the loaded record changes, so a slow QR decode cannot
  // replace a record pasted or linked while it was running.
  const recordGeneration = useRef(0);

  // Abort synchronously, before the reducer drops the run, so a stale hash
  // stops reading at once and never reaches the analytics calls below.
  const send = useCallback((action: VerifyAction): void => {
    if (endsRun(action)) {
      inFlight.current?.abort();
      inFlight.current = null;
    }
    if (action.type === "recordLoaded" || action.type === "recordCleared" || action.type === "linkRejected") {
      recordGeneration.current += 1;
    }
    dispatch(action);
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  // The record rides in the URL fragment, which Next's search params cannot see.
  // Listen for hash changes too, so following a second link in the same tab loads it.
  useEffect(() => {
    const apply = (): void => {
      const fromFragment = extractPayloadFromUrl(window.location.hash);
      const source = fromFragment ?? (legacyQuery ? `?data=${legacyQuery}` : "");
      if (!source) return;
      const parsed = parseVerificationInput(source);
      send(parsed ? { type: "recordLoaded", loaded: parsed } : { type: "linkRejected", message: "The verification link is not valid." });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [legacyQuery, send]);

  // Fetch the published keys once; fall back to the cached copy when offline.
  useEffect(() => {
    let cancelled = false;
    loadPublicKeys()
      .then((keys) => {
        if (!cancelled) dispatch({ type: "keysLoaded", keys });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          dispatch({ type: "keysFailed", message: err instanceof Error ? err.message : "Keys unavailable" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessionEmail) dispatch({ type: "legacyEmailDefaulted", email: sessionEmail });
  }, [sessionEmail]);

  const setManualInput = useCallback((text: string) => dispatch({ type: "manualInputChanged", text }), []);
  const setLegacyEmail = useCallback((email: string) => dispatch({ type: "legacyEmailChanged", email }), []);

  const loadManual = useCallback(() => {
    const parsed = parseVerificationInput(state.manualInput);
    send(
      parsed
        ? { type: "recordLoaded", loaded: parsed }
        : { type: "inputRejected", message: "That is not a ContentProof record or verification link." },
    );
  }, [state.manualInput, send]);

  const clearLoaded = useCallback(() => send({ type: "recordCleared" }), [send]);

  const loadQrImage = useCallback(
    async (image: File): Promise<void> => {
      const generation = recordGeneration.current;
      dispatch({ type: "qrDecodeStarted" });
      try {
        const text = await decodeQrFile(image);
        if (recordGeneration.current !== generation) return;
        const parsed = text ? parseVerificationInput(text) : null;
        if (parsed) {
          send({ type: "recordLoaded", loaded: parsed });
        } else {
          dispatch({
            type: "inputRejected",
            message: text ? "That QR code is not a ContentProof record." : "No QR code was found in that image.",
          });
        }
      } catch {
        dispatch({ type: "inputRejected", message: "Could not read that image." });
      } finally {
        dispatch({ type: "qrDecodeFinished" });
      }
    },
    [send],
  );

  const chooseFile = useCallback((file: File | null) => send({ type: "fileChosen", file }), [send]);
  const clearFile = useCallback(() => send({ type: "fileCleared" }), [send]);
  const cancel = useCallback(() => send({ type: "cancelled" }), [send]);

  const { loaded, file, keys, legacyEmail } = state;
  const verify = useCallback(async (): Promise<void> => {
    if (!loaded || !file || !keys) return;
    if (loaded.kind === "legacy" && !legacyEmail.trim()) {
      send({ type: "legacyEmailMissing" });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    runCounter.current += 1;
    const run = runCounter.current;
    dispatch({ type: "verifyStarted", run, total: file.size });
    track("verify_started", { record_kind: loaded.kind });
    try {
      const fileHash = await sha256Hash(file, {
        signal: controller.signal,
        onProgress: (done, total) => dispatch({ type: "hashProgress", run, done, total }),
      });
      // Anything that ended this run aborted its controller first.
      if (controller.signal.aborted) return;
      const email = loaded.kind === "record" ? loaded.record.e : legacyEmail.trim();
      const outcome =
        loaded.kind === "record"
          ? verifyRecord(loaded.record, fileHash, keys.keys)
          : verifyLegacyPayload(loaded.payload, email, fileHash, keys.keys);
      track("verify_signature", {
        result: outcome.ok ? "success" : "failure",
        record_kind: loaded.kind,
        ...(outcome.ok ? {} : { failure_reason: outcome.reason ?? "unknown" }),
      });
      const checkLog = outcome.ok && loaded.kind === "record";
      const attestedMs = loaded.kind === "record" ? loaded.record.t : loaded.payload.timestamp;
      dispatch({ type: "verified", run, result: outcome, subject: { email, attestedMs }, checkLog });
      if (checkLog) {
        void checkLogInclusion(loaded.record, keys.keys).then((status) =>
          dispatch({ type: "logChecked", run, status }),
        );
      }
      // A revoked key does not undo a valid signature, but a verifier should
      // know the account holder has disowned it. The run guard drops a late
      // answer for a check that has since been replaced.
      if (outcome.ok && outcome.userSigned && outcome.userKey) {
        void fetchUserKeyStatus(outcome.userKey).then((status) =>
          dispatch({ type: "userKeyChecked", run, status }),
        );
      }
    } catch (err) {
      // Cancelling is not a failure: the cancel action already returned to idle.
      if (isAbortError(err)) return;
      console.error(err);
      dispatch({ type: "verifyFailed", run });
    }
  }, [loaded, file, keys, legacyEmail, send]);

  return {
    state,
    canVerify: canVerify(state),
    setManualInput,
    loadManual,
    clearLoaded,
    loadQrImage,
    chooseFile,
    clearFile,
    setLegacyEmail,
    verify,
    cancel,
  };
}
