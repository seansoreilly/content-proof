"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Button, LocalTime } from "@/components/ui";
import { hashB64urlToHex, RECORD_VERSION_USER_SIGNED, type SignatureRecord } from "@/lib/record";

interface Entry {
  record: SignatureRecord;
  logIndex?: number;
}

interface Page {
  records: Entry[];
  nextCursor: string | null;
}

const PAGE_SIZE = 20;

function hashPrefix(record: SignatureRecord): string {
  try {
    return `${hashB64urlToHex(record.h).slice(0, 12)}…`;
  } catch {
    return `${record.h.slice(0, 12)}…`;
  }
}

async function fetchPage(cursor: string | null): Promise<Page> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/account/records?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load your records (${res.status}).`);
  return (await res.json()) as Page;
}

/** The signed-in account's records, newest first, a page at a time. */
export function AccountRecords(): ReactElement {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(cursor);
      setEntries((previous) => (cursor ? [...previous, ...page.records] : page.records));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-void" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="text-mute">
          Nothing signed yet. <Link className="text-accent underline" href="/upload">Sign a file</Link>.
        </p>
      )}
      {entries.length > 0 && (
        <ul className="flex flex-col divide-y divide-mute" aria-label="Your records">
          {entries.map(({ record, logIndex }) => (
            <li key={record.s} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
              <div className="flex flex-col gap-1">
                <LocalTime iso={new Date(record.t).toISOString()} className="text-ink" />
                <span className="font-mono text-[13px] text-mute">
                  SHA-256 {hashPrefix(record)}
                  {logIndex !== undefined && <> &middot; log #{logIndex}</>}
                </span>
                <span className="text-sm text-mute">
                  {record.v === RECORD_VERSION_USER_SIGNED ? "Signed by your browser key" : "Service attestation only"}
                </span>
              </div>
              <Link className="text-accent underline" href={`/sig/${record.s}`}>
                View record
              </Link>
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <p className="text-mute" role="status">
          Loading…
        </p>
      )}
      {!loading && nextCursor && (
        <div>
          <Button variant="secondary" onClick={() => void load(nextCursor)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
