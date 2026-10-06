import { describe, expect, test } from "vitest";

import {
  DEFAULT_DERP_MIRROR_SETTINGS,
  DEFAULT_DERP_MIRROR_TARGET_PATH,
  derpMirrorIntervalMs,
  normalizeDerpMirrorSettings,
  normalizeMirrorNumber,
  normalizeOfficialRegionIds,
  parseDerpMirrorIntervalHours,
  pruneAssignmentToSelection,
} from "~/server/derp-mirror/settings";

describe("DERP mirror settings", () => {
  test("starts disabled with Hong Kong and Singapore selected at 901 and 902", () => {
    expect(DEFAULT_DERP_MIRROR_SETTINGS).toEqual({
      enabled: false,
      officialRegionIds: ["20", "3"],
      assignment: { "20": 901, "3": 902 },
      targetPath: DEFAULT_DERP_MIRROR_TARGET_PATH,
      intervalHours: 24,
      autoReload: true,
    });
    expect(DEFAULT_DERP_MIRROR_SETTINGS.assignmentRankedAt).toBeUndefined();
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
    expect(normalizeOfficialRegionIds("20")).toEqual(["20", "3"]);
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

  test("a junk assignment falls back to the default numbering", () => {
    expect(normalizeDerpMirrorSettings({ assignment: "nope" }).assignment).toEqual({
      "20": 901,
      "3": 902,
    });
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
