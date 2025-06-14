---
description: 
globs: 
alwaysApply: false
---
# Git Commit Hash Build Integration

**Purpose:** Ensure consistent implementation of Git commit hash tracking across development, build, and deployment environments using `process.env.GIT_COMMIT_HASH`.

## **Next.js Configuration Implementation**

### ✅ **DO: Implement Multi-Environment Hash Resolution**

```javascript
// next.config.js
const { execSync } = require("child_process");

function getGitCommitHash() {
  // Priority 1: Vercel deployment environment
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    const shortHash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
    console.log("Using Vercel commit hash:", shortHash);
    return shortHash;
  }

  // Priority 2: Generic CI environment variables
  if (process.env.GITHUB_SHA) {
    const shortHash = process.env.GITHUB_SHA.substring(0, 7);
    console.log("Using GitHub Actions commit hash:", shortHash);
    return shortHash;
  }

  if (process.env.CI_COMMIT_SHA) {
    const shortHash = process.env.CI_COMMIT_SHA.substring(0, 7);
    console.log("Using CI commit hash:", shortHash);
    return shortHash;
  }

  // Priority 3: Local development fallback
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
    }).trim();
    console.log("Using local git commit hash:", hash);
    return hash;
  } catch (error) {
    console.warn("Could not get git commit hash:", error.message);
    return "unknown";
  }
}

const nextConfig = {
  env: {
    GIT_COMMIT_HASH: getGitCommitHash(),
  },
  // ... other config
};

module.exports = nextConfig;
```

### ❌ **DON'T: Use Single-Environment Solutions**

```javascript
// ❌ Only works in one environment
const nextConfig = {
  env: {
    GIT_COMMIT_HASH: process.env.VERCEL_GIT_COMMIT_SHA, // Fails in local dev
  },
};

// ❌ No error handling
function getGitCommitHash() {
  return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
}
```

## **Frontend Usage Patterns**

### ✅ **DO: Safe Environment Variable Access**

```tsx
// components/Footer.tsx or pages/index.tsx
export default function Footer() {
  const commitHash = process.env.GIT_COMMIT_HASH || "unknown";
  
  return (
    <footer className="text-center text-sm text-gray-500">
      <p>
        Build: <span className="font-mono">{commitHash}</span>
      </p>
    </footer>
  );
}

// For debugging/admin panels
export default function AdminPanel() {
  const buildInfo = {
    commit: process.env.GIT_COMMIT_HASH || "unknown",
    buildTime: process.env.BUILD_TIME || "unknown",
    nodeEnv: process.env.NODE_ENV || "unknown",
  };

  return (
    <div className="debug-panel">
      <h3>Build Information</h3>
      <dl>
        <dt>Commit Hash:</dt>
        <dd className="font-mono">{buildInfo.commit}</dd>
        <dt>Environment:</dt>
        <dd>{buildInfo.nodeEnv}</dd>
      </dl>
    </div>
  );
}
```

### ❌ **DON'T: Assume Variable Availability**

```tsx
// ❌ No fallback handling
<span>{process.env.GIT_COMMIT_HASH}</span>

// ❌ Client-side access without build-time injection
const [hash, setHash] = useState();
useEffect(() => {
  // This won't work - env vars aren't available client-side
  setHash(process.env.GIT_COMMIT_HASH);
}, []);
```

## **Build Script Integration**

### ✅ **DO: Enhance Build Scripts with Hash Injection**

```json
// package.json
{
  "scripts": {
    "build": "next build",
    "build:with-hash": "cross-env BUILD_TIME=$(date -Iseconds) next build",
    "build:production": "npm run lint && npm run test && npm run build:with-hash",
    "deploy": "npm run build:production && npm run deploy:platform"
  },
  "devDependencies": {
    "cross-env": "^7.0.3"
  }
}
```

### Enhanced Next.js Config with Additional Build Info

```javascript
// next.config.js
const { execSync } = require("child_process");

function getBuildInfo() {
  const gitHash = getGitCommitHash();
  const buildTime = process.env.BUILD_TIME || new Date().toISOString();
  
  return {
    GIT_COMMIT_HASH: gitHash,
    BUILD_TIME: buildTime,
    BUILD_VERSION: `${gitHash}-${Date.now()}`,
  };
}

const nextConfig = {
  env: {
    ...getBuildInfo(),
  },
};
```

