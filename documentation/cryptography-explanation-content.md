# How It Works - Cryptography Behind Content Proof

## Introduction

Content Proof is an attestation (notary) service. It uses SHA-256 to fingerprint your file in your browser and an Ed25519 digital signature, made by the ContentProof server key, to attest that your Google account submitted that fingerprint at a particular time. This page explains each piece and exactly what the result does and does not prove.

## The trust model

A valid Content Proof record means:

> The ContentProof service attests that the Google account `<email>` submitted the SHA-256 hash `<hash>` at time `<timestamp>`.

Things to understand:

- **ContentProof signs, not you.** You hold no key. The ContentProof server key signs every record after checking your Google sign-in.
- **No non-repudiation by the user.** The signature shows what the service attests, not that you personally signed anything.
- **A verifier trusts ContentProof's published key.** Verification checks the signature against the key set published at `/.well-known/public-keys.json`. If you trust that key and the sign-in check, you can trust the record.
- **Your file never leaves your browser.** Only its SHA-256 hash is sent to the server.
- **It is not proof of authorship.** It shows who submitted a hash and when, not who created the file.

## Digital signatures overview

### What are digital signatures?

A digital signature is a mathematical scheme that lets anyone holding a public key check that a message was signed by the matching private key. It provides:

- **Authentication**: the message came from the holder of the private key. Here, that is the ContentProof service.
- **Integrity**: the message has not been modified since signing.

### How they differ from encryption

| Digital signatures | Encryption |
|-------------------|------------|
| Prove who signed | Hide information |
| Anyone can verify | Only the intended recipient can read |
| Detect tampering with the signed message | Prevent unauthorized access |
| Public verification | Private communication |

## The Ed25519 algorithm

### Why Ed25519?

Ed25519 is a modern elliptic curve signature algorithm (RFC 8032) that offers:

**Security**
- Designed to resist timing side channels
- Deterministic signatures, so weak random number generation cannot leak the key
- No parameter choices that could weaken security

**Performance**
- Fast signing and verification
- Small signatures (64 bytes)
- Compact public keys (32 bytes)

Ed25519 is not resistant to large-scale quantum computers. If post-quantum signatures become necessary, the format version field allows moving to a new scheme.

### Ed25519 vs other algorithms

| Algorithm | Signature size | Public key size |
|-----------|---------------|-----------------|
| Ed25519 | 64 bytes | 32 bytes |
| ECDSA P-256 | about 64 bytes | 33 to 65 bytes |
| RSA-2048 | 256 bytes | about 270 bytes |
| RSA-4096 | 512 bytes | about 550 bytes |

## SHA-256 file hashing

### What is a hash function?

A cryptographic hash function takes any amount of data and produces a fixed-size fingerprint. SHA-256 produces a 256-bit (32-byte) hash with these properties:

- **Deterministic**: the same input always produces the same hash
- **Avalanche effect**: tiny input changes create completely different hashes
- **One-way**: recovering the data from the hash is practically impossible
- **Collision-resistant**: finding two inputs with the same hash is extremely difficult

### Hash properties in action

```
Original file: "Hello, World!"
SHA-256 hash: dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f

Modified file: "Hello, World?"  (just changed ! to ?)
SHA-256 hash: f5ca38f748a1d6eaf726b8a42fb575c3c71f1864a8143301782de13da2d9202b
```

A single character change completely changes the hash.

### File fingerprinting process

1. **File selection**: your file is read in your browser and never uploaded.
2. **Chunked processing**: files up to 500 MB are read and hashed in chunks, so large files do not exhaust memory.
3. **Hash calculation**: SHA-256 processes every byte of the file.
4. **Fingerprint**: the result is a 32-byte digest, shown as 64 hexadecimal characters.

Any file type is accepted.

## The signing process

### Step-by-step

1. **Hash the file in the browser**
   ```
   File -> SHA-256 -> 32-byte digest
   ```

2. **Send the hash to the server.** The user must be signed in with Google. The server takes the email from the verified session and the time from its own clock.

3. **Build the message.** The signed message is this UTF-8 string:
   ```
   <hash_hex>:<email>:<timestamp>
   ```
   `hash_hex` is the digest as 64 lowercase hex characters, `email` is the raw Google account email, and `timestamp` is milliseconds since the Unix epoch in decimal.

4. **Sign with the ContentProof key**
   ```
   signature = Ed25519_Sign(ServerPrivateKey, message)
   ```

5. **Package the record.** The verification link is:
   ```
   https://<host>/verify#P=<payload>
   ```
   and the payload is six fields separated by tildes:
   ```
   2~<kid>~<hash>~<email>~<timestamp>~<signature>
   ```

| Field | Meaning |
|-------|---------|
| `2` | Format version |
| `kid` | Key id: first 16 characters of base64url(SHA-256(SPKI DER of the public key)) |
| `hash` | base64url, no padding, 43 characters, of the 32-byte digest |
| `email` | `encodeURIComponent(email)`, with any `~` also encoded as `%7E` |
| `timestamp` | Milliseconds since the Unix epoch, decimal |
| `signature` | base64url, no padding, 86 characters, of the 64-byte signature |

Note the hash is hex in the signed message but base64url in the payload.

