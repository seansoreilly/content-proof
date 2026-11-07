"use client";

import type { ReactElement } from "react";
import { formatSize } from "./format-size";
import { percent } from "./HashProgress";
import type { EntryStatus, UploadEntry } from "./upload-reducer";

export interface BatchListProps {
  entries: UploadEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function statusText(status: EntryStatus): string {
  switch (status.kind) {
    case "queued":
      return "Queued";
    case "hashing":
      return `Hashing ${percent(status.done, status.total)}%`;
    case "signing":
      return "Signing…";
    case "done":
      return "Signed";
    case "failed":
      return `Failed: ${status.message}`;
    case "skipped":
      return status.reason;
  }
}

function statusTone(status: EntryStatus): string {
  if (status.kind === "done") return "text-accent";
  if (status.kind === "failed") return "text-void";
  return "text-mute";
}

/**
 * One row per file in the batch. Choosing a row shows that file's details and
 * seal below, so the page never has to lay out twenty seals at once.
 */
export function BatchList({ entries, selectedId, onSelect }: BatchListProps): ReactElement {
  const signed = entries.filter((entry) => entry.status.kind === "done").length;
  return (
    <section className="flex flex-col gap-3" aria-label="Files in this batch">
      <h2 className="eyebrow">
        Files · {signed} of {entries.length} signed
      </h2>
      <ol className="flex flex-col gap-2">
        {entries.map((entry) => {
          const selected = entry.id === selectedId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={selected}
                data-testid="batch-entry"
                data-status={entry.status.kind}
                onClick={() => onSelect(entry.id)}
                className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected ? "bg-tint shadow-pressed" : "shadow-outline hover:bg-tint"
                }`}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="break-all font-semibold">{entry.name}</span>
                  <span className="text-sm text-mute">{formatSize(entry.size)}</span>
                </span>
                <span className="break-all font-mono text-[12px] text-mute">
                  {entry.hash ??
                    (entry.status.kind === "queued" || entry.status.kind === "hashing"
                      ? "SHA-256 pending"
                      : "No SHA-256")}
                </span>
                <span className={`text-sm font-semibold ${statusTone(entry.status)}`}>{statusText(entry.status)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
