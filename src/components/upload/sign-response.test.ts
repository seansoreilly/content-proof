import { describe, expect, it } from "vitest";
import { interpretSignResponse } from "@/components/upload/sign-response";
import { USER_KEY_REVOKED_MESSAGE } from "@/lib/user-key-status";

const record = {
  v: 2,
  k: "AAAAAAAAAAAAAAAA",
  h: "A".repeat(43),
  e: "a@example.com",
  t: 1_700_000_000_000,
  s: "B".repeat(86),
};

describe("interpretSignResponse", () => {
  it("returns the record from a successful response", () => {
    const outcome = interpretSignResponse(200, { record, logIndex: 3, logged: true });
    expect(outcome).toEqual({ ok: true, record });
  });

  it("rejects a successful response without a valid record", () => {
    expect(interpretSignResponse(200, { record: { v: 2 } })).toMatchObject({
      ok: false,
      errorType: "invalid_response",
      stopsBatch: false,
    });
    expect(interpretSignResponse(200, null)).toMatchObject({ ok: false, errorType: "invalid_response" });
  });

  it("asks for sign-in on 401 and stops a batch", () => {
    expect(interpretSignResponse(401, { error: "Unauthorized" })).toEqual({
      ok: false,
      message: "Please sign in before signing a file.",
      errorType: "unauthorized",
      needsSignIn: true,
      stopsBatch: true,
    });
  });

  it("shows the server's reason on 403, or a default", () => {
    expect(interpretSignResponse(403, { error: "This key was revoked." })).toEqual({
      ok: false,
      message: "This key was revoked.",
      errorType: "unauthorized",
      needsSignIn: false,
      stopsBatch: false,
    });
    expect(interpretSignResponse(403, null)).toMatchObject({ message: "This signing key cannot be used." });
    expect(interpretSignResponse(403, { error: "  " })).toMatchObject({ message: "This signing key cannot be used." });
    expect(interpretSignResponse(403, { error: 42 })).toMatchObject({ message: "This signing key cannot be used." });
  });

  it("flags only the server's exact revoked-key 403, without stopping the batch", () => {
    expect(interpretSignResponse(403, { error: USER_KEY_REVOKED_MESSAGE })).toEqual({
      ok: false,
      message: USER_KEY_REVOKED_MESSAGE,
      errorType: "unauthorized",
      needsSignIn: false,
      stopsBatch: false,
      revoked: true,
    });
    expect(interpretSignResponse(403, { error: "This signing key is registered to another account" })).not.toHaveProperty(
      "revoked",
    );
    // Same words under another status are not the revocation answer.
    expect(interpretSignResponse(500, { error: USER_KEY_REVOKED_MESSAGE })).not.toHaveProperty("revoked");
  });

  it("reports the rate limit on 429 and stops a batch", () => {
    expect(interpretSignResponse(429, null)).toMatchObject({
      ok: false,
      errorType: "rate_limited",
      message: "Too many signing requests. Please wait a minute and try again.",
      stopsBatch: true,
      needsSignIn: false,
    });
  });

  it("treats any other status as a server error", () => {
    expect(interpretSignResponse(500, { error: "Internal Server Error" })).toMatchObject({
      ok: false,
      message: "Signing failed (500).",
      errorType: "server_error",
      stopsBatch: false,
    });
    expect(interpretSignResponse(400, { error: "bad" })).toMatchObject({ message: "Signing failed (400)." });
  });
});
