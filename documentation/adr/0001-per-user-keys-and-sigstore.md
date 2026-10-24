# ADR 0001: Per-user signing keys and Sigstore

Status: Accepted (option E, browser-held keys with service countersignature)
on 2026-10-24. Options C and D remain open as future upgrades.

## Context

ContentProof signs every record with one service-held Ed25519 key. A valid
record therefore proves "the service attests that account E submitted hash H
at time T". It does not prove that the account holder signed anything, and the
service could issue a record for any account. The 2026-10-24 fitness review
(finding 3) flagged that the product copy promised user non-repudiation it
could not deliver. That copy has been corrected; this ADR records the options
for actually delivering it, and why none of them is in the current change.

The transparency log added in the same change (signed tree heads, inclusion
proofs, `/api/log/*`) constrains the service: it cannot issue a record and
later deny it, or back-date one, without the tree heads revealing it. It does
not stop the service from issuing a record for an account that never asked.

## Options

### A. Keep the attestation model (current)

One service key, honest wording, transparency log.

- Proves: service attestation, append-only history.
- Does not prove: the account holder's intent.
- Cost: none further.

### B. Server-held per-user keys

Generate an Ed25519 pair per account on first sign-in, store the private key
encrypted (KMS-wrapped) and sign with it; the service key countersigns.

- Proves: the same as A. The server still holds every key, so it still can
  sign for anyone. It adds key-management burden for no gain in trust.
- Verdict: not worth doing. It looks like per-user signing without being it.

### C. Keys the user controls (passkeys / WebAuthn)

Have the browser sign with a credential the user holds, for example a WebAuthn
assertion over the file hash, or a key derived with the WebAuthn PRF
extension, with the service key countersigning the record.

- Proves: an authenticator the user controls was present and approved this
  specific hash. This is real user non-repudiation.
- Requires: a credential registry per account, recovery flows (lost device
  means lost key), verifier support for WebAuthn assertion formats, and
  testing on real authenticators. QR payload grows (assertion is a few hundred
  bytes), so the QR would carry a link to a stored record rather than the
  record itself, which makes verification depend on the service being up.
- Verdict: the right destination if non-repudiation is a product requirement.
  It is a multi-week change with UX consequences (every signing needs a
  passkey prompt; recovery must be designed) and should be decided, not slipped
  in.

### D. Sigstore keyless signing

Use Fulcio to bind a Google OIDC identity to a short-lived certificate, sign
with the ephemeral key, and record the signature in Rekor's public log.

- Proves: a holder of the Google identity signed, witnessed by a public
  transparency log run by a third party. Strongest external trust.
- Requires: an OIDC token with audience `sigstore`, which NextAuth's Google
  login does not produce (its audience is this app's client id). The browser
  would run its own OIDC flow against Google for the Sigstore audience, or the
  service would need to be an OIDC provider that Fulcio trusts (not available
  to arbitrary services). Bundles are several kilobytes, so QR codes would
  carry a Rekor lookup rather than the proof. Verification needs the Sigstore
  trust root and, in practice, network access to Rekor.
- Verdict: attractive, and it is the model this product was reaching for, but
  it changes who the user is trusting (Sigstore's public-good instance), what
  the QR contains, and the offline story. A product decision.

### E. Browser-held WebCrypto key with service countersignature (chosen)

Generate a non-extractable Ed25519 key with WebCrypto in the browser, keep it
in IndexedDB, sign `<hash>:<email>:<timestamp>` with it, and have the service
verify that signature and countersign a statement that includes the user's
key and signature (record version 3).

- Proves: the holder of the key in the record approved exactly this
  statement. The service cannot produce such a record for an existing key
  it does not hold.
- Does not prove: that the key belongs to the person behind the email. The
  service asserts that binding when it countersigns (the key was presented in
  a session for that account). A dishonest service could mint a key and claim
  it is the user's. Mitigations: the upload page shows the key so the user can
  publish it independently; every record and key use is in the transparency
  log, so a key appearing out of nowhere is auditable.
- Requires: WebCrypto Ed25519 (current Chrome, Firefox, Safari; Node 18+ for
  tests). No authenticator prompts, no external service, verification stays
  offline. Loss of the browser profile loses the key; the next visit makes a
  new one, which is acceptable because records name the key that signed them.
- Cost: implemented in this change. Payload grows by about 130 characters; the
  QR stays within version 15 at error-correction level M.

## Decision

Implement E now. It delivers per-record non-repudiation by a key the service
never holds, with no change to who runs the infrastructure and no new prompts
for the user. Keep version 2 as the fallback for browsers without WebCrypto
Ed25519 so every browser can still sign, and keep the verifier honest about
which it is looking at.

Do not implement B. Revisit C (passkeys) if users want keys that roam across
devices with platform-backed recovery, and D (Sigstore) if an external,
third-party identity binding becomes a requirement. Both are additive: the
version 3 record stays the service-attestation layer.

## Consequences

- Copy and docs state the attestation model plainly, and distinguish version 2
  (service only) from version 3 (account holder's key plus service) (done).
- The transparency log gives auditors a way to hold the service to its own
  history, including which keys it bound to which accounts (done).
- The verifier reports whether a record carries the account holder's
  signature (done).
- Device-roaming keys and external identity binding remain roadmap items
  with two viable designs (C, D).
