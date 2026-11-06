import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripHiddenChars } from "@/components/verify/display-text";

describe("stripHiddenChars", () => {
  it("leaves ordinary text alone", () => {
    expect(stripHiddenChars("alice@example.com")).toBe("alice@example.com");
    expect(stripHiddenChars("名前@例え.jp")).toBe("名前@例え.jp");
  });

  it.each([
    ["zero-width space", 0x200b],
    ["right-to-left mark", 0x200f],
    ["left-to-right embedding", 0x202a],
    ["right-to-left override", 0x202e],
    ["word joiner", 0x2060],
    ["invisible plus", 0x2064],
    ["left-to-right isolate", 0x2066],
    ["pop directional isolate", 0x2069],
    ["byte order mark", 0xfeff],
  ])("removes %s", (_name, code) => {
    const hidden = String.fromCharCode(code);
    expect(stripHiddenChars(`a${hidden}b@example.com${hidden}`)).toBe("ab@example.com");
  });

  it("keeps visible neighbours of the ranges", () => {
    for (const code of [0x200a, 0x2010, 0x2029, 0x202f, 0x205f, 0x2065, 0x206a, 0xfefe]) {
      const ch = String.fromCharCode(code);
      expect(stripHiddenChars(ch)).toBe(ch);
    }
  });

  it("keeps its pattern as visible escapes in the source", () => {
    // Literal invisible characters are easy to lose to an editor or a paste.
    const source = readFileSync(new URL("./display-text.ts", import.meta.url), "utf8");
    expect(stripHiddenChars(source)).toBe(source);
  });

  it("defeats a right-to-left override that reverses an address", () => {
    expect(stripHiddenChars("\u202emoc.live@x")).toBe("moc.live@x");
  });
});
