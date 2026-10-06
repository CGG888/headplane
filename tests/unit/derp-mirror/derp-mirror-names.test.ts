import { describe, expect, test } from "vitest";

import {
  regionsBelowLatency,
  sortMirrorRegions,
  type MirrorRegionRow,
} from "~/routes/settings/headscale/derp-mirror";
import { chineseRegionName } from "~/server/derp-mirror/names";

/**
 * Tailscale's official DERP regions, snapshotted from
 * `https://controlplane.tailscale.com/derpmap/default` on 2026-10-06: 28
 * regions, in the map's own order. The list is checked in so these tests run
 * offline; refresh it with
 * `node -e "fetch('https://controlplane.tailscale.com/derpmap/default').then(r => r.json()).then(j => console.log(Object.values(j.Regions).map(r => r.RegionCode + ' ' + r.RegionName).join('\n')))"`.
 * A region that shows up here without a Chinese name in
 * `app/server/derp-mirror/names.ts` fails this file until it is named.
 */
const OFFICIAL_REGIONS: readonly (readonly [code: string, name: string])[] = [
  ["nyc", "New York City"],
  ["sfo", "San Francisco"],
  ["sin", "Singapore"],
  ["fra", "Frankfurt"],
  ["syd", "Sydney"],
  ["blr", "Bengaluru"],
  ["tok", "Tokyo"],
  ["lhr", "London"],
  ["dfw", "Dallas"],
  ["sea", "Seattle"],
  ["sao", "São Paulo"],
  ["ord", "Chicago"],
  ["den", "Denver"],
  ["ams", "Amsterdam"],
  ["jnb", "Johannesburg"],
  ["mia", "Miami"],
  ["lax", "Los Angeles"],
  ["par", "Paris"],
  ["mad", "Madrid"],
  ["hkg", "Hong Kong"],
  ["tor", "Toronto"],
  ["waw", "Warsaw"],
  ["dbi", "Dubai"],
  ["hnl", "Honolulu"],
  ["nai", "Nairobi"],
  ["nue", "Nuremberg"],
  ["iad", "Ashburn"],
  ["hel", "Helsinki"],
];

describe("official region names", () => {
  test("every official region resolves to a name that is not simply the english one", () => {
    const stillEnglish = OFFICIAL_REGIONS.filter(
      ([code, name]) => chineseRegionName(code, name) === name,
    ).map(([code, name]) => `${code} ${name}`);

    expect(stillEnglish).toEqual([]);
  });

  test("every official region resolves to a name written in Chinese", () => {
    const notChinese = OFFICIAL_REGIONS.filter(
      ([code, name]) => !/[\u4e00-\u9fff]/.test(chineseRegionName(code, name)),
    ).map(([code, name]) => `${code} ${name}`);

    expect(notChinese).toEqual([]);
  });

  test("the five regions the operator named read as agreed", () => {
    expect(chineseRegionName("sao", "São Paulo")).toBe("圣保罗");
    expect(chineseRegionName("dbi", "Dubai")).toBe("迪拜");
    expect(chineseRegionName("hnl", "Honolulu")).toBe("檀香山");
    expect(chineseRegionName("nai", "Nairobi")).toBe("内罗毕");
    expect(chineseRegionName("nue", "Nuremberg")).toBe("纽伦堡");
  });

  test("an unknown code keeps the official name, and an unnamed region keeps its code", () => {
    expect(chineseRegionName("zzz", "Somewhere")).toBe("Somewhere");
    expect(chineseRegionName("zzz", "   ")).toBe("zzz");
    expect(chineseRegionName("HKG", "Hong Kong")).toBe("香港");
  });
});

describe("official region rows", () => {
  test("the card produces one row per official region, so the bounded table is complete", () => {
    const regions: MirrorRegionRow[] = OFFICIAL_REGIONS.map(([code, name], index) => ({
      officialId: index + 1,
      code,
      officialName: name,
      chineseName: chineseRegionName(code, name),
      nodeCount: 1,
      latencyMs: undefined,
      storedNumber: undefined,
    }));

    // This is exactly what the card renders: the rows in official order, with
    // the latency ceiling left empty so no region is filtered away. Nothing in
    // the pipeline drops an official region.
    const rows = regionsBelowLatency(sortMirrorRegions(regions, "official"), undefined);

    expect(rows).toHaveLength(OFFICIAL_REGIONS.length);
    expect(rows.map((row) => row.code)).toEqual(OFFICIAL_REGIONS.map(([code]) => code));
  });
});
