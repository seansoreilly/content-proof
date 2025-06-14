# ContentProof - Product Requirements Document

## Executive Summary

**Product Name:** ContentProof  
**Version:** 1.0  
**Platform:** Web Application (Next.js, TypeScript, React)  
**Infrastructure:** Vercel deployment  
**Development:** Cursor AI assisted development

ContentProof is a Gmail-based file authentication service that provides cryptographic proof of file integrity and signer identity. Users authenticate with Google OAuth, upload files, and receive Ed25519-based digital signatures that can be verified independently of the original file.

## Problem Statement

### Current Challenges

- **C2PA adoption barrier**: Traditional signing certificates cost $250+ annually
- **Trust gap**: Self-signed certificates are flagged as "unknown source"
- **Metadata fragility**: file metadata is stripped by iOS and social platforms
- **Individual exclusion**: C2PA ecosystem designed for institutions, not creators
- **Complexity**: Traditional certificate procurement requires business verification

### Target Users

- **Individual content creators** (photographers, influencers, journalists)
- **Small businesses** (real estate, e-commerce, marketing agencies)
- **Developers** building content verification into platforms

## Solution Overview

### Core Value Proposition

"Prove your content is real with Gmail-verified digital signatures"

### Key Innovation

- **Gmail-based trust model**: Leverage existing Google account reputation
- **Separate signature approach**: QR codes and signature files that survive metadata stripping
- **Ed25519 cryptography**: Modern, efficient digital signatures
- **Mobile-first verification**: Scan QR codes for instant verification

## Technical Architecture

### Technology Stack

```typescript
Frontend:
- Next.js (App Router)
- React
- TypeScript
- Tailwind CSS
- Lucide React (icons)

Backend:
- Next.js API Routes
- NextAuth.js (Google OAuth)
- Node.js Crypto (Ed25519)

Infrastructure:
- Vercel (deployment)
- Upstash Redis (rate limiting)

Development:
- Cursor AI (development assistance)
- GitHub (version control)
- Vercel CLI (deployment)
```

### Core Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React UI      │    │   API Routes    │    │   External      │
│   Components    │◄──►│   (Next.js)     │◄──►│   Services      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
    ┌───▼───┐                ┌───▼───┐                ┌───▼───┐
    │Upload │                │file  │                │Google │
    │ UI    │                │Hash + │                │OAuth  │
    └───────┘                │Sign   │                └───────┘
        │                    └───────┘                    │
    ┌───▼───┐                ┌───▼───┐                ┌───▼───┐
    │Verify │                │Ed25519│                │Vercel │
    │ UI    │                │Crypto │                │Storage│
    └───────┘                └───────┘                └───────┘
```

## Functional Requirements

### 1. User Authentication (Google OAuth)

#### 1.1 Sign In Flow

- **Trigger**: User clicks "Sign in with Google"
- **Process**: NextAuth.js OAuth flow with Google
- **Success**: User authenticated, session created
- **Failure**: Error message, retry option

#### 1.2 Account Evaluation

- **Gmail age**: Account creation date
- **Activity indicators**: Regular email usage patterns
- **Security features**: 2FA enabled status
- **Trust scoring**: Basic/Enhanced/Premium levels

```typescript
interface UserTrustLevel {
  level: "basic" | "enhanced" | "premium";
  gmailAge: number; // months
  has2FA: boolean;
  isWorkspace: boolean;
  score: number; // 0-100
}
```

### 2. file Signing Process

#### 2.1 File Upload

- **Supported formats**: all file formats
- **Size limit**: 10MB maximum
- **Validation**: File type, size, file integrity
- **UI**: Drag & drop with preview

#### 2.2 Hash Generation

- **Algorithm**: SHA-256
- **Input**: Complete file file buffer
- **Output**: 64-character hex string
- **Purpose**: Unique file fingerprint

#### 2.3 Signature Creation

```typescript
interface SignatureData {
  id: string; // UUID v4 – primary identifier
  v: string; // "1.0" – payload/format version
  h: string; // SHA-256 file hash (hex)
  e: string; // signer Gmail address
  t: string; // ISO 8601 timestamp
  s: string; // Ed25519 signature (Base64)
  pk: string; // public key identifier
  trustLevel?: UserTrustLevel; // optional – not embedded if it inflates QR size
}
```

#### 2.4 Ed25519 Implementation

```typescript
// Signature generation
const dataToSign = Buffer.concat([
  Buffer.from(fileHash, "hex"),
  Buffer.from(gmailAddress, "utf8"),
  Buffer.from(timestamp, "utf8"),
]);

