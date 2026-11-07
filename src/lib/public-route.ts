import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/http";
import { createRateLimiter, getClientIp, rateLimitedResponse, type RateLimiter } from "@/lib/rate-limit";
import { getCounterStore } from "@/lib/redis";

/**
 * Shared plumbing for the public, read-only endpoints: per-IP rate limiting,
 * CORS on every response, and a JSON error instead of an HTML error page when
 * a backing store fails. Kept apart from `@/lib/http` so that module stays
 * free of the Redis import.
 */

/** JSON response that always carries the public CORS headers. */
export function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: corsHeaders(extraHeaders) });
}

/** An `OPTIONS` route handler answering the CORS preflight for `methods`. */
export function publicOptions(methods: string[]): () => Response {
  return () => corsPreflight(methods);
}

export interface PublicRouteOptions {
  /** Requests per IP per window. Omit to leave the route unlimited. */
  limit?: number;
  /** Rate-limit key namespace, e.g. "rl:verify". Required with `limit`. */
  prefix?: string;
  windowSeconds?: number;
  /** Status and message returned when the handler throws. */
  failureStatus: 500 | 503;
  failureMessage: string;
  /** Prefix for the server log line, e.g. "[verify] failed". */
  logTag: string;
  logLevel?: "error" | "warn";
}

/** Route handler arguments: none, or the request first and then Next's context. */
type HandlerArgs = [] | [Request, ...unknown[]];

/**
 * Wrap a public route handler. The handler only deals with its own logic;
 * the wrapper rate-limits by client IP (when `limit` is set) and turns any
 * thrown error into `failureStatus` with `failureMessage`, both with CORS
 * headers so browser verifiers can read the status.
 */
export function publicRoute<A extends HandlerArgs>(
  options: PublicRouteOptions,
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  const { limit, prefix, windowSeconds = 60, failureStatus, failureMessage, logTag, logLevel = "error" } = options;
  if (limit !== undefined && !prefix) throw new Error("publicRoute: a rate limit needs a key prefix");
  // Created once per module, as each route did before, so the counter store is shared across requests.
  const rateLimit: { limiter: RateLimiter; limit: number } | null =
    limit !== undefined && prefix
      ? { limiter: createRateLimiter(getCounterStore(), { limit, windowSeconds, prefix }), limit }
      : null;

  return async (...args: A): Promise<Response> => {
    try {
      if (rateLimit) {
        // Next always passes the request; a limited route called without one is a bug.
        const request = args[0];
        if (!request) throw new Error("publicRoute: a rate-limited route needs the request");
        const decision = await rateLimit.limiter(getClientIp(request));
        if (!decision.allowed) return rateLimitedResponse(decision, rateLimit.limit, corsHeaders());
      }
      return await handler(...args);
    } catch (error) {
      console[logLevel](logTag, error);
      return jsonResponse({ error: failureMessage }, failureStatus);
    }
  };
}
