"use client";

import type { ChangeEventHandler, ReactElement } from "react";
import type { SignatureRecord } from "@/lib/record";
import type { LoadedInput } from "@/lib/verify-input";
import { Button, FileField, TextArea, VerifyResult, buildSummaryRows } from "@/components/ui";
import { DisplayEmail, TimeText } from "./DisplayEmail";

/**
 * RecordSummary's labels describe a verified record ("Attested for"). Before
 * the check nothing in the record is established, so the claims are worded
 * as claims.
 */
const UNVERIFIED_LABELS: Readonly<Record<string, string>> = {
  "Attested for": "Claims to be for",
  "Account holder's key": "Claims account holder's key",
};

/**
 * The shared summary rows for a loaded but unchecked record. The address is
 * shown through DisplayEmail so hidden characters are stripped and flagged
 * right beside it.
 */
function ClaimedSummary({ record }: { record: SignatureRecord }): ReactElement {
  const rows = buildSummaryRows(record);
  return (
    <dl className="grid gap-3">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="eyebrow">{UNVERIFIED_LABELS[row.label] ?? row.label}</dt>
          <dd className={row.mono ? "mt-1 break-all font-mono text-[13px]" : "mt-1 break-words"}>
            {row.label === "Attested for" ? (
              <DisplayEmail email={record.e} />
            ) : row.iso !== undefined ? (
              <TimeText ms={record.t} />
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface RecordLoaderProps {
  loaded: LoadedInput | null;
  manualInput: string;
  decodingQr: boolean;
  onManualInputChange: (text: string) => void;
  onLoadManual: () => void;
  onQrImage: (image: File) => void;
  onClear: () => void;
}

/** First step of the page: paste a link or record, or upload a QR picture. */
export function RecordLoader({
  loaded,
  manualInput,
  decodingQr,
  onManualInputChange,
  onLoadManual,
  onQrImage,
  onClear,
}: RecordLoaderProps): ReactElement {
  const onQrImageChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const image = e.target.files?.[0];
    // Cleared so choosing the same picture again still fires a change.
    e.target.value = "";
    if (image) onQrImage(image);
  };

  return (
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
            onChange={(e) => onManualInputChange(e.target.value)}
          />
          <div>
            <Button onClick={onLoadManual} disabled={!manualInput.trim()}>
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
              <ClaimedSummary record={loaded.record} />
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
            <Button variant="secondary" onClick={onClear}>
              Load a different record
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
