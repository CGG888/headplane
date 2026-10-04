import { describe, expect, test } from "vitest";

import {
  buildDerpInfo,
  capDerpLatencies,
  DERP_LATENCY_ROW_LIMIT,
  embeddedDerpRegion,
  formatDerpLatency,
  parseDerpRegionId,
  regionLabel,
  sortDerpLatencies,
  type DerpEmbeddedServer,
} from "~/routes/machines/derp-info";

const EMBEDDED: DerpEmbeddedServer = {
  enabled: true,
  regionId: 999,
  regionCode: "headscale",
  regionName: "Headscale Embedded DERP",
};

describe("DERP latency", () => {
  test("sorts fastest first and drops samples that are not finite numbers", () => {
    expect(sortDerpLatencies({ "900": 0.052, "901": 0.011, "902": Number.NaN, sfo: 0.2 })).toEqual([
      { region: "901", regionId: 901, seconds: 0.011 },
      { region: "900", regionId: 900, seconds: 0.052 },
      { region: "sfo", regionId: undefined, seconds: 0.2 },
    ]);
  });

  test("returns an empty list without agent data", () => {
    expect(sortDerpLatencies(undefined)).toEqual([]);
    expect(sortDerpLatencies({})).toEqual([]);
    expect(sortDerpLatencies({ "900": Number.POSITIVE_INFINITY })).toEqual([]);
  });

  test("parses the region id out of the agent's map keys", () => {
    expect(parseDerpRegionId("900")).toBe(900);
    expect(parseDerpRegionId(" 901 ")).toBe(901);
    expect(parseDerpRegionId("sfo")).toBeUndefined();
    expect(parseDerpRegionId("9.5")).toBeUndefined();
    expect(parseDerpRegionId("-901")).toBeUndefined();
    expect(parseDerpRegionId("")).toBeUndefined();
  });

  test("formats seconds as whole milliseconds", () => {
    expect(formatDerpLatency(0.052)).toBe("52ms");
    expect(formatDerpLatency(0)).toBe("0ms");
    expect(formatDerpLatency(0.0004)).toBe("0ms");
    expect(formatDerpLatency(1.5)).toBe("1500ms");
    expect(formatDerpLatency(Number.NaN)).toBe("—");
    expect(formatDerpLatency(-1)).toBe("—");
  });

  test("caps the rows at the readable limit and counts the rest", () => {
    const latencies = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`${100 + index}`, 0.1 + index * 0.01]),
    );
    const { rows, hidden } = capDerpLatencies(sortDerpLatencies(latencies));

    expect(DERP_LATENCY_ROW_LIMIT).toBe(8);
    expect(rows).toHaveLength(8);
    expect(rows[0].region).toBe("100");
    expect(rows[7].region).toBe("107");
    expect(hidden).toBe(3);
  });

  test("reports nothing hidden for a short list", () => {
    expect(capDerpLatencies(sortDerpLatencies({ "900": 0.2 }))).toEqual({
      rows: [{ region: "900", regionId: 900, seconds: 0.2 }],
      hidden: 0,
    });
    expect(capDerpLatencies([], 0)).toEqual({ rows: [], hidden: 0 });
  });
});

describe("embedded DERP region", () => {
  test("only describes the configured region while the server is enabled", () => {
    expect(embeddedDerpRegion(EMBEDDED)).toEqual({
      regionId: 999,
      code: "headscale",
      name: "Headscale Embedded DERP",
    });
    expect(embeddedDerpRegion({ ...EMBEDDED, enabled: false })).toBeUndefined();
    expect(embeddedDerpRegion(undefined)).toBeUndefined();
  });

  test("ignores blank region names", () => {
    expect(embeddedDerpRegion({ ...EMBEDDED, regionCode: "  ", regionName: "" })).toEqual({
      regionId: 999,
      code: undefined,
      name: undefined,
    });
  });
});

