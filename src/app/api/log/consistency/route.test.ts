import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeKeyPair, stubServerKeys, type TestKeyPair } from "@/test/fixtures";
import { keyIdFromSpkiBase64, type PublicKeysJson } from "@/lib/keyset";
import { createMemoryLogStore, type LogStore } from "@/lib/log-store";
import {
  verifyConsistencyResponse,
  verifyLogConsistency,
  type ConsistencyProofResponse,
  type SignedLogHead,
} from "@/lib/log-verify";
import { createMemoryStore } from "@/lib/rate-limit";
import type { SignatureRecord } from "@/lib/record";

let log: LogStore = createMemoryLogStore();
vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getLogStore: () => log,
}));

function rec(i: number): SignatureRecord {
  return {
    v: 2,
    k: "AbCdEfGhIjKlMnOp",
    h: "A".repeat(42) + "Q",
    e: `user${i}@example.com`,
    t: 1_760_000_000_000 + i,
    s: String.fromCharCode(65 + (i % 26)).repeat(85) + String.fromCharCode(65 + Math.floor(i / 26)),
  };
}

function keysFor(pair: TestKeyPair): PublicKeysJson {
  const keyId = keyIdFromSpkiBase64(pair.publicKeyBase64);
  return { current: keyId, keys: { [keyId]: { keyId, algorithm: "Ed25519", publicKey: pair.publicKeyBase64 } } };
}

async function load() {
  vi.resetModules();
  const consistency = await import("@/app/api/log/consistency/route");
  const head = await import("@/app/api/log/head/route");
  const getHead = async (): Promise<SignedLogHead> =>
    (await (await head.GET(new Request("http://t/api/log/head"))).json()) as SignedLogHead;
  const get = (qs: string, ip = "203.0.113.9"): Promise<Response> =>
    consistency.GET(new Request(`http://t/api/log/consistency${qs}`, { headers: { "x-forwarded-for": ip } }));
  return { consistency, getHead, get };
}

describe("GET /api/log/consistency", () => {
  let pair: TestKeyPair;
  let keys: PublicKeysJson;

  beforeEach(() => {
    log = createMemoryLogStore();
    pair = stubServerKeys();
    keys = keysFor(pair);
  });

  it("proves every archived head is a prefix of the current tree", async () => {
    const { getHead, get } = await load();
    const heads: SignedLogHead[] = [await getHead()];
    for (let i = 0; i < 12; i++) {
      await log.append(rec(i));
      heads.push(await getHead());
    }
    for (const old of heads) {
      const res = await get(`?from=${old.size}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const body = (await res.json()) as ConsistencyProofResponse;
      expect(body).toMatchObject({ from: old.size, to: 12 });
      expect(body.head.size).toBe(12);
      expect(body.head.root).toBe(heads[12].root);
      if (old.size === 0 || old.size === 12) expect(body.proof).toEqual([]);
      expect(verifyConsistencyResponse(old, body, keys)).toBe(true);
      expect(verifyLogConsistency(old, heads[12], body.proof, keys)).toBe(true);
    }

    // An explicit `to` equal to the current size is the same request.
    const explicit = (await (await get("?from=5&to=12")).json()) as ConsistencyProofResponse;
    expect(verifyConsistencyResponse(heads[5], explicit, keys)).toBe(true);
  });

  it("rejects a rewritten history, a forged head and a mismatched response", async () => {
    const { getHead, get } = await load();
    for (let i = 0; i < 6; i++) await log.append(rec(i));
    const old = await getHead();
    const body = (await (await get(`?from=${old.size}`)).json()) as ConsistencyProofResponse;
    expect(verifyConsistencyResponse(old, body, keys)).toBe(true);

    // The log is rewritten: entry 2 replaced, then grown. The old head no longer links up.
    log = createMemoryLogStore();
    for (let i = 0; i < 9; i++) await log.append(i === 2 ? rec(99) : rec(i));
    const rewritten = (await (await get(`?from=${old.size}`)).json()) as ConsistencyProofResponse;
    expect(rewritten.to).toBe(9);
    expect(verifyConsistencyResponse(old, rewritten, keys)).toBe(false);

    const flip = (hex: string): string => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    const grown = (await (await get("?from=6")).json()) as ConsistencyProofResponse;
    const goodOld = { ...old };
    // Signature checks: a head signed by another key, or with an edited root, fails.
    const otherKeys = keysFor(makeKeyPair());
    expect(verifyLogConsistency(goodOld, grown.head, grown.proof, otherKeys)).toBe(false);
    expect(verifyLogConsistency({ ...goodOld, root: flip(goodOld.root) }, grown.head, grown.proof, keys)).toBe(false);
    expect(verifyLogConsistency(goodOld, { ...grown.head, size: 10 }, grown.proof, keys)).toBe(false);
    expect(verifyLogConsistency(goodOld, grown.head, ["not hex"], keys)).toBe(false);
    expect(verifyConsistencyResponse(goodOld, { ...grown, from: 5 }, keys)).toBe(false);
    expect(verifyConsistencyResponse(goodOld, { ...grown, to: 8 }, keys)).toBe(false);
    expect(verifyConsistencyResponse(goodOld, { ...grown, proof: grown.proof.map(flip) }, keys)).toBe(false);
  });

  it("answers 400 for missing, malformed or unsignable sizes", async () => {
    const { get } = await load();
    for (let i = 0; i < 4; i++) await log.append(rec(i));
    for (const qs of ["", "?to=4", "?from=-1", "?from=1.5", "?from=abc", "?from=1&to=", "?from=1&to=x", "?from=3&to=2"]) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(res.headers.get("access-control-allow-origin"), qs).toBe("*");
    }
    const past = await get("?from=1&to=3");
    expect(past.status).toBe(400);
    expect(await past.json()).toMatchObject({ size: 4 });
    const ahead = await get("?from=5");
    expect(ahead.status).toBe(400);
    expect(await ahead.json()).toMatchObject({ size: 4 });
    expect((await get("?from=4&to=4")).status).toBe(200);
  });

  it("is rate limited per client IP and answers the CORS preflight", async () => {
    const { consistency, get } = await load();
    for (let i = 0; i < 60; i++) expect((await get("?from=0", "198.51.100.7")).status).toBe(200);
    const blocked = await get("?from=0", "198.51.100.7");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get("?from=0", "198.51.100.8")).status).toBe(200);

    const preflight = consistency.OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers 503 when the log store fails", async () => {
    const { get } = await load();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log = { ...createMemoryLogStore(), size: async () => Promise.reject(new Error("redis down")) };
    const res = await get("?from=0");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Log unavailable" });
    error.mockRestore();
  });
});
