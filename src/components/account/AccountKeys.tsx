"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Button, LocalTime } from "@/components/ui";
import { getOrCreateUserKey, replaceRevokedUserKey } from "@/lib/user-keys";

interface KeyEntry {
  publicKey: string;
  firstSeen: number;
  lastSeen: number;
  revokedAt?: number;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The browser keys this account has signed with. The key held by this
 * browser is marked, so the account holder can tell which device a key
 * belongs to before revoking it.
 */
export function AccountKeys(): ReactElement {
  const [keys, setKeys] = useState<KeyEntry[] | null>(null);
  const [thisBrowserKey, setThisBrowserKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/account/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load your keys (${res.status}).`);
      const body = (await res.json()) as { keys: KeyEntry[] };
      setKeys(body.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your keys.");
    }
  }, []);

  useEffect(() => {
    void load();
    // Creates this browser's key if it has none yet, exactly as signing would.
    // A browser that cannot hold a key simply has no "this browser" marker.
    getOrCreateUserKey().then(
      (key) => setThisBrowserKey(key.publicKey),
      () => setThisBrowserKey(null)
    );
  }, [load]);

  const revoke = async (publicKey: string): Promise<void> => {
    // Captured now: the marker may move while the request is in flight.
    const wasThisBrowser = publicKey === thisBrowserKey;
    setRevoking(publicKey);
    setError(null);
    setRotated(false);
    try {
      const res = await fetch("/api/account/keys/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : `Revocation failed (${res.status}).`);
      }
      await load();
      // The service will never countersign with a revoked key again, so if it
      // was this browser's, replace it rather than leave the browser unable to
      // sign. Asking the store, not the marker, also covers a revoke confirmed
      // before the marker had loaded.
      try {
        const { key, rotated: replaced } = await replaceRevokedUserKey(publicKey);
        setThisBrowserKey(key.publicKey);
        setRotated(replaced || wasThisBrowser);
      } catch {
        setThisBrowserKey(null);
        if (wasThisBrowser) {
          setError("The key is revoked, but this browser could not make a new one, so it cannot sign with its own key.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revocation failed.");
    } finally {
      setRevoking(null);
      setConfirming(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-void" role="alert">
          {error}
        </p>
      )}
      {rotated && (
        <p className="text-sm text-mute" role="status" data-testid="new-key-note">
          This browser now has a new signing key; it is registered the next time you sign.
          {thisBrowserKey && (
            <code className="mt-1 block break-all font-mono text-[13px]" data-testid="new-browser-key">
              {thisBrowserKey}
            </code>
          )}
        </p>
      )}
      {keys === null && !error && (
        <p className="text-mute" role="status">
          Loading…
        </p>
      )}
      {keys !== null && keys.length === 0 && (
        <p className="text-mute">No browser keys yet. A key is registered the first time a browser signs a file.</p>
      )}
      {keys !== null && keys.length > 0 && (
        <ul className="flex flex-col divide-y divide-mute" aria-label="Your keys">
          {keys.map((key) => {
            const isThisBrowser = key.publicKey === thisBrowserKey;
            return (
              <li key={key.publicKey} className="flex flex-col gap-2 py-3" data-public-key={key.publicKey}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all font-mono text-[13px]">{key.publicKey}</code>
                  {isThisBrowser && (
                    <span className="eyebrow text-accent" data-testid="this-browser">
                      This browser
                    </span>
                  )}
                  {key.revokedAt !== undefined && (
                    <span className="eyebrow text-void">Revoked</span>
                  )}
                </div>
                <p className="text-sm text-mute">
                  First used <LocalTime iso={iso(key.firstSeen)} />, last used <LocalTime iso={iso(key.lastSeen)} />
                  {key.revokedAt !== undefined && (
                    <>
                      , revoked <LocalTime iso={iso(key.revokedAt)} />
                    </>
                  )}
                </p>
                {key.revokedAt === undefined &&
                  (confirming === key.publicKey ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm">
                        Revoke this key permanently? ContentProof will refuse to countersign with it again
                        {isThisBrowser ? ", so this browser will get a new key for future records" : ""}. Records it
                        already signed are not withdrawn.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={() => void revoke(key.publicKey)}
                          disabled={revoking === key.publicKey}
                        >
                          {revoking === key.publicKey ? "Revoking…" : "Confirm revoke"}
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Button variant="secondary" onClick={() => setConfirming(key.publicKey)}>
                        Revoke
                      </Button>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
