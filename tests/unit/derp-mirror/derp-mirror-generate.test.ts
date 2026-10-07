import { describe, expect, test } from "vitest";

import { readDerpMapRegions, validateDerpMap } from "~/routes/settings/headscale/derp-map-schema";
import {
  assignRegionNumbers,
  buildMirrorMap,
  EMBEDDED_REGION_ID,
  HONG_KONG_MIRROR_NUMBER,
  mirrorMapChanged,
  renderMirrorYaml,
  SINGAPORE_MIRROR_NUMBER,
} from "~/server/derp-mirror/generate";
import { CHINESE_REGION_NAMES, chineseRegionName } from "~/server/derp-mirror/names";
import type { OfficialRegion } from "~/server/derp-mirror/types";

const HKG = "20";
const SIN = "3";
const TOK = "9";
const FRA = "7";
const NYC = "25";
const LAX = "12";

function region(
  regionId: string,
  code: string,
  name: string,
  nodes: number,
  overrides: Partial<OfficialRegion["nodes"][number]> = {},
): OfficialRegion {
  return {
    regionId: Number(regionId),
    code,
    name,
    nodes: Array.from({ length: nodes }, (_, index) => ({
      name: `${code}${index + 1}`,
      hostname: `${code}${index + 1}.example.com`,
      derpPort: 443,
      stunPort: 3478,
      stunOnly: false,
      ipv4: `1.2.3.${index + 1}`,
      ...overrides,
    })),
  };
}

const OFFICIAL: OfficialRegion[] = [
  region(HKG, "hkg", "Hong Kong", 2),
  region(SIN, "sin", "Singapore", 3),
  region(TOK, "tok", "Tokyo", 1),
  region(FRA, "fra", "Frankfurt", 1),
  region(NYC, "nyc", "New York", 1),
  region(LAX, "lax", "Los Angeles", 1),
];