## **Platform-Specific Implementations**

### **Vercel Deployment**

```javascript
// next.config.js - Vercel optimized
function getGitCommitHash() {
  // Vercel provides VERCEL_GIT_COMMIT_SHA automatically
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
  }
  
  // Fallback for local development
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "local-dev";
  }
}
```

### **GitHub Actions Integration**

```yaml
# .github/workflows/deploy.yml
- name: Build with commit hash
  env:
    GITHUB_SHA: ${{ github.sha }}
  run: npm run build
```

```javascript
// next.config.js - GitHub Actions support
function getGitCommitHash() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA.substring(0, 7);
  }
  // ... other fallbacks
}
```

### **Docker Builds**

```dockerfile
# Dockerfile
ARG GIT_COMMIT_HASH=unknown
ENV GIT_COMMIT_HASH=$GIT_COMMIT_HASH

# Build stage
RUN npm run build
```

```bash
# Build script
#!/bin/bash
GIT_HASH=$(git rev-parse --short HEAD)
docker build --build-arg GIT_COMMIT_HASH=$GIT_HASH -t my-app .
```

## **Testing and Validation**

### ✅ **DO: Test Hash Availability**

```javascript
// __tests__/build-info.test.js
describe('Build Information', () => {
  it('should have git commit hash available', () => {
    expect(process.env.GIT_COMMIT_HASH).toBeDefined();
    expect(process.env.GIT_COMMIT_HASH).not.toBe('unknown');
    expect(process.env.GIT_COMMIT_HASH).toMatch(/^[a-f0-9]{7}$/);
  });
});

// jest.config.js
module.exports = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
};

// jest.setup.js
process.env.GIT_COMMIT_HASH = 'abc1234'; // Mock for tests
```

### **Development Environment Setup**

```bash
# .env.local (for local development)
GIT_COMMIT_HASH=dev-local

# Or use a script to auto-generate
# scripts/setup-dev.sh
#!/bin/bash
echo "GIT_COMMIT_HASH=$(git rev-parse --short HEAD)" > .env.local
```

## **Error Handling and Fallbacks**

### ✅ **DO: Implement Graceful Degradation**

```javascript
// next.config.js
function getGitCommitHash() {
  const sources = [
    () => process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7),
    () => process.env.GITHUB_SHA?.substring(0, 7),
    () => process.env.CI_COMMIT_SHA?.substring(0, 7),
    () => {
      try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
      } catch (error) {
        console.warn(`Git command failed: ${error.message}`);
        return null;
      }
    },
  ];

  for (const source of sources) {
    const hash = source();
    if (hash) {
      console.log(`Using commit hash: ${hash}`);
      return hash;
    }
  }

  console.warn("No git commit hash available, using fallback");
  return "unknown";
}
```

### **Monitoring and Debugging**

```typescript
// lib/build-info.ts
export interface BuildInfo {
  commitHash: string;
  buildTime: string;
  environment: string;
  isProduction: boolean;
}

export function getBuildInfo(): BuildInfo {
  return {
    commitHash: process.env.GIT_COMMIT_HASH || "unknown",
    buildTime: process.env.BUILD_TIME || "unknown",
    environment: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
  };
}

// Usage in components
import { getBuildInfo } from "@/lib/build-info";

export default function DebugInfo() {
  const buildInfo = getBuildInfo();
  
  if (!buildInfo.isProduction) {
    return (
      <div className="fixed bottom-4 right-4 bg-black text-white p-2 text-xs">
        Commit: {buildInfo.commitHash}
      </div>
    );
  }
  return null;
}
```

## **Security Considerations**

### ✅ **DO: Safe Information Exposure**

```typescript
// Only expose non-sensitive build information
const publicBuildInfo = {
  version: process.env.GIT_COMMIT_HASH, // Safe to expose
  environment: process.env.NODE_ENV,    // Safe to expose
};

// ❌ DON'T expose sensitive information
const sensitiveInfo = {
  apiKeys: process.env.SECRET_KEY,      // Never expose
  internalPaths: process.env.BUILD_PATH, // Don't expose
};
```

