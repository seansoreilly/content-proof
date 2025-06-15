import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Basic rate limiting: max 60 requests per IP per minute across all API routes.
// Note: Redis operations are disabled in middleware due to Edge Runtime limitations
export async function middleware(request: NextRequest) {
  try {
    // Use `x-forwarded-for` header or fallback to unknown
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    // For now, we'll skip Redis-based rate limiting in middleware due to Edge Runtime limitations
    // Rate limiting can be implemented in individual API routes instead
    console.log(`[MIDDLEWARE] Request from IP: ${ip} to ${request.nextUrl.pathname}`);

    return NextResponse.next();

  } catch (error) {
    console.warn("Middleware error:", error);
    // Continue without rate limiting if there's an error
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/api/:path*"],
}; 