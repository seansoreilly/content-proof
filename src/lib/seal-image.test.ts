import { describe, expect, it } from "vitest";
import { rimFontSizeFraction, rimTextFor, SEAL_GEOMETRY } from "@/lib/seal-image";

describe("rimTextFor", () => {
  it("formats the exact rim text in UTC with zero padding", () => {
    const t = Date.UTC(2026, 0, 5, 3, 7, 59);
    expect(rimTextFor({ t, k: "abcdefghijklmnop" })).toBe(
      "ContentProof · attested · 2026-01-05 03:07 UTC · abcdefghijklmnop ·",
    );
  });

  it("uses UTC fields regardless of local time zone", () => {
    const t = Date.UTC(2026, 11, 31, 23, 59, 0);
    expect(rimTextFor({ t, k: "K" })).toContain("2026-12-31 23:59 UTC");
  });
});

describe("SEAL_GEOMETRY", () => {
  const g = SEAL_GEOMETRY;
  it("keeps the slot corners inside the inner ring", () => {
    const corner = (g.slotSize / 2) * Math.SQRT2;
    expect(corner).toBeLessThan(g.innerRingRadius - g.innerRingWidth / 2);
  });
  it("puts the text radius between the rings", () => {
    expect(g.textRadius).toBeGreaterThan(g.innerRingRadius);
    expect(g.textRadius).toBeLessThan(g.outerRingRadius);
  });
  it("keeps the rim text band between the rings", () => {
    const half = rimFontSizeFraction(67) / 2;
    expect(g.textRadius - half).toBeGreaterThan(g.innerRingRadius);
    expect(g.textRadius + half).toBeLessThan(g.outerRingRadius);
  });
  it("clamps the font size", () => {
    expect(rimFontSizeFraction(1)).toBe(g.maxFontSize);
    expect(rimFontSizeFraction(10000)).toBe(g.minFontSize);
  });
});
