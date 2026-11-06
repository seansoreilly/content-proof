import type { ReactElement } from "react";
import type { VerificationFailure, VerificationResult } from "@/lib/crypto/verify";
import { LocalTime, VerifyResult } from "@/components/ui";
import type { UserKeyStatus } from "@/lib/user-key-status";
import { DisplayEmail, TimeText } from "./DisplayEmail";
import { logStatusText, type LogStatus } from "./log-status";

export const FAILURE_MESSAGES: Record<VerificationFailure, string> = {
  "unknown-key":
    "This record was not signed with any key ContentProof has published. Treat it as a forgery.",
  "hash-mismatch":
    "The file you selected is not the file that was attested. It may have been modified, re-saved or converted.",
  "bad-signature":
    "The signature does not match the record. The record was altered after it was issued.",
  "bad-user-signature":
    "The service countersignature is valid but the account holder's own signature does not verify. Treat the record as invalid.",
  malformed: "The record is malformed and cannot be checked.",
};

export interface VerificationOutcomeProps {
  result: VerificationResult;
  /** The address the check was made against: the record's, or the one typed for a legacy record. */
  email: string;
  attestedMs: number;
  logStatus: LogStatus | null;
  /** The account holder's key status, when it has been looked up. */
  userKeyStatus?: UserKeyStatus | null;
}

/** When the record's own key has been revoked, per a status about that same key. */
function revokedAt(result: VerificationResult, status: UserKeyStatus | null | undefined): number | null {
  if (!result.ok || !result.userSigned || !status || status.publicKey !== result.userKey) return null;
  return status.revokedAt;
}

/** The verdict, and for a current record what the transparency log says about it. */
export function VerificationOutcome({
  result,
  email,
  attestedMs,
  logStatus,
  userKeyStatus,
}: VerificationOutcomeProps): ReactElement {
  const keyRevokedAt = revokedAt(result, userKeyStatus);
  return (
    <section aria-live="polite">
      {result.ok ? (
        <VerifyResult tone="sealed" title="Attestation verified">
          <div className="flex flex-col gap-2">
            <p>
              ContentProof attests that <DisplayEmail email={email} /> submitted this exact file on{" "}
              <TimeText ms={attestedMs} />.
            </p>
            {result.userSigned ? (
              <p className="text-sm text-mute" data-testid="user-signature">
                Also signed by the account holder&apos;s own key{" "}
                <code className="break-all font-mono text-[13px]">{result.userKey}</code>, which the service never
                holds. Service countersignature by published key{" "}
                <code className="break-all font-mono text-[13px]">{result.keyId}</code>.
              </p>
            ) : (
              <p className="text-sm text-mute" data-testid="user-signature">
                Signed with published key <code className="break-all font-mono text-[13px]">{result.keyId}</code>.
                This is an attestation by the service only; the record carries no signature from a key the account
                holder controls.
              </p>
            )}
            {logStatus && (
              <p className="text-sm text-mute" data-testid="log-status">
                {logStatusText(logStatus)}
              </p>
            )}
            {keyRevokedAt !== null && (
              <p className="text-sm text-void" data-testid="user-key-status">
                The account holder revoked this key on <LocalTime iso={new Date(keyRevokedAt).toISOString()} />.
                Records it signed before then remain valid; anything presented as newer should be treated with
                suspicion.
              </p>
            )}
          </div>
        </VerifyResult>
      ) : (
        <VerifyResult tone="void" title="Not verified">
          <p>{FAILURE_MESSAGES[result.reason ?? "malformed"]}</p>
        </VerifyResult>
      )}
    </section>
  );
}
