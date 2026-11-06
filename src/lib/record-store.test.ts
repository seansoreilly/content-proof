import { describe, expect, it } from "vitest";
import { createMemoryRecordStore, parseStoredRecord } from "@/lib/record-store";
import type { SignatureRecord } from "@/lib/record";

const record: SignatureRecord = {
  v: 2,
  k: "AbCdEfGhIjKlMnOp",
  h: "A".repeat(42) + "Q",
  e: "user@example.com",
  t: 1_760_000_000_000,
  s: "S".repeat(86),
};

describe("parseStoredRecord", () => {
  it("accepts a JSON string, as stored", () => {
    expect(parseStoredRecord(JSON.stringify(record))).toEqual(record);
  });

  it("accepts an object Upstash has already deserialised", () => {
    expect(parseStoredRecord({ ...record })).toEqual(record);
  });

  it("returns null for missing values", () => {
    expect(parseStoredRecord(null)).toBeNull();
    expect(parseStoredRecord(undefined)).toBeNull();
  });

  it("returns null instead of throwing on corrupt JSON", () => {
    expect(parseStoredRecord("{not json")).toBeNull();
    expect(parseStoredRecord("")).toBeNull();
  });

  it("returns null for well-formed JSON that is not a record", () => {
    expect(parseStoredRecord(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseStoredRecord("42")).toBeNull();
    expect(parseStoredRecord(42)).toBeNull();
    expect(parseStoredRecord({ ...record, v: 99 })).toBeNull();
  });
});

describe("memory record store", () => {
  it("stores records by signature and misses unknown signatures", async () => {
    const store = createMemoryRecordStore();
    expect(await store.get(record.s)).toBeNull();
    await store.put(record);
    expect(await store.get(record.s)).toEqual(record);
    expect(await store.get("Z".repeat(86))).toBeNull();
  });

  it("keeps separate instances independent", async () => {
    const a = createMemoryRecordStore();
    const b = createMemoryRecordStore();
    await a.put(record);
    expect(await b.get(record.s)).toBeNull();
  });
});