const signature = crypto.sign(null, dataToSign, ed25519PrivateKey);
```

### 3. Signature Delivery Options

#### 3.1 Self-Contained QR Code (Primary Method)

```jsonc
// Raw signature record embedded in the QR (URL-safe Base64-encoded)
{
  "id": "e3f738a2-9d22-4e52-ba83-3b4b0d6bd25b", // UUID v4
  "v": "1.0",                                    // format version
  "h": "abc123...",                               // 64-char SHA-256 file hash
  "e": "user@gmail.com",                          // signer Gmail
  "t": "2024-02-01T12:34:56Z",                    // ISO timestamp
  "s": "base64-ed25519-signature",                 // 88-char Ed25519 sig
  "pk": "contentproof-2024-v1"                    // public-key identifier
}

// QR actually encodes this as a link so phone cameras open the verifier automatically
// (everything after #P= stays client-side and is never sent to the server):
https://contentproof.app/verify#P=<base64url(payload above)>
```

#### 3.2 QR Code Specifications

- **Content**: HTTPS link wrapping the self-contained signature payload in the URL fragment (`#P=`) so scanners launch the site while keeping data client-side.
- **Encoding**: Payload is JSON → Base64 → URL-safe (`+`→`-`, `/`→`_`, no padding).
- **Size**: ≥250 × 250 px (QR Version-10 recommended; size not critical since payload < 350 chars).
- **Error-correction**: Level **M** (15 %) for a balance of resilience and density.
- **Format**: PNG with ContentProof branding (monochrome for MVP).
- **Offline guarantee**: Because the fragment is never sent to the server, verification works fully offline once the public key JSON is cached.
- **Forward compatibility**: Record contains `id`, allowing future online lookup via `/sig/{id}` without changing existing QRs.

#### 3.3 Public Key Distribution

**Well-Known Endpoint:**

```
GET https://contentproof.app/.well-known/public-keys.json
{
  "current": "contentproof-2024-v1",
  "keys": {
    "contentproof-2024-v1": {
      "algorithm": "Ed25519",
      "publicKey": "base64-encoded-public-key",
      "created": "2024-01-01T00:00:00Z",
      "keyId": "contentproof-2024-v1"
    }
  }
}
```

### 4. Verification System

#### 4.1 Self-Contained QR Verification (Primary)

1. **Scan QR code** → extract embedded signature data
2. **Display signature info** (Gmail, timestamp, trust level)
3. **Upload file prompt** → user uploads file file
4. **Local verification** → JavaScript performs cryptographic verification
5. **No server dependency** → works offline with cached public key

#### 4.2 Independent Verification Process

```typescript
function verifyContentProofSignature(
  qrData: QRSignature,
  fileFile: File
): VerificationResult {
  // 1. Get ContentProof public key
  const publicKey = await getPublicKey(qrData.pk);

  // 2. Calculate file hash
  const fileHash = await sha256(fileFile);

  // 3. Verify hash matches
  if (fileHash !== qrData.h) {
    return { verified: false, error: "file hash mismatch" };
  }

  // 4. Verify Ed25519 signature
  const dataToVerify = Buffer.concat([
    Buffer.from(qrData.h, "hex"),
    Buffer.from(qrData.e, "utf8"),
    Buffer.from(qrData.t, "utf8"),
  ]);

  const isValid = crypto.verify(
    null,
    dataToVerify,
    publicKey,
    Buffer.from(qrData.s, "base64")
  );

  return {
    verified: isValid,
    gmailAddress: qrData.e,
    timestamp: qrData.t,
    publicKeyId: qrData.pk,
  };
}
```

#### 4.3 Enhanced Verification (Optional)

- **Fallback URL**: For rich UI experience and trust level display
- **Analytics**: Optional usage tracking (with user consent)
- **Trust scoring**: Display Gmail account evaluation
- **Batch verification**: Multiple signatures at once

## User Interface Requirements

### 1. Landing Page

```
Header: ContentProof logo + "Prove your content is real"
Hero: Large upload area + "Sign in with Google" button
Features: Three cards explaining signing, QR codes, verification
Footer: Links, privacy policy, terms
```

### 2. Signing Interface

