"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { track, type SignFailureType } from "@/lib/analytics";
import { isAbortError, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_LABEL, sha256Hash } from "@/lib/hash";
import { buildSignedMessage } from "@/lib/record";
import { getOrCreateUserKey, replaceRevokedUserKey, type UserSigningKey } from "@/lib/user-keys";
import type { FileSource } from "./DropZone";
import { interpretSignResponse, type SignResponseOutcome } from "./sign-response";
import {
  batchCapNote,
  initialUploadState,
  MAX_BATCH_FILES,
  uploadReducer,
  type UploadState,
} from "./upload-reducer";

export interface BatchSigner {
  state: UploadState;
  /** The files of the current batch, by entry id. */
  files: readonly File[];
  /** This browser's key, "unsupported", or null while it is being prepared. */
  userKey: UserSigningKey | "unsupported" | null;
  signFiles: (files: FileList | null, source: FileSource) => Promise<void>;
  cancel: () => void;
  select: (id: number) => void;
}

// Any file type is fine: only its hash leaves the browser. The size cap is a
// sanity bound, not a memory limit, because hashing is streamed.
function validateFile(file: File): { message: string; errorType: SignFailureType } | null {
  if (file.size === 0) return { message: "The selected file is empty.", errorType: "empty_file" };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      message: `Files larger than ${MAX_FILE_SIZE_LABEL} are not supported.`,
      errorType: "file_too_large",
    };
  }
  return null;
}

/**
 * Hashes and signs a batch of files one at a time, so a batch never outruns
 * the signing rate limit, and keeps the per-file state in a reducer.
 *
 * `email` is the signed-in account from the server session, so a file dropped
 * before the client session has loaded is still signed with the account
 * holder's key (version 3), never silently downgraded to a service-only record.
 */
export function useBatchSigner(email: string): BatchSigner {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [userKey, setUserKey] = useState<UserSigningKey | "unsupported" | null>(null);
  const runCounter = useRef(0);
  // The batch in flight, so Cancel (and unmounting) can stop reading the file
  // and drop its signing request.
  const inFlight = useRef<AbortController | null>(null);

  // This browser's own signing key (created on first use, never leaves the device).
  // The promise is kept so a file dropped before the key resolves still waits
  // for it instead of silently producing a service-only record.
  const keyPromise = useRef<Promise<UserSigningKey | "unsupported"> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const promise = getOrCreateUserKey().catch((): "unsupported" => "unsupported");
    keyPromise.current = promise;
    void promise.then((key) => {
      if (!cancelled) setUserKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  const cancel = useCallback((): void => {
    inFlight.current?.abort();
    inFlight.current = null;
    // Cancelling is the person's choice, not a failure: no error, nothing tracked.
    dispatch({ type: "cancelled" });
  }, []);

  const select = useCallback((id: number): void => dispatch({ type: "entrySelected", id }), []);

  const signFiles = useCallback(
    async (list: FileList | null, source: FileSource): Promise<void> => {
      // Copy before anything else: the picker clears its FileList right after this call.
      const chosen = list ? Array.from(list) : [];
      if (chosen.length === 0) return;
      const batch = chosen.slice(0, MAX_BATCH_FILES);

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const { signal } = controller;
      runCounter.current += 1;
      const run = runCounter.current;

      setFiles(batch);
      dispatch({
        type: "batchStarted",
        run,
        files: batch.map((file) => ({ name: file.name, size: file.size, isImage: file.type.startsWith("image/") })),
        note: batchCapNote(chosen.length),
      });
      for (const file of batch) track("file_selected", { source, is_image: file.type.startsWith("image/") });

      try {
        for (const [id, file] of batch.entries()) {
          if (signal.aborted) return;
          const isImage = file.type.startsWith("image/");
          const invalid = validateFile(file);
          if (invalid) {
            dispatch({ type: "fileFailed", run, id, message: invalid.message });
            track("sign_file_failed", { error_type: invalid.errorType });
            continue;
          }

          try {
            dispatch({ type: "hashStarted", run, id, total: file.size });
            const hash = await sha256Hash(file, {
              signal,
              onProgress: (done, total) => dispatch({ type: "hashProgress", run, id, done, total }),
            });
            if (signal.aborted) return;
            dispatch({ type: "hashed", run, id, hash });

            // Sign with this browser's key first so the service can countersign a
            // statement the account holder actually made. Falls back to a
            // service-only record when the browser cannot hold a key. Each file
            // gets its own timestamp, taken just before its request.
            const attempt = async (key: UserSigningKey | "unsupported"): Promise<SignResponseOutcome | null> => {
              let payload: Record<string, unknown> = { fileHash: hash };
              if (key !== "unsupported") {
                const timestamp = Date.now();
                const userSignature = await key.sign(buildSignedMessage(hash, email, timestamp));
                payload = { fileHash: hash, timestamp, userPublicKey: key.publicKey, userSignature };
              }
              if (signal.aborted) return null;
              const res = await fetch("/api/sign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal,
              });
              // A non-JSON error page still has a status worth reporting.
              const body: unknown = await res.json().catch(() => null);
              if (signal.aborted) return null;
              return interpretSignResponse(res.status, body);
            };

            let key = (await keyPromise.current) ?? "unsupported";
            let outcome = await attempt(key);
            if (!outcome) return;
            if (!outcome.ok && outcome.revoked && key !== "unsupported") {
              // The account holder revoked this browser's key. Replace it once
              // and try this file once more; later files then use the new key.
              // If no key can be had, the revoked message is shown as before.
              const fresh = await replaceRevokedUserKey(key.publicKey).then(
                (replacement) => replacement.key,
                () => null,
              );
              if (signal.aborted) return;
              if (fresh) {
                key = fresh;
                keyPromise.current = Promise.resolve(fresh);
                setUserKey(fresh);
                outcome = await attempt(fresh);
                if (!outcome) return;
              }
            }
            if (!outcome.ok) {
              track("sign_file_failed", { error_type: outcome.errorType });
              if (outcome.stopsBatch) {
                // Signed out or rate limited: every later file would fail the same way.
                dispatch({ type: "batchStopped", run, id, message: outcome.message, needsSignIn: outcome.needsSignIn });
                return;
              }
              dispatch({ type: "fileFailed", run, id, message: outcome.message });
              continue;
            }
            dispatch({ type: "signed", run, id, record: outcome.record, logged: outcome.logged });
            track("sign_file", { key_type: key === "unsupported" ? "service_only" : "user_key", is_image: isImage });
          } catch (err) {
            // Cancel already settled the batch; an abort is not a failure to report.
            if (isAbortError(err) || signal.aborted) return;
            console.error("File signing failed:", err);
            track("sign_file_failed", { error_type: "unknown" });
            dispatch({
              type: "fileFailed",
              run,
              id,
              message: err instanceof Error ? err.message : "Failed to generate signature.",
            });
          }
        }
        dispatch({ type: "batchFinished", run });
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [email],
  );

  return { state, files, userKey, signFiles, cancel, select };
}
