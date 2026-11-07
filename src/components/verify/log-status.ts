import type { PublicKeysLoad } from "@/lib/keyset-client";
import { verifyInclusionProof, type InclusionProofResponse } from "@/lib/log-verify";
import type { SignatureRecord } from "@/lib/record";

export type LogStatus =
  | { kind: "checking" }
  | { kind: "included"; index: number; size: number }
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/**
 * Ask the service for an inclusion proof and check it locally, including the
 * signed tree head it carries. A record can be perfectly valid and still absent
 * from the log (storage not configured), which is reported as such rather than
 * as failure.
 */
export async function checkLogInclusion(
  record: SignatureRecord,
  keys: PublicKeysLoad["keys"],
): Promise<LogStatus> {
  try {
    const res = await fetch(`/api/log/proof?signature=${encodeURIComponent(record.s)}`, { cache: "no-store" });
    if (res.status === 404) return { kind: "absent" };
    if (!res.ok) return { kind: "unavailable" };
    const proof = (await res.json()) as InclusionProofResponse;
    return verifyInclusionProof(record, proof, keys)
      ? { kind: "included", index: proof.index, size: proof.size }
      : { kind: "invalid" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** What the page says about the transparency log for each status. */
export function logStatusText(status: LogStatus): string {
  switch (status.kind) {
    case "checking":
      return "Checking the transparency log…";
    case "included":
      return `Included in the transparency log as entry ${status.index + 1} of ${status.size}; inclusion proof and signed tree head verified.`;
    case "absent":
      return "Not present in the transparency log (the service may not have storage configured).";
    case "invalid":
      return "The transparency log proof did not verify. The record is valid, but the log should be treated with suspicion.";
    case "unavailable":
      return "Transparency log could not be reached.";
  }
}
