import { describe, expect, it } from "vitest";
import {
  MAX_JSON_BODY_BYTES,
  hasJsonContentType,
  jsonContentTypeError,
  jsonRequestHeadersError,
  readJsonBody,
} from "@/lib/json-body";

const post = (body: BodyInit | null, headers: Record<string, string> = {}): Request =>
  new Request("http://t/x", { method: "POST", headers, body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

/** A body streamed in chunks with no Content-Length, as a chunked upload arrives. */
function chunked(totalBytes: number, chunkBytes = 16 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const n = Math.min(chunkBytes, totalBytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
}

describe("hasJsonContentType", () => {
  it("accepts application/json with any case and parameters, and nothing else", () => {
    expect(hasJsonContentType(post("{}", { "content-type": "application/json" }))).toBe(true);
    expect(hasJsonContentType(post("{}", { "content-type": "Application/JSON; charset=utf-8" }))).toBe(true);
    // The three content types a cross-site form or a no-preflight fetch can send.
    expect(hasJsonContentType(post("{}", { "content-type": "text/plain" }))).toBe(false);
    expect(hasJsonContentType(post("{}", { "content-type": "application/x-www-form-urlencoded" }))).toBe(false);
    expect(hasJsonContentType(post("{}", { "content-type": "multipart/form-data; boundary=x" }))).toBe(false);
    expect(hasJsonContentType(post("{}", { "content-type": "application/json-patch+json" }))).toBe(false);
    // A string body with no header gets text/plain from the Request constructor.
    expect(hasJsonContentType(post("{}"))).toBe(false);
    expect(jsonContentTypeError(post("{}"))).toEqual({ status: 415, error: "Content-Type must be application/json" });
    expect(jsonContentTypeError(post("{}", { "content-type": "application/json" }))).toBeNull();
  });
});

describe("jsonRequestHeadersError", () => {
  it("refuses a non-JSON type first, then an announced oversized length", () => {
    const json = { "content-type": "application/json" };
    expect(jsonRequestHeadersError(post("{}", json))).toBeNull();
    expect(jsonRequestHeadersError(post("{}", { "content-type": "text/plain" }))).toMatchObject({ status: 415 });
    const big = { ...json, "content-length": String(MAX_JSON_BODY_BYTES + 1) };
    expect(jsonRequestHeadersError(post("{}", big))).toEqual({ status: 413, error: "Request body too large" });
    expect(jsonRequestHeadersError(post("{}", { ...big, "content-type": "text/plain" }))).toMatchObject({ status: 415 });
  });
});

describe("readJsonBody", () => {
  it("parses JSON and reports malformed or empty bodies as 400", async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJsonBody(post("{"))).toEqual({ ok: false, status: 400, error: "Invalid JSON" });
    expect(await readJsonBody(post(null))).toEqual({ ok: false, status: 400, error: "Invalid JSON" });
  });

  it("refuses an announced oversized body without reading it", async () => {
    const req = post("{}", { "content-length": String(MAX_JSON_BODY_BYTES + 1) });
    expect(await readJsonBody(req)).toMatchObject({ ok: false, status: 413 });
  });

  it("stops reading a chunked body once it passes the limit", async () => {
    expect(await readJsonBody(post(chunked(2 * 1024 * 1024)))).toMatchObject({ ok: false, status: 413 });
    expect(await readJsonBody(post(chunked(MAX_JSON_BODY_BYTES)))).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(post(JSON.stringify({ pad: "x".repeat(100) })), 50)).toMatchObject({ status: 413 });
  });

  it("answers a body stream that fails midway with 400, not an exception", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.error(new Error("client went away"));
      },
    });
    expect(await readJsonBody(post(broken))).toEqual({ ok: false, status: 400, error: "Invalid JSON" });
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ s: "é€😀" }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });
    expect(await readJsonBody(post(stream))).toEqual({ ok: true, value: { s: "é€😀" } });
  });
});
