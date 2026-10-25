/**
 * Shared HTTP helpers for the public, read-only API endpoints.
 */

const NON_NEGATIVE_INT_RE = /^\d{1,15}$/;

/**
 * CORS headers for the public endpoints. Everything served this way is already
 * public (or authenticated by signature), carries no cookies, and is meant to
 * be fetched from third-party verifiers.
 */
export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

/** Response for an OPTIONS preflight on a public endpoint. */
export function corsPreflight(methods: string[]): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders({ "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", ") }),
  });
}

/**
 * Parse a query value that must be a plain non-negative decimal integer.
 * Rejects "", whitespace, hex, exponents, signs and anything over 15 digits.
 * A missing value (`null`) yields `fallback` when given, otherwise `null`.
 */
export function parseNonNegativeInt(value: string | null, fallback?: number): number | null {
  if (value === null) return fallback ?? null;
  if (!NON_NEGATIVE_INT_RE.test(value)) return null;
  return Number(value);
}
