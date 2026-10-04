import { describe, expect, test } from "vitest";

import { IMPORT_ERROR_KEYS, importErrorVars } from "~/routes/dns/import-error-keys";
import {
  exportFileName,
  importRecords,
  MAX_IMPORT_RECORDS,
  parseImportMode,
  parseRecordsJson,
  planImport,
  serializeRecords,
  type DNSRecordInput,
} from "~/routes/dns/records-io";

const EXISTING: DNSRecordInput[] = [
  { name: "existing.example.com", type: "A", value: "10.0.0.1" },
  { name: "v6.example.com", type: "AAAA", value: "2001:db8::1" },
];

function record(name: string, type = "A", value = "10.0.0.2"): DNSRecordInput {
  return { name, type, value };
}

describe("parseRecordsJson", () => {
  test("accepts a valid array of records", () => {
    const result = parseRecordsJson('[{"name":"a.example.com","type":"A","value":"10.0.0.1"}]');

    expect(result).toEqual({ ok: true, records: [record("a.example.com", "A", "10.0.0.1")] });
  });

  test("accepts every type the DNS page offers", () => {
    const text = JSON.stringify([
      { name: "a.example.com", type: "A", value: "10.0.0.1" },
      { name: "aaaa.example.com", type: "AAAA", value: "2001:db8::1" },
    ]);

    expect(parseRecordsJson(text).ok).toBe(true);
  });

  test("ignores extra properties and trims surrounding whitespace", () => {
    const result = parseRecordsJson(
      '[{"name":" a.example.com ","type":"A","value":" 10.0.0.1 ","ttl":300}]',
    );

    expect(result).toEqual({ ok: true, records: [record("a.example.com", "A", "10.0.0.1")] });
  });

  test("rejects empty input and an empty array", () => {
    expect(parseRecordsJson("")).toEqual({ ok: false, error: { code: "empty" } });
    expect(parseRecordsJson("   \n ")).toEqual({ ok: false, error: { code: "empty" } });
    expect(parseRecordsJson("[]")).toEqual({ ok: false, error: { code: "empty" } });
  });

  test("rejects input that is not valid JSON", () => {
    expect(parseRecordsJson("not json")).toEqual({ ok: false, error: { code: "invalidJson" } });
    expect(parseRecordsJson('{"name":"a"}')).toEqual({ ok: false, error: { code: "notArray" } });
    expect(parseRecordsJson('"a.example.com"')).toEqual({ ok: false, error: { code: "notArray" } });
  });

  test("rejects entries that are not objects", () => {
    expect(parseRecordsJson('["a.example.com"]')).toEqual({
      ok: false,
      error: { code: "notObject", index: 0 },
    });
    expect(parseRecordsJson('[{"name":"a","type":"A","value":"1"}, null]')).toEqual({
      ok: false,
      error: { code: "notObject", index: 1 },
    });
    expect(parseRecordsJson('[{"name":"a","type":"A","value":"1"}, []]')).toEqual({
      ok: false,
      error: { code: "notObject", index: 1 },
    });
  });

  test("rejects a missing or unusable name", () => {
    expect(parseRecordsJson('[{"type":"A","value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "invalidName", index: 0 },
    });
    expect(parseRecordsJson('[{"name":"","type":"A","value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "invalidName", index: 0 },
    });
    expect(parseRecordsJson('[{"name":5,"type":"A","value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "invalidName", index: 0 },
    });
    expect(parseRecordsJson('[{"name":null,"type":"A","value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "invalidName", index: 0 },
    });
  });

  test("rejects a missing or unusable value", () => {
    expect(parseRecordsJson('[{"name":"a.example.com","type":"A"}]')).toEqual({
      ok: false,
      error: { code: "invalidValue", index: 0 },
    });
    expect(parseRecordsJson('[{"name":"a.example.com","type":"A","value":"  "}]')).toEqual({
      ok: false,
      error: { code: "invalidValue", index: 0 },
    });
    expect(parseRecordsJson('[{"name":"a.example.com","type":"A","value":123}]')).toEqual({
      ok: false,
      error: { code: "invalidValue", index: 0 },
    });
  });

  test("rejects a type that is not a string", () => {
    expect(parseRecordsJson('[{"name":"a.example.com","type":5,"value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "invalidType", index: 0 },
    });
    expect(parseRecordsJson('[{"name":"a.example.com","value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "invalidType", index: 0 },
    });
  });

  test("rejects a type the DNS page does not offer", () => {
    expect(
      parseRecordsJson('[{"name":"a.example.com","type":"CNAME","value":"b.example.com"}]'),
    ).toEqual({
      ok: false,
      error: { code: "unsupportedType", index: 0, type: "CNAME" },
    });
    expect(parseRecordsJson('[{"name":"a.example.com","type":"a","value":"10.0.0.1"}]')).toEqual({
      ok: false,
      error: { code: "unsupportedType", index: 0, type: "a" },
    });
  });

  test("names the offending entry for a later record", () => {
    const text = JSON.stringify([
      { name: "a.example.com", type: "A", value: "10.0.0.1" },
      { name: "b.example.com", type: "AAAA", value: "2001:db8::2" },
      { name: "c.example.com", type: "MX", value: "mail.example.com" },
    ]);

    expect(parseRecordsJson(text)).toEqual({
      ok: false,
      error: { code: "unsupportedType", index: 2, type: "MX" },
    });
  });

  test("rejects more than the maximum number of records", () => {
    const tooMany = Array.from({ length: MAX_IMPORT_RECORDS + 1 }, (_, i) =>
      record(`host-${i}.example.com`),
    );

    expect(parseRecordsJson(JSON.stringify(tooMany))).toEqual({
      ok: false,
      error: { code: "tooManyRecords", count: MAX_IMPORT_RECORDS + 1 },
    });
    expect(parseRecordsJson(JSON.stringify(tooMany.slice(1))).ok).toBe(true);
  });

  test("every error code maps onto a localized message that uses its placeholders", () => {
    expect(Object.keys(IMPORT_ERROR_KEYS).sort()).toEqual([
      "conflictingRecord",
      "empty",
      "invalidJson",
      "invalidName",
      "invalidType",
      "invalidValue",
      "notArray",
      "notObject",
      "tooManyRecords",
      "unsupportedType",
    ]);
    expect(importErrorVars({ code: "notObject", index: 4 })).toMatchObject({ position: 5 });
    expect(importErrorVars({ code: "unsupportedType", type: "MX" })).toMatchObject({ type: "MX" });
    expect(importErrorVars({ code: "tooManyRecords", count: 1001 })).toMatchObject({
      count: 1001,
      max: MAX_IMPORT_RECORDS,
    });
  });
});

