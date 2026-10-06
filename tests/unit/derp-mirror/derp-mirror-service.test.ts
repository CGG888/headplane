import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createDerpMirrorService,
  DERP_MIRROR_SNAPSHOT_REASON,
  derpMirrorFailureReason,
  loadOfficialRegions,
  mirrorTargetProblem,
  OFFICIAL_DERP_MAP_URL,
  type DerpMirrorService,
} from "~/server/derp-mirror/service.server";
import { DEFAULT_DERP_MIRROR_SETTINGS } from "~/server/derp-mirror/settings";
import { readDerpMirrorDocument, writeDerpMirrorDocument } from "~/server/derp-mirror/store";
import type { DerpMirrorRun, OfficialRegion } from "~/server/derp-mirror/types";
import type { Headscale } from "~/server/headscale/api";
import { clearRemoteDerpMapCache } from "~/server/headscale/derp-map-remote";
import type { SnapshotService } from "~/server/snapshots/service.server";

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const HKG = "20";
const SIN = "3";
const TOK = "9";
const FRA = "7";
const NYC = "25";

/** Root ignores the read-only bit, so the permission rail cannot be tested as root. */
const RUNS_AS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

function region(regionId: string, code: string, name: string, nodes = 1): OfficialRegion {
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
      ipv6: `2001:db8::${index + 1}`,
    })),
  };
}

const OFFICIAL: OfficialRegion[] = [
  region(HKG, "hkg", "Hong Kong", 2),
  region(SIN, "sin", "Singapore"),
  region(TOK, "tok", "Tokyo"),
  region(FRA, "fra", "Frankfurt"),
  region(NYC, "nyc", "New York"),
];

interface Harness {
  service: DerpMirrorService;
  dir: string;
  target: string;
  snapshot: ReturnType<typeof vi.fn>;
  audit: Array<Record<string, unknown>>;
  alerts: Array<{ failed: boolean; reason?: string }>;
  reload: ReturnType<typeof vi.fn>;
  /** The live `derp.urls` list the fake configuration hands out. */
  urls: string[];
  /** Every fetch request the service made, as the shared loader receives it. */
  loads: Array<{ urls: string[]; cache: { autoUpdateEnabled: boolean; updateFrequency: string } }>;
  /** The map the fake fetcher answers with; undefined makes it fail. */
  source: { regions: OfficialRegion[] | undefined; latencies: Record<string, number> };
}

