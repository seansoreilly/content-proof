import type { ReactElement } from "react";
import FileUpload from "@/components/FileUpload";
import { Panel } from "@/components/ui";

export default function UploadPage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-[42rem] px-4 py-10 sm:py-16">
      <h1 className="mb-8">Sign a file</h1>
      <Panel>
        <FileUpload />
      </Panel>
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
      </div>
    </main>
  );
}
