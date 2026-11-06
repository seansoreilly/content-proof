import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stubServerKeys, type TestKeyPair } from "@/test/fixtures";
import { keyIdFromSpkiBase64 } from "@/lib/keyset";
import { createMemoryLogStore, type LogStore } from "@/lib/log-store";
import type { SignedLogHead } from "@/lib/log-verify";
import { MerkleTree, leafHash } from "@/lib/merkle";
import { createMemoryStore } from "@/lib/rate-limit";
import type { SignatureRecord } from "@/lib/record";

/**
 * scripts/verify-log-head.mjs re-implements the consistency check in plain
 * Node for the archive workflow. These tests pin it to the TypeScript
 * verifier and run it end to end against the real route handlers.
 */
let log: LogStore = createMemoryLogStore();
vi.mock("@/lib/redis", () => ({
  getCounterStore: () => createMemoryStore(),
  getLogStore: () => log,
}));

const scriptPath = path.join(process.cwd(), "scripts", "verify-log-head.mjs");

type VerifyConsistency = (m: number, n: number, oldRoot: Buffer, newRoot: Buffer, proof: Buffer[]) => boolean;

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

describe("verify-log-head script: Merkle verifier", () => {
  it("agrees with the TypeScript consistency proofs for every 0 <= m <= n <= 24", async () => {
    const { verifyConsistency } = (await import(pathToFileURL(scriptPath).href)) as {
      verifyConsistency: VerifyConsistency;
    };
    const tree = MerkleTree.from(Array.from({ length: 24 }, (_, i) => leafHash(Uint8Array.of(i))));
    const buf = (b: Uint8Array): Buffer => Buffer.from(b);
    for (let n = 0; n <= 24; n++) {
      for (let m = 0; m <= n; m++) {
        const proof = tree.consistencyProof(m, n).map(buf);
        const oldRoot = buf(tree.root(m));
        const newRoot = buf(tree.root(n));
        expect(verifyConsistency(m, n, oldRoot, newRoot, proof), `${m}->${n}`).toBe(true);
        if (m > 0 && m < n) {
          const bad = proof.map((p) => Buffer.from(p));
          bad[0][0] ^= 1;
          expect(verifyConsistency(m, n, oldRoot, newRoot, bad)).toBe(false);
          expect(verifyConsistency(m, n, newRoot, oldRoot, proof)).toBe(false);
        }
      }
    }
    expect(verifyConsistency(5, 4, Buffer.alloc(32), Buffer.alloc(32), [])).toBe(false);
  });
});

