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

To verify in your own code, import or vendor `src/lib/verifier/index.ts`
(with the few `src/lib` modules it imports: `record`, `keyset`,
`keyset-client`, `crypto/verify`, `verify-input`, `base64`, `hash-stream`;
point the `@/` alias at wherever you place them). It has no Next,
Node or DOM dependencies, only `@noble/hashes` and `@noble/curves`, and runs
in browsers, Node 18+ and edge runtimes:

```ts
import { verifyFile, parseRecordInput, verifyRecordAgainstHash } from "@/lib/verifier";

// Parses a compact record, a verification link or a pasted/wrapped form,
// streams the file through SHA-256 and fetches the published keys.
const result = await verifyFile(linkOrRecord, file, { baseUrl: "https://www.contentproof.app" });
// { ok, keyId, userSigned, userKey, reason, record, fileHash, inputError? }
```

Keys come only from `options.keys` or `${baseUrl}/.well-known/public-keys.json`,
never from the record. Unparseable input returns `reason: "malformed"` with an
`inputError`; keys that cannot be loaded throw, so an outage is never reported
as `unknown-key`. Legacy pre-version-2 payloads are rejected; the verify page
still handles them.

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
- `POST /api/verify` verifies a record server-side and returns
  `{valid, keyId, userSigned, userKey, reason}`. Rate limited (60 per minute
  per IP), CORS enabled. The body is one of:
  - the record as a JSON object `{v,k,h,e,t,s}` (plus `u`,`us` for version 3),
    where `v` and `t` must be JSON numbers;
  - `{"record": "<compact record or verification link>"}`, accepting the same
    pasted forms as the verify page (`2~…`/`3~…`, a full link, a bare `#P=`
    fragment, wrapped in quotes or `<>`).

  Either form may add `"fileHash"`, the file's SHA-256 as 64 hex characters.
  The server never sees the file: without `fileHash` a `valid: true` only
  means the service issued the record, and you must still compare its hash
  with your file; with it the comparison happens here and a different file
  returns `valid: false, reason: "hash-mismatch"`. `reason` is otherwise one
  of `unknown-key`, `bad-signature`, `bad-user-signature` or `malformed`.
  An unparseable `record`, a legacy payload or a malformed `fileHash` returns
  400 with `{error}`.

  ```sh
  # A verification link (or compact record) plus the file's hash
  curl -s https://www.contentproof.app/api/verify \
    -H 'content-type: application/json' \
    -d "{\"record\": \"https://www.contentproof.app/verify#P=2~…\", \"fileHash\": \"$(shasum -a 256 photo.jpg | cut -d' ' -f1)\"}"

  # The JSON object form, record only
  curl -s https://www.contentproof.app/api/verify \
    -H 'content-type: application/json' \
    -d '{"v":2,"k":"…","h":"…","e":"you@example.com","t":1760000000000,"s":"…"}'
  # → {"valid":true,"keyId":"…","userSigned":false,"userKey":null,"reason":null}
  ```
- `GET /api/health` returns
  `{ok, storage: {durable, backend}, log: {size}, keyId}`. `backend` is
  `"redis"` or `"memory"`; `durable: false` means records and the
  transparency log are lost on restart (no Upstash/KV variables set, which
  production also reports once with a loud `console.error`). `keyId` is the
  current signing key, or `null` if keys are not configured. If the log size
  cannot be read, `log` is `{size: null, error: "unavailable"}`. Always 200,
  `Cache-Control: no-store`, rate limited, CORS enabled.

Unknown `/api/*` paths return a JSON 404. Every response carries a
Content-Security-Policy and the usual security headers (`next.config.ts`),
and the retired `*.vercel.app` production hostnames redirect to
`www.contentproof.app`.

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
- `GET /api/log/entries?from=0&limit=100` → `{from, limit, size, entries[]}`
  where each entry is `{index, leafHash, h, t, k, v}`: the Merkle leaf hash,
  the file hash, the time, the service key id and the record version. The
  feed deliberately omits emails, account holder keys and signatures so it
  cannot be used to enumerate who signed what, but the leaf hashes let anyone
  mirror the log and recompute the root. Whoever holds a record can check it
  against `leafHash` (`SHA-256(0x00 || encoded record)`).
- `GET /api/log/proof?index=N` or `?signature=<s>` → an inclusion proof
  `{index, size, root, leafHash, proof[], head}` (audit path, hex, leaf to
  root). `head` is a signed tree head over exactly that tree, so a proof
  verifies on its own: walk the path to `root`, then check `head.signature`
  and that `head.size` and `head.root` match.
- `GET /api/log/consistency?from=M` (optionally `&to=N`) → an RFC 6962
  consistency proof `{from, to, proof[], head}` that the tree of size `M`
  (say, a head you archived last month) is a prefix of the current tree.
  `head` is a freshly signed head for size `to`. The service only signs the
  current tree, so `to` defaults to the current size and any other value is
  answered with 400 and `{error, size}`. The proof is empty when `M` is 0 or
  equals `to`. Check it with `verifyConsistencyResponse(oldHead, response,
  keys)` from `src/lib/log-verify.ts` (RFC 9162 §2.1.4.2), which also checks
  both head signatures.

