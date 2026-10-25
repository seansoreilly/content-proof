import { bytesToHex, fromBase64Url } from "@/lib/base64";
import { formatLocalTime, toIsoUtc } from "@/lib/format-time";
import type { SignatureRecord } from "@/lib/record";

export interface SummaryRow {
  label: string;
  value: string;
  mono: boolean;
  /** Set on the time row: the ISO UTC value, for a `<time dateTime>` element. */
  iso?: string;
}

function hashToHex(h: string): string {
  try {
    return bytesToHex(fromBase64Url(h));
  } catch {
    return h;
  }
}

/** Pure row builder, kept separate from rendering so it can be unit tested. */
export function buildSummaryRows(
  record: SignatureRecord,
  options: {
    logIndex?: number | null;
    showHash?: boolean;
    timeFormat?: "local" | "iso";
  } = {},
): SummaryRow[] {
  const { logIndex, showHash = false, timeFormat = "local" } = options;
  const iso = toIsoUtc(record.t);
  const rows: SummaryRow[] = [
    { label: "Attested for", value: record.e, mono: false },
    {
      label: "At",
      value: timeFormat === "iso" ? iso : formatLocalTime(record.t),
      mono: false,
      iso,
    },
  ];
  if (showHash) {
    rows.push({ label: "File SHA-256", value: hashToHex(record.h), mono: true });
  }
  rows.push({ label: "Service key id", value: record.k, mono: true });
  rows.push(
    record.u !== undefined
      ? { label: "Account holder's key", value: record.u, mono: true }
      : {
          label: "Account holder's key",
          value: "none, service attestation only",
          mono: false,
        },
  );
  if (logIndex !== undefined) {
    rows.push({
      label: "Log entry",
      value: logIndex === null ? "not recorded" : `#${logIndex}`,
      mono: false,
    });
  }
  return rows;
}
