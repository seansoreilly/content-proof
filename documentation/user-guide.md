# User Guide - Content Proof

## Getting Started

Content Proof allows you to cryptographically sign digital files and create QR codes for easy verification. This ensures anyone can verify that a file hasn't been tampered with and came from you.

### What You Need
- A Gmail account
- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Files you want to sign (up to 10MB each)

## How to Sign a File

### Step 1: Sign In
1. Visit the Content Proof website
2. Click "Sign in with Google"
3. Authorize the application to access your Gmail account
4. You'll be redirected back to the application

### Step 2: Upload Your File
1. Click "Sign a file" on the homepage
2. Either:
   - Drag and drop your file into the upload area, or
   - Click "browse files" to select from your computer
3. Supported file types include images, PDFs, text files, and more
4. Maximum file size is 10MB

### Step 3: Generate Signature
1. Once uploaded, the file will be automatically processed
2. A unique SHA-256 hash will be generated for your file
3. An Ed25519 digital signature will be created using your Gmail identity
4. A QR code containing all verification data will be generated

### Step 4: Download Your Assets
You'll receive:
- **Original file**: Unchanged from what you uploaded
- **QR code**: PNG image containing verification data
- **Signature data**: Text that can be used for manual verification

## How to Verify a File

### Method 1: QR Code Verification (Recommended)

1. Go to the verification page
2. Scan the QR code using your phone's camera or upload the QR code image
3. Upload the file you want to verify
4. Enter the Gmail address of the person who signed the file
5. Click "Verify Signature"

### Method 2: Manual Verification

1. Go to the verification page
2. Enter the signature data manually in the text area
3. Upload the file you want to verify
4. Enter the Gmail address of the person who signed the file
5. Click "Verify Signature"

## Understanding Verification Results

### ✅ Verification Successful
- The file hasn't been modified since signing
- The signature is cryptographically valid
- The Gmail address matches the signer

### ❌ Verification Failed
This could mean:
- The file has been modified or corrupted
- The signature data is incorrect or corrupted
- The Gmail address doesn't match the signer
- The signature is invalid or expired

## Security Features

### What Content Proof Guarantees
- **File Integrity**: Any modification to the file will cause verification to fail
- **Signer Identity**: The Gmail address is cryptographically bound to the signature
- **Timestamp**: When the file was signed is recorded and verified
- **Non-repudiation**: The signer cannot deny they signed the file

### What Content Proof Protects Against
- **File Tampering**: Changes to the file content
- **Identity Spoofing**: Someone claiming to be a different signer
- **Backdating**: Claiming a file was signed at a different time

### Privacy and Security
- **No File Storage**: Your files are never stored on our servers
- **Local Processing**: File hashing happens in your browser
- **Offline Verification**: QR codes work without internet connection
- **Open Source Crypto**: Uses standard Ed25519 digital signatures

## Common Use Cases

### Content Creators
- Sign photos to prove authenticity
- Protect against unauthorized modifications
- Establish creation timestamp

### Business Documents
- Sign contracts and agreements
- Verify document integrity
- Prove document origin

### Evidence Preservation
- Sign important files for legal purposes
- Maintain chain of custody
- Prevent tampering claims

## Troubleshooting

### File Upload Issues
**Problem**: File won't upload
- Check file size (must be under 10MB)
- Ensure stable internet connection
- Try a different browser

**Problem**: Unsupported file type
- Most common file types are supported
- Try converting to a supported format (PDF, PNG, JPG, TXT)

### Verification Issues
**Problem**: QR code won't scan
- Ensure QR code image is clear and undamaged
- Try different QR code reader apps
- Use manual verification method instead

**Problem**: Verification fails unexpectedly
- Ensure you're using the exact same file that was signed
- Check that the Gmail address is exactly correct
- Verify the QR code or signature data isn't corrupted

### Browser Issues
**Problem**: Website doesn't work properly
- Update to the latest browser version
- Enable JavaScript
- Clear browser cache and cookies
- Try an incognito/private browsing window

## Best Practices

### For Signers
1. **Keep Original Files Safe**: Store the original signed file securely
2. **Save QR Codes**: Keep the QR code image with your files
3. **Document Context**: Note why and when you signed files
4. **Regular Backups**: Back up both files and QR codes

### For Verifiers
1. **Verify Source**: Get QR codes from trusted sources
2. **Check Details**: Verify signer identity and timestamp make sense
3. **Multiple Checks**: If verification fails, try again carefully
4. **Keep Records**: Document verification results for important files

## Technical Limitations

### Current Limitations
- Gmail accounts only (no other email providers)
- 10MB maximum file size
- Single file processing (no batch operations)
- Requires modern browser with JavaScript

### What's Not Protected
- **File Content Privacy**: Signatures don't encrypt files
- **Access Control**: Anyone with the QR code can verify
- **Metadata**: Some file metadata may be lost during processing

## Getting Help

### Common Questions
- **Q: Can I sign files without a Gmail account?**
  A: Currently, only Gmail accounts are supported for signing.

- **Q: Do I need internet to verify files?**
  A: After the first verification, QR codes work offline.

- **Q: How long do signatures last?**
  A: Signatures are mathematically valid forever, but we recommend re-signing important files annually.

- **Q: Can I revoke a signature?**
  A: Signatures cannot be revoked, but you can create new signatures for updated files.

### Support Resources
- Check the FAQ section on our website
- Review error messages carefully - they often contain helpful information
- Ensure you're following the steps exactly as described
- Try using a different browser or device

### Reporting Issues
If you encounter bugs or have feature requests:
1. Note the exact steps you took
2. Include any error messages
3. Specify your browser and operating system
4. Contact support through our website

## Privacy Policy Summary

Content Proof is designed with privacy in mind:
- **No File Storage**: Files are processed locally and never stored
- **Minimal Data**: Only Gmail addresses and signature metadata are stored
- **No Tracking**: Verification doesn't require server communication
- **User Control**: You control what files you sign and who you share QR codes with

For complete privacy details, see our full Privacy Policy.
