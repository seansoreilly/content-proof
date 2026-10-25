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
    <div className="mx-auto w-full max-w-[42rem] px-4 py-10 sm:py-16">
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
      <div className="mt-8 flex max-w-[60ch] flex-col gap-3 text-mute">
        <p>
          Sign the file you already have. It is not uploaded, and there is
          nothing to download back: this browser reads it, computes its
          SHA-256 fingerprint, and only that fingerprint is signed, first by
          this browser&apos;s key and then by ContentProof.
        </p>
        <p>
          The only thing you download is the seal. Keep your original file
          unchanged, because whoever verifies the seal needs that exact file.
          A re-saved, converted or compressed copy will not match.
        </p>
        <p>
          Each record is also appended to ContentProof&apos;s public, permanent
          transparency log. The log feed shows only hashes, times and key ids,
          but anyone holding your link or seal sees your email.
        </p>
      </div>
    </div>
  );
}
