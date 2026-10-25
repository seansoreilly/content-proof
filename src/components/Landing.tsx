"use client";

import { useEffect, useState } from "react";
import { Session } from "next-auth";
import { Button, Eyebrow } from "@/components/ui";
import { Seal } from "@/components/Seal";
import { rimTextFor } from "@/lib/seal-image";
import { generateQrCodeDataUrl } from "@/lib/qr";

const EXAMPLE_RIM = rimTextFor({
  t: Date.UTC(2026, 9, 25, 3, 14),
  k: "Kq2vR8mZ9pLw3XcT",
});

const POINTS = [
  {
    title: "Your file stays with you",
    text: "Your browser hashes the file. Only the SHA-256 fingerprint is sent, never the file itself.",
  },
  {
    title: "Two signatures",
    text: "This browser's key signs first. ContentProof then countersigns who, what and when. The service never holds your key.",
  },
  {
    title: "Verify anywhere",
    text: "Checks run in the browser against the published keys. No account is needed to verify.",
  },
];

interface LandingProps {
  authSection?: React.ReactNode;
  session?: Session | null;
}

export default function Landing({
  authSection,
  session,
}: LandingProps): React.JSX.Element {
  const [isHydrated, setIsHydrated] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    setIsHydrated(true);
    let cancelled = false;
    generateQrCodeDataUrl("https://contentproof.app/verify", { width: 256 })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        // The seal keeps its blank centre.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isSignedIn = !!session;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-10 text-center sm:py-16">
      <Seal rimText={EXAMPLE_RIM}>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Example record QR code" className="h-full w-full" />
        ) : (
          <div className="h-full w-full bg-white" />
        )}
      </Seal>

      <h1 className="mt-10">Attested.</h1>
      <p className="mt-6 max-w-[60ch]">
        Hash a file in your browser and receive a sealed record of who
        submitted it and when. Anyone can check the seal against our published
        keys, with no account and no upload.
      </p>

      {authSection && <div className="mt-8">{authSection}</div>}

      <div className="mt-8 flex flex-col gap-4 sm:flex-row">
        <Button
          href="/upload"
          disabled={!isHydrated || !isSignedIn}
          disabledReason="Sign in to sign a file"
        >
          Sign a file
        </Button>
        <Button variant="secondary" href="/verify">
          Verify a file
        </Button>
      </div>

      <div className="mt-16 flex max-w-[60ch] flex-col gap-8 text-left">
        {POINTS.map((p) => (
          <section key={p.title}>
            <Eyebrow>{p.title}</Eyebrow>
            <p className="mt-2">{p.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
