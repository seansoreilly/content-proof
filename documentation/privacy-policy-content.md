# Privacy Policy - Content Proof

*Last updated: October 24, 2026*

## Introduction

Content Proof is committed to protecting your privacy and being transparent about how we handle your information. This Privacy Policy explains what data we collect, how we use it, and your rights regarding your personal information.

## Information We Collect

### 1. Account Information
When you sign in with Google, we collect:
- **Email address**: Your Google account email, used to identify you and included in the records we sign
- **Basic profile information**: Name and profile picture from your Google account
- **Authentication tokens**: Temporary tokens to maintain your session

### 2. Signature Records
When you sign a file, our server receives only the SHA-256 hash of the file, never the file. If record storage is configured, we store the signature record:
- **File hash**: SHA-256 fingerprint of your file (not the file itself)
- **Email**: The Google account that submitted the hash
- **Timestamp**: When the signature was created
- **Signature**: The ContentProof signature over the record
- **Key identifier**: Reference to the key used for signing

If storage is not configured, no record is kept on our servers and the record exists only in the QR code or link you receive.

### 3. Usage Information
We may collect:
- **Access logs**: When you use our service and which features you access
- **Performance data**: How long operations take and any errors encountered
- **Analytics data**: Aggregated usage patterns to improve our service

## What We Don't Collect

### Files and Content
- **Your files**: Files never leave your browser. Only their SHA-256 hash is sent to us
- **File contents**: Files are hashed locally in your browser
- **Personal documents**: No access to your personal files or Google Drive

### Sensitive Information
- **Passwords**: We don't have access to your Google password
- **Financial information**: No payment processing data
- **Browsing history**: No tracking of your activity outside our service

## How We Use Your Information

### 1. Service Provision
- **Authentication**: Verify your identity for secure access
- **Signature creation**: Sign a record attesting that your Google account submitted a file hash at a given time
- **Verification**: Enable others to verify signatures you've created

### 2. Service Improvement
- **Performance optimization**: Identify and fix technical issues
- **Feature development**: Understand how users interact with our service
- **Security enhancement**: Detect and prevent abuse

### 3. Communication
- **Service updates**: Important changes to our service
- **Security notifications**: Alerts about your account security
- **Support responses**: Answers to your questions and issues

## How We Share Your Information

### With Third Parties
We only share information with:

**Google**: Your authentication is handled by Google OAuth. Google's privacy policy applies to this interaction.

**Vercel**: Our hosting provider processes data according to their privacy policy and security standards.

**Upstash**: Our Redis provider stores signature records and rate-limit counters, when storage is configured.

### Public Information
Some information is intentionally public:
- **Signature verification data**: Anyone with a QR code or link can verify the record
- **Signer identity**: Your Google account email is included in the QR code and link
- **Verification link payload**: It is carried in the URL fragment (after `#`), which browsers do not send to our server, so opening a link does not disclose it to us
- **Public keys**: Available publicly for signature verification

### We Never Sell Data
We do not sell, rent, or trade your personal information to third parties for marketing purposes.

## Data Security

### Encryption
- **Data in transit**: All data is encrypted using TLS/SSL
- **Data at rest**: Stored data is protected by our storage provider's encryption
- **Authentication**: Secure OAuth 2.0 implementation with Google

### Access Controls
- **Limited access**: Only authorized personnel can access user data
- **Audit logging**: All data access is logged and monitored
- **Regular reviews**: Access permissions are reviewed regularly

### Security Practices
- **Vulnerability scanning**: Regular security assessments
- **Incident response**: Procedures for handling security incidents
- **Data minimization**: We collect only necessary information

## Data Retention

### Signature Data
- **Retention**: When storage is configured, signature records are kept until deleted or until the storage retention period set by the operator ends

### Account Information
ContentProof keeps no account profile. Signing in with Google produces a
signed session cookie held by your browser; nothing about your account is
written to our storage. Signing out discards the session.

### Legal Requirements
We may retain data longer if required by law or for legitimate business purposes such as fraud prevention.

## Your Rights and Choices

### What we hold about you
When storage is configured, the only data tied to you is the signature
record itself: the file hash, your Google account email, the time, the key
id and the signature. Each stored record expires automatically one year
after it was created. When storage is not configured, nothing is retained
after the response is sent.

### Data Access and Deletion
- **View a record**: Every record is contained in the QR code or link you
  received. If storage is configured, `GET /api/sig/<signature>` returns the
  same record.
- **Request deletion**: Email the address below with the signature(s) you
  want removed from storage. Deleting a stored record does not invalidate
  QR codes or links already shared, because they are self-contained.
- **Opt out of analytics**: Block the analytics script in your browser
  (where applicable).

### Data Portability
- **Records**: The record in your QR code or link is the complete, portable
  form of your data; keep copies for offline verification.
- There is no separate signature history or export feature.

## Cookies and Tracking

### Essential Cookies
- **Session cookies**: Required for authentication and basic functionality
- **Security cookies**: CSRF protection and secure session management

### Analytics (Optional)
- **Usage analytics**: Aggregated data to improve our service
- **Performance monitoring**: Error tracking and performance optimization
- **Opt-out available**: You can disable analytics tracking

### No Advertising
We do not use cookies for advertising or tracking for marketing purposes.

## International Data Transfers

Our service operates globally, and your data may be processed in:
- **United States**: Primary data processing location
- **European Union**: Backup and redundancy systems
- **Data protection**: All transfers comply with applicable privacy laws

## Children's Privacy

Content Proof is not intended for children under 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately.

## Changes to This Policy

We may update this Privacy Policy to reflect changes in our practices or for legal reasons. We will:
- **Notify users**: Email notification of significant changes
- **Version history**: Maintain previous versions for reference
- **Effective date**: Clearly indicate when changes take effect

## Contact Information

### Privacy Questions
If you have questions about this Privacy Policy or our privacy practices:

**Email**: seansoreilly@gmail.com

**Response time**: We aim to respond within 48 hours

### Data Requests
For data access, deletion, or portability requests:

**Email**: data@contentproof.app

**Processing time**: Most requests processed within 30 days

### Security Issues
To report security vulnerabilities:

**Email**: security@contentproof.app

**Response**: Critical issues addressed within 24 hours

## Legal Compliance

### Applicable Laws
This Privacy Policy is designed to comply with:
- **GDPR**: European Union General Data Protection Regulation
- **CCPA**: California Consumer Privacy Act
- **PIPEDA**: Canada Personal Information Protection and Electronic Documents Act

### Data Protection Officer
For GDPR-related inquiries, contact our Data Protection Officer:
**Email**: dpo@contentproof.app

### Jurisdiction
This Privacy Policy is governed by the laws of [Your Jurisdiction], and any disputes will be resolved in the courts of [Your Jurisdiction].