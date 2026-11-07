import type { ReactElement } from "react";
import { formatLocalTime, toIsoUtc } from "@/lib/format-time";
import { stripHiddenChars } from "./display-text";

/**
 * An email as it should be read, not as it was typed. Hidden characters are
 * stripped for display only, and flagged; verification signs the raw bytes.
 */
export function DisplayEmail({ email }: { email: string }): ReactElement {
  const clean = stripHiddenChars(email);
  return (
    <span className="break-words font-medium">
      {clean}
      {clean !== email && <span className="text-void"> (hidden characters removed)</span>}
    </span>
  );
}

/** A record time in the viewer's zone, with the ISO value in `dateTime`. */
export function TimeText({ ms }: { ms: number }): ReactElement {
  const iso = toIsoUtc(ms);
  if (!iso) return <span>unknown time</span>;
  return <time dateTime={iso}>{formatLocalTime(ms)}</time>;
}
