# ContentProof

ContentProof is an attestation (notary) service. You sign in with Google, your
browser hashes a file with SHA-256 and signs the hash with a key held in that
browser, and the server countersigns who, what and when with the ContentProof
Ed25519 key. The service never holds your key. The file never leaves your
browser; only its hash is sent. Anyone can verify the result against the
published keys.

A valid signature proves one thing. For a version 3 record: **the holder of the
browser key `<ukey>` approved the statement that the Google account `<email>`
submitted the SHA-256 hash `<hash>` at time `<timestamp>`, and ContentProof
countersigned it.** The binding of `<ukey>` to the account is asserted by the
service at signing time. For a version 2 record (browsers without Ed25519
WebCrypto), only the service signs: **the ContentProof service attests that
`<email>` submitted `<hash>` at `<timestamp>`**, with no signature by you and
no non-repudiation by the user. Either way, verifiers trust ContentProof's
published public key and its sign-in check. It does not prove authorship or
ownership of the file.

## How verification works

The QR code encodes a link:

```
https://<host>/verify#P=<payload>
```

The payload is in the URL fragment, so it is never sent to the server. It is a
tilde-separated string of six URL-safe fields:

```
2~<kid>~<hash>~<email>~<timestamp>~<signature>
```

| Field | Meaning |
|-------|---------|
| `2` | Format version |
| `kid` | Key id: first 16 characters of base64url(SHA-256(SPKI DER of the Ed25519 public key)) |
| `hash` | base64url, no padding, 43 chars, of the 32-byte SHA-256 digest of the file |
| `email` | Google account email, `encodeURIComponent`-encoded, with any `~` also encoded as `%7E` |
| `timestamp` | Milliseconds since the Unix epoch, decimal |
| `signature` | base64url, no padding, 86 chars, of the 64-byte Ed25519 signature |

The signed message is the UTF-8 string:

```
<hash_hex>:<email>:<timestamp>
```

`hash_hex` is the same digest as lowercase hex (64 chars), `email` is the raw
(not percent-encoded) address, and `timestamp` is the same decimal. The hash is
hex in the signed message but base64url in the payload.

To verify independently:

1. Fetch `https://<host>/.well-known/public-keys.json`.
2. Look up `keys[kid].publicKey` (base64 SPKI DER; the raw 32-byte Ed25519 key is
   the last 32 bytes). Reject if the key id is absent.
3. SHA-256 the file and compare it with the payload hash.
4. Rebuild the message and verify the Ed25519 signature.

Key document:

```json
{
  "current": "<kid>",
  "keys": {
    "<kid>": { "keyId": "<kid>", "algorithm": "Ed25519", "publicKey": "<base64 SPKI DER>" }
  }
}
```

The in-app verifier does this in the browser and caches the key set for offline
use. It never trusts a key carried inside the QR code.

### Version 3: the account holder's own signature

When the browser can hold a key, records are version 3 and carry two
signatures:

```
3~<kid>~<hash>~<email>~<timestamp>~<signature>~<ukey>~<usig>
```

| Field | Meaning |
|-------|---------|
| `ukey` | base64url raw 32-byte Ed25519 public key held by the account holder (43 chars) |
| `usig` | base64url Ed25519 signature by that key over `<hash_hex>:<email>:<timestamp>` (86 chars) |
| `signature` | the service's countersignature, now over `<hash_hex>:<email>:<timestamp>:<ukey>:<usig>` |

The key is generated in the browser with WebCrypto as a non-extractable
Ed25519 key and stored in IndexedDB. The private half never leaves the device
and the service never sees it: the browser signs, the service verifies that
signature, then countersigns. A verifier checks both. A version 3 record
therefore proves that whoever held `ukey` approved exactly this statement,
not only that the service says so.

What it does not prove on its own is that `ukey` belongs to the person behind
the email: the service asserts that binding at signing time (the key was
presented in a session logged in as that account). The upload page shows your
key so you can publish it somewhere you control, which gives verifiers an
independent binding. Each browser has its own key; records name the key that
signed them. Browsers without WebCrypto Ed25519 fall back to version 2
(service attestation only) and the verifier says so.

Optional endpoints:

- `GET /api/sig/<signature>` returns the stored record `{v,h,e,t,s,k}` when
  storage is configured. The core flow does not need it. `/sig/<signature>` is
  the human-readable page for the same record.
