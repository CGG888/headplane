import { resolve } from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import {
  clearRemoteDerpMapCache,
  type DerpMapFetch,
  type DerpMapResponse,
} from "~/server/headscale/derp-map-remote";
import {
  clearLocalDerpRegionCache,
  loadDerpNodeInventory,
  type DerpRegionFs,
} from "~/server/headscale/derp-region-sources";

/** One region with a relay node, the shape the map editor accepts. */
const LOCAL_MAP = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes:
      - name: "901a"
        regionid: 901
        hostname: derp-ams.example.com
        derpport: 8443
`;

/** Two regions, so a file's own nodes stay with that file. */
const TWO_REGION_MAP = `regions:
  902:
    regionid: 902
    regioncode: sfo
    regionname: "San Francisco"
    nodes:
      - name: "902a"
        regionid: 902
        hostname: derp-sfo.example.com
  903:
    regionid: 903
    regioncode: syd
    regionname: "Sydney"
    nodes:
      - name: "903a"
        regionid: 903
        hostname: derp-syd.example.com
`;

/** The renumbered map the region filter writes: its regions are its own. */
const MIRROR_MAP = `regions:
  911:
    regionid: 911
    regioncode: hkg
    regionname: "Hong Kong"
    nodes:
      - name: "911a"
        regionid: 911
        hostname: derp-hkg.example.com
