"use client";

import type { ChangeEventHandler, ReactElement } from "react";
import type { PublicKeysLoad } from "@/lib/keyset-client";
import { Button, FileField, TextField } from "@/components/ui";
import type { VerifyPhase } from "./verify-reducer";

export interface FileCheckerProps {
  file: File | null;
  fileInputKey: number;
  /** Shown only for a legacy record, which does not carry the signer's address. */
  needsEmail: boolean;
  legacyEmail: string;
  phase: VerifyPhase;
  canVerify: boolean;
  keys: PublicKeysLoad | null;
  keysError: string | null;
  onFileChange: (file: File | null) => void;
  onClearFile: () => void;
  onLegacyEmailChange: (email: string) => void;
  onVerify: () => void;
  onCancel: () => void;
}

function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
}

function keysStatusText(keys: PublicKeysLoad | null, keysError: string | null): string {
  if (keys) {
    return keys.source === "network"
      ? "Using ContentProof's currently published keys."
      : "Offline: using the last published keys this browser saw.";
  }
  return keysError ? "Published keys could not be loaded." : "Loading published keys…";
}

/** Second step of the page: choose the file, then hash and check it. */
export function FileChecker({
  file,
  fileInputKey,
  needsEmail,
  legacyEmail,
  phase,
  canVerify,
  keys,
  keysError,
  onFileChange,
  onClearFile,
  onLegacyEmailChange,
  onVerify,
  onCancel,
}: FileCheckerProps): ReactElement {
  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => onFileChange(e.target.files?.[0] ?? null);
  const hashing = phase.kind === "hashing" ? phase : null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="eyebrow">Check the file</h2>

      {/* Remounting via the key is the only reliable way to clear a native file field. */}
      <FileField key={fileInputKey} id="fileInput" label="Select the file to check" onChange={onChange} />
      {file && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-mute">
          <span className="break-all">{file.name}</span>
          <Button variant="secondary" onClick={onClearFile}>
            Remove file
          </Button>
        </div>
      )}

      {needsEmail && (
        <TextField
          id="emailInput"
          type="email"
          label="Signer's Google account email"
          placeholder="Email used when the file was signed"
          value={legacyEmail}
          onChange={(e) => onLegacyEmailChange(e.target.value)}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!canVerify} onClick={onVerify}>
          {hashing ? "Verifying…" : "Verify"}
        </Button>
        {hashing && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {hashing && (
        <div role="status" className="flex flex-col gap-1 text-sm text-mute" data-testid="hash-progress">
          <progress
            className="h-2 w-full accent-accent"
            max={100}
            value={percent(hashing.done, hashing.total)}
            aria-label="Reading the file"
          />
          <span>Reading the file: {percent(hashing.done, hashing.total)}%</span>
        </div>
      )}

      <p className="text-sm text-mute">{keysStatusText(keys, keysError)}</p>
    </section>
  );
}
