import { describe, expect, test } from "vitest";

import { parseRecordsJson } from "~/routes/dns/records-io";

// Headplane stores one record per name+type (the config helpers ignore a second
// value), so an import must refuse a file that would silently lose one rather
// than quietly keeping the first.

describe("DNS record import conflicts", () => {
  test("accepts an exact duplicate because the plan skips it", () => {
    const result = parseRecordsJson(
      JSON.stringify([
        { name: "nas.example.com", type: "A", value: "10.0.0.1" },
        { name: "nas.example.com", type: "A", value: "10.0.0.1" },
      ]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toHaveLength(2);
    }
  });

  test("rejects two values for one name and type", () => {
    const result = parseRecordsJson(
      JSON.stringify([
        { name: "nas.example.com", type: "A", value: "10.0.0.1" },
        { name: "nas.example.com", type: "A", value: "10.0.0.2" },
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflictingRecord");
      expect(result.error.index).toBe(1);
    }
  });

  test("allows the same name with different types", () => {
    const result = parseRecordsJson(
      JSON.stringify([
        { name: "nas.example.com", type: "A", value: "10.0.0.1" },
        { name: "nas.example.com", type: "AAAA", value: "fd00::1" },
      ]),
    );

    expect(result.ok).toBe(true);
  });

  test("trims before comparing", () => {
    const result = parseRecordsJson(
      JSON.stringify([
        { name: " nas.example.com ", type: "A", value: "10.0.0.1" },
        { name: "nas.example.com", type: "A", value: "10.0.0.2" },
      ]),
    );

    expect(result.ok).toBe(false);
  });
});