```
User Status: "Signed in as user@gmail.com [Trust Level: Enhanced]"
Upload Area: Drag & drop with file preview
Output:
  - Download original file (unchanged)
  - Download QR verification code (self-contained)
  - Copy verification URL (optional enhanced experience)
Progress: Clear status messages and loading states
```

### 3. Verification Interface

```
Primary mode: QR code scanning with local verification
Secondary mode: Manual signature data entry

Verification process:
1. Scan/input QR data
2. Upload file file
3. Client-side cryptographic verification
4. Results display (no server dependency)

Results display:
- Verification status (✅/❌)
- Signer information
- Timestamp
- Public key information
- "Verified independently" messaging
```

## API Specifications

### 1. Authentication Endpoints

#### POST /api/auth/[...nextauth]

- **Purpose**: NextAuth.js OAuth flow
- **Provider**: Google OAuth 2.0
- **Response**: Session token

### 2. Signing Endpoints

#### POST /api/sign

```typescript
Request:
- Method: POST
- Content-Type: multipart/form-data
- Body: { file: File }
- Headers: Authorization (session)

Response:
{
  success: boolean;
  signatureData: SignatureData;
  qrCodeUrl?: string;
  error?: string;
}
```

### 3. Verification Endpoints

#### GET /.well-known/public-keys.json

```typescript
Response:
{
  current: string; // Current key ID
  keys: {
    [keyId: string]: {
      algorithm: "Ed25519";
      publicKey: string; // Base64 encoded
      created: string; // ISO timestamp
      validUntil?: string; // Optional expiry
    }
  }
}
```

#### POST /api/verify (Enhanced Experience)

```typescript
Request:
- Method: POST
- Content-Type: application/json
- Body: {
    qrData: QRSignature;
    fileHash: string; // Client-calculated
  }

Response:
{
  verified: boolean;
  trustLevel?: UserTrustLevel; // Enhanced data from database
  verificationCount?: number; // Usage analytics
  additionalInfo?: object;
}
```

#### GET /api/trust/{gmailAddress} (Optional)

```typescript
Response: {
  trustLevel: UserTrustLevel;
  signatureCount: number;
  firstSeen: string;
  reputation: number; // 0-100
}
```

### 4. Utility Endpoints

#### GET /api/qr/{signatureId}

```typescript
Response: PNG file (QR code)
```

## Security Requirements

### 1. Key Management & Distribution

- **Ed25519 key pair**: Primary signing key stored in Vercel environment variables
- **Public key distribution**: Available via `/.well-known/public-keys.json` endpoint
- **Key rotation**: Versioned keys with backward compatibility
- **Public verification**: Anyone can verify signatures independently
- **Decentralized trust**: No dependency on ContentProof service for verification

### 2. Self-Contained Signatures

- **QR code embedding**: Complete signature data in QR code (no external lookup required)
- **Offline verification**: Works without internet after initial public key caching
- **Tamper resistance**: Any modification to file or signature data fails verification
- **Cryptographic proof**: Ed25519 signature provides mathematical proof of authenticity

### 2. Authentication Security

- **OAuth scopes**: Minimal required (email, profile)
- **Session management**: NextAuth.js JWT tokens
- **CSRF protection**: Built into NextAuth.js
- **Rate limiting**: Upstash Redis for API endpoints

### 3. Input Validation

```typescript
// File validation
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["file/jpeg", "file/png", "file/gif", "file/webp"];

// Hash validation
const SHA256_REGEX = /^[a-f0-9]{64}$/i;

// Email validation
const GMAIL_REGEX = /^[^@]+@gmail\.com$/i;
```

### 4. Data Protection

- **No PII storage**: Only Gmail addresses (public identifiers)
- **Signature data**: Stored with automatic expiration (1 year)
- **File handling**: Process in memory, never store files
- **GDPR compliance**: Data deletion endpoints

## Database Schema

### Upstash Redis Key Design (MVP)

ContentProof stores only lightweight metadata needed for optional enhanced features; the core verification flow remains fully offline.

- `sig:{id}` → **Hash**

  - `data` : JSON string – full signature record (same payload embedded in the QR)
  - `ts` : ISO timestamp when the signature was created
  - `count` : integer – number of successful verifications (optional)

- `pk:current` → **String** – key ID of the currently active Ed25519 public key (e.g., `contentproof-2024-v1`)

- `pk:{keyId}` → **Hash**
  - `public` : Base64 public key
  - `algo` : "Ed25519"
  - `created`: ISO timestamp