describe("mirror region numbering", () => {
  test("Hong Kong is always 901 and Singapore is always 902", () => {
    const { assignment } = assignRegionNumbers([HKG, SIN], { [SIN]: 5, [HKG]: 400 });

    expect(assignment).toEqual({ [HKG]: HONG_KONG_MIRROR_NUMBER, [SIN]: SINGAPORE_MIRROR_NUMBER });
  });

  test("pins the two fixed regions even when the ranking would order them otherwise", () => {
    const { assignment } = assignRegionNumbers([HKG, SIN, TOK, FRA], {
      [HKG]: 500,
      [SIN]: 900,
      [TOK]: 20,
      [FRA]: 10,
    });

    expect(assignment[HKG]).toBe(901);
    expect(assignment[SIN]).toBe(902);
    // The rest rank by latency: Frankfurt (10ms) before Tokyo (20ms).
    expect(assignment[FRA]).toBe(903);
    expect(assignment[TOK]).toBe(904);
  });

  test("ranks the remaining regions by ascending latency", () => {
    const { assignment } = assignRegionNumbers([HKG, SIN, TOK, FRA, NYC, LAX], {
      [FRA]: 120,
      [TOK]: 30,
      [NYC]: 200,
      [LAX]: 80,
    });

    expect(assignment).toEqual({
      [HKG]: 901,
      [SIN]: 902,
      [TOK]: 903,
      [LAX]: 904,
      [FRA]: 905,
      [NYC]: 906,
    });
  });

  test("breaks ties by official region id, then by the order the selection lists them", () => {
    const { assignment } = assignRegionNumbers([HKG, SIN, NYC, FRA, LAX, TOK], {
      [FRA]: 50,
      [TOK]: 50,
      [NYC]: 50,
    });

    // Equal latencies: id 7 (fra), 9 (tok), 25 (nyc); lax has no sample at all
    // and ranks behind every measured region.
    expect(assignment[FRA]).toBe(903);
    expect(assignment[TOK]).toBe(904);
    expect(assignment[NYC]).toBe(905);
    expect(assignment[LAX]).toBe(906);
  });

  test("keeps a stored assignment that already covers the selection, and its timestamp", () => {
    const existing = { [HKG]: 901, [SIN]: 902, [NYC]: 903, [FRA]: 904 };
    const result = assignRegionNumbers([HKG, SIN, FRA, NYC], { [FRA]: 1, [NYC]: 999 }, existing);

    // A fresh ranking would put Frankfurt first; the stored numbers win.
    expect(result.assignment).toEqual(existing);
    expect(result.rankedAt).toBeUndefined();
  });

  test("appends a newly selected region after the highest stored number", () => {
    const existing = { [HKG]: 901, [SIN]: 902, [FRA]: 903 };
    const { assignment, rankedAt } = assignRegionNumbers(
      [HKG, SIN, FRA, TOK],
      { [TOK]: 1 },
      existing,
    );

    expect(assignment[FRA]).toBe(903);
    expect(assignment[TOK]).toBe(904);
    expect(typeof rankedAt).toBe("string");
    expect(Number.isFinite(Date.parse(rankedAt ?? ""))).toBe(true);
  });

  test("drops numbers that are out of range, duplicated or reserved, keeping every number in the 900s", () => {
    const { assignment } = assignRegionNumbers(
      [HKG, SIN, TOK, FRA, NYC],
      {},
      {
        [HKG]: 901,
        [SIN]: 902,
        // Out of range, so Tokyo is numbered again rather than kept at 42.
        [TOK]: 42,
        // The embedded region's own id is never handed to a mirror.
        [FRA]: EMBEDDED_REGION_ID,
        // A duplicate of Hong Kong's number loses to the pinned one.
        [NYC]: 901,
      },
    );

    expect(assignment[HKG]).toBe(901);
    expect(assignment[SIN]).toBe(902);
    for (const value of Object.values(assignment)) {
      expect(value).toBeGreaterThanOrEqual(900);
      expect(value).toBeLessThanOrEqual(999);
      expect(value).not.toBe(EMBEDDED_REGION_ID);
    }

    expect(new Set(Object.values(assignment)).size).toBe(Object.keys(assignment).length);
  });

  test("never reuses a number, falling back to a free slot inside the 900s", () => {
    const existing = { [HKG]: 901, [SIN]: 902, [FRA]: 998 };
    const { assignment } = assignRegionNumbers([HKG, SIN, FRA, TOK], { [TOK]: 1 }, existing);

    // The tail of the range is taken, so the only free slots are below 903.
    expect(assignment[TOK]).toBe(900);
    expect(assignment[FRA]).toBe(998);
  });

  test("numbers an empty selection to an empty assignment", () => {
    expect(assignRegionNumbers([], {}).assignment).toEqual({});
    expect(assignRegionNumbers(["not-an-id", "-1", "0"], {}).assignment).toEqual({});
  });

  test("prefers a latency this server measured itself over a reported one", () => {
    // The machines reported Tokyo as far faster (5 ms) than Frankfurt (400 ms),
    // but this server measured Tokyo itself at 500 ms. The local value wins, so
    // Frankfurt takes the lower number.
    const { assignment } = assignRegionNumbers(
      [HKG, SIN, TOK, FRA],
      { [TOK]: 5, [FRA]: 400 },
      undefined,
      { [TOK]: 500 },
    );

    expect(assignment[FRA]).toBe(903);
    expect(assignment[TOK]).toBe(904);
  });

  test("falls back to the reported value for a region this server did not measure", () => {
    const { assignment } = assignRegionNumbers(
      [HKG, SIN, TOK, FRA],
      { [TOK]: 5, [FRA]: 400 },
      undefined,
      { [FRA]: 30 },
    );

    // Frankfurt is measured here at 30 ms; Tokyo keeps the 5 ms its machines
    // reported, so it still takes the lower number.
    expect(assignment[TOK]).toBe(903);
    expect(assignment[FRA]).toBe(904);
  });

  test("still ranks an unmeasured region last when only part of the selection was measured", () => {
    const { assignment } = assignRegionNumbers([HKG, SIN, TOK, FRA, NYC], {}, undefined, {
      [FRA]: 30,
      [NYC]: 20,
    });

    expect(assignment[NYC]).toBe(903);
    expect(assignment[FRA]).toBe(904);
    expect(assignment[TOK]).toBe(905);
  });

  test("reports the regions the 900s cannot number instead of dropping them", () => {
    // 900 and 903-998 are the only numbers ranking may hand out (901, 902 and
    // 999 are reserved), so a selection of 100 regions leaves three over.
    const ids = Array.from({ length: 100 }, (_, index) => String(1000 + index));
    const latencies = Object.fromEntries(ids.map((id) => [id, 10]));
    const { assignment, unassigned } = assignRegionNumbers(ids, latencies);

    expect(Object.keys(assignment)).toHaveLength(97);
    // Equal latencies are settled by official id, so the highest ids lose out.
    expect(unassigned).toEqual(["1097", "1098", "1099"]);
  });

  test("reports nothing unassigned for a selection the stored assignment covers", () => {
    const stored = { [HKG]: 901, [SIN]: 902, [FRA]: 903 };
    const { assignment, unassigned } = assignRegionNumbers([HKG, SIN, FRA], {}, stored);

    expect(assignment).toEqual(stored);
    expect(unassigned).toEqual([]);
  });
});

describe("chinese region names", () => {
  test("maps the codes the mirror is built for", () => {
    expect(chineseRegionName("hkg", "Hong Kong")).toBe("香港");
    expect(chineseRegionName("sin", "Singapore")).toBe("新加坡");
    expect(chineseRegionName("FRA", "Frankfurt")).toBe("法兰克福");
    expect(CHINESE_REGION_NAMES.hkg).toBe("香港");
  });

  test("falls back to the official name for an unknown code", () => {
    expect(chineseRegionName("zzz", "Somewhere New")).toBe("Somewhere New");
    expect(chineseRegionName("zzz", "  ")).toBe("zzz");
    expect(chineseRegionName("", "")).toBe("");
  });
});

