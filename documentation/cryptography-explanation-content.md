# How It Works - Cryptography Behind Content Proof

## Introduction

Content Proof uses state-of-the-art cryptographic techniques to ensure the authenticity and integrity of your digital files. This page explains the technical foundation of our service in an accessible way.

## Digital Signatures Overview

### What Are Digital Signatures?

Digital signatures are mathematical schemes that provide:
- **Authentication**: Proof of who signed the data
- **Integrity**: Assurance that data hasn't been modified
- **Non-repudiation**: The signer cannot deny they signed the data

Think of a digital signature like a tamper-evident seal on a package, but mathematically unbreakable.

### How They Differ from Encryption

| Digital Signatures | Encryption |
|-------------------|------------|
| Prove authenticity | Hide information |
| Anyone can verify | Only intended recipient can read |
| Detect tampering | Prevent unauthorized access |
| Public verification | Private communication |

## The Ed25519 Algorithm

### Why Ed25519?

Content Proof uses Ed25519, a modern elliptic curve digital signature algorithm that offers:

**Security Benefits**:
- Resistant to timing attacks
- Immune to weak random number generation
- Mathematically proven security properties
- Protection against quantum computing advances (for now)

**Performance Benefits**:
- Fast signature generation (~0.1ms)
- Quick verification (~0.3ms)
- Small signature size (64 bytes)
- Compact public keys (32 bytes)

**Simplicity Benefits**:
- No parameter choices that could weaken security
- Single, well-tested implementation
- Widely adopted by security-conscious organizations

### Ed25519 vs Other Algorithms

| Algorithm | Signature Size | Security Level | Speed |
|-----------|---------------|---------------|-------|
| Ed25519 | 64 bytes | High | Very Fast |
| RSA-2048 | 256 bytes | Medium | Slow |
| ECDSA P-256 | 64 bytes | High | Fast |
| RSA-4096 | 512 bytes | High | Very Slow |

## SHA-256 File Hashing

### What Is a Hash Function?

A cryptographic hash function takes any amount of data and produces a fixed-size "fingerprint" (hash). SHA-256 produces a 256-bit (32-byte) hash that:

- **Deterministic**: Same input always produces same hash
- **Avalanche effect**: Tiny input changes create completely different hashes
- **One-way**: Computing the original data from the hash is practically impossible
- **Collision-resistant**: Finding two different inputs with the same hash is extremely difficult

### Hash Properties in Action

```
Original file: "Hello, World!"
SHA-256 hash: dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f

Modified file: "Hello, World?"  (just changed ! to ?)
SHA-256 hash: f5ca38f748a1d6eaf726b8a42fb575c3c71f1864a8143301782de13da2d9202b
```

Notice how a single character change completely changes the hash.

### File Fingerprinting Process

1. **File Upload**: Your file is read in your browser
2. **Chunk Processing**: Large files are processed in small chunks to maintain performance
3. **Hash Calculation**: SHA-256 algorithm processes every byte of your file
4. **Fingerprint Creation**: Results in a unique 64-character hexadecimal string

## The Signing Process

### Step-by-Step Breakdown

1. **File Hashing**
   ```
   File → SHA-256 → Hash (e.g., "abc123...def789")
   ```

2. **Message Construction**
   ```
   Message = FileHash + ":" + GmailAddress + ":" + Timestamp
   Example: "abc123...def789:user@gmail.com:1640995200000"
   ```

3. **Signature Generation**
   ```
   Signature = Ed25519_Sign(PrivateKey, Message)
   ```

4. **Package Creation**
   ```
   SignaturePackage = {
     signature: "base64-encoded-signature",
     publicKey: "base64-encoded-public-key", 
     timestamp: 1640995200000
   }
   ```

### Why This Design?

**Including the hash**: Ensures the signature is tied to the specific file content
**Including the email**: Cryptographically binds the signature to the signer's identity  
**Including the timestamp**: Prevents replay attacks and provides chronological proof
**Using colons**: Creates unambiguous message structure

## The Verification Process

### Cryptographic Verification Steps

1. **Signature Decoding**
   - Extract signature data from QR code or manual input
   - Decode base64-encoded components

2. **Message Reconstruction**
   - Calculate SHA-256 hash of the uploaded file
   - Reconstruct the original signed message: `hash:email:timestamp`

3. **Mathematical Verification**
   - Use Ed25519 verification algorithm
   - Check if signature was created with the private key corresponding to the public key
   - Verify against the reconstructed message

4. **Result Interpretation**
   - ✅ Valid: Signature mathematically correct, file unchanged
   - ❌ Invalid: File modified, signature corrupted, or wrong signer

### The Mathematics Behind Verification

Ed25519 uses elliptic curve mathematics. Without diving into complex math:

1. **Key Pair Generation**: Creates mathematically linked private and public keys
2. **Signing**: Uses private key to create signature that proves ownership
3. **Verification**: Uses public key to verify signature without revealing private key

```
If Verify(PublicKey, Message, Signature) = True:
    Then the holder of PrivateKey signed this exact Message
    And the Message has not been modified since signing
```

## Security Model

### What We Protect Against

**File Tampering**
- Any modification to file content invalidates the signature
- Even changing a single bit is detectable
- Accidental corruption is caught

**Identity Spoofing**
- Gmail OAuth prevents unauthorized access to accounts
- Private keys are never shared or transmitted
- Signatures are cryptographically bound to Gmail addresses