describe("region labels", () => {
  const embedded = embeddedDerpRegion(EMBEDDED);

  test("resolves the embedded region and leaves external regions as ids", () => {
    expect(regionLabel(999, embedded, "Unknown")).toEqual({
      label: "#999 · headscale · Headscale Embedded DERP",
      isEmbedded: true,
    });
    expect(regionLabel(1, embedded, "Unknown")).toEqual({ label: "#1", isEmbedded: false });
  });

  test("keeps the code and name from duplicating when they match", () => {
    const sameName = embeddedDerpRegion({ ...EMBEDDED, regionName: "headscale" });
    expect(regionLabel(999, sameName, "Unknown")).toEqual({
      label: "#999 · headscale",
      isEmbedded: true,
    });
  });

  test("marks an unknown id as the localized unknown value", () => {
    // 998 is not the configured embedded region and has no name to resolve.
    expect(regionLabel(998, embedded, "Unknown")).toEqual({
      label: "#998",
      isEmbedded: false,
    });
    expect(regionLabel(undefined, embedded, "Unknown")).toEqual({
      label: "Unknown",
      isEmbedded: false,
    });
  });

  test("falls back to the region name when no code is configured", () => {
    const named = embeddedDerpRegion({ ...EMBEDDED, regionCode: "" });
    expect(regionLabel(999, named, "Unknown")).toEqual({
      label: "#999 · Headscale Embedded DERP",
      isEmbedded: true,
    });
  });

  test("never marks a region as embedded while the server is disabled", () => {
    expect(
      regionLabel(999, embeddedDerpRegion({ ...EMBEDDED, enabled: false }), "Unknown"),
    ).toEqual({
      label: "#999",
      isEmbedded: false,
    });
  });

  test("uses the manual mapping for regions the embedded server cannot name", () => {
    const names = { "901": "Amsterdam" };
    expect(regionLabel(901, embedded, "Unknown", names)).toEqual({
      label: "#901 · Amsterdam",
      isEmbedded: false,
    });
    // The embedded region's own configuration wins over a manual entry.
    expect(regionLabel(999, embedded, "Unknown", { "999": "Manual" })).toEqual({
      label: "#999 · headscale · Headscale Embedded DERP",
      isEmbedded: true,
    });
  });

  test("a removed mapping restores the bare id", () => {
    const names = { "901": "Amsterdam" };
    expect(regionLabel(901, embedded, "Unknown", names).label).toBe("#901 · Amsterdam");
    expect(regionLabel(901, embedded, "Unknown", {}).label).toBe("#901");
  });
});

describe("machine relay view", () => {
  test("reads home, preferred and latency out of the agent's host info", () => {
    const view = buildDerpInfo(
      {
        HomeDERP: 999,
        NetInfo: { PreferredDERP: 1, DERPLatency: { "1": 0.31, "999": 0.02, "2": 0.12 } },
      },
      EMBEDDED,
      "Unknown",
    );

    expect(view.hasRelayData).toBe(true);
    expect(view.home).toEqual({
      label: "#999 · headscale · Headscale Embedded DERP",
      isEmbedded: true,
    });
    expect(view.preferred).toEqual({ label: "#1", isEmbedded: false });
    expect(view.latencies.rows.map((row) => row.region)).toEqual(["999", "2", "1"]);
    expect(view.latencies.hidden).toBe(0);
    expect(view.hasIdOnlyRegions).toBe(true);
  });

  test("a mapped external region no longer counts as id-only", () => {
    const view = buildDerpInfo(
      { HomeDERP: 901, NetInfo: { PreferredDERP: 1 } },
      EMBEDDED,
      "Unknown",
      { "901": "Amsterdam" },
    );

    expect(view.home).toEqual({ label: "#901 · Amsterdam", isEmbedded: false });
    // Region 1 is still unmapped, so the page keeps the id-only note.
    expect(view.hasIdOnlyRegions).toBe(true);

    const fullyMapped = buildDerpInfo({ HomeDERP: 901 }, EMBEDDED, "Unknown", {
      "901": "Amsterdam",
    });
    expect(fullyMapped.hasIdOnlyRegions).toBe(false);
  });

  test("reports no relay data before the agent has looked at the machine", () => {
    const view = buildDerpInfo(undefined, EMBEDDED, "Unknown");

    expect(view.hasRelayData).toBe(false);
    expect(view.home).toEqual({ label: "Unknown", isEmbedded: false });
    expect(view.latencies).toEqual({ rows: [], hidden: 0 });
    expect(view.hasIdOnlyRegions).toBe(false);
  });

  test("relaying only through the embedded server needs no id note", () => {
    const view = buildDerpInfo(
      { HomeDERP: 999, NetInfo: { PreferredDERP: 999, DERPLatency: { "999": 0.02 } } },
      EMBEDDED,
      "Unknown",
    );

    expect(view.home.isEmbedded).toBe(true);
    expect(view.hasIdOnlyRegions).toBe(false);
  });

  test("every region is an id when the embedded server is disabled", () => {
    const view = buildDerpInfo(
      { HomeDERP: 999, NetInfo: { PreferredDERP: 999 } },
      { ...EMBEDDED, enabled: false },
      "Unknown",
    );

    expect(view.home).toEqual({ label: "#999", isEmbedded: false });
    expect(view.hasIdOnlyRegions).toBe(true);
  });
});
