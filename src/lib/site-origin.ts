/**
 * Work out the absolute origin of this deployment for links that leave the
 * browser, such as the verification URL in a QR code. A phone that scans a
 * code cannot resolve a relative path, so these links must be absolute.
 */

export const DEFAULT_SITE_ORIGIN = "https://www.contentproof.app";

/** The subset of `Headers` this needs, so tests can pass a plain stub. */
export interface HeaderSource {
  get(name: string): string | null;
}

// A bare host name, IPv4 address or bracketed IPv6 address, with an optional
// port. Anything else in the Host header is ignored rather than echoed into a link.
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "[::1]";
}

/**
 * Resolve the site origin, without a trailing slash. In order of preference:
 * the configured `NEXT_PUBLIC_VERIFY_BASE_URL`, the request's own host (with
 * `x-forwarded-proto`, defaulting to https, or http for localhost), and
 * finally the production origin.
 */
export function resolveSiteOrigin(
  env: { NEXT_PUBLIC_VERIFY_BASE_URL?: string | undefined },
  headers: HeaderSource | null | undefined
): string {
  const configured = env.NEXT_PUBLIC_VERIFY_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = headers?.get("host")?.trim();
  if (host && HOST_RE.test(host)) {
    const forwarded = headers?.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const proto =
      forwarded === "http" || forwarded === "https" ? forwarded : isLocalHost(host) ? "http" : "https";
    return `${proto}://${host}`;
  }

  return DEFAULT_SITE_ORIGIN;
}
