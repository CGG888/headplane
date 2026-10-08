import { describe, expect, test } from "vitest";

import {
  DERP_MIRROR_MAX_SOURCES,
  DERP_MIRROR_PASTE_MAX_BYTES,
  DEFAULT_DERP_MIRROR_SETTINGS,
  DEFAULT_DERP_MIRROR_TARGET_PATH,
  derpMirrorIntervalMs,
  isAbsoluteHttpUrl,
  normalizeDerpMirrorSettings,
  normalizeMirrorNumber,
  normalizeOfficialRegionIds,
  normalizePastedMap,
  normalizeSourceUrls,
  parseDerpMirrorIntervalHours,
  pruneAssignmentToSelection,
} from "~/server/derp-mirror/settings";

describe("DERP mirror settings", () => {
  test("starts disabled with no region selected and no numbering", () => {
    expect(DEFAULT_DERP_MIRROR_SETTINGS).toEqual({
      enabled: false,
      officialRegionIds: [],
      assignment: {},
      targetPath: DEFAULT_DERP_MIRROR_TARGET_PATH,
      intervalHours: 24,
      autoReload: true,
      sourceUrls: [],
    });
    expect(DEFAULT_DERP_MIRROR_SETTINGS.assignmentRankedAt).toBeUndefined();
    expect(DEFAULT_DERP_MIRROR_SETTINGS.pastedMap).toBeUndefined();
  });

  test("a missing or junk document reads as the defaults", () => {
    expect(normalizeDerpMirrorSettings(undefined)).toEqual(DEFAULT_DERP_MIRROR_SETTINGS);
    expect(normalizeDerpMirrorSettings(null)).toEqual(DEFAULT_DERP_MIRROR_SETTINGS);
    expect(normalizeDerpMirrorSettings("nonsense")).toEqual(DEFAULT_DERP_MIRROR_SETTINGS);
    expect(normalizeDerpMirrorSettings([1, 2, 3])).toEqual(DEFAULT_DERP_MIRROR_SETTINGS);
  });

  test("only 6, 12 and 24 hours are accepted; anything else falls back", () => {
    for (const value of [6, 12, 24]) {
      expect(normalizeDerpMirrorSettings({ intervalHours: value }).intervalHours).toBe(value);
    }

    // Form values arrive as strings.
    expect(normalizeDerpMirrorSettings({ intervalHours: "6" }).intervalHours).toBe(6);
    for (const value of [0, 1, 7, 25, -6, 6.5, "7", "soon", null]) {
      expect(normalizeDerpMirrorSettings({ intervalHours: value }).intervalHours).toBe(24);
    }

    expect(parseDerpMirrorIntervalHours("24")).toBe(24);
    expect(parseDerpMirrorIntervalHours(24)).toBe(24);
    expect(parseDerpMirrorIntervalHours("25")).toBeUndefined();
    expect(parseDerpMirrorIntervalHours("")).toBeUndefined();
    expect(derpMirrorIntervalMs(6)).toBe(6 * 60 * 60 * 1000);
  });

  test("keeps an absolute target path and refuses a relative one", () => {
    expect(normalizeDerpMirrorSettings({ targetPath: "/mnt/derp/mirror.yaml" }).targetPath).toBe(
      "/mnt/derp/mirror.yaml",
    );
    expect(
      normalizeDerpMirrorSettings({ targetPath: "  /mnt/derp/mirror.yaml  " }).targetPath,
    ).toBe("/mnt/derp/mirror.yaml");
    expect(normalizeDerpMirrorSettings({ targetPath: "derp/mirror.yaml" }).targetPath).toBe(
      DEFAULT_DERP_MIRROR_TARGET_PATH,
    );
    expect(normalizeDerpMirrorSettings({ targetPath: "" }).targetPath).toBe(
      DEFAULT_DERP_MIRROR_TARGET_PATH,
    );
    expect(normalizeDerpMirrorSettings({ targetPath: 7 }).targetPath).toBe(
      DEFAULT_DERP_MIRROR_TARGET_PATH,
    );
  });

  test("drops unusable region ids and keeps the order they were listed in", () => {
    expect(normalizeOfficialRegionIds(["9", 3, " 20 ", "9", "x", "", null, "-1", "0"])).toEqual([
      "9",
      "3",
      "20",
    ]);
    // Anything that is not an array reads as the default, which selects nothing.
    expect(normalizeOfficialRegionIds("20")).toEqual([]);
    expect(normalizeOfficialRegionIds([])).toEqual([]);
  });

  test("keeps only in-range, unique assignment entries", () => {
    const settings = normalizeDerpMirrorSettings({
      assignment: {
        "20": 901,
        "3": 5000,
        "9": "904",
        nope: 903,
        "7": -1,
        "25": 901,
      },
    });

    expect(settings.assignment).toEqual({ "20": 901, "9": 904 });
  });

  test("a junk assignment falls back to an empty numbering", () => {
    expect(normalizeDerpMirrorSettings({ assignment: "nope" }).assignment).toEqual({});
    expect(normalizeMirrorNumber(901)).toBe(901);
    expect(normalizeMirrorNumber(899)).toBeUndefined();
    expect(normalizeMirrorNumber(1000)).toBeUndefined();
    expect(normalizeMirrorNumber(903.5)).toBeUndefined();
  });

  test("keeps a parseable ranking timestamp and drops junk", () => {
    expect(
      normalizeDerpMirrorSettings({ assignmentRankedAt: "2026-01-01T00:00:00.000Z" })
        .assignmentRankedAt,
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(
      normalizeDerpMirrorSettings({ assignmentRankedAt: "whenever" }).assignmentRankedAt,
    ).toBeUndefined();
    expect(
      normalizeDerpMirrorSettings({ assignmentRankedAt: 7 }).assignmentRankedAt,
    ).toBeUndefined();
  });

  test("only an explicit false turns the reload and the enable off", () => {
    expect(normalizeDerpMirrorSettings({}).autoReload).toBe(true);
    expect(normalizeDerpMirrorSettings({ autoReload: false }).autoReload).toBe(false);
    expect(normalizeDerpMirrorSettings({ autoReload: "no" }).autoReload).toBe(true);
    expect(normalizeDerpMirrorSettings({ enabled: "yes" }).enabled).toBe(false);
    expect(normalizeDerpMirrorSettings({ enabled: true }).enabled).toBe(true);
  });

  test("keeps a stored local measurement, source and all", () => {
    const latency = normalizeDerpMirrorSettings({
      latency: {
        measuredAt: "2026-01-02T03:04:05.000Z",
        outcome: "partial",
        regions: [
          {
            regionId: 20,
            regionCode: "hkg",
            bestV4: 12.5,
            bestV6: 30,
            // A hand-edited file cannot pass a reported value off as measured.
            source: "reported",
            nodes: [
              {
                name: "hkg1",
                hostname: "hkg1.example.com",
                family: "ipv4",
                target: "44.1.1.1",
                latencyMs: 12.5,
                method: "stun",
              },
            ],
          },
        ],
      },
    }).latency;

    expect(latency?.measuredAt).toBe("2026-01-02T03:04:05.000Z");
    expect(latency?.outcome).toBe("partial");
    expect(latency?.regions).toHaveLength(1);
    expect(latency?.regions[0]?.regionId).toBe(20);
    expect(latency?.regions[0]?.bestV4).toBe(12.5);
    expect(latency?.regions[0]?.source).toBe("measured");
    expect(latency?.regions[0]?.nodes[0]?.method).toBe("stun");
  });

  test("drops a measurement that cannot be dated or read, keeping the rest of the settings", () => {
    expect(normalizeDerpMirrorSettings({ latency: {} }).latency).toBeUndefined();
    expect(normalizeDerpMirrorSettings({ latency: "soon" }).latency).toBeUndefined();
    expect(
      normalizeDerpMirrorSettings({ latency: { measuredAt: "whenever", regions: [] } }).latency,
    ).toBeUndefined();
    expect(normalizeDerpMirrorSettings({ enabled: true, latency: 7 }).enabled).toBe(true);

    const empty = normalizeDerpMirrorSettings({
      latency: { measuredAt: "2026-01-02T03:04:05.000Z", regions: "nonsense" },
    }).latency;
    expect(empty?.outcome).toBe("empty");
    expect(empty?.regions).toEqual([]);
  });

  test("accepts only absolute http(s) URLs as sources", () => {
    expect(isAbsoluteHttpUrl("https://mirror.example.com/derpmap/default")).toBe(true);
    expect(isAbsoluteHttpUrl("http://10.0.0.5:8080/derp.json")).toBe(true);
    expect(isAbsoluteHttpUrl("  https://mirror.example.com/a.json  ")).toBe(true);

    // A relative path, a bare host, another scheme and junk are all refused.
    for (const value of [
      "mirror.example.com/a.json",
      "/derpmap/default",
      "ftp://mirror.example.com/a.json",
      "file:///etc/derp.json",
      "https://",
      "",
      "   ",
      null,
      7,
    ]) {
      expect(isAbsoluteHttpUrl(value)).toBe(false);
    }
  });

  test("keeps the source list in order, deduplicated, capped and clean", () => {
    expect(
      normalizeSourceUrls([
        "https://b.example.com/map.json",
        "https://a.example.com/map.json",
        "https://b.example.com/map.json",
        "not a url",
        "",
        null,
      ]),
    ).toEqual(["https://b.example.com/map.json", "https://a.example.com/map.json"]);

    // Anything that is not a list is the built-in chain, not a broken source.
    expect(normalizeSourceUrls("https://a.example.com/map.json")).toEqual([]);
    expect(normalizeSourceUrls(undefined)).toEqual([]);

    const many = Array.from(
      { length: DERP_MIRROR_MAX_SOURCES + 3 },
      (_, index) => `https://s${index}.example.com/map.json`,
    );
    expect(normalizeSourceUrls(many)).toHaveLength(DERP_MIRROR_MAX_SOURCES);
  });

  test("keeps a dated, sized pasted body and drops anything else", () => {
    const at = "2026-01-02T03:04:05.000Z";
    expect(normalizePastedMap({ body: '{"Regions":{}}', at, regions: 2 })).toEqual({
      body: '{"Regions":{}}',
      at,
      regions: 2,
    });

    // A hand-edited document cannot smuggle in an undated, empty or oversized body.
    expect(normalizePastedMap({ body: "", at, regions: 2 })).toBeUndefined();
    expect(normalizePastedMap({ body: "   ", at, regions: 2 })).toBeUndefined();
    expect(normalizePastedMap({ body: "x", at: "whenever", regions: 2 })).toBeUndefined();
    expect(normalizePastedMap({ at, regions: 2 })).toBeUndefined();
    expect(normalizePastedMap("nope")).toBeUndefined();
    expect(normalizePastedMap(null)).toBeUndefined();

    const oversized = normalizePastedMap({
      body: "x".repeat(DERP_MIRROR_PASTE_MAX_BYTES + 1),
      at,
      regions: 2,
    });
    expect(oversized).toBeUndefined();

    // A missing region count reads as zero rather than dropping the body.
    expect(normalizePastedMap({ body: "map", at })?.regions).toBe(0);
  });

  test("normalizes the new fields through the whole settings document", () => {
    const settings = normalizeDerpMirrorSettings({
      sourceUrls: ["https://mirror.example.com/map.json", "nope"],
      pastedMap: { body: "map", at: "2026-01-02T03:04:05.000Z", regions: 1 },
    });

    expect(settings.sourceUrls).toEqual(["https://mirror.example.com/map.json"]);
    expect(settings.pastedMap?.regions).toBe(1);
    expect(settings.enabled).toBe(false);
  });
});

describe("stored numbering follows the selection", () => {
  const assignment = { "20": 901, "3": 902, "9": 903, "7": 904 };

  test("keeps every entry of a region that is still selected", () => {
    expect(pruneAssignmentToSelection(assignment, ["20", "3", "9", "7"])).toEqual(assignment);
  });

  test("drops the entries of the regions the selection no longer has", () => {
    expect(pruneAssignmentToSelection(assignment, ["20", "9"])).toEqual({ "20": 901, "9": 903 });
  });

  test("a cleared selection leaves no stored number at all", () => {
    expect(pruneAssignmentToSelection(assignment, [])).toEqual({});
  });

  test("keeps only usable entries, so a junk document cannot survive a save", () => {
    expect(pruneAssignmentToSelection({ "20": 901, "3": 5000, nope: 903 }, ["20", "3"])).toEqual({
      "20": 901,
    });
  });
});
