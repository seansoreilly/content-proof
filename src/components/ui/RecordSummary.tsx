import type { ReactElement } from "react";
import { buildSummaryRows } from "./summary-rows";
import { LocalTime } from "./LocalTime";
import type { SignatureRecord } from "@/lib/record";

export interface RecordSummaryProps {
  record: SignatureRecord;
  logIndex?: number | null;
  showHash?: boolean;
  timeFormat?: "local" | "iso";
}

export function RecordSummary({
  record,
  logIndex,
  showHash,
  timeFormat = "local",
}: RecordSummaryProps): ReactElement {
  const rows = buildSummaryRows(record, { logIndex, showHash, timeFormat });
  return (
    <dl className="grid gap-4">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="eyebrow">{row.label}</dt>
          <dd
            className={
              row.mono
                ? "mt-1 break-all font-mono text-[13px]"
                : "mt-1 break-words"
            }
          >
            {row.iso === undefined ? (
              row.value
            ) : timeFormat === "iso" ? (
              <>
                <time dateTime={row.iso}>{row.value}</time>
                {/* The server cannot know the viewer's zone; the browser adds it. */}
                <LocalTime iso={row.iso} fallback="none" className="block text-sm text-mute" />
              </>
            ) : (
              <time dateTime={row.iso}>{row.value}</time>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
