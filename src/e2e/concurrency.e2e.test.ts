import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/test/fixtures";
import { bytesToHex } from "@/lib/base64";
import {
  recordLeafHash,
  verifyInclusionProof,
  verifyLogHead,
  type InclusionProofResponse,
  type SignedLogHead,
} from "@/lib/log-verify";
import { USER_KEY_REVOKED_MESSAGE } from "@/lib/user-key-status";
import {
  NEEDS_ACCOUNTS,
  accountName,
  api,
  base,
  keyStatus,
  login,
  makeUserKey,
  multiAccount,
  publicKeys,
  revokeKey,
  runId,
  sign,
  sleep,
  setClientIp,
  v3Body,
  type Account,
  type SignResult,
} from "@/e2e/helpers";

/**
 * Concurrency against a live server: parallel signing keeps the transparency
 * log consistent, the per-account rate limit holds under a burst, and a key
 * revocation cannot be outrun by signing requests that start after it.
 *
 * Budgets: signing is limited to 30 per account per minute. With the
 * preview-test provider every scenario gets fresh accounts (named per run).
 * The debug provider has one account whose budget the other e2e files share,
 * so there the burst is 18 requests (leaving room for the other files' signs
 * within the same minute) and the scenarios that need a fresh
 * account skip.
 */
setClientIp(11);

const SIGN_LIMIT = 30;
const BURST_ACCOUNTS = multiAccount ? 3 : 1;
const BURST_PER_ACCOUNT = multiAccount ? 10 : 18;