describe("DERP region mirror service", () => {
  let dir: string;
  let harness: Harness | undefined;

  function build(
    options: {
      withSnapshots?: boolean;
      withAlerts?: boolean;
      withIntegration?: boolean;
      reloadFails?: boolean;
    } = {},
  ): Harness {
    const target = join(dir, "official-mirror.yaml");
    const audit: Array<Record<string, unknown>> = [];
    const alerts: Array<{ failed: boolean; reason?: string }> = [];
    const loads: Harness["loads"] = [];
    const snapshot = vi.fn(async () => ({ id: "snap-1" }));
    const reload = vi.fn(async () => {
      if (options.reloadFails) {
        throw new Error("reload refused");
      }
    });
    const urls: string[] = ["https://controlplane.tailscale.com/derpmap/default"];
    const source: Harness["source"] = { regions: OFFICIAL, latencies: {} };

    const service = createDerpMirrorService({
      dataPath: dir,
      config: {
        getDERPSettings: () => ({
          urls,
          autoUpdateEnabled: true,
          updateFrequency: "3h",
        }),
      },
      ...(options.withSnapshots === false
        ? {}
        : { snapshots: { take: snapshot } as unknown as SnapshotService }),
      audit: {
        record: async (input) => {
          audit.push(input as unknown as Record<string, unknown>);
        },
      },
      ...(options.withAlerts === false
        ? {}
        : {
            alerts: {
              reportDerpSync: async (input: { failed: boolean; reason?: string }) => {
                alerts.push(input);
              },
            },
          }),
      headscale: {} as unknown as Headscale,
      ...(options.withIntegration === false ? {} : { integration: { onConfigChange: reload } }),
      loadOfficialRegions: async (requestedUrls, cache) => {
        loads.push({ urls: [...requestedUrls], cache });
        return source.regions;
      },
      loadLatencies: async () => source.latencies,
      now: () => new Date(BASE),
    });

    const next: Harness = {
      service,
      dir,
      target,
      snapshot,
      audit,
      alerts,
      reload,
      urls,
      loads,
      source,
    };
    harness = next;
    return next;
  }

  /** The settings a test starts from, with the target inside the data directory. */
  async function configure(h: Harness, patch: Record<string, unknown> = {}) {
    const result = await h.service.update({
      enabled: true,
      targetPath: h.target,
      officialRegionIds: [HKG, SIN],
      autoReload: false,
      ...patch,
    });
    expect(result.success).toBe(true);
    return result;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-mirror-service-"));
    harness = undefined;
  });

  afterEach(async () => {
    harness?.service.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test("writes the mirrored map, snapshots it and records the run", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, SIN, TOK], autoReload: true });

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(run?.changed).toBe(true);
    expect(run?.mirrored).toEqual([HKG, SIN, TOK]);
    expect(run?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [TOK]: 903 });
    expect(run?.reload).toBe("triggered");
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.snapshot).toHaveBeenCalledWith(DERP_MIRROR_SNAPSHOT_REASON, [
      { path: h.target, kind: "derp_map" },
    ]);
    expect(run?.snapshotId).toBe("snap-1");
    expect(h.audit).toHaveLength(1);
    expect(h.alerts).toEqual([{ failed: false }]);

    const yaml = await readFile(h.target, "utf8");
    expect(yaml).toContain("regionname: 香港");
    expect(yaml).toContain("regioncode: hkg");
    expect(yaml).toContain("name: 901a");

    // The run and the numbering it settled on are both persisted.
    const document = await readDerpMirrorDocument(dir);
    expect(document.last?.outcome).toBe("changed");
    expect(document.settings.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [TOK]: 903 });
    expect(typeof document.settings.assignmentRankedAt).toBe("string");
  });

  test("a second run with an identical map writes nothing and takes no snapshot", async () => {
    const h = build();
    await configure(h);

    expect((await h.service.runNow())?.outcome).toBe("changed");
    const before = await stat(h.target);

    const second = await h.service.runNow();

    expect(second?.outcome).toBe("unchanged");
    expect(second?.changed).toBe(false);
    expect(second?.reload).toBe("not-needed");
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    expect((await stat(h.target)).mtimeMs).toBe(before.mtimeMs);
  });

  test("a fetch that yields nothing keeps the previous file and records the reason", async () => {
    const h = build();
    await configure(h);
    await writeFile(h.target, "previous: map\n", "utf8");
    h.source.regions = undefined;

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.reason).toBe("fetch-unusable");
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:fetch-unusable" }]);
    expect((await readDerpMirrorDocument(dir)).last?.reason).toBe("fetch-unusable");
  });

  test("an empty selection is refused before anything is fetched", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [] });
    await writeFile(h.target, "previous: map\n", "utf8");

    const run = await h.service.runNow();

    expect(run?.reason).toBe("selection-empty");
    expect(run?.outcome).toBe("skipped");
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:selection-empty" }]);
  });

  test("a selection the official map does not describe records no-regions", async () => {
    const h = build();
    await configure(h, { officialRegionIds: ["12345"] });
    await writeFile(h.target, "previous: map\n", "utf8");

    const run = await h.service.runNow();

    expect(run?.reason).toBe("no-regions");
    expect(run?.detail).toBe("12345");
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
  });

  test("a map that fails validation is never written", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });
    await writeFile(h.target, "previous: map\n", "utf8");
    h.source.regions = [
      {
        ...region(HKG, "hkg", "Hong Kong"),
        nodes: [
          {
            name: "hkg1",
            hostname: "hkg1.example.com",
            stunOnly: false,
            ipv4: "not-an-address",
          },
        ],
      },
    ];

    const run = await h.service.runNow();

    expect(run?.reason).toBe("validation-failed");
    expect(run?.detail).toBe("derpNodeInvalidIpv4");
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:validation-failed" }]);
  });

  test.skipIf(RUNS_AS_ROOT)("a read-only target is refused rather than replaced", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });
    await writeFile(h.target, "previous: map\n", "utf8");
    await chmod(h.target, 0o444);

    try {
      const run = await h.service.runNow();

      expect(run?.reason).toBe("not-writable");
      expect(run?.outcome).toBe("skipped");
      expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
      expect(h.snapshot).not.toHaveBeenCalled();
      expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:not-writable" }]);
    } finally {
      // The read-only bit has to go before the temp directory can be removed on
      // Windows, where deleting a read-only file is refused.
      await chmod(h.target, 0o644);
    }
  });

  test("a target with a parent traversal is refused instead of resolved", async () => {
    const h = build();
    // Written with separators by hand: `join` would collapse the `..` away, and
    // the point of the test is a stored path that still carries it.
    const escaping = `${dir}/nested/../official-mirror.yaml`;
    await configure(h, { targetPath: escaping });

    const run = await h.service.runNow();

    expect(run?.reason).toBe("target-unsafe");
    expect(run?.outcome).toBe("skipped");
    await expect(readFile(h.target, "utf8")).rejects.toBeDefined();
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:target-unsafe" }]);
  });

  test("a path with a parent traversal is refused", async () => {
    expect(mirrorTargetProblem("/etc/headscale/../derp.yaml")).toBe("target-unsafe");
    expect(mirrorTargetProblem("derp.yaml")).toBe("target-relative");
    expect(mirrorTargetProblem("")).toBe("target-relative");
    expect(mirrorTargetProblem("/etc/headscale/derp.yaml")).toBeUndefined();
  });

  test("a failing reload is reported after the file is already written", async () => {
    const h = build({ reloadFails: true });
    await configure(h, { autoReload: true });

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(run?.reload).toBe("failed");
    expect(run?.reason).toBe("reload-failed");
    expect(await readFile(h.target, "utf8")).toContain("regioncode: hkg");
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:reload-failed" }]);
  });

  test("the reload switch off means a manual reload, not a trigger", async () => {
    const h = build();
    await configure(h, { autoReload: false });

    const run = await h.service.runNow();

    expect(run?.reload).toBe("manual");
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ failed: false }]);
  });

  test("check reports the diff and touches nothing", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, SIN, TOK], assignment: {} });

    const run = await h.service.check();

    expect(run?.mode).toBe("check");
    expect(run?.outcome).toBe("changed");
    expect(run?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [TOK]: 903 });
    await expect(readFile(h.target, "utf8")).rejects.toBeDefined();
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([]);

    // A check proposes a numbering; it does not adopt it.
    const document = await readDerpMirrorDocument(dir);
    expect(document.settings.assignment).toEqual({});
    expect(document.settings.assignmentRankedAt).toBeUndefined();
    expect(document.last?.mode).toBe("check");
  });

  test("check on an up-to-date file reports unchanged", async () => {
    const h = build();
    await configure(h);
    await h.service.runNow();

    const run = await h.service.check();

    expect(run?.outcome).toBe("unchanged");
    expect(run?.mode).toBe("check");
  });

  test("keeps the stored numbering across runs and re-ranks only on reassign", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, SIN, FRA, NYC] });
    h.source.latencies = { [FRA]: 100, [NYC]: 1 };

    // The first run ranks New York (1ms) before Frankfurt (100ms).
    const first = await h.service.runNow();
    expect(first?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [NYC]: 903, [FRA]: 904 });

    // Today's measurements would swap them; the stable run does not.
    h.source.latencies = { [FRA]: 1, [NYC]: 100 };
    const stable = await h.service.runNow();
    expect(stable?.outcome).toBe("unchanged");
    expect(stable?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [NYC]: 903, [FRA]: 904 });

    // Reassigning is the explicit way to adopt the new order.
    const reranked = await h.service.reassign();
    expect(reranked?.outcome).toBe("changed");
    expect(reranked?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [FRA]: 903, [NYC]: 904 });
    expect(await readFile(h.target, "utf8")).toContain("regioncode: fra");
  });

  test("appends a newly selected region after the numbers already in use", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, SIN, NYC] });
    await h.service.runNow();

    await h.service.update({ officialRegionIds: [HKG, SIN, NYC, TOK] });
    h.source.latencies = { [TOK]: 1 };

    const run = await h.service.runNow();

    expect(run?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [NYC]: 903, [TOK]: 904 });
  });

  test("a manual run still works while the schedule is disabled", async () => {
    const h = build();
    await h.service.update({ targetPath: h.target, officialRegionIds: [HKG] });

    expect(h.service.settings().enabled).toBe(false);
    const run = await h.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(await readFile(h.target, "utf8")).toContain("regionname: 香港");
  });

  test("hands the configured URLs and cache window to the shared fetcher", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, "9999"] });
    h.urls.length = 0;
    h.urls.push("https://maps.example.com/derp.json", "https://maps.example.com/derp.json");

    const run = await h.service.runNow();

    // The selection lists one region the map does not describe; the other is
    // mirrored, and the loader saw exactly the configured URL list.
    expect(run?.mirrored).toEqual([HKG]);
    expect(h.loads).toEqual([
      {
        urls: ["https://maps.example.com/derp.json", "https://maps.example.com/derp.json"],
        cache: { autoUpdateEnabled: true, updateFrequency: "3h" },
      },
    ]);
  });

  test("an unexpected failure is recorded and reported once", async () => {
    const h = build({ withSnapshots: false });
    await configure(h, { officialRegionIds: [HKG] });
    h.service.dispose();

    const service = createDerpMirrorService({
      dataPath: dir,
      config: {
        getDERPSettings: () => {
          throw new Error("configuration is unreadable");
        },
      },
      headscale: {} as unknown as Headscale,
      loadOfficialRegions: async () => OFFICIAL,
      now: () => new Date(BASE),
    });

    try {
      await service.update({ enabled: true, targetPath: h.target, officialRegionIds: [HKG] });
      const run = await service.runNow();

      expect(run?.outcome).toBe("failed");
      expect(run?.reason).toBe("unexpected");
      expect(run?.error).toContain("configuration is unreadable");
      await expect(readFile(h.target, "utf8")).rejects.toBeDefined();
    } finally {
      service.dispose();
    }
  });

  test("an unwritable settings document reports failure instead of throwing", async () => {
    const blocked = join(dir, "blocked");
    await writeFile(blocked, "not a directory", "utf8");

    const service = createDerpMirrorService({
      dataPath: blocked,
      config: {
        getDERPSettings: () => ({ urls: [], autoUpdateEnabled: false, updateFrequency: "3h" }),
      },
      headscale: {} as unknown as Headscale,
      loadOfficialRegions: async () => OFFICIAL,
    });

    try {
      const result = await service.update({ enabled: true });
      expect(result.success).toBe(false);
      expect(result.settings.enabled).toBe(false);
      expect(service.settings().enabled).toBe(false);
    } finally {
      service.dispose();
    }
  });
});

