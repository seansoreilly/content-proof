import type { SignFailureType } from "@/lib/analytics";
import { parseRecordObject, type SignatureRecord } from "@/lib/record";
import { USER_KEY_REVOKED_MESSAGE } from "@/lib/user-key-status";

/** What the upload page should do with one answer from `/api/sign`. */
export type SignResponseOutcome =
  | { ok: true; record: SignatureRecord }
  | {
      ok: false;
      message: string;
      errorType: SignFailureType;
      /** The session has gone, so offer the sign-in button. */
      needsSignIn: boolean;
      /**
       * Every later file would get the same answer (signed out, rate limited),
       * so a batch should stop here rather than burn through its other files.
       */
      stopsBatch: boolean;
      /**
       * The account holder revoked the browser key this request was signed
       * with. The caller can replace the key and try the file again.
       */
      revoked?: true;
    };

type SignFailureOutcome = Extract<SignResponseOutcome, { ok: false }>;

function failure(
  message: string,
  errorType: SignFailureType,
  { needsSignIn = false, stopsBatch = false } = {},
): SignFailureOutcome {
  return { ok: false, message, errorType, needsSignIn, stopsBatch };
}

function serverMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.trim() !== "" ? error : null;
}

/**
 * Turns the status and parsed JSON body of a `/api/sign` response into either
 * the signed record or a message for the person. Kept pure, with the body
 * already parsed (or null when it was not JSON), so every branch is testable
 * without a server and the component only has to act on the outcome.
 */
export function interpretSignResponse(status: number, body: unknown): SignResponseOutcome {
  if (status === 401) {
    return failure("Please sign in before signing a file.", "unauthorized", { needsSignIn: true, stopsBatch: true });
  }
  if (status === 403) {
    // The server explains why this key is refused better than a generic line can.
    const message = serverMessage(body);
    const outcome = failure(message ?? "This signing key cannot be used.", "unauthorized");
    return message === USER_KEY_REVOKED_MESSAGE ? { ...outcome, revoked: true } : outcome;
  }
  if (status === 429) {
    return failure("Too many signing requests. Please wait a minute and try again.", "rate_limited", {
      stopsBatch: true,
    });
  }
  if (status < 200 || status > 299) return failure(`Signing failed (${status}).`, "server_error");

  const record = parseRecordObject(body && typeof body === "object" ? (body as { record?: unknown }).record : null);
  if (!record) return failure("The server returned an unexpected response.", "invalid_response");
  return { ok: true, record };
}