describe("verify-log-head script: end to end", () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;
  let pair: TestKeyPair;
  /** Runs before each consistency request is served: simulates appends racing the script, or an outage. */
  let beforeConsistency: (() => Promise<Response | void>) | null = null;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "log-head-script-"));
    server = createServer((req, res) => {
      void (async () => {
        const url = req.url ?? "/";
        let response: Response;
        if (url === "/.well-known/public-keys.json") {
          const keyId = keyIdFromSpkiBase64(pair.publicKeyBase64);
          response = Response.json({
            current: keyId,
            keys: { [keyId]: { keyId, algorithm: "Ed25519", publicKey: pair.publicKeyBase64 } },
          });
        } else if (url.startsWith("/api/log/consistency")) {
          const { GET } = await import("@/app/api/log/consistency/route");
          const override = beforeConsistency ? await beforeConsistency() : undefined;
          response = override ?? (await GET(new Request(`http://t${url}`)));
        } else {
          response = new Response("not found", { status: 404 });
        }
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(await response.text());
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    log = createMemoryLogStore();
    pair = stubServerKeys();
    beforeConsistency = null;
  });

  async function head(): Promise<SignedLogHead> {
    const { buildSignedLogHead } = await import("@/lib/log-head");
    return buildSignedLogHead(log);
  }

  function save(name: string, value: unknown): string {
    const file = path.join(dir, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
  }

  function run(...files: string[]): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      const env = { ...process.env, VERIFY_LOG_HEAD_RETRY_MS: "1,1" };
      execFile(process.execPath, [scriptPath, "--base-url", baseUrl, ...files], { env }, (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, output: `${stdout}${stderr}` });
      });
    });
  }

  async function append(from: number, to: number): Promise<void> {
    for (let i = from; i < to; i++) await log.append(rec(i));
  }

  it("accepts a head that extends the previous one, including from size 0", async () => {
    const empty = save("empty.json", await head());
    await append(0, 3);
    const three = save("three.json", await head());
    await append(3, 7);
    const seven = save("seven.json", await head());

    for (const [prev, label] of [[empty, "from 0"], [three, "from 3"], [seven, "same size"]] as const) {
      const result = await run(seven, prev);
      expect(result.code, `${label}: ${result.output}`).toBe(0);
      expect(result.output).toContain("is a prefix of the new head");
    }
    const alone = await run(seven);
    expect(alone.code, alone.output).toBe(0);
  });

  it("still verifies when the log grows between the head and the proof", async () => {
    await append(0, 2);
    const prev = save("prev.json", await head());
    await append(2, 5);
    const next = save("next.json", await head());
    await append(5, 6);
    const result = await run(next, prev);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("both prefixes of the signed head of size 6");
  });

  it("fails when the log was rewritten, shrank, or a head was tampered with", async () => {
    await append(0, 4);
    const prevHead = await head();
    const prev = save("prev.json", prevHead);

    // Rewrite entry 1 and grow: the old head no longer links up.
    log = createMemoryLogStore();
    for (let i = 0; i < 6; i++) await log.append(i === 1 ? rec(50) : rec(i));
    const nextHead = await head();
    const next = save("next.json", nextHead);
    let result = await run(next, prev);
    expect(result.code).toBe(1);
    expect(result.output).toContain("does not verify");

    result = await run(prev, next);
    expect(result.code).toBe(1);
    expect(result.output).toContain("the log shrank");

    const flip = (hex: string): string => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    result = await run(save("bad-root.json", { ...nextHead, root: flip(nextHead.root) }));
    expect(result.code).toBe(1);
    expect(result.output).toContain("signature does not verify");

    result = await run(next, save("bad-prev.json", { ...prevHead, root: flip(prevHead.root) }));
    expect(result.code).toBe(1);
    expect(result.output).toContain("signature does not verify");

    result = await run(save("junk.json", { size: "3" }));
    expect(result.code).toBe(1);
    expect(result.output).toContain("is not a signed log head");
  });

  it("fails when the new head is not the service's current tree", async () => {
    await append(0, 3);
    const prev = save("prev.json", await head());
    await append(3, 5);
    const nextHead = await head();
    const next = save("next.json", nextHead);
    // A different tree of the same size, served as current.
    log = createMemoryLogStore();
    for (let i = 0; i < 5; i++) await log.append(i < 3 ? rec(i) : rec(70 + i));
    const result = await run(next, prev);
    expect(result.code).toBe(1);
    expect(result.output).toContain("not the new head's");
  });

  it("retries when the log keeps growing during the check", async () => {
    await append(0, 2);
    const prev = save("prev.json", await head());
    await append(2, 4);
    const next = save("next.json", await head());
    // Each consistency request is served after one more append, up to size 10.
    let n = 4;
    beforeConsistency = async () => {
      if (n < 10) {
        await append(n, n + 1);
        n += 1;
      }
    };
    const result = await run(next, prev);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("grew again");
    expect(result.output).toContain("both prefixes of the signed head");
  });

  it("exits 3, not 1, when the service is unavailable", async () => {
    await append(0, 2);
    const prev = save("prev.json", await head());
    await append(2, 3);
    const next = save("next.json", await head());
    let calls = 0;
    beforeConsistency = async () => {
      calls += 1;
      return Response.json({ error: "Log unavailable" }, { status: 503 });
    };
    const result = await run(next, prev);
    expect(result.code, result.output).toBe(3);
    expect(result.output).toContain("service unavailable");
    expect(calls).toBe(3);
  });
});