describe("DERP region mirror scheduling", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-mirror-schedule-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function service(intervalMs = 60_000): DerpMirrorService {
    return createDerpMirrorService({
      dataPath: dir,
      config: {
        getDERPSettings: () => ({ urls: [], autoUpdateEnabled: true, updateFrequency: "3h" }),
      },
      headscale: {} as unknown as Headscale,
      loadOfficialRegions: async () => OFFICIAL,
      now: () => new Date(BASE),
      intervalMs,
    });
  }

  test("start schedules nothing while the mirror is disabled", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const instance = service();

    try {
      instance.start();
      await instance.ready();

      expect(instance.settings().enabled).toBe(false);
      expect(interval).not.toHaveBeenCalled();
    } finally {
      instance.dispose();
      interval.mockRestore();
    }
  });

  test("start schedules the configured interval and unrefs the timer", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    const unref = vi.fn();
    interval.mockReturnValue({ unref } as never);

    await writeDerpMirrorDocument(dir, {
      settings: {
        ...DEFAULT_DERP_MIRROR_SETTINGS,
        enabled: true,
        intervalHours: 6,
        targetPath: join(dir, "mirror.yaml"),
      },
    });

    const instance = service(60_000);

    try {
      instance.start();
      await instance.ready();

      expect(interval).toHaveBeenCalledTimes(1);
      expect(interval.mock.calls[0][1]).toBe(60_000);
      expect(unref).toHaveBeenCalledTimes(1);

      instance.dispose();
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      instance.dispose();
      interval.mockRestore();
      clear.mockRestore();
    }
  });

  test("saving settings reschedules and disabling stops the timer", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    interval.mockReturnValue({ unref: vi.fn() } as never);

    const instance = service(60_000);

    try {
      const saved = await instance.update({ enabled: true, intervalHours: 6 });
      expect(saved.success).toBe(true);
      expect(interval).toHaveBeenCalledTimes(1);

      const disabled = await instance.update({ enabled: false });
      expect(disabled.success).toBe(true);
      expect(clear).toHaveBeenCalled();
      expect(interval).toHaveBeenCalledTimes(1);
    } finally {
      instance.dispose();
      interval.mockRestore();
      clear.mockRestore();
    }
  });
});