describe("mirror map building", () => {
  const assignment = { [HKG]: 901, [SIN]: 902, [TOK]: 903 };

  test("keeps every node of every selected region, with unique names and matching ids", () => {
    const map = buildMirrorMap(OFFICIAL, assignment, [HKG, SIN, TOK]);

    expect(Object.keys(map.regions)).toEqual(["901", "902", "903"]);

    const hongKong = map.regions["901"];
    expect(hongKong.regionid).toBe(901);
    expect(hongKong.regioncode).toBe("hkg");
    expect(hongKong.regionname).toBe("香港");
    expect(hongKong.nodes).toHaveLength(2);
    expect(hongKong.nodes.map((node) => node.name)).toEqual(["901a", "901b"]);
    expect(hongKong.nodes.every((node) => node.regionid === 901)).toBe(true);
    expect(hongKong.nodes[0]).toMatchObject({
      hostname: "hkg1.example.com",
      derpport: 443,
      stunport: 3478,
      ipv4: "1.2.3.1",
    });

    const names = Object.values(map.regions).flatMap((entry) =>
      entry.nodes.map((node) => node.name),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["901a", "901b", "902a", "902b", "902c", "903a"]);
  });

  test("keeps the official code and address families, and writes no empty ipv6", () => {
    const map = buildMirrorMap(OFFICIAL, assignment, [HKG]);

    expect(map.regions["901"].regioncode).toBe("hkg");
    expect(map.regions["901"].nodes[0]).not.toHaveProperty("ipv6");
    expect(map.regions["901"].nodes[0]).not.toHaveProperty("stunonly");
  });

  test("skips a selected region the map does not describe, and one without a number", () => {
    const map = buildMirrorMap(OFFICIAL, { [HKG]: 901 }, [HKG, SIN, "9999"]);

    expect(Object.keys(map.regions)).toEqual(["901"]);
  });

  test("keeps an unknown code's official name", () => {
    const map = buildMirrorMap([region("44", "zzz", "Somewhere New", 1)], { "44": 903 }, ["44"]);

    expect(map.regions["903"].regionname).toBe("Somewhere New");
  });
});

describe("mirror YAML", () => {
  const map = buildMirrorMap(OFFICIAL, { [HKG]: 901, [SIN]: 902, [TOK]: 903 }, [HKG, SIN, TOK]);

  test("round-trips through the validator the map editor uses", () => {
    const yaml = renderMirrorYaml(map);

    expect(validateDerpMap(yaml)).toEqual([]);
  });

  test("reads back with the existing region reader, ids and Chinese names intact", () => {
    const entries = readDerpMapRegions(renderMirrorYaml(map));

    expect(entries).toEqual([
      { regionId: 901, code: "hkg", name: "香港" },
      { regionId: 902, code: "sin", name: "新加坡" },
      { regionId: 903, code: "tok", name: "东京" },
    ]);
  });

  test("is stable for the same map", () => {
    expect(renderMirrorYaml(map)).toBe(
      renderMirrorYaml(
        buildMirrorMap(OFFICIAL, { [HKG]: 901, [SIN]: 902, [TOK]: 903 }, [HKG, SIN, TOK]),
      ),
    );
  });
});

describe("mirror change detection", () => {
  const built = buildMirrorMap(OFFICIAL, { [HKG]: 901, [SIN]: 902 }, [HKG, SIN]);
  const yaml = renderMirrorYaml(built);

  test("a missing or unparsable file always counts as a change", () => {
    expect(mirrorMapChanged(undefined, yaml)).toBe(true);
    expect(mirrorMapChanged("", yaml)).toBe(true);
    expect(mirrorMapChanged("{ not: [yaml", yaml)).toBe(true);
  });

  test("the same map in a different spelling is not a change", () => {
    expect(mirrorMapChanged(yaml, yaml)).toBe(false);
    expect(mirrorMapChanged(`# a hand-written comment\n${yaml}`, yaml)).toBe(false);

    // Reversed region keys describe the same map.
    const reordered = renderMirrorYaml({
      regions: { "902": built.regions["902"], "901": built.regions["901"] },
    });
    expect(mirrorMapChanged(reordered, yaml)).toBe(false);
  });

  test("a different map is a change", () => {
    const changed = renderMirrorYaml(
      buildMirrorMap(OFFICIAL, { [HKG]: 901, [SIN]: 902, [TOK]: 903 }, [HKG, SIN, TOK]),
    );

    expect(mirrorMapChanged(yaml, changed)).toBe(true);
  });
});
