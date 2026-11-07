"use client";

import React, { useEffect, useState } from "react";
import { Eyebrow } from "@/components/ui";
import { SignInButton } from "@/components/SignInButton";
import { BatchList } from "@/components/upload/BatchList";
import { DropZone } from "@/components/upload/DropZone";
import { HashProgress } from "@/components/upload/HashProgress";
import { SignedResult } from "@/components/upload/SignedResult";
import { currentEntry, selectedEntry } from "@/components/upload/upload-reducer";
import { useBatchSigner } from "@/components/upload/useBatchSigner";

interface FileUploadProps {
  /**
   * The signed-in account, from the server session. Passed in rather than read
   * from useSession() so a file dropped before the client session has loaded
   * is still signed with the account holder's key (version 3), never silently
   * downgraded to a service-only record.
   */
  email: string;
}

export default function FileUpload({ email }: FileUploadProps): React.JSX.Element {
  const { state, files, userKey, signFiles, cancel, select } = useBatchSigner(email);
  const { entries, running, note, stopError, needsSignIn } = state;

  const current = currentEntry(state);
  const selected = selectedEntry(state);
  const isBatch = entries.length > 1;

  // Preview the selected file when it is an image. The object URL lives only as
  // long as that selection, so switching entries or batches never leaks one.
  const previewFile = selected?.isImage ? (files[selected.id] ?? null) : null;
  // The URL is kept with the file it was made for, so on the render where the
  // selection changes the old (soon revoked) URL is never shown for the new file.
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!previewFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreview({ file: previewFile, url });
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);
  const previewUrl = preview && preview.file === previewFile ? preview.url : null;

  // A batch lists each file's outcome in its row; a single file shows its
  // failure here, as the page always has. A stopped batch says why here too.
  const singleFailure = !isBatch && entries[0]?.status.kind === "failed" ? entries[0].status.message : null;
  const error = stopError ?? singleFailure;

  const stage = running ? (current?.status.kind === "hashing" ? "hashing" : "signing") : null;
  const hashing = current?.status.kind === "hashing" ? current.status : null;

  return (
    <div className="w-full space-y-6">
      <DropZone
        stage={stage}
        position={isBatch && current ? `File ${current.id + 1} of ${entries.length}` : undefined}
        onFiles={(list, source) => void signFiles(list, source)}
      />

      {running && (
        <HashProgress
          done={hashing ? hashing.done : null}
          total={hashing ? hashing.total : 0}
          label={isBatch && current ? current.name : undefined}
          onCancel={cancel}
        />
      )}

      {note && <p className="text-sm text-mute">{note}</p>}

      {error && (
        <div className="flex flex-col items-start gap-3">
          <p className="font-semibold text-void" role="alert">
            {error}
          </p>
          {needsSignIn && <SignInButton />}
        </div>
      )}

      {isBatch && <BatchList entries={entries} selectedId={state.selectedId} onSelect={select} />}

      {selected && <SignedResult key={`${state.run}-${selected.id}`} entry={selected} previewUrl={previewUrl} />}

      <div className="space-y-2 pt-2" data-testid="user-key">
        {userKey === "unsupported" ? (
          <p className="text-sm text-mute">
            This browser cannot hold a signing key, so records are service attestations only. A current
            Chrome, Firefox or Safari adds your own signature.
          </p>
        ) : userKey ? (
          <>
            <Eyebrow>Your signing key (this browser)</Eyebrow>
            <code className="block break-all font-mono text-[13px]">{userKey.publicKey}</code>
            <p className="text-sm text-mute">
              Records you create here carry a signature made with this key. It never leaves this device.
              Publish this key where people can find you so they can tie your records to you, not just to
              your account.
            </p>
          </>
        ) : (
          <p className="text-sm text-mute">Preparing your signing key…</p>
        )}
      </div>
    </div>
  );
}
