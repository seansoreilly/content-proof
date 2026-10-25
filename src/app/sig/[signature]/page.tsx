import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { encodeRecord } from "@/lib/record";
import { getLogStore, getRecordStore } from "@/lib/redis";
import { rimTextFor } from "@/lib/seal-image";
import { Seal } from "@/components/Seal";
import { Button, RecordSummary } from "@/components/ui";

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
}): Promise<React.JSX.Element> {
  const { signature } = await params;
  if (!SIGNATURE_RE.test(signature)) notFound();

  const record = await getRecordStore().get(signature).catch(() => null);
  if (!record) notFound();

  const logIndex = await getLogStore().indexOf(signature).catch(() => null);
  const encoded = encodeRecord(record);
  const verifyHref = `/verify#P=${encoded}`;

  // qrcode's default modules are black on white, which is what the seal requires.
  const qrDataUrl = await QRCode.toDataURL(verifyHref, {
    width: 512,
    errorCorrectionLevel: "M",
    margin: 1,
  });

  return (
    <main className="mx-auto flex w-full max-w-[42rem] flex-col items-center gap-8 px-4 py-10 md:py-16">
      <h1 className="self-start">Record</h1>

      <Seal rimText={rimTextFor(record)} size={288}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt="QR code for this record's verification link"
          className="h-full w-full"
        />
      </Seal>

      <div className="flex w-full flex-col gap-4">
        <RecordSummary record={record} showHash logIndex={logIndex} timeFormat="iso" />
        {logIndex !== null && (
          <p>
            <Link className="text-accent underline" href={`/api/log/proof?index=${logIndex}`}>
              Inclusion proof for entry {logIndex}
            </Link>
          </p>
        )}

        <details>
          <summary className="eyebrow cursor-pointer select-none">Raw record</summary>
          <code className="mt-2 block break-all bg-paper p-3 font-mono text-[13px] shadow-pressed">
            {encoded}
          </code>
        </details>

        <div>
          <Button href={verifyHref}>Verify a file against this record</Button>
        </div>

        <p className="text-sm text-mute">
          This page is a convenience. The record is self-contained and verifiable without it, using the
          keys at <code className="font-mono">/.well-known/public-keys.json</code>.
        </p>
      </div>
    </main>
  );
}