The payload sits in the URL fragment (after `#`). Browsers never send the fragment to the server, so opening a verification link does not disclose the record to ContentProof.

### Why this design?

- **Including the hash** ties the signature to the exact file content.
- **Including the email** records which Google account the service saw submit the hash.
- **Including the timestamp** records when the service saw it. The time comes from the ContentProof server, not from the user.
- **Including a key id** lets verifiers pick the right key after rotation.
- **Colon separators** give an unambiguous message structure.

## The verification process

### Steps

An independent verifier can follow these steps without ContentProof software:

1. **Fetch the key set** from `https://<host>/.well-known/public-keys.json`:
   ```json
   {
     "current": "<kid>",
     "keys": {
       "<kid>": { "keyId": "<kid>", "algorithm": "Ed25519", "publicKey": "<base64 SPKI DER>" }
     }
   }
   ```
2. **Look up the key.** Find `keys[kid].publicKey`. It is base64 SPKI DER; the raw 32-byte Ed25519 key is the last 32 bytes. Reject the record if the key id is absent.
3. **Hash the file** with SHA-256 and compare it with the payload hash.
4. **Rebuild the message** `<hash_hex>:<email>:<timestamp>` and verify the Ed25519 signature with the public key.

The Content Proof verifier does this in your browser and caches the key set so it works offline once cached. It never trusts a key carried inside the QR code, because anyone could forge a QR code containing their own key.

### Results

- **Valid**: the signature matches a published ContentProof key and the file's hash matches the record.
- **Invalid**: the file was modified, the link was damaged, or the key id is not published.

### The mathematics behind verification

```
If Verify(PublicKey, Message, Signature) = True:
    Then the holder of the matching private key signed this exact Message
    And the Message has not been modified since signing
```

For Content Proof, the holder of the private key is the ContentProof service.

### Legacy QR codes

Codes created before this format used `?data=<base64url JSON>`. They are still accepted only when the key they carry matches a published key, and the verifier asks for the signer's email.

## Security model

### What the design protects against

**File tampering**
- Any change to the file changes its hash and fails verification.
- Accidental corruption is caught.

**Forged records**
- Without the ContentProof private key, nobody can produce a record that verifies against the published key set.
- Embedding an attacker's key in a QR code does not help, because verifiers only use published keys.

**Altered email or time**
- The email and timestamp are inside the signed message, so changing either breaks the signature.

**Eavesdropping on the link**
- The payload is in the URL fragment and is not sent to the server by the browser. HTTPS protects the key set and sign-in traffic.

### Security assumptions

- Google sign-in correctly identifies the account holder.
- Ed25519 and SHA-256 remain secure.
- The ContentProof private key stays confidential.
- The ContentProof server clock is accurate.

### What it does not protect against

**Compromised Google accounts**
- Anyone who controls your Google account can obtain attestations as you. Use strong passwords and two-step verification.

**Compromised service key**
- If the ContentProof private key leaks, an attacker could forge records. Key rotation limits the damage going forward, but records signed before a compromise cannot be told apart from forged ones by signature alone.

**Authorship and ownership disputes**
- A record shows who submitted a hash and when. It does not show who created the file. Combine it with other evidence when needed.

**Non-repudiation by the user**
- The user holds no key, so a signature cannot be used to show the user personally signed.

**Quantum computing**
- Ed25519 is not quantum-resistant.

## Key management

- The Ed25519 private key is supplied to the server through environment variables. In production the server refuses to sign if it is missing.
- The public keys are published at `/.well-known/public-keys.json`, with a `current` key id and a map of key ids to keys.
- When keys are rotated, previous public keys stay in the published set so older records continue to verify.
- The key id in each record selects the key to use.

### Client side

- File hashing uses the browser's Web Crypto API and runs locally.
- File contents are never transmitted to ContentProof.
- Verification works offline once the key set has been cached.

## Signature formats at a glance

**Raw signature**: 64 bytes of binary data.

**In the payload**: base64url without padding, 86 characters.

**QR code content**:
```
https://<host>/verify#P=2~<kid>~<hash>~<email>~<timestamp>~<signature>
```

## Comparison with other approaches

### Content Proof vs C2PA

| Feature | Content Proof | C2PA |
|---------|--------------|------|
| Where the proof lives | In a QR code or link, separate from the file | Embedded in file metadata |
| Who signs | ContentProof service key | Certificates held by the creator or tool |
| Trust anchor | ContentProof's published key | Certificate authorities |
| Survives metadata stripping | Yes, because it travels separately | Often lost in processing |
| Verification | Browser, with a QR code or link | Specialized tools |

### Content Proof vs blockchain timestamping

| Feature | Content Proof | Blockchain solutions |
|---------|--------------|---------------------|
| Speed | Immediate | Minutes to hours |
| Cost | Free | Fees required |
| Trust anchor | A single service key | Distributed ledger |
| Timestamp | Server clock, attested by ContentProof | Block time, independent of any one party |
| User experience | Sign in with Google | Wallet management |

## Technical resources

- **RFC 8032**: Edwards-Curve Digital Signature Algorithm (EdDSA)
- **FIPS 180-4**: Secure Hash Standard (SHA-256)
- **RFC 4648**: Base64url encoding
- **Web Crypto API**: browser-native hashing
- **Node.js crypto**: server-side Ed25519
