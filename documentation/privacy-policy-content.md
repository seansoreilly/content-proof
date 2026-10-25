# Privacy Policy - Content Proof

*Last updated: October 25, 2026*

## Introduction

Content Proof is committed to protecting your privacy and being transparent about how we handle your information. This Privacy Policy explains what data we collect, how we use it, and your rights regarding your personal information.

## Information We Collect

### 1. Account Information
When you sign in with Google, we receive:
- **Email address**: Your Google account email, used to identify you and included in the records we sign
- **Basic profile information**: Name and profile picture from your Google account, held only in your session
- **Authentication tokens**: Temporary tokens to maintain your session

### 2. Signature Records
When you sign a file, our server receives only the SHA-256 hash of the file, never the file. The record we sign contains:
- **File hash**: SHA-256 fingerprint of your file (not the file itself)
- **Email**: The Google account that submitted the hash
- **Timestamp**: When the signature was created
- **Your browser's public key and signature**: When your browser can hold a key, it signs the record first; the private key never leaves your device and we never see it
- **Signature**: The ContentProof signature over the record
- **Key identifier**: Reference to the service key used for signing

Every issued record is handled in two ways:

- **Record store** (when storage is configured): the full record is kept for one year so that `GET /api/sig/<signature>` and the record page can return it to anyone who holds the signature. The signature is not guessable, so this is not a public list.
- **Transparency log** (when storage is configured): a hash of the record is appended to a public, append-only log, and the log's signed tree head is published. The public log feed (`/api/log/entries`) exposes the file hash, the timestamp, the key identifier and the leaf hash of each record. It does **not** expose your email or your browser key. Inclusion proofs (`/api/log/proof`) are available to anyone who already holds a record's signature.

If storage is not configured, nothing is kept on our servers and the record exists only in the QR code, seal image or link you receive.

### 3. Usage Information
We use Google Analytics to collect:
- **Page views and events**: Which pages you open and whether a signing or verification succeeded or failed (never the file, the hash, the record or your email)
- **Performance data**: Standard browser and timing information collected by Google Analytics

Our hosting provider also keeps short-lived request logs (IP address, path, status, timing) for operating the service.

## What We Don't Collect

### Files and Content
- **Your files**: Files never leave your browser. Only their SHA-256 hash is sent to us
- **File contents**: Files are hashed locally in your browser
- **Personal documents**: No access to your personal files or Google Drive
- **Your signing key**: The key your browser uses to sign records is non-extractable and never leaves your device

### Sensitive Information
- **Passwords**: We don't have access to your Google password
- **Financial information**: No payment processing data
- **Browsing history**: No tracking of your activity outside our service

## How We Use Your Information

### 1. Service Provision
- **Authentication**: Verify your identity for secure access
- **Signature creation**: Sign a record attesting that your Google account submitted a file hash at a given time
- **Verification**: Enable others to verify signatures you've created
- **Transparency**: Let anyone check that a record was issued and has not been removed or back-dated

### 2. Service Improvement
- **Performance optimization**: Identify and fix technical issues
- **Feature development**: Understand how users interact with our service
- **Security enhancement**: Detect and prevent abuse (for example, rate limiting by account and by IP address)

## How We Share Your Information

### With Third Parties
We only share information with:

**Google**: Your authentication is handled by Google OAuth, and usage analytics are collected by Google Analytics. Google's privacy policy applies to both.

**Vercel**: Our hosting provider processes requests according to their privacy policy and security standards.

**Upstash**: Our Redis provider stores signature records, the transparency log and rate-limit counters, when storage is configured.

### Public Information
Some information is intentionally public:
- **Signature verification data**: Anyone with a QR code, seal image or link can verify the record
- **Signer identity**: Your Google account email is included in the QR code, seal image and link
- **Verification link payload**: It is carried in the URL fragment (after `#`), which browsers do not send to our server, so opening a link does not disclose it to us. Verifying a record does send its signature to our server when the verify page asks the transparency log for an inclusion proof
- **Transparency log**: The hash, timestamp and key identifier of every record, and the log's signed tree heads, are public and permanent
- **Public keys**: Available publicly for signature verification

### We Never Sell Data
We do not sell, rent, or trade your personal information to third parties for marketing purposes.

## Data Security

### Encryption
- **Data in transit**: All data is encrypted using TLS
- **Data at rest**: Stored data is protected by our storage provider's encryption
- **Authentication**: OAuth 2.0 with Google; only accounts with a verified email on an approved domain can sign

### Access Controls
- **Limited access**: Only the operator can access stored records and counters
- **Data minimization**: We collect only what the attestation needs

## Data Retention

### Signature Data
- **Record store**: Each stored record expires automatically one year after it was created
- **Transparency log**: Log entries are permanent by design. An append-only log that could be edited would prove nothing, so entries are never removed

### Account Information
ContentProof keeps no account profile. Signing in with Google produces a
signed session cookie held by your browser; nothing about your account is
written to our storage. Signing out discards the session.

### Legal Requirements
We may retain data longer if required by law or for legitimate business purposes such as fraud prevention.

## Your Rights and Choices

### What we hold about you
When storage is configured, the data tied to you is the signature record
itself (the file hash, your Google account email, the time, the key ids and
the signatures) in the record store for one year, and the record's hash,
file hash, timestamp and key id in the permanent transparency log. When
storage is not configured, nothing is retained after the response is sent.

### Data Access and Deletion
- **View a record**: Every record is contained in the QR code, seal image or
  link you received. If storage is configured, `GET /api/sig/<signature>`
  returns the same record.
- **Request deletion**: Email the address below with the signature(s) you
  want removed from the record store. Deleting a stored record does not
  invalidate QR codes or links already shared, because they are
  self-contained, and it does not remove the record's hash from the
  transparency log, which is append-only.
- **Opt out of analytics**: Block the Google Analytics script in your browser
  (an ad or tracker blocker does this).

### Data Portability
- **Records**: The record in your QR code, seal image or link is the
  complete, portable form of your data; keep copies for offline
  verification.
- There is no separate signature history or export feature.

## Cookies and Tracking

### Essential Cookies
- **Session cookies**: Required for authentication and basic functionality
- **Security cookies**: CSRF protection and secure session management

### Analytics
- **Google Analytics**: Sets its own cookies to measure usage
- **Opt-out available**: Block the analytics script in your browser

### No Advertising
We do not use cookies for advertising or tracking for marketing purposes.

## International Data Transfers

The service runs on Vercel. Requests are served from Vercel's global edge
network and our server functions run in Sydney, Australia. When storage is
configured it runs in the Upstash region chosen by the operator. Google
processes sign-in and analytics data under its own policies.

## Children's Privacy

Content Proof is not intended for children under 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately.

## Changes to This Policy

We may update this Privacy Policy to reflect changes in our practices or for legal reasons. Because we keep no account profile we cannot email you about changes; the date at the top of this page shows when it last changed, and the history is in the project's public source repository.

## Contact Information

### Privacy, data and security requests
For questions about this policy, data access or deletion requests, or to report a security vulnerability:

**Email**: seansoreilly@gmail.com

We aim to respond within 48 hours and to process data requests within 30 days.

## Legal Compliance

### Applicable Laws
This Privacy Policy is designed to comply with the Australian Privacy Act 1988 and, for users in those regions, the GDPR and the CCPA.

### Jurisdiction
This Privacy Policy is governed by the laws of Victoria, Australia, and any disputes will be resolved in the courts of Victoria, Australia.
