import Link from "next/link";
import { notFound } from "next/navigation";
import { encodeRecord } from "@/lib/record";
import { getLogStore, getRecordStore } from "@/lib/redis";

export const dynamic = "force-dynamic";

const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

/**
 * Public page for one issued record: what was attested, by which key, and
 * where it sits in the transparency log. Recovers a lost QR code and gives
 * integrators a stable link.
 */
export default async function RecordPage({
  params,
}: {
  params: Promise<{ signature: string }>;
}) {
  const { signature } = await params;
  if (!SIGNATURE_RE.test(signature)) notFound();

  const record = await getRecordStore().get(signature).catch(() => null);
  if (!record) notFound();

  const logIndex = await getLogStore().indexOf(signature).catch(() => null);
  const encoded = encodeRecord(record);
  const verifyHref = `/verify#P=${encoded}`;

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen p-4">
      <div className="absolute top-6 left-6">
        <Link href="/" aria-label="Back to home" className="btn-secondary">
          ← Home
        </Link>
      </div>

      <h1 className="text-blue-600 text-3xl md:text-5xl font-extrabold mb-8 text-center">Record</h1>

      <div className="glass p-6 w-full max-w-md space-y-4 text-sm text-light-600">
        <p>
          <span className="text-light-500">Attested for:</span>{" "}
          <span className="font-medium break-all">{record.e}</span>
        </p>
        <p>
          <span className="text-light-500">At:</span>{" "}
          <span className="font-medium">{new Date(record.t).toISOString()}</span>
        </p>
        <p>
          <span className="text-light-500">File SHA-256 (base64url):</span> <code className="text-xs break-all">{record.h}</code>
        </p>
        <p>
          <span className="text-light-500">Key id:</span> <code className="text-xs">{record.k}</code>
        </p>
        <p>
          <span className="text-light-500">Transparency log:</span>{" "}
          {logIndex === null ? (
            "not recorded"
          ) : (
            <>
              entry <code className="text-xs">{logIndex}</code>{" "}
              <Link className="underline" href={`/api/log/proof?index=${logIndex}`}>
                (inclusion proof)
              </Link>
            </>
          )}
        </p>

        <details className="pt-2">
          <summary className="cursor-pointer text-light-500 select-none">Raw record</summary>
          <code className="block mt-2 p-3 rounded-lg font-mono text-xs break-all bg-white/5">{encoded}</code>
        </details>

        <Link href={verifyHref} className="btn-primary w-full flex items-center justify-center mt-4">
          Verify a file against this record
        </Link>

        <p className="text-xs text-light-400 pt-2">
          This page is a convenience. The record is self-contained and verifiable without it, using the
          keys at <code>/.well-known/public-keys.json</code>.
        </p>
      </div>
    </main>
  );
}
