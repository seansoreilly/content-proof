# Button Components Update Guide

## SignInButton Component

### Current Implementation
The SignInButton likely uses a basic blue button style. Update it to use the new gradient design system.

### New Implementation
```jsx
"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      onClick={() => signIn("google")}
      className="group relative px-8 py-4 rounded-xl font-semibold text-white transition-all duration-300 overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-accent-purple opacity-100 group-hover:opacity-90 transition-opacity" />
      <div className="absolute inset-0 bg-gradient-to-r from-accent-purple to-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      <span className="relative flex items-center gap-2">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </span>
    </button>
  );
}
```

## SignOutButton Component

### New Implementation
```jsx
"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut()}
      className="px-6 py-3 rounded-xl font-medium transition-all duration-300 glass border-2 border-dark-600 text-dark-300 hover:border-dark-500 hover:text-white hover:bg-dark-800/50"
    >
      <span className="flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Sign out
      </span>
    </button>
  );
}
```

## AccountStatus Component

### New Implementation
```jsx
"use client";

import { useSession } from "next-auth/react";

export function AccountStatus() {
  const { data: session } = useSession();
  
  if (!session) return null;
  
  return (
    <div className="glass rounded-xl px-4 py-2 flex items-center gap-3">
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center text-white font-semibold">
          {session.user?.email?.[0].toUpperCase()}
        </div>
        <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-dark-950 rounded-full"></span>
      </div>
      <div>
        <p className="text-sm font-medium text-white">{session.user?.name}</p>
        <p className="text-xs text-dark-400">{session.user?.email}</p>
      </div>
    </div>
  );
}
```

## QrCodeGenerator Component Updates

### Wrapper Structure
```jsx
export function QrCodeGenerator({ signature }: Props) {
  // ... existing QR generation logic ...
  
  return (
    <div className="glass rounded-xl p-6 mt-6">
      <div className="flex flex-col items-center space-y-4">
        <div className="bg-white p-4 rounded-lg">
          {/* QR Code canvas/image here */}
        </div>
        
        <button
          onClick={downloadQRCode}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-primary-500 to-accent-purple text-white font-medium hover:shadow-lg transition-all duration-300"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download QR Code
        </button>
        
        <p className="text-xs text-dark-400 text-center">
          This QR code contains the verification link for your signed document
        </p>
      </div>
    </div>
  );
}
```

## General Button Patterns

### Primary Action Button
```jsx
className="group relative px-8 py-4 rounded-xl font-semibold text-white transition-all duration-300 overflow-hidden"
// With gradient background divs as children
```

### Secondary Action Button
```jsx
className="px-6 py-3 rounded-xl font-medium transition-all duration-300 glass border-2 border-primary-500/20 text-primary-400 hover:border-primary-500/40 hover:bg-primary-500/10"
```

### Ghost Button
```jsx
className="px-6 py-3 rounded-xl font-medium transition-all duration-300 text-dark-300 hover:text-white hover:bg-dark-800/50"
```

### Icon Button
```jsx
className="p-2 rounded-lg hover:bg-dark-700 transition-colors"
```

## Hover Effects
- Primary buttons: Gradient reversal on hover
- Secondary buttons: Border opacity increase, slight background
- All buttons: translateY(-2px) on hover for lift effect
- Include transition-all duration-300 for smooth animations

## Focus States
Add focus-visible styles:
```jsx
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-950
```

This guide provides all the patterns needed to update button components consistently across the application.
