import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // This is a debug endpoint to test authentication
  if (
    process.env.DEBUG_AUTH !== "true" &&
    process.env.NEXT_PUBLIC_DEBUG_AUTH !== "true"
  ) {
    return NextResponse.json(
      { error: "Debug mode not enabled" },
      { status: 403 },
    );
  }

  try {
    // Redirect to NextAuth debug callback
    const url = new URL("/api/auth/callback/debug", request.url);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Debug signin error:", error);
    return NextResponse.json({ error: "Debug signin failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