describe.skipIf(!base)("concurrent signing", () => {
  it(`signs ${BURST_ACCOUNTS} x ${BURST_PER_ACCOUNT} concurrent v2/v3 requests into a consistent log`, async () => {
    const accounts = multiAccount
      ? await Promise.all(["conc-a", "conc-b", "conc-c"].map((p) => login(accountName(p))))
      : [await login()];

    // Distinct hashes: a v2 signature is deterministic over hash, email and
    // millisecond, so identical requests in the same millisecond would
    // legitimately produce identical records.
    const requests = await Promise.all(
      accounts.flatMap((account, a) =>
        Array.from({ length: BURST_PER_ACCOUNT }, async (_, i) => {
          const fileHash = sha256Hex(`concurrency ${runId} ${a} ${i}`);
          if (i % 2 === 0) return { account, body: { fileHash } as unknown };
          return { account, body: await v3Body(account, await userKeyFor(a), fileHash) as unknown };
        })
      )
    );
    const results = await Promise.all(requests.map(({ account, body }) => sign(account, body)));

    for (const r of results) {
      expect(r.status, r.body.error).toBe(200);
      expect(r.body.logged).toBe(true);
      expect(Number.isInteger(r.body.logIndex)).toBe(true);
    }
    const issued = results.map((r) => ({ record: r.record!, logIndex: r.body.logIndex as number }));
    expect(issued.filter(({ record }) => record.v === 3)).toHaveLength(BURST_ACCOUNTS * Math.floor(BURST_PER_ACCOUNT / 2));
    expect(new Set(issued.map(({ record }) => record.s)).size).toBe(issued.length);
    expect(new Set(issued.map(({ logIndex }) => logIndex)).size).toBe(issued.length);

    // The head covers every index handed out and is genuinely signed.
    const keys = await publicKeys();
    const head = (await (await api("/api/log/head")).json()) as SignedLogHead;
    expect(verifyLogHead(head, keys)).toBe(true);
    const maxIndex = Math.max(...issued.map(({ logIndex }) => logIndex));
    const minIndex = Math.min(...issued.map(({ logIndex }) => logIndex));
    expect(head.size).toBeGreaterThan(maxIndex);

    // Every record's inclusion proof verifies, at the index it was given.
    const proofs = await Promise.all(
      issued.map(async ({ record }) => {
        const res = await api(`/api/log/proof?signature=${encodeURIComponent(record.s)}`);
        expect(res.status).toBe(200);
        return (await res.json()) as InclusionProofResponse;
      })
    );
    proofs.forEach((proof, i) => {
      expect(proof.index).toBe(issued[i].logIndex);
      expect(verifyInclusionProof(issued[i].record, proof, keys)).toBe(true);
    });

    // The public feed holds each record's leaf at that same index.
    const span = maxIndex - minIndex + 1;
    expect(span).toBeLessThanOrEqual(500);
    const page = (await (await api(`/api/log/entries?from=${minIndex}&limit=${span}`)).json()) as {
      entries: Array<{ index: number; leafHash: string; h: string; t: number; k: string; v: number }>;
    };
    const byIndex = new Map(page.entries.map((e) => [e.index, e]));
    for (const { record, logIndex } of issued) {
      expect(byIndex.get(logIndex)).toEqual({
        index: logIndex,
        leafHash: bytesToHex(recordLeafHash(record)),
        h: record.h,
        t: record.t,
        k: record.k,
        v: record.v,
      });
    }
  }, 120_000);

  it.skipIf(!multiAccount)(`allows exactly ${SIGN_LIMIT} signatures per account per minute ${NEEDS_ACCOUNTS}`, async () => {
    const account = await login(accountName("rate"));
    const results = await Promise.all(
      Array.from({ length: SIGN_LIMIT + 1 }, (_, i) => sign(account, { fileHash: sha256Hex(`rate ${runId} ${i}`) }))
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(SIGN_LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    expect(results.find((r) => r.status === 429)!.body.error).toBe("Too many requests");
  }, 60_000);

  describe.skipIf(!multiAccount)(`key revocation races ${NEEDS_ACCOUNTS}`, () => {
    // One account for both races: 1 + 12 + 3 signs, then 3 x 3.
    const racer = (): Promise<Account> => login(accountName("race"));

    it("issues no 200 for a key once its revocation has been answered", async () => {
      const account = await racer();
      const key = await makeUserKey();
      const first = await sign(account, await v3Body(account, key, sha256Hex(`race ${runId} first`)));
      expect(first.status, first.body.error).toBe(200);

      // Bodies are prepared up front so each request starts the moment it is sent.
      const bodies = await Promise.all(
        Array.from({ length: 12 }, (_, i) => v3Body(account, key, sha256Hex(`race ${runId} ${i}`)))
      );
      let revokeAnswered = false;
      let revokePromise: Promise<Response> | null = null;
      const burst: Array<Promise<SignResult & { startedAfterRevoke: boolean }>> = [];
      for (const [i, body] of bodies.entries()) {
        if (i === 4) {
          revokePromise = revokeKey(account, key.publicKey).then((res) => {
            revokeAnswered = true;
            return res;
          });
        }
        const startedAfterRevoke = revokeAnswered;
        burst.push(sign(account, body).then((r) => ({ ...r, startedAfterRevoke })));
        await sleep(15);
      }
      const revokeRes = await revokePromise!;
      expect(revokeRes.status).toBe(200);
      const { key: revoked } = (await revokeRes.json()) as { key: { publicKey: string; revokedAt: number } };
      expect(revoked.publicKey).toBe(key.publicKey);

      // Signs that start now, strictly after the revocation was answered.
      const after: SignResult[] = [];
      for (let i = 0; i < 3; i++) {
        after.push(await sign(account, await v3Body(account, key, sha256Hex(`race ${runId} after ${i}`))));
      }

      const inFlight = await Promise.all(burst);
      // In flight: either outcome is allowed (the documented race window).
      for (const r of inFlight) {
        expect([200, 403], r.body.error).toContain(r.status);
        if (r.status === 403) expect(r.body.error).toBe(USER_KEY_REVOKED_MESSAGE);
      }
      // Started after the answer: always refused.
      for (const r of [...after, ...inFlight.filter((r) => r.startedAfterRevoke)]) {
        expect(r.status).toBe(403);
        expect(r.body.error).toBe(USER_KEY_REVOKED_MESSAGE);
      }

      const status = await keyStatus(key.publicKey);
      expect(status).toMatchObject({ known: true, revokedAt: revoked.revokedAt });
    }, 60_000);

    it("ends revoked when a revoke and a signing touch race", async () => {
      const account = await racer();
      for (let round = 0; round < 3; round++) {
        const key = await makeUserKey();
        const first = await sign(account, await v3Body(account, key, sha256Hex(`touch ${runId} ${round}`)));
        expect(first.status, first.body.error).toBe(200);

        const raceBody = await v3Body(account, key, sha256Hex(`touch ${runId} ${round} race`));
        const [revokeRes, raced] = await Promise.all([revokeKey(account, key.publicKey), sign(account, raceBody)]);
        expect(revokeRes.status).toBe(200);
        expect([200, 403]).toContain(raced.status);

        // Whatever order the registry saw, the touch did not un-revoke the key.
        expect((await keyStatus(key.publicKey)).revokedAt).toEqual(expect.any(Number));
        const later = await sign(account, await v3Body(account, key, sha256Hex(`touch ${runId} ${round} later`)));
        expect(later.status).toBe(403);
        expect(later.body.error).toBe(USER_KEY_REVOKED_MESSAGE);
      }
    }, 60_000);
  });
});

/** One user key per burst account, shared by that account's v3 requests. */
const burstKeys = new Map<number, ReturnType<typeof makeUserKey>>();
function userKeyFor(account: number): ReturnType<typeof makeUserKey> {
  let key = burstKeys.get(account);
  if (!key) burstKeys.set(account, (key = makeUserKey()));
  return key;
}
