import type { Metadata } from "next";
import type { ReactElement } from "react";
import { getServerSession } from "next-auth";
import FileUpload from "@/components/FileUpload";
import { SignInButton } from "@/components/SignInButton";
import { Eyebrow, Panel } from "@/components/ui";
import { authOptions } from "@/lib/auth/options";

export const metadata: Metadata = { title: "Sign a file" };

export default async function UploadPage(): Promise<ReactElement> {
  const session = await getServerSession(authOptions);

  return (
    <main className="mx-auto w-full max-w-[42rem] px-4 py-10 sm:py-16">
      <h1 className="mb-8">Sign a file</h1>
      {session ? (
        <Panel>
          <FileUpload />
        </Panel>
      ) : (
        <Panel className="flex flex-col items-start gap-4">
          <Eyebrow>Sign in</Eyebrow>
          <p>Sign in with Google to sign a file.</p>
          <SignInButton callbackUrl="/upload" />
        </Panel>
      )}
      <p className="mt-8 max-w-[60ch] text-mute">
        Your file never leaves this browser. Only its SHA-256 fingerprint is
        signed, first by this browser&apos;s key and then by ContentProof.
      </p>
      <p className="mt-4 max-w-[60ch] text-mute">
        Each record is also appended to ContentProof&apos;s public, permanent
        transparency log. The log feed shows only hashes, times and key ids, but
        anyone holding your link or seal sees your email.
      </p>
    </main>
  );
}
