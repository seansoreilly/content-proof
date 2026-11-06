"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button, Panel } from "@/components/ui";
import { FileChecker } from "@/components/verify/FileChecker";
import { RecordLoader } from "@/components/verify/RecordLoader";
import { useVerification } from "@/components/verify/useVerification";
import { VerificationOutcome } from "@/components/verify/VerificationOutcome";

function VerifyPageContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const { data: session, status: authStatus } = useSession();
  const sessionEmail = authStatus === "authenticated" ? (session?.user?.email ?? null) : null;
  const v = useVerification({ legacyQuery: searchParams.get("data") ?? "", sessionEmail });
  const { state } = v;
  const { loaded, phase } = state;
  const error = state.inputError ?? state.keysError ?? state.fileError;

  return (
    <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-6 px-4 py-10 md:py-16">
      <h1>Verify</h1>

      {error && (
        <Panel>
          <p className="font-medium text-void" role="alert">
            {error}
          </p>
        </Panel>
      )}

      <Panel className="flex flex-col gap-6">
        <RecordLoader
          loaded={loaded}
          manualInput={state.manualInput}
          decodingQr={state.decodingQr}
          onManualInputChange={v.setManualInput}
          onLoadManual={v.loadManual}
          onQrImage={(image) => void v.loadQrImage(image)}
          onClear={v.clearLoaded}
        />

        <div className="h-px bg-relief" aria-hidden="true"></div>

        <FileChecker
          file={state.file}
          fileInputKey={state.fileInputKey}
          needsEmail={loaded?.kind === "legacy"}
          legacyEmail={state.legacyEmail}
          phase={phase}
          canVerify={v.canVerify}
          keys={state.keys}
          keysError={state.keysError}
          onFileChange={v.chooseFile}
          onClearFile={v.clearFile}
          onLegacyEmailChange={v.setLegacyEmail}
          onVerify={() => void v.verify()}
          onCancel={v.cancel}
        />

        {phase.kind === "done" && (
          <>
            <div className="h-px bg-relief" aria-hidden="true"></div>
            <VerificationOutcome
              result={phase.result}
              email={phase.subject?.email ?? ""}
              attestedMs={phase.subject?.attestedMs ?? 0}
              logStatus={state.logStatus}
            />
          </>
        )}
      </Panel>

      <p className="text-sm text-mute">
        The file and the record stay in your browser. The page fetches
        ContentProof&apos;s published keys and, after a successful check, asks
        the transparency log for an inclusion proof, which sends the record&apos;s
        signature. Usage analytics go to Google Analytics.
      </p>

      <div>
        <Button variant="secondary" href="/">
          Back to home
        </Button>
      </div>
    </div>
  );
}

export default function VerifyPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[42rem] px-4 py-10 md:py-16">
          <Panel>
            <p className="eyebrow">Loading verification…</p>
          </Panel>
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
