---
description: 
globs: 
alwaysApply: false
---
# Image Sign Project Rules

This document outlines the coding standards, patterns, and best practices for the Image Sign Next.js application.

## **Project Overview**

The Image Sign project is a secure digital image authentication platform built with:
- **Next.js 15** with App Router
- **TypeScript** for type safety
- **React 19** with modern patterns
- **Cryptographic signatures** (Ed25519/RSA)
- **Image processing** with Sharp and metadata manipulation
- **Authentication** via NextAuth.js with Google OAuth

## **File Structure & Organization**

### **API Routes (`src/app/api/`)**
- Use Next.js 13+ App Router API conventions
- Each API route must be in its own directory with `route.ts`
- Handle errors gracefully with proper HTTP status codes
- Include comprehensive input validation

```typescript
// ✅ DO: Proper API route structure
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    // ... implementation
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ❌ DON'T: Missing error handling or authentication
export async function POST(request: NextRequest) {
  const data = await request.json(); // No validation
  return NextResponse.json(data); // No error handling
}
```

### **Components (`src/components/`)**
- Use functional components with TypeScript
- Implement proper prop interfaces
- Include comprehensive JSDoc comments
- Co-locate test files in `__tests__` subdirectory

```typescript
// ✅ DO: Well-structured component
interface ImageUploadProps {
  onUpload: (file: File) => Promise<void>;
  maxSize?: number;
  acceptedTypes?: string[];
  disabled?: boolean;
}

/**
 * ImageUpload component for handling secure image uploads
 * @param onUpload - Callback function when file is uploaded
 * @param maxSize - Maximum file size in bytes (default: 5MB)
 * @param acceptedTypes - Array of accepted MIME types
 * @param disabled - Whether the upload is disabled
 */
export function ImageUpload({ 
  onUpload, 
  maxSize = 5 * 1024 * 1024,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  disabled = false 
}: ImageUploadProps) {
  // Implementation
}
```

### **Library Functions (`src/lib/`)**
- Export utility functions with clear, descriptive names
- Include comprehensive type definitions
- Handle edge cases and errors appropriately
- Use proper JSDoc documentation

## **TypeScript Patterns**

### **Type Definitions**
- Define interfaces in `src/types/` directory
- Use discriminated unions for complex state
- Prefer `interface` over `type` for object shapes
- Use `const assertions` for literal types

```typescript
// ✅ DO: Comprehensive type definitions
interface VerificationResult {
  verified: boolean;
  email: string | null;
  timestamp: string | null;
  error?: string;
  metadata?: {
    fileSize: number;
    fileType: string;
    signatureAlgorithm: 'Ed25519' | 'RSA';
  };
}

// Discriminated union for processing states
type ProcessingState = 
  | { status: 'idle' }
  | { status: 'processing'; progress: number }
  | { status: 'success'; result: VerificationResult }
  | { status: 'error'; error: string };
```

### **Error Handling**
- Use custom error types for different error categories
- Implement proper error boundaries in React components
- Log errors with appropriate context

```typescript
// ✅ DO: Custom error types
export class CryptographicError extends Error {
  constructor(message: string, public readonly operation: string) {
    super(message);
    this.name = 'CryptographicError';
  }
}

export class ImageProcessingError extends Error {
  constructor(message: string, public readonly fileType?: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}
```

## **Cryptographic Standards**

### **Key Management**
- Always validate cryptographic keys before use
- Use base64 encoding for environment variables
- Implement key format detection and conversion
- Never log or expose private keys

```typescript
// ✅ DO: Secure key handling
function validateAndFormatPrivateKey(key: string): string {
  try {
    // Try to decode base64 first
    const decodedKey = Buffer.from(key, 'base64').toString('utf-8');
    if (decodedKey.includes('-----BEGIN PRIVATE KEY-----')) {
      return decodedKey;
    }
  } catch {
    // If base64 decode fails, treat as raw key
  }
  
  // Add PEM headers if missing
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    const keyWithLineBreaks = key.replace(/(.{64})/g, '$1\n');
    return `-----BEGIN PRIVATE KEY-----\n${keyWithLineBreaks}\n-----END PRIVATE KEY-----`;
  }
  
  return key;
}

// ❌ DON'T: Log private keys or expose them
console.log('Private key:', privateKey); // NEVER DO THIS
```

