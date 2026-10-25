import { NextResponse } from "next/server";

/**
 * Catch-all for unknown API paths so clients get JSON, not the HTML 404 page.
 * More specific route handlers (including /api/auth/*) take precedence.
 */
export const dynamic = "force-dynamic";

function notFound(): Response {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