describe("planImport", () => {
  test("append keeps existing records and adds the imported ones", () => {
    const plan = planImport([record("new.example.com")], EXISTING, "append");

    expect(plan.records).toEqual([...EXISTING, record("new.example.com")]);
    expect(plan.added).toEqual([record("new.example.com")]);
    expect(plan.removed).toEqual([]);
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(0);
  });

  test("append skips records that are already configured", () => {
    const plan = planImport([EXISTING[0], record("new.example.com")], EXISTING, "append");

    expect(plan.records).toEqual([...EXISTING, record("new.example.com")]);
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(1);
  });

  test("append skips repeated entries in the file", () => {
    const plan = planImport(
      [record("new.example.com"), record("new.example.com")],
      EXISTING,
      "append",
    );

    expect(plan.records).toEqual([...EXISTING, record("new.example.com")]);
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(1);
  });

  test("append treats a different value for a known name as new", () => {
    const plan = planImport(
      [{ name: "existing.example.com", type: "A", value: "10.0.0.9" }],
      EXISTING,
      "append",
    );

    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(0);
  });

  test("replace writes only the imported records", () => {
    const plan = planImport([record("new.example.com")], EXISTING, "replace");

    expect(plan.records).toEqual([record("new.example.com")]);
    expect(plan.added).toEqual([record("new.example.com")]);
    expect(plan.removed).toEqual(EXISTING);
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(0);
  });

  test("replace dedupes the file and keeps identical records", () => {
    const plan = planImport(
      [EXISTING[0], EXISTING[0], record("new.example.com")],
      EXISTING,
      "replace",
    );

    expect(plan.records).toEqual([EXISTING[0], record("new.example.com")]);
    expect(plan.added).toEqual([record("new.example.com")]);
    expect(plan.removed).toEqual([EXISTING[1]]);
    expect(plan.imported).toBe(2);
    expect(plan.skipped).toBe(1);
  });

  test("replace with the same records changes nothing", () => {
    const plan = planImport(EXISTING, EXISTING, "replace");

    expect(plan.records).toEqual(EXISTING);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.skipped).toBe(0);
  });
});

describe("importRecords", () => {
  test("round-trips an export back into the configuration", () => {
    const exported = serializeRecords(EXISTING);

    expect(exported).toBe(JSON.stringify(EXISTING, null, 2));

    const result = importRecords(exported, [], "append");
    expect(result.ok && result.plan.records).toEqual(EXISTING);
  });

  test("reports the parse error without planning anything", () => {
    const result = importRecords("[{]", EXISTING, "append");

    expect(result).toEqual({ ok: false, error: { code: "invalidJson" } });
  });
});

describe("parseImportMode", () => {
  test("accepts only replace, defaulting to append", () => {
    expect(parseImportMode("replace")).toBe("replace");
    expect(parseImportMode("append")).toBe("append");
    expect(parseImportMode(undefined)).toBe("append");
    expect(parseImportMode("")).toBe("append");
    expect(parseImportMode("REPLACE")).toBe("append");
  });
});

describe("exportFileName", () => {
  test("is timestamped and safe for Windows file names", () => {
    const name = exportFileName(new Date("2026-10-05T01:02:17.000Z"));

    expect(name).toBe("headplane-dns-records-2026-10-05T01-02-17-000Z.json");
    expect(name).not.toMatch(/[:*?"<>|]/);
  });
});
