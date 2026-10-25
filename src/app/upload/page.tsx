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
      <p className="mt-8 max-w-[60ch] text-mute">
        Your file never leaves this browser. Only its SHA-256 fingerprint is
        signed, first by this browser&apos;s key and then by ContentProof.
      </p>
    </main>
  );
}