### **Signature Generation**
- Use Ed25519 as primary algorithm with RSA fallback
- Always include timestamp in signature data
- Encrypt sensitive data before signing
- Validate signature data integrity

```typescript
// ✅ DO: Proper signature generation
async function createSignature(
  imageBuffer: Buffer,
  userEmail: string,
  privateKey: string
): Promise<string> {
  const encryptedEmail = encryptEmail(userEmail);
  const timestamp = new Date().toISOString();
  
  const dataToSign = Buffer.concat([
    imageBuffer,
    Buffer.from(encryptedEmail, 'utf8'),
    Buffer.from(timestamp, 'utf8')
  ]);
  
  try {
    // Try Ed25519 first
    return crypto.sign(null, dataToSign, formattedPrivateKey).toString('base64');
  } catch (ed25519Error) {
    // Fallback to RSA
    const sign = crypto.createSign('sha256');
    sign.update(dataToSign);
    return sign.sign(formattedPrivateKey, 'base64');
  }
}
```

## **Image Processing Standards**

### **File Validation**
- Validate file size, type, and integrity
- Use Sharp for robust image validation
- Implement proper MIME type checking
- Handle corrupted file scenarios

```typescript
// ✅ DO: Comprehensive file validation
async function validateImageFile(file: File): Promise<ValidationResult> {
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
  if (file.size > MAX_SIZE) {
    return { 
      valid: false, 
      error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum ${MAX_SIZE / 1024 / 1024}MB` 
    };
  }
  
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { 
      valid: false, 
      error: `File type ${file.type} not supported. Allowed: ${ALLOWED_TYPES.join(', ')}` 
    };
  }
  
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    return { valid: true, metadata };
  } catch (error) {
    return { 
      valid: false, 
      error: 'Invalid or corrupted image file' 
    };
  }
}
```

### **Metadata Handling**
- Handle JPEG EXIF and PNG text chunks appropriately
- Preserve original image quality during processing
- Use format-specific metadata embedding

```typescript
// ✅ DO: Format-specific metadata handling
async function embedSignatureMetadata(
  buffer: Buffer, 
  signature: string, 
  metadata: SignatureMetadata,
  imageType: string
): Promise<Buffer> {
  switch (imageType) {
    case 'image/jpeg':
      return embedJpegSignature(buffer, signature, metadata);
    case 'image/png':
      return embedPngSignature(buffer, signature, metadata);
    default:
      throw new ImageProcessingError(`Unsupported image type: ${imageType}`);
  }
}
```

## **Authentication Patterns**

### **Session Management**
- Use NextAuth.js patterns consistently
- Validate sessions on all protected routes
- Handle authentication errors gracefully

```typescript
// ✅ DO: Consistent session validation
export async function validateUserSession(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    throw new AuthenticationError('Authentication required');
  }
  
  return {
    user: session.user,
    email: session.user.email
  };
}
```

### **OAuth Configuration**
- Store OAuth secrets securely in environment variables
- Use proper redirect URI configuration
- Handle OAuth errors with user-friendly messages

## **Environment & Configuration**

### **Environment Variables**
- Use the `getValidatedEnv()` function consistently
- Provide clear error messages for missing variables
- Document all required and optional variables

```typescript
// ✅ DO: Use validated environment variables
export function getValidatedEnv() {
  const requiredVars = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    SIGNING_PRIVATE_KEY: process.env.SIGNING_PRIVATE_KEY,
    SIGNING_PUBLIC_KEY: process.env.SIGNING_PUBLIC_KEY,
  };
  
  const missing = Object.entries(requiredVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);
    
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  return requiredVars as Record<keyof typeof requiredVars, string>;
}
```

## **Testing Standards**

### **API Route Testing**
- Test both success and error scenarios
- Mock external dependencies (AWS, crypto operations)
- Validate response formats and status codes

```typescript
// ✅ DO: Comprehensive API testing
describe('/api/sign', () => {
  it('should sign image successfully with valid authentication', async () => {
    const mockSession = { user: { email: 'test@example.com' } };
    (getServerSession as jest.Mock).mockResolvedValue(mockSession);
    
    const formData = new FormData();
    formData.append('image', new File([mockImageBuffer], 'test.jpg', { type: 'image/jpeg' }));
    
    const response = await POST(createMockRequest(formData));
    
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
  });
  
  it('should return 401 for unauthenticated requests', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    
    const response = await POST(createMockRequest(new FormData()));
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Authentication required');
  });
});
```

### **Component Testing**
- Test user interactions and state changes
- Mock file uploads and drag-and-drop
- Verify accessibility features

```typescript
// ✅ DO: Interactive component testing
test('ImageUpload handles file drop correctly', async () => {
  const mockOnUpload = jest.fn();
  const { getByTestId } = render(<ImageUpload onUpload={mockOnUpload} />);
  
  const dropZone = getByTestId('drop-zone');
  const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
  
  fireEvent.drop(dropZone, {
    dataTransfer: { files: [file] }
  });
  
  await waitFor(() => {
    expect(mockOnUpload).toHaveBeenCalledWith(file);
  });
});
```

## **Error Handling Patterns**

### **Client-Side Error Boundaries**
- Implement error boundaries for key components
- Provide fallback UI for error states
- Log errors for debugging

```typescript
// ✅ DO: Proper error boundary implementation
export class ImageProcessingErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }
  
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error.message };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Image processing error:', error, errorInfo);
    // Log to external service if needed
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h2>Something went wrong with image processing</h2>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    
    return this.props.children;
  }
}
```

## **Performance Optimization**

### **Image Processing**
- Use Sharp for efficient image operations
- Implement streaming for large files
- Cache processed results when appropriate

### **Client-Side Performance**
- Use React.memo for expensive components
- Implement proper loading states
- Use dynamic imports for heavy dependencies

```typescript
// ✅ DO: Optimized component with loading states
const ImageSignature = React.memo(({ imageData }: Props) => {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  
  const processImage = useCallback(async () => {
    setProcessing(true);
    try {
      const result = await verifyImageSignature(imageData);
      setResult(result);
    } catch (error) {
      // Handle error
    } finally {
      setProcessing(false);
    }
  }, [imageData]);
  
  if (processing) {
    return <LoadingSpinner message="Verifying signature..." />;
  }
  
  return <VerificationDisplay result={result} />;
});
```

## **Security Best Practices**

### **Input Sanitization**
- Validate all user inputs
- Sanitize file names and metadata
- Implement rate limiting for API endpoints

### **Sensitive Data Handling**
- Never log sensitive information
- Use encryption for storing user data
- Implement secure session management

```typescript
// ✅ DO: Secure data handling
function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .substring(0, 255);
}