describe("DERP region mirror failure predicate", () => {
  function run(overrides: Partial<DerpMirrorRun> = {}): DerpMirrorRun {
    return {
      at: new Date(BASE).toISOString(),
      mode: "run",
      outcome: "unchanged",
      selected: [],
      mirrored: [],
      assignment: {},
      targetPath: "/mnt/derp/mirror.yaml",
      changed: false,
      reload: "not-needed",
      ...overrides,
    };
  }

  test("a run that only found nothing to change is not a failure", () => {
    expect(derpMirrorFailureReason(run())).toBeUndefined();
    expect(derpMirrorFailureReason(run({ outcome: "changed", reload: "manual" }))).toBeUndefined();
    expect(
      derpMirrorFailureReason(run({ outcome: "changed", reload: "triggered" })),
    ).toBeUndefined();
  });

  test("every skip, a failed reload and an unexpected error are failures", () => {
    expect(derpMirrorFailureReason(run({ outcome: "skipped", reason: "not-writable" }))).toBe(
      "not-writable",
    );
    expect(derpMirrorFailureReason(run({ outcome: "changed", reload: "failed" }))).toBe(
      "reload-failed",
    );
    expect(derpMirrorFailureReason(run({ outcome: "failed" }))).toBe("unexpected");
  });
});