`;

function textResponse(body: string): DerpMapResponse {
  return { ok: true, status: 200, text: () => Promise.resolve(body) };
}

function createFakeFs(files: Record<string, string>): DerpRegionFs {
  return {
    stat: (path) =>
      files[path] === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve({ size: files[path].length, mtimeMs: 1 }),
    readFile: (path) =>
      files[path] === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(files[path]),
  };
}

const SETTINGS = { autoUpdateEnabled: false, updateFrequency: "3h" };

beforeEach(() => {
  clearRemoteDerpMapCache();
  clearLocalDerpRegionCache();
});

describe("loadDerpNodeInventory", () => {
  test("holds every configured map apart, with its own regions and nodes", async () => {
    const first = resolve("/maps/first.yaml");
    const second = resolve("/maps/second.yaml");
    const url = "https://example.com/public.yaml";
    const fetch: DerpMapFetch = () => Promise.resolve(textResponse(MIRROR_MAP));

    const inventory = await loadDerpNodeInventory(
      { paths: [first, second], urls: [url], ...SETTINGS },
      { fs: createFakeFs({ [first]: LOCAL_MAP, [second]: TWO_REGION_MAP }), fetch },
    );

    expect(inventory.groups.map((group) => [group.kind, group.source])).toEqual([
      ["local", first],
      ["local", second],
      ["remote", url],
    ]);
    expect(inventory.groups[0]?.state).toBe("ok");
    expect(inventory.groups[0]?.regions).toEqual([
      {
        regionId: 901,
        code: "ams",
        name: "Amsterdam",
        nodes: [
          {
            name: "901a",
            hostname: "derp-ams.example.com",
            derpPort: 8443,
            stunOnly: false,
          },
        ],
      },
    ]);
    expect(inventory.groups[1]?.regions.map((region) => region.regionId)).toEqual([902, 903]);
    expect(inventory.groups[2]?.regions[0]?.nodes[0]?.hostname).toBe("derp-hkg.example.com");
  });

  test("tags the region filter's own file as the mirror source", async () => {
    const path = resolve("/maps/local.yaml");
    const mirror = resolve("/maps/official-mirror.yaml");
    const inventory = await loadDerpNodeInventory(
      { paths: [path, mirror], urls: [], ...SETTINGS, mirrorPath: mirror },
      { fs: createFakeFs({ [path]: LOCAL_MAP, [mirror]: MIRROR_MAP }) },
    );

    expect(inventory.groups.map((group) => group.kind)).toEqual(["local", "mirror"]);
    // Listed, so the local map row never shows it and it is not read twice.
    expect(inventory.groups).toHaveLength(2);
    expect(inventory.groups[1]?.unlisted).toBeUndefined();
    expect(inventory.groups[1]?.regions[0]?.regionId).toBe(911);
    expect(inventory.groups[0]?.regions.map((region) => region.regionId)).toEqual([901]);
  });

  test("resolves a relative mirror path against the configuration directory", async () => {
    const baseDir = resolve("/etc/headscale");
    const path = resolve(baseDir, "maps/local.yaml");
    const mirror = resolve(baseDir, "maps/official-mirror.yaml");
    const inventory = await loadDerpNodeInventory(
      {
        paths: ["maps/local.yaml", "maps/official-mirror.yaml"],
        urls: [],
        ...SETTINGS,
        baseDir,
        mirrorPath: "maps/official-mirror.yaml",
      },
      { fs: createFakeFs({ [path]: LOCAL_MAP, [mirror]: MIRROR_MAP }) },
    );

    expect(inventory.groups.map((group) => group.kind)).toEqual(["local", "mirror"]);
  });

  test("reads the region filter's file even when derp.paths leaves it out", async () => {
    const path = resolve("/maps/local.yaml");
    const mirror = resolve("/maps/official-mirror.yaml");
    const inventory = await loadDerpNodeInventory(
      { paths: [path], urls: [], ...SETTINGS, mirrorPath: mirror, mirrorEnabled: true },
      { fs: createFakeFs({ [path]: LOCAL_MAP, [mirror]: MIRROR_MAP }) },
    );

    expect(inventory.groups.map((group) => [group.kind, group.unlisted])).toEqual([
      ["local", undefined],
      ["mirror", true],
    ]);
    expect(inventory.groups[1]?.source).toBe(mirror);
    // The nodes of the filtered map are read, not collapsed to nothing.
    expect(inventory.groups[1]?.state).toBe("ok");
    expect(inventory.groups[1]?.regions[0]?.regionId).toBe(911);
    expect(inventory.groups[1]?.regions[0]?.nodes[0]?.hostname).toBe("derp-hkg.example.com");
    // Nothing loads the file yet, so it names no region for the local chain.
    expect(inventory.local).toEqual({
      "901": { regionId: 901, code: "ams", name: "Amsterdam" },
    });
  });

  test("an unlisted mirror path is left alone while the filter is off", async () => {
    const path = resolve("/maps/local.yaml");
    const mirror = resolve("/maps/official-mirror.yaml");
    const inventory = await loadDerpNodeInventory(
      { paths: [path], urls: [], ...SETTINGS, mirrorPath: mirror },
      { fs: createFakeFs({ [path]: LOCAL_MAP, [mirror]: MIRROR_MAP }) },
    );

    // The settings always name a default target path, so an off filter must not
    // turn a file nobody maintains into a source the card reports on.
    expect(inventory.groups.map((group) => [group.kind, group.source])).toEqual([["local", path]]);
  });

  test("an unlisted mirror file reports why it could not be read", async () => {
    const path = resolve("/maps/local.yaml");
    const missing = resolve("/maps/missing-mirror.yaml");
    const broken = resolve("/maps/broken-mirror.yaml");

    const unreadable = await loadDerpNodeInventory(
      { paths: [path], urls: [], ...SETTINGS, mirrorPath: missing, mirrorEnabled: true },
      { fs: createFakeFs({ [path]: LOCAL_MAP }) },
    );
    const invalid = await loadDerpNodeInventory(
      { paths: [path], urls: [], ...SETTINGS, mirrorPath: broken, mirrorEnabled: true },
      { fs: createFakeFs({ [path]: LOCAL_MAP, [broken]: "not: [a, derp, map" }) },
    );

    expect(unreadable.groups.map((group) => [group.kind, group.state])).toEqual([
      ["local", "ok"],
      ["mirror", "unreadable"],
    ]);
    expect(invalid.groups[1]).toMatchObject({ kind: "mirror", unlisted: true, state: "invalid" });
    expect(invalid.groups[1]?.regions).toEqual([]);
  });

  test("holds an unlisted mirror file apart from the far maps", async () => {
    const path = resolve("/maps/local.yaml");
    const mirror = resolve("/maps/official-mirror.yaml");
    const url = "https://example.com/public.yaml";
    const inventory = await loadDerpNodeInventory(
      { paths: [path], urls: [url], ...SETTINGS, mirrorPath: mirror, mirrorEnabled: true },
      {
        fs: createFakeFs({ [path]: LOCAL_MAP, [mirror]: MIRROR_MAP }),
        fetch: () => Promise.resolve(textResponse(MIRROR_MAP)),
      },
    );

    // The filter's file is claimed before any URL, so a remote map that repeats
    // its region can never take its nodes away from the filter row.
    expect(inventory.groups.map((group) => group.kind)).toEqual(["local", "mirror", "remote"]);
    expect(inventory.groups[1]?.regions.map((region) => region.regionId)).toEqual([911]);
  });

  test("says why a configured file contributed nothing", async () => {
    const missing = resolve("/maps/missing.yaml");
    const broken = resolve("/maps/broken.yaml");
    const inventory = await loadDerpNodeInventory(
      { paths: [missing, broken], urls: [], ...SETTINGS },
      { fs: createFakeFs({ [broken]: "not: [a, derp, map" }) },
    );

    expect(inventory.groups.map((group) => group.state)).toEqual(["unreadable", "invalid"]);
    expect(inventory.groups.every((group) => group.regions.length === 0)).toBe(true);
  });

  test("a URL that cannot be read is an unreadable remote group", async () => {
    const url = "https://example.com/down.yaml";
    const inventory = await loadDerpNodeInventory(
      { paths: [], urls: [url], ...SETTINGS },
      { fs: createFakeFs({}), fetch: () => Promise.reject(new Error("offline")) },
    );

    expect(inventory.groups).toEqual([
      { source: url, kind: "remote", state: "unreadable", regions: [] },
    ]);
    expect(inventory.remote).toBeUndefined();
  });

  test("keeps the region names of every map it read", async () => {
    const path = resolve("/maps/local.yaml");
    const url = "https://example.com/public.yaml";
    const inventory = await loadDerpNodeInventory(
      { paths: [path], urls: [url], ...SETTINGS },
      {
        fs: createFakeFs({ [path]: LOCAL_MAP }),
        fetch: () => Promise.resolve(textResponse(MIRROR_MAP)),
      },
    );

    expect(inventory.local).toEqual({
      "901": { regionId: 901, code: "ams", name: "Amsterdam" },
    });
    expect(inventory.remote).toEqual({
      "911": { regionId: 911, code: "hkg", name: "Hong Kong" },
    });
  });

  test("an empty configuration describes nothing and complains about nothing", async () => {
    const inventory = await loadDerpNodeInventory({ paths: [], urls: [], ...SETTINGS });

    expect(inventory).toEqual({ local: undefined, remote: undefined, groups: [] });
  });
});
