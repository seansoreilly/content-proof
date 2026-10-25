# User Guide - Content Proof

## What Content Proof does

Content Proof is an attestation service. When you sign a file, the ContentProof
service records that **your Google account submitted that file's SHA-256 hash at
a specific time**, and signs the record with its own Ed25519 key. Anyone can
check the record against ContentProof's published public keys.

Your file is hashed in your browser and never uploaded. Only the hash is sent.

### What you need
- A Google account (@gmail.com or Google Workspace)
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Any file, up to 500 MB

## How to sign a file

1. **Sign in.** Click "Sign in with Google" and approve access to your basic profile and email.
2. **Choose your file.** Drag and drop it or browse. Any file type works, up to 500 MB. Large files are hashed in chunks in your browser.
3. **Get your attestation.** The server signs the hash, your Google account email and the current time. You receive a QR code and a verification link.
4. **Keep and share.** Download the QR code or copy the link. Share them with the file.

The link looks like `https://<host>/verify#P=...`. Everything after `#` stays in the browser and is never sent to the server.

## How to verify a file

1. Scan the QR code or open the verification link. If you only have a picture or screenshot of the QR code, upload it on the verification page and it is decoded in your browser.
2. Select the file you want to check. It is hashed locally.
3. The page shows the result, the signer's Google account and the timestamp.

You do not type an email for current QR codes; it is part of the record. For older QR codes created before the format change, the verifier asks you for the signer's email.

Verification runs in your browser against the key set published at `/.well-known/public-keys.json`. The keys are cached in your browser, so checks keep working offline once you have verified at least once online.

## Understanding results

### Valid
- The file's hash matches the hash in the record.
- The signature was made by a ContentProof key that is published.
- ContentProof attests that this Google account submitted that hash at that time.

### Invalid
Possible causes:
- The file was modified or is not the one that was signed.
- The link or QR code is damaged or incomplete.
- The key id is not in the published key set.

## What a valid result does and does not mean

Content Proof gives you:
- **Integrity check:** any change to the file changes its hash and fails verification.
- **Attestation:** a record, signed by ContentProof, that a Google account submitted the hash at a time.

Content Proof does not give you:
- **Proof the user signed.** The user holds no key. ContentProof's key signs everything, so a verifier is trusting ContentProof and its sign-in check.
- **Proof of authorship or ownership.** It shows who submitted a hash and when, not who made the file.
- **Confidentiality.** Signatures do not encrypt files, and anyone with the link can see the email and timestamp.
- **Revocation.** A record cannot be revoked. Sign the new version of a file if it changes.

## Common uses

- Recording that you had a particular version of a document or image by a certain time.
- Giving recipients a quick way to check that the file they received matches the one you submitted.
- Keeping a lightweight record alongside other evidence. For legal disputes, combine it with traditional documentation.

## Troubleshooting

**File won't hash or sign**
- Check the file is under 500 MB.
- Keep the tab open until hashing finishes.
- Try another browser or close memory-heavy tabs.

**QR code won't scan**
- Make sure the image is clear and undamaged.
- Try another scanner app, or open the verification link directly.

**Verification fails unexpectedly**
- Use the exact file that was signed, byte for byte. Re-saving or re-compressing changes the hash.
- Make sure the whole link was copied, including everything after `#`.
- For an older QR code, check that the signer email is exactly right.
- If you are offline for the first time, connect once so the public keys can be cached.

**Site doesn't work**
- Update your browser, enable JavaScript, clear the cache, or try a private window.

## Best practices

**For signers**
1. Keep the original file and its QR code together.
2. Secure your Google account with two-step verification. Anyone with access to it can obtain attestations as you.
3. Note why and when you signed.

**For verifiers**
1. Open verification links on the real ContentProof site.
2. Check that the signer and timestamp make sense for the context.
3. Remember a valid result is ContentProof's attestation, not a personal signature.

## Limitations

- Google sign-in only (Gmail and Workspace accounts).
- One file at a time.
- 500 MB maximum file size.
- Requires a modern browser.

## FAQ

**Can I sign without a Google account?** No. Sign-in is Google only.

**Do I need internet to verify?** Not after the public keys have been cached in your browser.

**How long do records last?** The signature stays mathematically valid as long as ContentProof's published key is available. Keep a copy of the key set if you need long-term evidence.

**Can I revoke a record?** No. Sign the new version of the file instead.

## Privacy summary

- Files never leave your browser; only the SHA-256 hash is sent.
- If storage is configured, the service keeps the signature record: hash, email, timestamp and key id.
- The verification payload is in the URL fragment and is not sent to the server.

See the full Privacy Policy for details.