TTL policies can be applied to `sig:{id}` hashes (e.g., 1-year expiry) to keep the data set compact. Upstash's REST API allows simple GET/SET calls directly from Edge Functions.

Note: The Redis store is **not** required for basic verification; it only powers future analytics, revocation, or trust-score lookups.

## Google analytics Requirements

```typescript
interface AnalyticsEvents {
  sign_file: {
    gmail_domain: string;
    trust_level: string;
    file_size: number;
    file_type: string;
  };

  verify_signature: {
    verification_method: "qr" | "upload";
    result: "valid" | "invalid" | "error";
    signature_age_days: number;
  };

  user_registration: {
    gmail_domain: string;
    trust_level: string;
  };
}
```

## Development Workflow

### 1. Cursor AI Integration

```typescript
// Cursor AI prompts for development
const developmentPrompts = {
  components:
    "Create React component for {feature} with TypeScript, Tailwind CSS, proper error handling",
  api: "Implement Next.js API route for {endpoint} with input validation, error handling, and TypeScript",
  crypto:
    "Add Ed25519 signature verification with proper error handling and security best practices",
  ui: "Design responsive UI component with loading states, error messages, and accessibility",
};
```

### 2. Git Workflow

```
main: Production-ready code
develop: Integration branch
feature/*: Feature development
hotfix/*: Production fixes

Cursor AI assists with:
- Code generation
- Bug fixing
- Refactoring
- Documentation
```

### 3. Deployment Pipeline

```
1. Development: Cursor AI + local Next.js
2. Testing: Jest + Playwright automated tests
3. Staging: Vercel preview deployments
4. Production: Vercel production deployment
5. Monitoring: Vercel Analytics + Sentry
```

## Testing Strategy

### 1. Unit Tests (Jest)

```typescript
// Example test structure
describe("Ed25519 Signature", () => {
  test("generates valid signature for file hash + Gmail + timestamp", () => {
    const result = signfileData(mockfileHash, mockEmail, mockTimestamp);
    expect(result.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(verifySignature(result)).toBe(true);
  });
});
```

### 2. Integration Tests (Playwright)

```typescript
// Example E2E test
test("complete signing flow", async ({ page }) => {
  await page.goto("/");
  await page.click('[data-testid="google-signin"]');
  await uploadTestfile(page);
  await page.click('[data-testid="sign-file"]');
  await expect(page.locator('[data-testid="signature-success"]')).toBeVisible();
});
```

### 3. Security Testing

- **Input validation**: Malformed files, oversized uploads
- **Authentication**: Session manipulation, OAuth edge cases
- **Cryptography**: Signature verification, key handling
- **Rate limiting**: API abuse prevention

## Success Metrics

### Technical KPIs

- **Signature generation time**: < 2 seconds average
- **Verification success rate**: > 95%
- **System uptime**: > 99.9%
- **API response time**: < 500ms p95

### Business KPIs

- **Monthly active users**: 1,000 by month 3
- **Signatures created**: 10,000 by month 6
- **Conversion to Pro**: 5% of active users
- **Developer signups**: 100 API users by month 6

### User Experience KPIs

- **Sign-up to first signature**: < 2 minutes
- **QR code scan success rate**: > 90%
- **User satisfaction**: > 4.5/5 rating
- **Support ticket volume**: < 1% of MAU

## Risk Mitigation

### Technical Risks

- **Google OAuth changes**: Monitor API deprecations, maintain good relationship
- **Vercel limitations**: Have migration plan to other platforms
- **Security vulnerabilities**: Regular security audits, bug bounty program
- **Key compromise**: Key rotation procedures, monitoring

### Business Risks

- **Google competition**: Focus on specific use case, potential partnership
- **Legal challenges**: Clear terms of service, DMCA compliance
- **Market adoption**: Start with niche markets, build momentum
- **Scaling costs**: Monitor usage, optimize for efficiency

## Future Roadmap

### Short-term (6 months)

- Browser extension for seamless signing
- Mobile app for on-device verification
- Platform partnerships (social media, marketplaces)
- Advanced trust scoring algorithms

### Medium-term (1 year)

- Video content support
- Bulk processing APIs
- White-label solutions
- International expansion

### Long-term (2+ years)

- Multi-provider support (other email providers)
- Blockchain integration for immutable records
- AI content detection integration
- Enterprise PKI bridge solutions
