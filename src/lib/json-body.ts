/**
 * Reading JSON request bodies with the two checks `request.json()` skips.
 *
 * Content type. The session endpoints (`/api/sign`, `/api/account/keys/revoke`)
 * act on the session cookie. A cross-site page can send a "simple" POST
 * (text/plain, form-encoded or multipart) without a CORS preflight, and
 * `request.json()` parses such a body all the same. The SameSite=Lax session
 * cookie already keeps a cross-site POST from carrying the session in current
 * browsers; requiring `application/json`, which a cross-site page cannot send
 * without a preflight this app never answers, makes that not the only defence.
 *
 * Size. `request.json()` buffers whatever arrives. Every legitimate body here
 * is well under a kilobyte, so anything past `maxBytes` is refused with 413
 * before it is buffered, whether or not it announced its length.
 */

/** Generous for any body these endpoints take: a record, a hash, a key and two signatures. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415; error: string };

/** True when the request declares `application/json` (parameters such as charset allowed). */
export function hasJsonContentType(request: Request): boolean {
  const type = request.headers.get("content-type");
  return type !== null && type.split(";")[0].trim().toLowerCase() === "application/json";
}

/** The 415 refusal for a non-JSON body, or null when the content type is JSON. */
export function jsonContentTypeError(request: Request): { status: 415; error: string } | null {
  return hasJsonContentType(request) ? null : { status: 415, error: "Content-Type must be application/json" };
}

/**
 * The checks that need only the headers: 415 for a non-JSON content type,
 * then 413 for an announced length over `maxBytes`. Cheap enough to run
 * before a rate limiter, so refused requests spend no budget.
 */
export function jsonRequestHeadersError(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES
): { status: 413 | 415; error: string } | null {
  return jsonContentTypeError(request) ?? (declaresTooLarge(request, maxBytes) ? TOO_LARGE_ERROR : null);
}

function declaresTooLarge(request: Request, maxBytes: number): boolean {
  const declared = request.headers.get("content-length");
  return declared !== null && Number(declared) > maxBytes;
}

const TOO_LARGE_ERROR = { status: 413, error: "Request body too large" } as const;
const TOO_LARGE = { ok: false, ...TOO_LARGE_ERROR } as const;

/**
 * Read and parse the body as JSON, refusing more than `maxBytes`. Does not
 * check the content type; callers that need it call `jsonContentTypeError` first.
 */
export async function readJsonBody(request: Request, maxBytes: number = MAX_JSON_BODY_BYTES): Promise<JsonBodyResult> {
  if (declaresTooLarge(request, maxBytes)) return TOO_LARGE;

  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return TOO_LARGE;
        }
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      // The client aborted or sent a broken body: its fault, as request.json() would say.
      return { ok: false, status: 400, error: "Invalid JSON" };
    }
    text += decoder.decode();
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
}
