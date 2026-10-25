import type { ReactElement } from "react";
import { buildSummaryRows } from "./summary-rows";
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
  timeFormat,
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
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