function logAuditEvent(event: string, userId: string, metadata: object) {
  // Only log non-sensitive metadata
  const sanitizedMetadata = {
    ...metadata,
    email: undefined, // Never log email
    privateKey: undefined, // Never log keys
  };
  
  console.log(`Audit: ${event}`, { userId: hashUserId(userId), ...sanitizedMetadata });
}
```

## **Deployment & Production**

### **Environment Configuration**
- Use different configurations for development/production
- Implement proper logging levels
- Use secure headers and CORS policies

### **Monitoring & Logging**
- Implement structured logging
- Monitor cryptographic operations
- Track performance metrics

## **Code Style & Formatting**

### **General Rules**
- Use TypeScript strict mode
- Follow ESLint configuration
- Use Prettier for consistent formatting
- Write meaningful commit messages

### **Naming Conventions**
- Use camelCase for variables and functions
- Use PascalCase for components and classes
- Use UPPER_SNAKE_CASE for constants
- Use descriptive names for cryptographic operations

```typescript
// ✅ DO: Clear naming conventions
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;

interface CryptographicOperation {
  algorithm: 'Ed25519' | 'RSA';
  keySize: number;
}

function generateEd25519Signature(data: Buffer, privateKey: string): string {
  // Implementation
}
```

---

**Follow these rules to maintain consistency, security, and performance across the Image Sign codebase.**