- `POST /api/verify` with JSON `{h,e,t,s,k}` returns `{valid, keyId}` for
  server-side verification. Rate limited.

The verify page also accepts a photo or screenshot of a QR code and decodes it
in the browser.

## Transparency log

Every issued record is appended to an append-only log. A Merkle tree
(RFC 6962: leaf hash `SHA-256(0x00 || record)`, node hash
`SHA-256(0x01 || left || right)`, leaf data is the encoded record string) is
built over it and the service signs the tree head with its current key.

- `GET /api/log/head` → `{size, root, timestamp, keyId, signature}` where
  `signature` is Ed25519 over the UTF-8 string
  `contentproof-log/v1\n<size>\n<root>\n<timestamp>`.
- `GET /api/log/entries?from=0&limit=100` → a page of encoded records, so the
  whole log can be mirrored and the root recomputed.
- `GET /api/log/proof?index=N` or `?signature=<s>` → an inclusion proof
  `{index, size, root, leaf, proof[]}` (audit path, hex, leaf to root).

What this gives you: the service cannot quietly remove, alter or back-date a
record once a tree head covering it has been seen by anyone. The verify page
checks the inclusion proof and the head signature after a successful
verification. To make the guarantee bite, tree heads must be archived
somewhere the service does not control: the workflow
`.github/workflows/archive-log-head.yml` commits the head to this repository
daily once the repository variable `CONTENTPROOF_BASE_URL` is set. Anyone can
do the same.

What it does not give you: proof that the account holder asked for the
record. See `documentation/adr/0001-per-user-keys-and-sigstore.md` for the
options and why they are a product decision.

Storage note: the log lives in the same Redis as the records. Without Redis it
is in-memory and lost on restart, which is fine for development only.

Legacy QR codes made before this format used `?data=<base64url JSON>`. They are
accepted only when the key they carry matches a published key, and the verifier
asks for the signer email.

Any file type is accepted, up to 500 MB, hashed in the browser in chunks.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open <http://localhost:3000>.

Generate a signing keypair:

```bash
node -e "const{generateKeyPairSync:g}=require('crypto');const{privateKey:a,publicKey:b}=g('ed25519');console.log('ED25519_PRIVATE_KEY='+a.export({type:'pkcs8',format:'der'}).toString('base64'));console.log('ED25519_PUBLIC_KEY='+b.export({type:'spki',format:'der'}).toString('base64'))"
```

## Environment variables

Required:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google OAuth credentials.
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`: session secret and public base URL.
- `ED25519_PRIVATE_KEY`: base64 PKCS#8 DER.
- `ED25519_PUBLIC_KEY`: base64 SPKI DER.

In production the app refuses to sign if the keys are missing. In development it
generates a throwaway keypair.

Optional:

- `ED25519_PUBLIC_KEYS_PREVIOUS`: comma-separated base64 SPKI DER keys still
  accepted for verification after rotation.
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`): record storage and shared rate limiting. Falls
  back to in-memory.
- `ALLOWED_EMAIL_DOMAINS`: comma-separated; unset allows all.
- `DEBUG_AUTH=true` with `DEBUG_AUTH_EMAIL`: development-only sign-in bypass,
  ignored in production. Set `NEXT_PUBLIC_DEBUG_AUTH=true` so the sign-in button
  uses it.
- `NEXT_PUBLIC_VERIFY_BASE_URL`: base URL used in QR codes.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`: Google Analytics.

## Scripts

- `npm run dev`: development server
- `npm run build`: production build
- `npm start`: run the production build
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript check
- `npm test`: unit tests

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test and build.

Regenerate `package-lock.json` with npm 10 (`npx npm@10 install
--package-lock-only`), which is what CI and Vercel run. npm 12 omits optional
platform packages from the lockfile and `npm ci` on npm 10 then refuses it.

## Deployment

Deploy on [Vercel](https://vercel.com/) with `npm run deploy` (runs the Vercel
CLI via `npx`; the CLI is not a project dependency), or build locally with
`npm run build` and `npm start`. Set the required environment variables in
the host. Keep `ED25519_PRIVATE_KEY` secret; the public key is published at
`/.well-known/public-keys.json`. To rotate, set a new keypair and move the old
public key into `ED25519_PUBLIC_KEYS_PREVIOUS`.

More detail is in [documentation](./documentation).