All four are rate limited per client IP and answer with permissive CORS.

The server keeps each entry's leaf hash in a parallel Redis list
(`log:leaves`) written in the same script as the entry, and an incremental
tree in memory, so a head or proof reads only the leaves appended since the
last request rather than the whole log. Logs written before the leaf list
existed are backfilled from the records on first read.

What this gives you: the service cannot quietly remove, alter or back-date a
record once a tree head covering it has been seen by anyone. The verify page
checks the inclusion proof and the head signature after a successful
verification. To make the guarantee bite, tree heads must be archived
somewhere the service does not control: the workflow
`.github/workflows/archive-log-head.yml` commits the head to this repository
daily once the repository variable `CONTENTPROOF_BASE_URL` is set. Before
committing, it runs `scripts/verify-log-head.mjs`, which checks the new head's
signature against `/.well-known/public-keys.json` and fetches a consistency
proof from the previously archived head; the job fails, and commits nothing,
if either check fails or cannot be completed. Anyone can do the same with
plain Node (18+, no dependencies); it exits 1 on a failed check and 3 when
the service could not be reached:

```bash
node scripts/verify-log-head.mjs --base-url https://contentproof.app new-head.json [previous-head.json]
```

What it does not give you: proof that the account holder asked for the
record. See `documentation/adr/0001-per-user-keys-and-sigstore.md` for the
options and why they are a product decision.

Storage note: the log lives in the same Redis as the records. Without Redis it
is in-memory and lost on restart, which is fine for development only.

Legacy QR codes made before this format used `?data=<base64url JSON>`. They are
accepted only when the key they carry matches a published key, and the verifier
asks for the signer email.

Any file type is accepted, up to 500 MB, hashed in the browser in chunks.

## Account: records and signing keys

The `/account` page (signed in) lists the account's records and the browser
keys it has signed with.

- `GET /api/account/records?limit=20&cursor=` → `{records: [{record,
  logIndex?}], nextCursor}`, newest first, at most 50 per page. Records are
  indexed by lowercased email when stored (Redis sorted set
  `sigs:email:<email>` scored by `t`) and expire with the record after 365
  days. Pass `nextCursor` back as `cursor` for the next page. Records issued
  before the index existed are not backfilled, so they are not listed.
- `GET /api/account/keys` → `{keys: [{publicKey, firstSeen, lastSeen,
  revokedAt?}]}`.
- `POST /api/account/keys/revoke` `{publicKey}` → `{key}`. Permanent. Only
  the account's own keys can be revoked (404 otherwise).

These three need a session and are same-origin only (no CORS).

The service records each browser key the first time it countersigns with it
(Redis hash `ukeys:<email>`, plus `ukey:<publicKey>` → `{email, revokedAt?}`),
and pins it to that account. `POST /api/sign` then refuses, with 403, a
version 3 request whose key is revoked or registered to another account. Any
other registry failure is logged and signing goes ahead.

- `GET /api/keys/user/<publicKey>` → `{publicKey, known, revokedAt}` (public,
  CORS, rate limited per IP). It never reveals which account a key belongs
  to. Revoking a key does not invalidate records it already signed; a verifier
  can compare `revokedAt` with the record's time. `fetchUserKeyStatus` in
  `src/lib/user-key-status.ts` is a browser-safe client for it.

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
  ignored in production. Set `NEXT_PUBLIC_DEBUG_AUTH=true` alongside it: the
  server-side `DEBUG_AUTH` registers the debug provider, and the public flag
  only tells the sign-in button to call it. The public flag alone grants
  nothing; the button falls back to Google.
