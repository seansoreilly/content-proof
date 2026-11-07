import type { VerificationResult } from "@/lib/crypto/verify";
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_LABEL } from "@/lib/hash";
import type { PublicKeysLoad } from "@/lib/keyset-client";
import type { UserKeyStatus } from "@/lib/user-key-status";
import type { LoadedInput } from "@/lib/verify-input";
import type { LogStatus } from "./log-status";

/** Where the current check is: nothing yet, reading the file, or finished. */
export type VerifyPhase =
  | { kind: "idle" }
  | { kind: "hashing"; done: number; total: number }
  | { kind: "done"; result: VerificationResult; subject: CheckedSubject | null };

/**
 * What a finished check was made against, captured with the result so the
 * verdict never mixes in details of a record loaded afterwards. Null when the
 * check could not run at all.
 */
export interface CheckedSubject {
  /** The record's address, or the one typed for a legacy record. */
  email: string;
  /** The attested time, in epoch milliseconds. */
  attestedMs: number;
}

export interface VerifyState {
  loaded: LoadedInput | null;
  manualInput: string;
  legacyEmail: string;
  file: File | null;
  /** Bumped to remount the native file input, the only reliable way to clear it. */
  fileInputKey: number;
  keys: PublicKeysLoad | null;
  keysError: string | null;
  inputError: string | null;
  /**
   * Kept apart from inputError so a later valid selection clears it without
   * hiding a problem with the record.
   */
  fileError: string | null;
  decodingQr: boolean;
  phase: VerifyPhase;
  logStatus: LogStatus | null;
  /**
   * The public revocation status of the account holder's key, once a
   * user-signed record has verified. Null while unknown or unavailable.
   */
  userKeyStatus: UserKeyStatus | null;
  /**
   * The check whose asynchronous results may still land, or null. Anything
   * that changes the file or record ends the run, so a slower earlier check
   * cannot overwrite the current state. It survives `done`, because the log
   * check reports after that.
   */
  run: number | null;
}

export type VerifyAction =
  | { type: "keysLoaded"; keys: PublicKeysLoad }
  | { type: "keysFailed"; message: string }
  | { type: "manualInputChanged"; text: string }
  | { type: "legacyEmailChanged"; email: string }
  /** The signed-in address, used only if nothing has been entered yet. */
  | { type: "legacyEmailDefaulted"; email: string }
  | { type: "recordLoaded"; loaded: LoadedInput }
  /** A link in the address bar that does not parse: drops any loaded record. */
  | { type: "linkRejected"; message: string }
  /** Pasted text or a QR image that does not parse: keeps what is loaded. */
  | { type: "inputRejected"; message: string }
  | { type: "recordCleared" }
  | { type: "qrDecodeStarted" }
  | { type: "qrDecodeFinished" }
  | { type: "fileChosen"; file: File | null }
  | { type: "fileCleared" }
  | { type: "legacyEmailMissing" }
  | { type: "verifyStarted"; run: number; total: number }
  | { type: "hashProgress"; run: number; done: number; total: number }
  | { type: "verified"; run: number; result: VerificationResult; subject: CheckedSubject; checkLog: boolean }
  | { type: "verifyFailed"; run: number }
  | { type: "logChecked"; run: number; status: LogStatus }
  /** The key status lookup finished; null when it could not be had. */
  | { type: "userKeyChecked"; run: number; status: UserKeyStatus | null }
  | { type: "cancelled" };

export const initialVerifyState: VerifyState = {
  loaded: null,
  manualInput: "",
  legacyEmail: "",
  file: null,
  fileInputKey: 0,
  keys: null,
  keysError: null,
  inputError: null,
  fileError: null,
  decodingQr: false,
  phase: { kind: "idle" },
  logStatus: null,
  userKeyStatus: null,
  run: null,
};

export const LEGACY_EMAIL_MISSING =
  "Older records do not carry the signer's address; enter the email used when signing.";