describe("DERP region mirror official map loader", () => {
  const CACHE = { autoUpdateEnabled: true, updateFrequency: "3h" };

  /** One region, in the official map's own numbering and shape. */
  const OFFICIAL_MAP = [
    "regions:",
    "  20:",
    "    regionid: 20",
    "    regioncode: hkg",
    "    regionname: Hong Kong",
    "    nodes:",
    "      - name: hkg1",
    "        hostname: hkg1.example.com",
    "        derpport: 443",
    "        stunport: 3478",
    "        ipv4: 1.2.3.4",
    "",
  ].join("\n");

  const READ: OfficialRegion[] = [
    {
      regionId: 20,
      code: "hkg",
      name: "Hong Kong",
      nodes: [
        {
          name: "hkg1",
          hostname: "hkg1.example.com",
          derpPort: 443,
          stunPort: 3478,
          stunOnly: false,
          ipv4: "1.2.3.4",
        },
      ],
    },
  ];

  function answering(status: number, text: string) {
    return async () => ({ ok: status === 200, status, text: async () => text });
  }

  beforeEach(() => {
    // The fetcher caches per URL process-wide, so tests start from a clean one.
    clearRemoteDerpMapCache();
  });

  test("reads the official map through the shared cached fetcher", async () => {
    const url = "https://maps.example.com/unit-official.json";
    const regions = await loadOfficialRegions([url], CACHE, {
      fetch: answering(200, OFFICIAL_MAP),
    });

    expect(regions).toEqual(READ);
  });

  test("falls back to the official URL when the configuration lists none", async () => {
    const seen: string[] = [];
    const regions = await loadOfficialRegions([], CACHE, {
      fetch: async (url) => {
        seen.push(url);
        return answering(200, OFFICIAL_MAP)();
      },
    });

    expect(seen).toEqual([OFFICIAL_DERP_MAP_URL]);
    expect(regions).toEqual(READ);
  });

  test("ignores blank entries and tries the configured URLs in order", async () => {
    const dead = "https://dead.example.com/map.json";
    const good = "https://good.example.com/map.json";
    const seen: string[] = [];

    const regions = await loadOfficialRegions(["", dead, good], CACHE, {
      fetch: async (url) => {
        seen.push(url);
        return answering(url === dead ? 500 : 200, OFFICIAL_MAP)();
      },
    });

    expect(seen).toEqual([dead, good]);
    expect(regions).toEqual(READ);
  });

  test("resolves to undefined when nothing answers with a usable map", async () => {
    const regions = await loadOfficialRegions(["https://dead.example.com/map.json"], CACHE, {
      fetch: answering(500, "nope"),
    });

    expect(regions).toBeUndefined();
  });

  test("resolves to undefined for a body that is not a DERP map", async () => {
    const regions = await loadOfficialRegions(["https://maps.example.com/unit-junk.json"], CACHE, {
      fetch: answering(200, "just: a document\n"),
    });

    expect(regions).toBeUndefined();
  });
});
