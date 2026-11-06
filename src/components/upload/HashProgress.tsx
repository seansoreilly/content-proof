"use client";

import type { ReactElement } from "react";
import { Button } from "@/components/ui";

export interface HashProgressProps {
  /** Bytes read so far, or null while the file is not being hashed (e.g. signing). */
  done: number | null;
  total: number;
  /** Which file is being read, shown when several are queued. */
  label?: string;
  onCancel: () => void;
}

function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
}

/**
 * Progress and Cancel for the file being processed, matching the verify page.
 * It sits outside the drop zone, so clicking or pressing Enter on Cancel never
 * reaches the zone's handlers and opens the file picker.
 */
export function HashProgress({ done, total, label, onCancel }: HashProgressProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {done !== null && (
        <div role="status" className="flex flex-col gap-1 text-sm text-mute" data-testid="hash-progress">
          <progress
            className="h-2 w-full accent-accent"
            max={100}
            value={percent(done, total)}
            aria-label="Reading the file"
          />
          <span>
            {label ? `Reading ${label}` : "Reading the file"}: {percent(done, total)}%
          </span>
        </div>
      )}
      <div>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