## **Common Patterns by Framework**

### **Next.js App Router**

```tsx
// app/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="text-xs text-gray-400 text-center p-4">
          Build: {process.env.GIT_COMMIT_HASH}
        </footer>
      </body>
    </html>
  );
}
```

### **API Routes**

```typescript
// app/api/health/route.ts
export async function GET() {
  return Response.json({
    status: 'healthy',
    commit: process.env.GIT_COMMIT_HASH,
    timestamp: new Date().toISOString(),
  });
}
```

## **Troubleshooting Common Issues**

### **Issue: "unknown" appears in production**
- **Cause:** Git command not available in build environment
- **Solution:** Use platform-specific environment variables (VERCEL_GIT_COMMIT_SHA, GITHUB_SHA)

### **Issue: Hash not updating after deployment**
- **Cause:** Next.js caching the environment variable
- **Solution:** Ensure the hash is computed at build time, not runtime

### **Issue: Different hashes between environments**
- **Cause:** Different commit states or build processes
- **Solution:** Use consistent CI/CD pipelines and validate hash sources

---

**Key Principles:**
1. **Multi-environment compatibility** - Works in development, CI, and production
2. **Graceful fallbacks** - Always provide a fallback value
3. **Build-time computation** - Calculate hash during build, not runtime
4. **Platform awareness** - Adapt to different deployment platforms
5. **Security conscious** - Only expose safe build information

**Reference Implementation:** [next.config.js](mdc:next.config.js) shows the current working implementation.

## **React (CRA / Vite) Configuration Implementation**

### ✅ **DO: Inject Hash via Build-Time Environment Variables**

```bash
# package.json scripts (CRA example)
{
  "scripts": {
    "build": "react-scripts build",
    "build:with-hash": "cross-env REACT_APP_GIT_COMMIT_HASH=$(git rev-parse --short HEAD) react-scripts build"
  },
  "devDependencies": {
    "cross-env": "^7.0.3"
  }
}
```

```tsx
// src/components/Footer.tsx (CRA)
export default function Footer() {
  const commitHash = process.env.REACT_APP_GIT_COMMIT_HASH || "unknown";
  return (
    <footer className="text-center text-xs text-gray-500">
      Build: <span className="font-mono">{commitHash}</span>
    </footer>
  );
}
```

#### **Vite Variant**

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "child_process";

function getGitCommitHash() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT_HASH__: JSON.stringify(getGitCommitHash()),
  },
});
```

```tsx
// usage in React component (Vite)
console.log("Build hash", __COMMIT_HASH__);
```

### ❌ **DON'T: Hard-code Values or Access Undefined Vars**

```tsx
// ❌ Will be undefined outside CRA prefix
<span>{process.env.GIT_COMMIT_HASH}</span>
```

---

## **Static Sites / Plain HTML & JavaScript**

### ✅ **DO: Insert Commit Hash at Build Time**

1. **Meta Tag Approach**

   ```bash
   # build.sh (simple static site)
   HASH=$(git rev-parse --short HEAD)
   perl -pi -e "s/__COMMIT_HASH__/$HASH/g" dist/index.html
   ```

   ```html
   <!-- index.html template -->
   <meta name="git-commit-hash" content="__COMMIT_HASH__" />
   ```

   ```js
   // runtime usage
   const hash = document.querySelector('meta[name="git-commit-hash"]').content;
   console.log('Build hash:', hash);
   ```

2. **Webpack / Rollup Define Plugin**

   ```js
   // webpack.config.js
   const { DefinePlugin } = require('webpack');
   const { execSync } = require('child_process');
   const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

   module.exports = {
     // ...rest
     plugins: [
       new DefinePlugin({
         __COMMIT_HASH__: JSON.stringify(hash),
       }),
     ],
   };
   ```

   ```js
   // app.js
   console.log('Commit:', __COMMIT_HASH__);
   ```

### ❌ **DON'T: Depend on Runtime Git Commands in the Browser**

```html
<!-- ❌ Won't work: git command isn't available in the browser -->
<script>
  fetch('/.git/HEAD').then(...);
</script>
```

---