export const FILE_TOO_LARGE = `Files larger than ${MAX_FILE_SIZE_LABEL} are not supported.`;

const RUN_ENDING: ReadonlySet<VerifyAction["type"]> = new Set<VerifyAction["type"]>([
  "recordLoaded",
  "linkRejected",
  "recordCleared",
  "fileChosen",
  "fileCleared",
  "legacyEmailMissing",
  "cancelled",
]);

/**
 * Whether an action abandons the current check. The hook aborts the
 * in-flight hash for these before dispatching, so a cancelled read stops
 * at once rather than finishing in the background.
 */
export function endsRun(action: VerifyAction): boolean {
  return RUN_ENDING.has(action.type);
}

/** The one reset that used to be repeated by hand: no check, no result. */
function endRun(state: VerifyState): VerifyState {
  return { ...state, run: null, phase: { kind: "idle" }, logStatus: null, userKeyStatus: null };
}

export function verifyReducer(state: VerifyState, action: VerifyAction): VerifyState {
  switch (action.type) {
    case "keysLoaded":
      return { ...state, keys: action.keys, keysError: null };
    case "keysFailed":
      return { ...state, keysError: action.message };
    case "manualInputChanged":
      return { ...state, manualInput: action.text };
    case "legacyEmailChanged":
      return { ...state, legacyEmail: action.email };
    case "legacyEmailDefaulted":
      return state.legacyEmail ? state : { ...state, legacyEmail: action.email };
    case "recordLoaded":
      return { ...endRun(state), loaded: action.loaded, inputError: null };
    case "linkRejected":
      return { ...endRun(state), loaded: null, inputError: action.message };
    case "inputRejected":
      return { ...state, inputError: action.message };
    case "recordCleared":
      return { ...endRun(state), loaded: null, manualInput: "", inputError: null };
    case "qrDecodeStarted":
      return { ...state, decodingQr: true, inputError: null };
    case "qrDecodeFinished":
      return { ...state, decodingQr: false };
    case "fileChosen":
      if (action.file && action.file.size > MAX_FILE_SIZE_BYTES) {
        return {
          ...endRun(state),
          file: null,
          fileInputKey: state.fileInputKey + 1,
          fileError: FILE_TOO_LARGE,
        };
      }
      return { ...endRun(state), file: action.file, fileError: null };
    case "fileCleared":
      return {
        ...endRun(state),
        file: null,
        fileError: null,
        fileInputKey: state.fileInputKey + 1,
      };
    case "legacyEmailMissing":
      return { ...endRun(state), inputError: LEGACY_EMAIL_MISSING };
    case "cancelled":
      return endRun(state);
    case "verifyStarted":
      return {
        ...state,
        run: action.run,
        inputError: null,
        phase: { kind: "hashing", done: 0, total: action.total },
        logStatus: null,
        userKeyStatus: null,
      };
    case "hashProgress":
      if (action.run !== state.run || state.phase.kind !== "hashing") return state;
      return { ...state, phase: { kind: "hashing", done: action.done, total: action.total } };
    case "verified":
      if (action.run !== state.run) return state;
      return {
        ...state,
        phase: { kind: "done", result: action.result, subject: action.subject },
        logStatus: action.checkLog ? { kind: "checking" } : null,
        userKeyStatus: null,
      };
    case "verifyFailed":
      if (action.run !== state.run) return state;
      return {
        ...state,
        phase: { kind: "done", result: { ok: false, reason: "malformed" }, subject: null },
        logStatus: null,
        userKeyStatus: null,
      };
    case "logChecked":
      if (action.run !== state.run) return state;
      return { ...state, logStatus: action.status };
    case "userKeyChecked":
      if (action.run !== state.run) return state;
      return { ...state, userKeyStatus: action.status };
  }
}

/** True when a record, a file and keys are all present and nothing is running. */
export function canVerify(state: VerifyState): boolean {
  return Boolean(state.loaded && state.file && state.keys) && state.phase.kind !== "hashing";
}
