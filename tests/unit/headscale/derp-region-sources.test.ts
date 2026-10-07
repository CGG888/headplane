import { resolve } from "node:path";

import { describe, expect, test, beforeEach } from "vitest";

import {
  clearRemoteDerpMapCache,
  DERP_MAP_FAILURE_TTL_MS,
  DERP_MAP_MAX_TTL_MS,
  DERP_MAP_MIN_TTL_MS,
  DERP_MAP_SUCCESS_TTL_MS,
  loadRemoteDerpMap,
  remoteDerpMapTtlMs,
  type DerpMapFetch,
  type DerpMapResponse,
} from "~/server/headscale/derp-map-remote";
import {
  clearLocalDerpRegionCache,
  loadDerpRegionSources,
  type DerpRegionFs,
} from "~/server/headscale/derp-region-sources";

const MAP = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes: []
  902:
    regionid: 902
    regioncode: fra
    regionname: "Frankfurt"
    nodes: []
`;

/** Two regions sharing a code, which the validator rejects but a reader keeps. */
const DUPLICATE_CODE_MAP = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes: []
  902:
    regionid: 902
    regioncode: ams
    regionname: "Amsterdam Two"
    nodes: []
`;

function textResponse(body: string, status = 200): DerpMapResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  };
}

/** A fetch that answers with `body` and counts how often it was dialled. */
function countingFetch(body: string, status = 200) {
  const calls: string[] = [];
  const fetch: DerpMapFetch = (url) => {
    calls.push(url);
    return Promise.resolve(textResponse(body, status));
  };

  return { calls, fetch };
}

function createFakeFs(files: Record<string, { content: string; mtimeMs?: number }>) {
  const reads: string[] = [];
  const fs: DerpRegionFs = {
    stat: (path) => {
      const entry = files[path];
      if (!entry) {
        return Promise.reject(new Error(`ENOENT: ${path}`));
      }

      return Promise.resolve({ size: entry.content.length, mtimeMs: entry.mtimeMs ?? 1 });
    },
    readFile: (path) => {
      reads.push(path);
      const entry = files[path];
      if (!entry) {
        return Promise.reject(new Error(`ENOENT: ${path}`));
      }

      return Promise.resolve(entry.content);
    },
  };

  return { fs, reads };
}

const SETTINGS = { autoUpdateEnabled: false, updateFrequency: "3h" };

beforeEach(() => {
  clearRemoteDerpMapCache();
  clearLocalDerpRegionCache();
});

describe("remote DERP map cache window", () => {
  test("keeps the long default while Headscale reads the map only at startup", () => {
    expect(remoteDerpMapTtlMs({ autoUpdateEnabled: false, updateFrequency: "30m" })).toBe(
      DERP_MAP_SUCCESS_TTL_MS,
    );
  });

  test("follows derp.update_frequency for a background refresh", () => {
    expect(remoteDerpMapTtlMs({ autoUpdateEnabled: true, updateFrequency: "30m" })).toBe(
      30 * 60 * 1000,
    );
    // A frequency outside a sensible page window is clamped, not obeyed blindly.
    expect(remoteDerpMapTtlMs({ autoUpdateEnabled: true, updateFrequency: "10s" })).toBe(
      DERP_MAP_MIN_TTL_MS,
    );
    expect(remoteDerpMapTtlMs({ autoUpdateEnabled: true, updateFrequency: "48h" })).toBe(
      DERP_MAP_MAX_TTL_MS,
    );
    expect(remoteDerpMapTtlMs({ autoUpdateEnabled: true, updateFrequency: "nonsense" })).toBe(
      DERP_MAP_SUCCESS_TTL_MS,
    );
  });
});

