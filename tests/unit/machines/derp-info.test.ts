import { describe, expect, test } from "vitest";

import {
  buildDerpInfo,
  capDerpLatencies,
  DERP_LATENCY_ROW_LIMIT,
  embeddedDerpRegion,
  formatDerpLatency,
  parseDerpRegionId,
  parseDerpRegionKey,
  regionLabel,
  resolveDerpLatencyKeyLabel,
  resolveDerpRegionLabel,
  sortDerpLatencies,
  type DerpEmbeddedServer,
  type DerpRegionInfo,
  type DerpRegionMap,
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

  test("reads the family suffix Tailscale puts on a region key", () => {
    // The real shape: magicsock keys DERPLatency as `"<regionID>-v4"`/`"-v6"`.
    expect(parseDerpRegionKey("900-v4")).toEqual({ regionId: 900, key: "900-v4" });
    expect(parseDerpRegionKey(" 901-v6 ")).toEqual({ regionId: 901, key: "901-v6" });
    expect(parseDerpRegionId("900-v4")).toBe(900);
  });

  test("keeps a key that names no region id as its own identity", () => {
    expect(parseDerpRegionKey("900")).toEqual({ regionId: 900, key: "900" });
    // A numeric record handed in as a number, not a JSON key.
    expect(parseDerpRegionKey(902)).toEqual({ regionId: 902, key: "902" });
    expect(parseDerpRegionKey("ams")).toEqual({ regionId: undefined, key: "ams" });
    expect(parseDerpRegionKey("derp1.tailscale.com:3478")).toEqual({
      regionId: undefined,
      key: "derp1.tailscale.com:3478",
    });
    expect(parseDerpRegionKey("9.5")).toEqual({ regionId: undefined, key: "9.5" });
    expect(parseDerpRegionKey("")).toEqual({ regionId: undefined, key: "" });
  });

  test("collapses a region's two families into its fastest sample", () => {
    expect(
      sortDerpLatencies({ "999-v6": 0.004, "999-v4": 0.001, "1-v4": 0.227, "2-v6": 0.266 }),
    ).toEqual([
      { region: "999-v4", regionId: 999, seconds: 0.001 },
      { region: "1-v4", regionId: 1, seconds: 0.227 },
      { region: "2-v6", regionId: 2, seconds: 0.266 },
    ]);
  });

  test("orders the rows fastest first across every key shape", () => {
    const rows = sortDerpLatencies({ "2-v4": 0.266, ams: 0.3, "1-v6": 0.227, "999-v4": 0.001 });
    expect(rows.map((row) => [row.region, row.seconds])).toEqual([
      ["999-v4", 0.001],
      ["1-v6", 0.227],
      ["2-v4", 0.266],
      ["ams", 0.3],
    ]);
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
    // A manual entry is the operator's own decision, so it also wins for the
    // embedded region; the marker still says which region is embedded.
    expect(regionLabel(999, embedded, "Unknown", { "999": "Manual" })).toEqual({
      label: "#999 · Manual",
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
      { manual: { "901": "Amsterdam" } },
    );

    expect(view.home).toEqual({ label: "#901 · Amsterdam", isEmbedded: false });
    // Region 1 is still unmapped, so the page keeps the id-only note.
    expect(view.hasIdOnlyRegions).toBe(true);

    const fullyMapped = buildDerpInfo({ HomeDERP: 901 }, EMBEDDED, "Unknown", {
      manual: { "901": "Amsterdam" },
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

  test("prefers a map name over the bare id and drops the id-only note", () => {
    const view = buildDerpInfo(
      { HomeDERP: 901, NetInfo: { PreferredDERP: 901, DERPLatency: { "901": 0.02 } } },
      { ...EMBEDDED, enabled: false },
      "Unknown",
      { local: { "901": { regionId: 901, code: "ams", name: "Amsterdam" } } },
    );

    expect(view.home).toEqual({ label: "#901 · ams · Amsterdam", isEmbedded: false });
    expect(view.hasIdOnlyRegions).toBe(false);
  });

  test("labels the family-suffixed keys a real agent reports", () => {
    // This is the shape that used to read `unknown · 1ms`: magicsock writes
    // `"<regionID>-v4"`/`"-v6"`, so no key was a bare region id.
    const view = buildDerpInfo(
      {
        HomeDERP: 999,
        NetInfo: {
          PreferredDERP: 999,
          DERPLatency: { "999-v4": 0.001, "1-v6": 0.227, "2-v4": 0.266 },
        },
      },
      EMBEDDED,
      "Unknown",
    );

    expect(view.latencies.rows.map((row) => row.label)).toEqual([
      "#999 · headscale · Headscale Embedded DERP",
      "#1",
      "#2",
    ]);
    expect(view.latencies.rows.map((row) => formatDerpLatency(row.seconds))).toEqual([
      "1ms",
      "227ms",
      "266ms",
    ]);
    // Regions 1 and 2 have no name from any source, so the id-only note stays.
    expect(view.hasIdOnlyRegions).toBe(true);
  });
});

describe("latency row labels", () => {
  const sources = {
    local: { "901": { regionId: 901, code: "ams", name: "Amsterdam" } },
    embedded: embeddedDerpRegion(EMBEDDED),
  };

  test("names a numeric key, with or without the family suffix", () => {
    expect(resolveDerpLatencyKeyLabel(902, sources, "Unknown")).toBe("#902");
    expect(resolveDerpLatencyKeyLabel("902-v6", sources, "Unknown")).toBe("#902");
  });

  test("names a string-numeric key through the one chain", () => {
    const manual = { ...sources, manual: { "901": "Hand" } };
    expect(resolveDerpLatencyKeyLabel("901", sources, "Unknown")).toBe("#901 · ams · Amsterdam");
    expect(resolveDerpLatencyKeyLabel(" 901 ", manual, "Unknown")).toBe("#901 · Hand");
  });

  test("matches a code-like key against the configured maps", () => {
    expect(resolveDerpLatencyKeyLabel("ams", sources, "Unknown")).toBe("#901 · ams · Amsterdam");
    expect(resolveDerpLatencyKeyLabel("AMS", sources, "Unknown")).toBe("#901 · ams · Amsterdam");
    // The embedded region's own code is part of the same chain.
    expect(resolveDerpLatencyKeyLabel("headscale", sources, "Unknown")).toBe(
      "#999 · headscale · Headscale Embedded DERP",
    );
  });

  test("shows an unknown key as #id, never as the localized unknown", () => {
    expect(resolveDerpLatencyKeyLabel("42", { ...sources, embedded: undefined }, "Unknown")).toBe(
      "#42",
    );
    expect(resolveDerpLatencyKeyLabel("42-v4", sources, "Unknown")).toBe("#42");
  });

  test("shows any other key as the raw key the agent reported", () => {
    expect(resolveDerpLatencyKeyLabel("sin", sources, "Unknown")).toBe("sin");
    expect(resolveDerpLatencyKeyLabel("derp1.tailscale.com:3478", sources, "Unknown")).toBe(
      "derp1.tailscale.com:3478",
    );
  });

  test("falls back to the localized unknown only when no key was reported", () => {
    expect(resolveDerpLatencyKeyLabel("", sources, "Unknown")).toBe("Unknown");
    expect(resolveDerpLatencyKeyLabel("   ", sources, "Unknown")).toBe("Unknown");
  });
});

describe("region label precedence", () => {
  const embedded = embeddedDerpRegion(EMBEDDED);

  /** Two regions sharing a code, which is a validation error but still readable. */
  const local: DerpRegionMap = {
    "901": { regionId: 901, code: "ams", name: "Amsterdam" },
    "902": { regionId: 902, code: "ams", name: "Amsterdam Two" },
  };

  const remote: DerpRegionMap = {
    "901": { regionId: 901, code: "remote", name: "Remote Amsterdam" },
    "903": { regionId: 903, code: "sfo", name: "San Francisco" },
  };

  test("the manual mapping wins over every automatic source", () => {
    const sources = {
      manual: { "901": "Named By Hand", "999": "Manual Embedded" },
      local,
      remote,
      embedded,
    };

    expect(resolveDerpRegionLabel(901, sources, "Unknown")).toEqual({
      label: "#901 · Named By Hand",
      isEmbedded: false,
    });
    expect(resolveDerpRegionLabel(999, sources, "Unknown")).toEqual({
      label: "#999 · Manual Embedded",
      isEmbedded: true,
    });
  });

  test("a local map file wins over a remote map", () => {
    expect(resolveDerpRegionLabel(901, { local, remote, embedded }, "Unknown")).toEqual({
      label: "#901 · ams · Amsterdam",
      isEmbedded: false,
    });
  });

  test("a remote map names what the local files do not", () => {
    expect(resolveDerpRegionLabel(903, { local, remote, embedded }, "Unknown")).toEqual({
      label: "#903 · sfo · San Francisco",
      isEmbedded: false,
    });
  });

  test("a local map also wins over the embedded region's own configuration", () => {
    expect(
      resolveDerpRegionLabel(
        999,
        { local: { "999": { regionId: 999, code: "eu" } }, embedded },
        "Unknown",
      ),
    ).toEqual({ label: "#999 · eu", isEmbedded: true });
    // Without another source the embedded region keeps its configured name.
    expect(resolveDerpRegionLabel(999, { embedded }, "Unknown")).toEqual({
      label: "#999 · headscale · Headscale Embedded DERP",
      isEmbedded: true,
    });
  });

  test("an unknown region stays the bare id, and no id stays unknown", () => {
    expect(resolveDerpRegionLabel(42, { local, remote, embedded }, "Unknown")).toEqual({
      label: "#42",
      isEmbedded: false,
    });
    expect(resolveDerpRegionLabel(999, { local, remote }, "Unknown")).toEqual({
      label: "#999",
      isEmbedded: false,
    });
    expect(resolveDerpRegionLabel(undefined, { local, remote, embedded }, "Unknown")).toEqual({
      label: "Unknown",
      isEmbedded: false,
    });
  });

  test("two regions that share a code stay two labelled regions", () => {
    const sources = { local, embedded };

    expect(resolveDerpRegionLabel(901, sources, "Unknown").label).toBe("#901 · ams · Amsterdam");
    expect(resolveDerpRegionLabel(902, sources, "Unknown").label).toBe(
      "#902 · ams · Amsterdam Two",
    );
    // Naming one of them by hand leaves the other on its map name.
    expect(
      resolveDerpRegionLabel(901, { ...sources, manual: { "901": "Hand" } }, "Unknown").label,
    ).toBe("#901 · Hand");
    expect(
      resolveDerpRegionLabel(902, { ...sources, manual: { "901": "Hand" } }, "Unknown").label,
    ).toBe("#902 · ams · Amsterdam Two");
  });

  test("formats the code and the name without repeating either", () => {
    const label = (info: DerpRegionInfo) =>
      resolveDerpRegionLabel(901, { local: { "901": info } }, "Unknown").label;

    expect(label({ regionId: 901, code: "ams", name: "Amsterdam" })).toBe("#901 · ams · Amsterdam");
    expect(label({ regionId: 901, code: "ams", name: "ams" })).toBe("#901 · ams");
    expect(label({ regionId: 901, code: "ams" })).toBe("#901 · ams");
    expect(label({ regionId: 901, name: "Amsterdam" })).toBe("#901 · Amsterdam");
    expect(label({ regionId: 901, code: "  ", name: "  " })).toBe("#901");
  });
});
