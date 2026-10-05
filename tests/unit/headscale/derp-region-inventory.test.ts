import { resolve } from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import {
  clearRemoteDerpMapCache,
  type DerpMapFetch,
  type DerpMapResponse,
} from "~/server/headscale/derp-map-remote";
import {
  clearLocalDerpRegionCache,
  loadDerpRegionInventory,
  type DerpRegionFs,
} from "~/server/headscale/derp-region-sources";

/** One region with a relay node and a STUN-only node that omits its ports. */
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
        stunport: 3479
        ipv4: 198.51.100.10
      - name: "901b"
        regionid: 901
        hostname: stun-ams.example.com
        stunonly: true
        stunport: 0
        ipv6: 2001:db8::10
`;

const REMOTE_MAP = `regions:
  903:
    regionid: 903
    regioncode: sfo
    regionname: "San Francisco"
    nodes:
      - name: "903a"
        regionid: 903
        hostname: derp-sfo.example.com
`;

function textResponse(body: string, status = 200): DerpMapResponse {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) };
}

function countingFetch(body: string, status = 200) {
  const calls: string[] = [];
  const fetch: DerpMapFetch = (url) => {
    calls.push(url);
    return Promise.resolve(textResponse(body, status));
  };

  return { calls, fetch };
}

function createFakeFs(files: Record<string, string>) {
  const fs: DerpRegionFs = {
    stat: (path) =>
      files[path] === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve({ size: files[path].length, mtimeMs: 1 }),
    readFile: (path) =>
      files[path] === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(files[path]),
  };

  return fs;
}

const SETTINGS = { autoUpdateEnabled: false, updateFrequency: "3h" };

beforeEach(() => {
  clearRemoteDerpMapCache();
  clearLocalDerpRegionCache();
});

describe("loadDerpRegionInventory", () => {
  test("reads each region's nodes and the file they came from", async () => {
    const path = resolve("/maps/local.yaml");
    const inventory = await loadDerpRegionInventory(
      { paths: [path], urls: [], ...SETTINGS },
      { fs: createFakeFs({ [path]: LOCAL_MAP }) },
    );

    expect(inventory.files).toEqual([{ path, state: "ok" }]);
    expect(inventory.remoteUnavailable).toBe(false);
    expect(inventory.regions).toHaveLength(1);
    expect(inventory.regions[0]).toMatchObject({
      regionId: 901,
      code: "ams",
      name: "Amsterdam",
      origin: { kind: "local", source: path },
    });
    expect(inventory.regions[0]?.nodes).toEqual([
      {
        name: "901a",
        hostname: "derp-ams.example.com",
        derpPort: 8443,
        stunPort: 3479,
        stunOnly: false,
        ipv4: "198.51.100.10",
      },
      {
        name: "901b",
        hostname: "stun-ams.example.com",
        stunPort: 0,
        stunOnly: true,
        ipv6: "2001:db8::10",
      },
    ]);
    expect(inventory.local).toEqual({
      "901": { regionId: 901, code: "ams", name: "Amsterdam" },
    });
  });

  test("keeps the first file that describes a region, nodes and all", async () => {
    const first = resolve("/maps/first.yaml");
    const second = resolve("/maps/second.yaml");
    const secondMap = LOCAL_MAP.replace("regioncode: ams", "regioncode: xxx").replace(
      '"Amsterdam"',
      '"Other"',
    );
    const inventory = await loadDerpRegionInventory(
      { paths: [first, second], urls: [], ...SETTINGS },
      { fs: createFakeFs({ [first]: LOCAL_MAP, [second]: secondMap }) },
    );

    expect(inventory.regions).toHaveLength(1);
    expect(inventory.regions[0]?.name).toBe("Amsterdam");
    expect(inventory.regions[0]?.origin.source).toBe(first);
    expect(inventory.regions[0]?.nodes[0]?.name).toBe("901a");
  });

  test("says why a configured file contributed nothing", async () => {
    const broken = resolve("/maps/broken.yaml");
    const empty = resolve("/maps/empty.yaml");
    const inventory = await loadDerpRegionInventory(
      {
        paths: [resolve("/maps/missing.yaml"), broken, empty],
        urls: [],
        ...SETTINGS,
      },
      { fs: createFakeFs({ [broken]: "not: [a, derp, map", [empty]: "regions: {}\n" }) },
    );

    expect(inventory.files).toEqual([
      { path: resolve("/maps/missing.yaml"), state: "unreadable" },
      { path: broken, state: "invalid" },
      { path: empty, state: "empty" },
    ]);
    expect(inventory.regions).toEqual([]);
    expect(inventory.local).toBeUndefined();
  });

  test("drops a file larger than the supported size", async () => {
    const path = resolve("/maps/huge.yaml");
    const inventory = await loadDerpRegionInventory(
      { paths: [path], urls: [], ...SETTINGS },
      { fs: createFakeFs({ [path]: "x".repeat(256 * 1024 + 1) }) },
    );

    expect(inventory.files).toEqual([{ path, state: "invalid" }]);
  });

  test("takes remote regions and their nodes from the cached fetch", async () => {
    const url = "https://example.com/public.yaml";
    const { calls, fetch } = countingFetch(REMOTE_MAP);
    const fs = createFakeFs({});

    const first = await loadDerpRegionInventory(
      { paths: [], urls: [url], ...SETTINGS },
      { fs, fetch },
    );
    const second = await loadDerpRegionInventory(
      { paths: [], urls: [url], ...SETTINGS },
      { fs, fetch },
    );

    expect(calls).toEqual([url]);
    expect(first.remoteUnavailable).toBe(false);
    expect(first.regions[0]).toMatchObject({
      regionId: 903,
      code: "sfo",
      origin: { kind: "remote", source: url },
    });
    expect(first.regions[0]?.nodes).toEqual([
      { name: "903a", hostname: "derp-sfo.example.com", stunOnly: false },
    ]);
    expect(second.regions).toEqual(first.regions);
  });

  test("a URL that cannot be read is reported without failing the read", async () => {
    const fs = createFakeFs({});
    const inventory = await loadDerpRegionInventory(
      { paths: [], urls: ["https://example.com/down.yaml"], ...SETTINGS },
      { fs, fetch: () => Promise.reject(new Error("offline")) },
    );

    expect(inventory.remoteUnavailable).toBe(true);
    expect(inventory.regions).toEqual([]);
    expect(inventory.remote).toBeUndefined();
  });

  test("an empty configuration describes nothing and complains about nothing", async () => {
    const inventory = await loadDerpRegionInventory({ paths: [], urls: [], ...SETTINGS });

    expect(inventory).toEqual({
      local: undefined,
      remote: undefined,
      regions: [],
      files: [],
      remoteUnavailable: false,
    });
  });

  test("leaves the defaults to the view by keeping an omitted port unset", async () => {
    const path = resolve("/maps/defaults.yaml");
    const inventory = await loadDerpRegionInventory(
      { paths: [path], urls: [], ...SETTINGS },
      { fs: createFakeFs({ [path]: REMOTE_MAP }) },
    );

    expect(inventory.regions[0]?.nodes[0]).toEqual({
      name: "903a",
      hostname: "derp-sfo.example.com",
      stunOnly: false,
    });
  });
});