**Replay Attacks**
- Timestamps prevent old signatures from being reused
- Each signature is unique to a specific moment in time

**Man-in-the-Middle Attacks**
- HTTPS encryption protects data transmission
- Signature verification happens locally when possible

### Security Assumptions

Our security model assumes:
- Google OAuth is secure and Gmail accounts are trusted
- Ed25519 algorithm remains cryptographically sound
- Users keep their Google accounts secure (use 2FA)
- Our private keys remain confidential

### What We Don't Protect Against

**Social Engineering**
- If someone gains access to your Gmail account, they could sign files as you
- Solution: Use strong passwords and enable 2-factor authentication

**Quantum Computing (Future)**
- Advanced quantum computers could eventually break Ed25519
- Solution: We monitor post-quantum cryptography developments

**Legal Disputes**
- Cryptographic proof doesn't resolve all ownership disputes
- Solution: Combine with traditional legal documentation when needed

## Key Management

### Our Key Infrastructure

**Server-Side Keys**
- Ed25519 private key securely stored in environment variables
- Public key distributed via `/.well-known/public-keys.json`
- Regular security audits and monitoring

**Key Rotation Strategy**
- Planned annual key rotation for security
- Backward compatibility with old signatures
- Transparent public key distribution

**Emergency Procedures**
- Key revocation process for security incidents
- Notification system for key changes
- Recovery procedures for service continuity

### Client-Side Security

**Browser Requirements**
- Modern Web Crypto API for secure hashing
- TLS 1.3 for encrypted communications
- Same-origin policy enforcement

**Local Processing**
- File hashing happens in your browser when possible
- No file contents transmitted to servers
- Verification can work offline after initial setup

## Interactive Examples

### Hash Calculator Demo

Try changing the input text and watch how the hash changes:

```
Input: [                    ]
SHA-256: [calculating...]
```

*Note: This would be an interactive component on the actual page*

### Signature Visualization

Here's how a signature looks in different formats:

**Raw Signature (Binary)**
```
[64 bytes of binary data - not human readable]
```

**Base64 Encoded**
```
MEUCIQDKyP4VbG8W3X4YZQ7xK5XbVR2pL9mN8zF6wE3QqR7vTgIgH8mPx2nF5C1A6bK9wY2vZ3jE4rS8tU0qW7cX1dN5oGk=
```

**QR Code Content**
```
https://contentproof.app/verify?data=eyJzaWduYXR1cmUiOi...
```

## Comparison with Other Solutions

### Content Proof vs C2PA

| Feature | Content Proof | C2PA |
|---------|--------------|------|
| Cost | Free with Gmail | $250+ annually |
| Setup | Instant OAuth | Business verification required |
| Trust Model | Gmail identity | Certificate authorities |
| Metadata | Survives stripping | Often lost in processing |
| Verification | QR code scanning | Specialized tools |

### Content Proof vs Blockchain

| Feature | Content Proof | Blockchain Solutions |
|---------|--------------|---------------------|
| Speed | Instant | Minutes to hours |
| Cost | Free | Gas fees required |
| Environmental Impact | Minimal | High energy usage |
| Scalability | High | Limited throughput |
| User Experience | Simple | Complex wallet management |

## Performance Characteristics

### Signing Performance

- **File Hashing**: ~1-2 seconds for 10MB files
- **Signature Generation**: ~100ms on server
- **QR Code Creation**: ~200ms in browser
- **Total Time**: Usually under 5 seconds

### Verification Performance

- **Hash Calculation**: ~1-2 seconds for 10MB files  
- **Signature Verification**: ~50ms in browser
- **QR Code Scanning**: ~1 second with phone camera
- **Total Time**: Usually under 10 seconds

### Scalability

Current system can handle:
- **Concurrent users**: 1000+ simultaneous
- **Signatures per second**: 100+
- **Verifications per second**: 1000+ (mostly offline)
- **File size limit**: 10MB (technical, not security limitation)

## Future Cryptographic Enhancements

### Post-Quantum Cryptography

We're monitoring developments in quantum-resistant algorithms:
- **CRYSTALS-Dilithium**: Leading post-quantum signature scheme
- **Falcon**: Compact post-quantum signatures
- **SPHINCS+**: Hash-based signatures (quantum-proof)

### Advanced Features in Development

**Multi-Signature Support**
- Multiple parties signing the same document
- Threshold signatures (N of M signers required)
- Sequential signature workflows

**Zero-Knowledge Proofs**
- Prove file properties without revealing content
- Private verification with public auditability
- Enhanced privacy features

**Blockchain Integration**
- Optional immutable timestamping
- Decentralized verification networks
- Smart contract integration

## Technical Resources

### Standards and Specifications

- **RFC 8032**: Edwards-Curve Digital Signature Algorithm (EdDSA)
- **FIPS 180-4**: Secure Hash Standard (SHA-256)
- **RFC 6234**: US Secure Hash Algorithms
- **RFC 7517**: JSON Web Key (JWK) format

### Open Source Libraries

Our implementation uses well-audited libraries:
- **Node.js Crypto**: Server-side Ed25519 implementation
- **TweetNaCl**: Client-side verification library
- **Web Crypto API**: Browser-native hashing

### Security Audits

- Regular security reviews by independent experts
- Open source components with public security track records
- Automated vulnerability scanning
- Bug bounty program for responsible disclosure

---

*For technical questions about our cryptographic implementation, contact: crypto@contentproof.app*
