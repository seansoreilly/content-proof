# ContentProof

ContentProof is an attestation (notary) service. You sign in with Google, your
browser hashes a file with SHA-256, and the server returns a signature over that
hash made with the ContentProof Ed25519 key. The file never leaves your browser;
only its hash is sent.

A valid signature proves one thing: **the ContentProof service attests that the
Google account `<email>` submitted the SHA-256 hash `<hash>` at time
`<timestamp>`.** You hold no key, so this is not a signature by you and gives no
non-repudiation by the user. Anyone verifying is trusting ContentProof's
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

Optional endpoints, both rate limited:

- `GET /api/sig/<signature>` returns the stored record `{v,h,e,t,s,k}` when
  storage is configured. The core flow does not need it.
- `POST /api/verify` with JSON `{h,e,t,s,k}` returns `{valid, keyId}` for
  server-side verification.

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

## Deployment

Deploy on [Vercel](https://vercel.com/) with `vercel --prod`, or build locally
with `npm run build` and `npm start`. Set the required environment variables in
the host. Keep `ED25519_PRIVATE_KEY` secret; the public key is published at
`/.well-known/public-keys.json`. To rotate, set a new keypair and move the old
public key into `ED25519_PUBLIC_KEYS_PREVIOUS`.

More detail is in [documentation](./documentation).
