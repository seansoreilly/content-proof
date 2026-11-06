import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyLogHead, type SignedLogHead } from "@/lib/log-verify";
import type { PublicKeysJson } from "@/lib/keyset";
import productionKeys from "@/test/fixtures/production-keys.json";

/**
 * Every tree head archived in `log-heads/` was signed in production. Verifying
 * them against a snapshot of the live `/.well-known/public-keys.json` proves
 * that the verifier still accepts real signatures, not just ones made in tests.
 *
 * The daily archive job keeps adding heads, but the fixture is a snapshot. A
 * head signed by a key the snapshot does not know (after a rotation) is
 * skipped rather than failed, so CI does not go red on an unrelated commit;
 * refresh the fixture from the live document to bring those heads back in.
 * The old key stays listed there, so earlier heads keep verifying.
 */
const keys = productionKeys as PublicKeysJson;
const headsDir = path.join(process.cwd(), "log-heads");
const heads = readdirSync(headsDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({
    name,
    head: JSON.parse(readFileSync(path.join(headsDir, name), "utf8")) as SignedLogHead,
  }));
const knownHeads = heads.filter(({ head }) => head.keyId in keys.keys);

describe("archived production log heads", () => {
  it("has heads signed by a key in the fixture", () => {
    expect(knownHeads.length).toBeGreaterThan(0);
  });

  it.each(knownHeads)("$name verifies against the published production keys", ({ head }) => {
    expect(verifyLogHead(head, keys)).toBe(true);
  });

  it("rejects an archived head whose root was altered", () => {
    const { head } = knownHeads[0];
    const altered = { ...head, root: head.root.replace(/^./, (c) => (c === "0" ? "1" : "0")) };
    expect(verifyLogHead(altered, keys)).toBe(false);
  });
});