- `NEXT_PUBLIC_VERIFY_BASE_URL`: base URL used in QR codes.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`: Google Analytics measurement ID. Unset or empty
  uses ContentProof's own ID; set it to `off` to disable GA in a fork. GA only ever loads on the production hostnames (`contentproof.app`,
  `www.contentproof.app`). Visitors in the EU, EEA, UK and Switzerland, or
  whose country is unknown, see a consent banner first and GA loads only if
  they accept; everyone else gets GA as disclosed in the privacy policy. The
  region comes from `GET /api/consent-region` (`{consentRequired}`, from
  Vercel's `x-vercel-ip-country` header; the list is in
  `src/lib/consent-region.ts`). A choice is stored in localStorage under
  `contentproof.analytics-consent.v1`, and declining keeps the gtag script
  from loading at all.

## Scripts

- `npm run dev`: development server on localhost
- `npm run dev:debug`: development server with the Node inspector enabled
  (on 127.0.0.1:9229) and the app listening on all interfaces (`0.0.0.0`) so
  other devices, such as a phone scanning QR codes, can reach it. Anyone on
  the network can then use the `DEBUG_AUTH` sign-in bypass if it is enabled,
  so only use it on a network you trust.
- `npm run deploy`: production deploy with a pinned Vercel CLI
- `npm run build`: production build
- `npm start`: run the production build
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript check
- `npm test`: unit tests
- `npm run test:redis`: Redis integration tests against a real Redis (see
  below)

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test and build.

Regenerate `package-lock.json` with npm 10 (`npx npm@10 install
--package-lock-only`), which is what CI and Vercel run. npm 12 omits optional
platform packages from the lockfile and `npm ci` on npm 10 then refuses it.

## Redis integration tests

The unit tests use in-memory fakes for Redis. `npm run test:redis` runs
`src/lib/redis.integration.test.ts` against a real Redis server through the real
`@upstash/redis` client and the Upstash REST protocol, so the Lua scripts,
cjson, MULTI/EXEC and nil handling are what production runs. They cover the
log store (including 100 concurrent appends and the upgrade of a log written
before leaf hashes were stored), signed heads and proofs, the rate limiter,
the record store and the key registry.

With no further setup the script starts a private `redis-server` (it must be
on the `PATH`; no persistence) and `scripts/upstash-rest-shim.mjs`, a small
stand-in for the Upstash REST API, runs the tests, and stops both. Ports
default to 6390 for Redis and 8079 for the shim; override them with
`REDIS_TEST_REDIS_PORT` and `REDIS_TEST_SHIM_PORT`.

To run against something else that speaks the Upstash REST protocol, such as
a throwaway Upstash database or the official emulator
(`hiett/serverless-redis-http`), set its URL and token:

```bash
REDIS_TEST_URL=https://<db>.upstash.io REDIS_TEST_TOKEN=<token> npm run test:redis
```

The tests run `FLUSHDB` before each one, so use a dedicated database with
nothing in it you want to keep, and keep all Redis integration tests in that
one file (two files running in parallel would flush each other's data).
Without `REDIS_TEST_URL` and `REDIS_TEST_TOKEN` they are skipped, so
`npm test` and CI do not need Redis.

## Deployment

Deploy on [Vercel](https://vercel.com/) with `npm run deploy` (runs a pinned
version of the Vercel CLI via `npx`; the CLI is not a project dependency, so
bump the version in `package.json` deliberately), or build locally with
`npm run build` and `npm start`. Set the required environment variables in
the host. Keep `ED25519_PRIVATE_KEY` secret; the public key is published at
`/.well-known/public-keys.json`. To rotate, set a new keypair and move the old
public key into `ED25519_PUBLIC_KEYS_PREVIOUS`.

## End-to-end tests on a preview

Google sign-in cannot be scripted, so automated tests on a Vercel preview
use a separate password login, `preview-test`. It signs in
`<name>@preview.contentproof.test` accounts. It only exists when every
safeguard below holds, and each is re-checked on every login
(`src/lib/auth/preview-test-auth.ts`):

- `VERCEL_ENV` is `preview`;
- `PREVIEW_TEST_AUTH_SECRET` is set, at least 32 characters, and presented by
  the caller;
- `PREVIEW_TEST_AUTH_ISOLATED=yes` is set;
- the preview's signing key is not a production key (not in
  `src/lib/production-keys.json` and not in the live
  `www.contentproof.app` key document, and if that cannot be fetched the
  login is refused);
- the request is not to a production hostname.

Outside a preview, test addresses are never allowed and their sessions are
dropped.

### One-time setup in Vercel

Set these in Project Settings → Environment Variables, scoped to **Preview
only**:

1. `ED25519_PRIVATE_KEY` and `ED25519_PUBLIC_KEY`: a new key pair just for
   previews (the one-liner under "Getting started"). Test records then never
   verify as production attestations.
2. The Redis variables (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or the
   `UPSTASH_*` pair), pointing at a separate Upstash database. The
   transparency log is permanent, so test records must never reach the
   production one. The Upstash integration usually adds its variables to every
   environment, so override them for Preview.
3. `NEXTAUTH_SECRET`: a different value from production, so a preview session
   cookie is meaningless to production.
4. `PREVIEW_TEST_AUTH_SECRET`: a random value of 32+ characters
   (`openssl rand -base64 32`).
5. `PREVIEW_TEST_AUTH_ISOLATED=yes`: your confirmation of points 2 and 3, which
   code cannot check.

Then enable Deployment Protection → **Protection Bypass for Automation**, and
redeploy the preview (environment variable changes need a new deployment).

### Running the tests

```bash
export E2E_BASE_URL=https://<project>-git-<branch>-<team>.vercel.app
export E2E_AUTH_PROVIDER=preview-test
export E2E_AUTH_SECRET=<PREVIEW_TEST_AUTH_SECRET>
export E2E_VERCEL_BYPASS=<protection bypass secret>
npx vitest run src/e2e          # API flow: sign, verify, log proofs
node scripts/e2e-browser.mjs    # browser flow: upload, verify, account, revoke
```

The browser script needs Playwright (`npm i --no-save playwright && npx
playwright install chromium`). Set `E2E_SCREENSHOTS=<dir>` to keep a
screenshot of each step. Both tests also run against a local dev server
started with `DEBUG_AUTH=true` and `NEXT_PUBLIC_DEBUG_AUTH=true`, with only
`E2E_BASE_URL` set.

More detail is in [documentation](./documentation).
