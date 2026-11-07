import { NextResponse } from "next/server";
import { COUNTRY_HEADER, consentRequiredFor } from "@/lib/consent-region";

/**
 * GET /api/consent-region  →  { consentRequired: boolean }
 *
 * Tells the consent banner whether this visitor must opt in before analytics
 * loads, from the country Vercel derives from their IP. Only the yes/no answer
 * is returned, never the country. Kept as its own small endpoint so the pages
 * themselves stay static.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return NextResponse.json(
    { consentRequired: consentRequiredFor(request.headers.get(COUNTRY_HEADER)) },
    { status: 200, headers: { "Cache-Control": "private, no-store", Vary: COUNTRY_HEADER } }
  );
}