describe("loadRemoteDerpMap", () => {
  test("reads a map once and serves the cache afterwards", async () => {
    const { calls, fetch } = countingFetch(MAP);
    const options = { fetch };

    const first = await loadRemoteDerpMap("https://example.com/derp.yaml", SETTINGS, options);
    const second = await loadRemoteDerpMap("https://example.com/derp.yaml", SETTINGS, options);

    expect(calls).toEqual(["https://example.com/derp.yaml"]);
    expect(first).toEqual([
      { regionId: 901, code: "ams", name: "Amsterdam" },
      { regionId: 902, code: "fra", name: "Frankfurt" },
    ]);
    expect(second).toEqual(first);
  });

  test("the cache stays bounded and lets the oldest map go", async () => {
    const { calls, fetch } = countingFetch(MAP);
    const options = { fetch, now: () => 0, ttlMs: 60_000 };

    for (let index = 0; index <= 200; index += 1) {
      await loadRemoteDerpMap(`https://example.com/map-${index}.yaml`, SETTINGS, options);
    }

    expect(calls).toHaveLength(201);

    // The map read last is still cached, while the map read first was evicted
    // and is fetched again instead of the cache growing without bound.
    await loadRemoteDerpMap("https://example.com/map-200.yaml", SETTINGS, options);
    expect(calls).toHaveLength(201);

    await loadRemoteDerpMap("https://example.com/map-0.yaml", SETTINGS, options);
    expect(calls).toHaveLength(202);
  });

  test("refetches once the success window has passed", async () => {
    const { calls, fetch } = countingFetch(MAP);
    let now = 1_000;
    const options = { fetch, now: () => now, ttlMs: 100 };

    await loadRemoteDerpMap("https://example.com/expiring.yaml", SETTINGS, options);
    now += 99;
    await loadRemoteDerpMap("https://example.com/expiring.yaml", SETTINGS, options);
    now += 2;
    await loadRemoteDerpMap("https://example.com/expiring.yaml", SETTINGS, options);

    expect(calls).toHaveLength(2);
  });

  test("coalesces concurrent callers into one request", async () => {
    const { calls, fetch } = countingFetch(MAP);

    const [first, second] = await Promise.all([
      loadRemoteDerpMap("https://example.com/shared.yaml", SETTINGS, { fetch }),
      loadRemoteDerpMap("https://example.com/shared.yaml", SETTINGS, { fetch }),
    ]);

    expect(calls).toHaveLength(1);
    expect(first).toEqual(second);
  });

  test("a timeout resolves to no regions and is cached briefly", async () => {
    const calls: string[] = [];
    const fetch: DerpMapFetch = (url, { signal }) => {
      calls.push(url);
      return new Promise<DerpMapResponse>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };

    const options = { fetch, timeoutMs: 5, failureTtlMs: 10_000 };
    const first = await loadRemoteDerpMap("https://example.com/slow.yaml", SETTINGS, options);
    const second = await loadRemoteDerpMap("https://example.com/slow.yaml", SETTINGS, options);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    // The one retry a transport failure gets dials the URL a second time; the
    // second lookup is then served from the failure cache.
    expect(calls).toHaveLength(2);
  });

  test("a rejected fetch resolves to no regions", async () => {
    const fetch: DerpMapFetch = () => Promise.reject(new Error("ECONNREFUSED"));

    await expect(
      loadRemoteDerpMap("https://example.com/refused.yaml", SETTINGS, { fetch }),
    ).resolves.toBeUndefined();
  });

  test("a malformed body resolves to no regions", async () => {
    for (const body of [
      "regions: [1, 2, 3]",
      "{ not yaml",
      "regions:\n  901:\n    regioncode: ams",
    ]) {
      const { fetch } = countingFetch(body);
      const url = `https://example.com/malformed-${body.length}.yaml`;
      await expect(loadRemoteDerpMap(url, SETTINGS, { fetch })).resolves.toBeUndefined();
    }
  });

  test("a non-200 answer resolves to no regions", async () => {
    const { fetch } = countingFetch(MAP, 500);
    await expect(
      loadRemoteDerpMap("https://example.com/error.yaml", SETTINGS, { fetch }),
    ).resolves.toBeUndefined();
  });

  test("a failure is retried after the short window, not the long one", async () => {
    const { calls, fetch } = countingFetch(MAP, 503);
    let now = 1_000;
    const options = { fetch, now: () => now, ttlMs: 10 * 60 * 1000 };

    await loadRemoteDerpMap("https://example.com/retry.yaml", SETTINGS, options);
    now += DERP_MAP_FAILURE_TTL_MS - 1;
    await loadRemoteDerpMap("https://example.com/retry.yaml", SETTINGS, options);
    expect(calls).toHaveLength(1);

    now += 1;
    await loadRemoteDerpMap("https://example.com/retry.yaml", SETTINGS, options);
    expect(calls).toHaveLength(2);
  });

  test("ignores a blank URL without dialling anything", async () => {
    const { calls, fetch } = countingFetch(MAP);
    await expect(loadRemoteDerpMap("  ", SETTINGS, { fetch })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("loadDerpRegionSources", () => {
  test("reads local files, resolves relative paths and fills from remote maps", async () => {
    const baseDir = resolve("/etc/headscale");
    const path = resolve(baseDir, "derp.yaml");
    const { fs } = createFakeFs({ [path]: { content: MAP } });
    const { fetch } = countingFetch(
      `regions:
  903:
    regionid: 903
    regioncode: sfo
    regionname: "San Francisco"
    nodes: []
`,
    );

    const sources = await loadDerpRegionSources(
      {
        paths: ["derp.yaml"],
        urls: ["https://example.com/public.yaml"],
        autoUpdateEnabled: true,
        updateFrequency: "30m",
        baseDir,
      },
      { fs, fetch },
    );

    expect(sources.local).toEqual({
      "901": { regionId: 901, code: "ams", name: "Amsterdam" },
      "902": { regionId: 902, code: "fra", name: "Frankfurt" },
    });
    expect(sources.remote).toEqual({
      "903": { regionId: 903, code: "sfo", name: "San Francisco" },
    });
  });

  test("keeps two regions that share a code apart, keyed by id", async () => {
    const { fs } = createFakeFs({ [resolve("/maps/dup.yaml")]: { content: DUPLICATE_CODE_MAP } });

    const sources = await loadDerpRegionSources(
      {
        paths: ["/maps/dup.yaml"],
        urls: [],
        autoUpdateEnabled: false,
        updateFrequency: "3h",
      },
      { fs },
    );

    expect(Object.keys(sources.local ?? {})).toEqual(["901", "902"]);
    expect(sources.local?.["902"]?.name).toBe("Amsterdam Two");
  });

  test("never throws when a file is missing, unreadable or not a map", async () => {
    const { fs } = createFakeFs({
      [resolve("/maps/broken.yaml")]: { content: "not: [a, derp, map" },
    });

    const sources = await loadDerpRegionSources(
      {
        paths: ["/maps/missing.yaml", "/maps/broken.yaml"],
        urls: ["https://example.com/down.yaml"],
        autoUpdateEnabled: false,
        updateFrequency: "3h",
      },
      { fs, fetch: () => Promise.reject(new Error("offline")) },
    );

    expect(sources).toEqual({ local: undefined, remote: undefined });
  });

  test("caches a parsed local file until its size or mtime changes", async () => {
    const path = resolve("/maps/cached.yaml");
    const files = { [path]: { content: MAP, mtimeMs: 10 } };
    const { fs, reads } = createFakeFs(files);
    const input = {
      paths: [path],
      urls: [],
      autoUpdateEnabled: false,
      updateFrequency: "3h",
    };

    await loadDerpRegionSources(input, { fs });
    await loadDerpRegionSources(input, { fs });
    expect(reads).toHaveLength(1);

    files[path] = { content: DUPLICATE_CODE_MAP, mtimeMs: 11 };
    const edited = await loadDerpRegionSources(input, { fs });
    expect(reads).toHaveLength(2);
    expect(edited.local?.["902"]?.name).toBe("Amsterdam Two");
  });

  test("drops a map file larger than the supported size without reading it", async () => {
    const huge = resolve("/maps/huge.yaml");
    const { fs, reads } = createFakeFs({
      [huge]: { content: "x".repeat(256 * 1024 + 1) },
    });

    const sources = await loadDerpRegionSources(
      {
        paths: [huge],
        urls: [],
        autoUpdateEnabled: false,
        updateFrequency: "3h",
      },
      { fs },
    );

    expect(sources.local).toBeUndefined();
    // The size in the stat answer is enough; reading is what would have pulled
    // the whole file into memory first.
    expect(reads).toEqual([]);
  });

  test("measures a file that grew after its stat", async () => {
    const path = resolve("/maps/grown.yaml");
    const fs: DerpRegionFs = {
      stat: () => Promise.resolve({ size: 10, mtimeMs: 1 }),
      readFile: () => Promise.resolve("x".repeat(256 * 1024 + 1)),
    };

    const sources = await loadDerpRegionSources(
      {
        paths: [path],
        urls: [],
        autoUpdateEnabled: false,
        updateFrequency: "3h",
      },
      { fs },
    );

    expect(sources.local).toBeUndefined();
  });

  test("reads nothing without configured sources", async () => {
    const sources = await loadDerpRegionSources({
      paths: [],
      urls: [],
      autoUpdateEnabled: false,
      updateFrequency: "3h",
    });

    expect(sources).toEqual({ local: undefined, remote: undefined });
  });
});
