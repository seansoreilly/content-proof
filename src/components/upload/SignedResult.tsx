"use client";

import type { ReactElement } from "react";
import Image from "next/image";
import { QrCodeGenerator } from "@/components/QrCodeGenerator";
import { formatSize } from "./format-size";
import type { UploadEntry } from "./upload-reducer";

export interface SignedResultProps {
  entry: UploadEntry;
  /** An object URL for the entry's image, when it is one. */
  previewUrl: string | null;
}

/**
 * The details of one file: its preview, name, size and fingerprint, and the
 * seal once it is signed. For a single file this is the whole result, laid out
 * as the page always has.
 */
export function SignedResult({ entry, previewUrl }: SignedResultProps): ReactElement {
  return (
    <div className="flex flex-col gap-6" data-testid="signed-result">
      {previewUrl && (
        <details>
          <summary className="eyebrow cursor-pointer select-none">Preview</summary>
          <div className="mt-3 p-3 shadow-pressed">
            <Image
              src={previewUrl}
              alt="File preview"
              width={256}
              height={256}
              unoptimized
              className="max-h-64 w-full object-contain"
            />
          </div>
        </details>
      )}

      {entry.hash && (
        <dl className="grid gap-4">
          <div>
            <dt className="eyebrow">File</dt>
            <dd className="mt-1 break-all">{entry.name}</dd>
          </div>
          <div>
            <dt className="eyebrow">Size</dt>
            <dd className="mt-1">{formatSize(entry.size)}</dd>
          </div>
          <div>
            <dt className="eyebrow">SHA-256</dt>
            <dd className="mt-1 break-all font-mono text-[13px]">{entry.hash}</dd>
          </div>
        </dl>
      )}

      {entry.status.kind === "done" && (
        <div className="flex flex-col gap-3">
          <QrCodeGenerator record={entry.status.record} />
          {!entry.status.logged && (
            <p className="text-sm text-mute" data-testid="not-logged">
              Signed, but the service could not store this record or add it to the transparency log. The seal still
              verifies; keep it safe.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
