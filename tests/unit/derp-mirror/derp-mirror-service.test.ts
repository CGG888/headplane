import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ProbeUdpSocket } from "~/server/derp-mirror/probe.server";
import {
  createDerpMirrorService,
  DERP_MIRROR_SNAPSHOT_REASON,
  derpMirrorFailureReason,
  loadOfficialRegions,
  loadOfficialRegionsReport,
  mirrorTargetProblem,
  OFFICIAL_DERP_MAP_URL,
  type DerpMirrorService,
} from "~/server/derp-mirror/service.server";
import {
  DERP_MIRROR_PASTE_MAX_BYTES,
  DEFAULT_DERP_MIRROR_SETTINGS,
} from "~/server/derp-mirror/settings";
import {
  PASTED_MAP_SOURCE,
  parseDerpMapBody,
  resolveMirrorSourceChain,
  type OfficialMapReport,
} from "~/server/derp-mirror/sources";
import { readDerpMirrorDocument, writeDerpMirrorDocument } from "~/server/derp-mirror/store";
import type {
  DerpMirrorRun,
  DerpMirrorSourceFailure,
  OfficialRegion,
} from "~/server/derp-mirror/types";
import type { Headscale } from "~/server/headscale/api";
import {
  clearRemoteDerpMapCache,
  type RemoteDerpMapFailure,
} from "~/server/headscale/derp-map-remote";
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

/**
 * The official map as the wire body Tailscale serves, so the same fixture can
 * arrive either by download or by paste and the two files can be compared.
 */
const OFFICIAL_BODY = JSON.stringify({
  Regions: {
    "20": {
      RegionID: 20,
      RegionCode: "hkg",
      RegionName: "Hong Kong",
      Nodes: [
        {
          Name: "hkg1",
          HostName: "hkg1.example.com",
          DERPPort: 443,
          STUNPort: 3478,
          IPv4: "1.2.3.4",
        },
      ],
    },
    "3": {
      RegionID: 3,
      RegionCode: "sin",
      RegionName: "Singapore",
      Nodes: [{ Name: "sin1", HostName: "sin1.example.com", DERPPort: 443, IPv4: "1.2.3.5" }],
    },
    "9": {
      RegionID: 9,
      RegionCode: "tok",
      RegionName: "Tokyo",
      Nodes: [{ Name: "tok1", HostName: "tok1.example.com", DERPPort: 443, IPv4: "1.2.3.6" }],
    },
  },
});

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
  /** Every source list the service asked the fake loader for, in order. */
  loads: Array<{
    urls: string[];
    kinds: string[];
    cache: { autoUpdateEnabled: boolean; updateFrequency: string };
  }>;
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
      /** Held open by a test that needs the run still in flight. */
      gate?: { wait?: Promise<void> };
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
      loadOfficialRegions: async (sources, cache) => {
        loads.push({
          urls: sources.map((source) => source.url),
          kinds: sources.map((source) => source.kind),
          cache,
        });

        await options.gate?.wait;

        // The fake answers from its first source, or from none: a source list
        // either yields a map or reports every entry as failed.
        const first = sources[0];
        if (source.regions !== undefined && source.regions.length > 0 && first !== undefined) {
          return {
            regions: source.regions,
            source: first.url,
            sourceKind: first.kind,
            attempts: [{ url: first.url }],
          };
        }

        return {
          attempts: sources.map((entry) => ({ url: entry.url, reason: "timeout" as const })),
        };
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

  test("a disposed service abandons a run that is still loading", async () => {
    const gate: { wait?: Promise<void> } = {};
    const h = build({ gate });
    await configure(h);

    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    gate.wait = held;

    const pending = h.service.runNow();
    h.service.dispose();
    release?.();

    await expect(pending).resolves.toBeUndefined();
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.audit).toEqual([]);
    expect(h.alerts).toEqual([]);
    await expect(stat(h.target)).rejects.toMatchObject({ code: "ENOENT" });
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

  test("a selection larger than the 900s records the regions it cannot number", async () => {
    const h = build();
    // The mirrored range holds 97 usable numbers, so a map with 100 regions
    // (only a pasted one is this large) cannot be numbered completely.
    h.source.regions = Array.from({ length: 100 }, (_, index) =>
      region(String(1000 + index), `r${index}`, `Region ${index}`),
    );
    const ids = h.source.regions.map((entry) => String(entry.regionId));
    await configure(h, { officialRegionIds: ids });
    await writeFile(h.target, "previous: map\n", "utf8");

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.reason).toBe("numbering-exhausted");
    // The three highest ids rank last and are the ones left without a number.
    expect(run?.detail).toBe("1097, 1098, 1099");
    expect(run?.mirrored).toHaveLength(100);
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.audit).toHaveLength(0);
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:numbering-exhausted" }]);
  });

  test("a target that already holds something other than a DERP map is refused", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });
    // A mirrored path that names Headscale's own configuration, or any other
    // document, must not be replaced: `mirrorMapChanged` counts an unparsable
    // file as a change, so the whole file would be overwritten.
    const config = "server_url: https://headscale.example.com\n";
    await writeFile(h.target, config, "utf8");

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.reason).toBe("target-not-mirror");
    expect(run?.detail).toBe(h.target);
    expect(await readFile(h.target, "utf8")).toBe(config);
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:target-not-mirror" }]);
  });

  test("a broken mirror file is still repaired", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });
    // Shaped like a DERP map but invalid inside: the shape is what decides
    // whether the file may be replaced, so this one is repaired as before.
    await writeFile(h.target, "regions:\n  broken:\n    regionid: not-a-number\n", "utf8");

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(await readFile(h.target, "utf8")).toContain("regioncode: hkg");
  });

  test("a snapshot that fails stops the write", async () => {
    const h = build();
    h.snapshot.mockRejectedValue(new Error("the snapshot store is full"));
    await configure(h, { officialRegionIds: [HKG] });

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.reason).toBe("snapshot-failed");
    expect(run?.detail).toBe("the snapshot store is full");
    await expect(readFile(h.target, "utf8")).rejects.toBeDefined();
    expect(h.audit).toHaveLength(0);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ failed: true, reason: "derp-region-mirror:snapshot-failed" }]);
  });

  test.skipIf(RUNS_AS_ROOT)("a read-only target is refused rather than replaced", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });
    // A DERP map, so the write is refused for being unwritable rather than for
    // the file's shape.
    await writeFile(h.target, "regions: {}\n", "utf8");
    await chmod(h.target, 0o444);

    try {
      const run = await h.service.runNow();

      expect(run?.reason).toBe("not-writable");
      expect(run?.outcome).toBe("skipped");
      expect(await readFile(h.target, "utf8")).toBe("regions: {}\n");
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
    expect(h.audit).toEqual([]);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([]);

    // A check proposes a numbering; it does not adopt it and does not even
    // become the stored run: a preview writes nothing at all.
    const document = await readDerpMirrorDocument(dir);
    expect(document.settings.assignment).toEqual({});
    expect(document.settings.assignmentRankedAt).toBeUndefined();
    expect(document.last).toBeUndefined();
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
    // mirrored, and the loader saw the configured URL once — a repeated entry is
    // not dialled twice — followed by the built-in official fallback, which is
    // the chain an install with no configured sources has always used.
    expect(run?.mirrored).toEqual([HKG]);
    expect(h.loads).toEqual([
      {
        urls: ["https://maps.example.com/derp.json", OFFICIAL_DERP_MAP_URL],
        kinds: ["headscale", "official"],
        cache: { autoUpdateEnabled: true, updateFrequency: "3h" },
      },
    ]);
  });

  test("records the source that answered", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });

    const run = await h.service.runNow();

    // The default chain is Headscale's own derp.urls first; this fake answers
    // from the first entry, and the run says which one that was.
    expect(run?.source).toBe(h.urls[0]);
    expect(run?.sourceKind).toBe("headscale");
    expect(run?.attempts).toEqual([{ url: h.urls[0] }]);
  });

  test("reports every source it tried when none of them answers", async () => {
    const h = build();
    await configure(h, {
      officialRegionIds: [HKG],
      sourceUrls: ["https://proxy.example.com/a.json", "https://proxy.example.com/b.json"],
    });
    await writeFile(h.target, "previous: map\n", "utf8");
    h.source.regions = undefined;

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.reason).toBe("fetch-unusable");
    expect(run?.source).toBeUndefined();
    expect(run?.attempts).toEqual([
      { url: "https://proxy.example.com/a.json", reason: "timeout" },
      { url: "https://proxy.example.com/b.json", reason: "timeout" },
    ]);
    // A blocked network keeps the previous file: nothing is written or snapshotted.
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
    expect(h.snapshot).not.toHaveBeenCalled();
    // The reasons are stored with the run, so the card can show them after a reload.
    expect((await readDerpMirrorDocument(dir)).last?.attempts).toEqual(run?.attempts);
  });

  test("uses a pasted map instead of any source, until it is cleared", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, SIN] });

    const stored = await h.service.update({
      pastedMap: { body: OFFICIAL_BODY, at: new Date(BASE).toISOString(), regions: 3 },
    });
    expect(stored.success).toBe(true);

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(run?.sourceKind).toBe("paste");
    expect(run?.source).toBeUndefined();
    expect(run?.pastedAt).toBe(new Date(BASE).toISOString());
    expect(run?.attempts).toEqual([{ url: PASTED_MAP_SOURCE }]);
    // No source was dialled at all while a paste is stored.
    expect(h.loads).toEqual([]);
    expect(run?.assignment).toEqual({ [HKG]: 901, [SIN]: 902 });
    expect(await readFile(h.target, "utf8")).toContain("regioncode: hkg");
    expect((await readDerpMirrorDocument(dir)).settings.pastedMap?.body).toBe(OFFICIAL_BODY);

    // Clearing it puts the mirror back on its sources: the next run fetches.
    const cleared = await h.service.update({ pastedMap: undefined });
    expect(cleared.success).toBe(true);
    expect(cleared.settings.pastedMap).toBeUndefined();

    const after = await h.service.runNow();

    expect(h.loads).toHaveLength(1);
    expect(after?.sourceKind).toBe("headscale");
    expect(after?.pastedAt).toBeUndefined();
  });

  test("a stored pasted body that is not a map keeps the previous file", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG] });
    await writeFile(h.target, "previous: map\n", "utf8");

    // A hand-edited store can hold anything; the run must refuse it rather than
    // fail, and it must never reach the write path.
    await h.service.update({
      pastedMap: { body: "just: a document\n", at: new Date(BASE).toISOString(), regions: 0 },
    });

    const run = await h.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.reason).toBe("fetch-unusable");
    expect(run?.sourceKind).toBe("paste");
    expect(run?.attempts).toEqual([{ url: PASTED_MAP_SOURCE, reason: "unreadable" }]);
    expect(await readFile(h.target, "utf8")).toBe("previous: map\n");
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.loads).toEqual([]);
  });

  test("a pasted map and a fetched map produce exactly the same file", async () => {
    const h = build();
    await configure(h, { officialRegionIds: [HKG, SIN, TOK] });

    // One service reads the body through the shared fetcher over a faked
    // transport; the other reads the same body from the paste store. Everything
    // after the read — generate, validate, snapshot, write — is the same path,
    // so the two files must be byte-identical.
    const fetchedTarget = join(dir, "fetched.yaml");
    const fetched = createDerpMirrorService({
      dataPath: join(dir, "fetched-data"),
      config: {
        getDERPSettings: () => ({
          urls: ["https://maps.example.com/same-body.json"],
          autoUpdateEnabled: true,
          updateFrequency: "3h",
        }),
      },
      headscale: {} as unknown as Headscale,
      loadOfficialRegions: (sources, cache) =>
        loadOfficialRegionsReport(sources, cache, {
          fetch: async () => ({ ok: true, status: 200, text: async () => OFFICIAL_BODY }),
        }),
      now: () => new Date(BASE),
    });

    try {
      await fetched.update({
        enabled: true,
        targetPath: fetchedTarget,
        officialRegionIds: [HKG, SIN, TOK],
        autoReload: false,
      });
      const fetchedRun = await fetched.runNow();
      expect(fetchedRun?.outcome).toBe("changed");

      const pastedTarget = join(dir, "pasted.yaml");
      await h.service.update({
        targetPath: pastedTarget,
        officialRegionIds: [HKG, SIN, TOK],
        pastedMap: { body: OFFICIAL_BODY, at: new Date(BASE).toISOString(), regions: 3 },
      });
      const pastedRun = await h.service.runNow();
      expect(pastedRun?.outcome).toBe("changed");

      expect(await readFile(pastedTarget, "utf8")).toBe(await readFile(fetchedTarget, "utf8"));
      expect(pastedRun?.assignment).toEqual(fetchedRun?.assignment);
      expect(pastedRun?.mirrored).toEqual(fetchedRun?.mirrored);
    } finally {
      fetched.dispose();
    }
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
      loadOfficialRegions: async () => ({ regions: OFFICIAL, attempts: [] }),
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
      loadOfficialRegions: async () => ({ regions: OFFICIAL, attempts: [] }),
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
      loadOfficialRegions: async () => ({ regions: OFFICIAL, attempts: [] }),
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

describe("DERP region mirror sources", () => {
  const CACHE = { autoUpdateEnabled: true, updateFrequency: "3h" };
  const OFFICIAL_URL = "https://controlplane.tailscale.com/derpmap/default";

  /** The same wire body the service-level comparison test uses. */
  const WIRE_BODY = OFFICIAL_BODY;

  // The order the body's own region keys come back in: a JSON object with
  // integer-like keys is written (and read back) in ascending numeric order.
  const READ: OfficialRegion[] = [
    {
      regionId: 3,
      code: "sin",
      name: "Singapore",
      nodes: [
        {
          name: "sin1",
          hostname: "sin1.example.com",
          derpPort: 443,
          stunOnly: false,
          ipv4: "1.2.3.5",
        },
      ],
    },
    {
      regionId: 9,
      code: "tok",
      name: "Tokyo",
      nodes: [
        {
          name: "tok1",
          hostname: "tok1.example.com",
          derpPort: 443,
          stunOnly: false,
          ipv4: "1.2.3.6",
        },
      ],
    },
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

  /** One URL's answer, as the fake transport reports it. */
  function answering(status: number, text = WIRE_BODY) {
    return async () => ({ ok: status === 200, status, text: async () => text });
  }

  beforeEach(() => {
    clearRemoteDerpMapCache();
  });

  test("an empty list keeps the built-in order: derp.urls first, then the official map", () => {
    const chain = resolveMirrorSourceChain({ sourceUrls: [] }, [
      "https://maps.example.com/one.json",
      "https://maps.example.com/two.json",
    ]);

    expect(chain).toEqual([
      { url: "https://maps.example.com/one.json", kind: "headscale" },
      { url: "https://maps.example.com/two.json", kind: "headscale" },
      { url: OFFICIAL_URL, kind: "official" },
    ]);
  });

  test("an empty list with no derp.urls still reaches the official map", () => {
    expect(resolveMirrorSourceChain({ sourceUrls: [] }, [])).toEqual([
      { url: OFFICIAL_URL, kind: "official" },
    ]);
    // Blank entries are dropped before the fallback is appended.
    expect(resolveMirrorSourceChain({ sourceUrls: [] }, ["", "  "])).toEqual([
      { url: OFFICIAL_URL, kind: "official" },
    ]);
  });

  test("a configured list replaces the built-in chain and keeps its order", () => {
    const chain = resolveMirrorSourceChain(
      {
        sourceUrls: [
          "https://proxy.example.com/official.json",
          "https://mirror.example.com/official.json",
          "https://proxy.example.com/official.json",
        ],
      },
      ["https://maps.example.com/one.json"],
    );

    // The duplicate collapses into its first position and Headscale's own URLs
    // are not dialled at all: the operator named exactly what to reach.
    expect(chain).toEqual([
      { url: "https://proxy.example.com/official.json", kind: "custom" },
      { url: "https://mirror.example.com/official.json", kind: "custom" },
    ]);
    expect(chain.some((source) => source.kind === "headscale")).toBe(false);
  });

  test("uses the first source that yields a usable map and reports which one", async () => {
    const dead = "https://dead.example.com/map.json";
    const good = "https://good.example.com/map.json";
    const seen: string[] = [];

    const report = await loadOfficialRegionsReport(
      [
        { url: dead, kind: "custom" },
        { url: good, kind: "custom" },
        { url: OFFICIAL_URL, kind: "official" },
      ],
      CACHE,
      {
        fetch: async (url) => {
          seen.push(url);
          return answering(url === dead ? 500 : 200)();
        },
      },
    );

    // The winner is dialled first and the third source is never reached.
    expect(seen).toEqual([dead, good]);
    expect(report.regions).toEqual(READ);
    expect(report.source).toBe(good);
    expect(report.sourceKind).toBe("custom");
    expect(report.attempts).toEqual([{ url: dead, reason: "status" }, { url: good }]);
  });

  test("names every source and why it failed when none of them answers", async () => {
    const dead = "https://dead.example.com/map.json";
    const slow = "https://slow.example.com/map.json";

    const report = await loadOfficialRegionsReport(
      [
        { url: dead, kind: "custom" },
        { url: slow, kind: "custom" },
      ],
      CACHE,
      {
        fetch: async (url) =>
          url === dead ? answering(500)() : answering(200, "just: a document\n")(),
      },
    );

    expect(report.regions).toBeUndefined();
    expect(report.source).toBeUndefined();
    expect(report.attempts).toEqual([
      { url: dead, reason: "status" },
      { url: slow, reason: "unreadable" },
    ]);
  });

  test("reads a pasted body exactly like a downloaded one", () => {
    const read = parseDerpMapBody(WIRE_BODY);

    expect(read.reason).toBeUndefined();
    expect(read.regions).toEqual(READ);
  });

  test("refuses a body that is not a map and one over the size cap", () => {
    expect(parseDerpMapBody("just: a document\n")).toEqual({ reason: "unreadable" });
    expect(parseDerpMapBody("{ not json")).toEqual({ reason: "unreadable" });
    expect(parseDerpMapBody("x".repeat(DERP_MIRROR_PASTE_MAX_BYTES + 1))).toEqual({
      reason: "too-large",
    });
  });

  test("the failure codes the store keeps are the reader's own", () => {
    // Compile-time parity: a code the reader can return must be storable, and
    // the other way round, or a stored reason would be dropped on the next read.
    const parity: Record<RemoteDerpMapFailure, DerpMirrorSourceFailure> = {
      timeout: "timeout",
      network: "network",
      status: "status",
      "too-large": "too-large",
      unreadable: "unreadable",
    };

    expect(Object.keys(parity).toSorted()).toEqual([
      "network",
      "status",
      "timeout",
      "too-large",
      "unreadable",
    ]);
  });
});

describe("DERP region mirror latency probe", () => {
  const MEASURED_AT = new Date("2026-02-03T04:05:06.000Z");
  /** The number of node-and-family attempts the five official regions plan. */
  const ATTEMPTS = 12;

  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-probe-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A monotonic clock the fakes advance, so every measured value is exact. */
  function makeClock() {
    const state = { value: 0 };
    return {
      now: () => state.value,
      advance: (ms: number) => {
        state.value += ms;
      },
    };
  }

  /** The binding success a fake socket answers with, for the request it got. */
  function bindingSuccess(request: Uint8Array): Uint8Array {
    const message = new Uint8Array(20);
    const view = new DataView(message.buffer);
    view.setUint16(0, 0x0101, false);
    view.setUint16(2, 0, false);
    view.setUint32(4, 0x2112a442, false);
    message.set(request.slice(8, 20), 8);
    return message;
  }

  /** A socket that answers every binding request after a scripted latency. */
  function answeringSocket(clock: ReturnType<typeof makeClock>, latencyMs: number): ProbeUdpSocket {
    let onMessage: ((message: Uint8Array) => void) | undefined;

    return {
      send(request, _port, _address, callback) {
        callback?.();
        const answer = bindingSuccess(request);
        queueMicrotask(() => {
          clock.advance(latencyMs);
          onMessage?.(answer);
        });
      },
      onMessage(listener) {
        onMessage = listener;
      },
      onError() {
        // Never fails here.
      },
      close() {
        // Nothing to release in a fake.
      },
    };
  }

  /** A socket on a filtered port: it never answers and never errors. */
  function silentSocket(): ProbeUdpSocket {
    return {
      send() {
        // Dropped, as a filtered port drops it.
      },
      onMessage() {
        // No answer will ever arrive.
      },
      onError() {
        // No error will ever arrive.
      },
      close() {
        // Nothing to release.
      },
    };
  }

  /** A socket that only answers when the test releases it. */
  function heldSocket() {
    const state = { sent: 0, request: undefined as Uint8Array | undefined };
    let onMessage: ((message: Uint8Array) => void) | undefined;

    const socket: ProbeUdpSocket = {
      send(request, _port, _address, callback) {
        callback?.();
        state.sent += 1;
        state.request = request;
      },
      onMessage(listener) {
        onMessage = listener;
      },
      onError() {
        // Never fails here.
      },
      close() {
        // Nothing to release.
      },
    };

    return {
      socket,
      sent: () => state.sent,
      release: () => {
        if (state.request !== undefined) {
          onMessage?.(bindingSuccess(state.request));
        }
      },
    };
  }

  /** A service whose probe seams are fakes: nothing here touches a network. */
  function service(
    options: {
      probe?: Record<string, unknown>;
      loadOfficialRegions?: () => Promise<OfficialMapReport>;
      loadLatencies?: () => Promise<Record<string, number>>;
    } = {},
  ): DerpMirrorService {
    return createDerpMirrorService({
      dataPath: dir,
      config: {
        getDERPSettings: () => ({ urls: [], autoUpdateEnabled: true, updateFrequency: "3h" }),
      },
      headscale: {} as unknown as Headscale,
      loadOfficialRegions:
        options.loadOfficialRegions === undefined
          ? async () => ({ regions: OFFICIAL, attempts: [] })
          : options.loadOfficialRegions,
      ...(options.loadLatencies === undefined ? {} : { loadLatencies: options.loadLatencies }),
      now: () => MEASURED_AT,
      probe: {
        wallClock: () => MEASURED_AT,
        udp: () => silentSocket(),
        tcp: async () => {
          throw new Error("ECONNREFUSED");
        },
        concurrency: 1,
        timeoutMs: 1000,
        ...options.probe,
      },
    });
  }

  /** Waits for the background run to finish, without waiting inside a request. */
  async function settle(instance: DerpMirrorService): Promise<void> {
    await vi.waitFor(() => {
      expect(instance.latencyProbeStatus().running).toBe(false);
    });
  }

  test("starts the run in the background and answers at once", async () => {
    const clock = makeClock();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const instance = service({
      loadOfficialRegions: async () => {
        // The map read is what a request would otherwise wait for.
        await gate;
        return { regions: OFFICIAL, attempts: [] };
      },
      probe: { udp: () => answeringSocket(clock, 5), now: clock.now },
    });

    try {
      const started = instance.startLatencyProbe();

      // Nothing has been probed yet — the map is still being fetched — and the
      // call already answered.
      expect(started.started).toBe(true);
      expect(started.status.running).toBe(true);
      expect(started.status.startedAt).toBe(MEASURED_AT.toISOString());
      expect(started.status.total).toBe(0);
      expect(started.status.completed).toBe(0);
      expect(started.status.regions).toEqual({});

      release?.();
      await settle(instance);

      const finished = instance.latencyProbeStatus();
      expect(finished.running).toBe(false);
      expect(finished.finishedAt).toBe(MEASURED_AT.toISOString());
      expect(finished.outcome).toBe("complete");
      expect(finished.regions).toEqual({ "20": 5, "3": 5, "9": 5, "7": 5, "25": 5 });
    } finally {
      instance.dispose();
    }
  });

  test("refuses a second start while a run is in flight", async () => {
    const held = heldSocket();
    const instance = service({
      probe: { udp: () => held.socket, timeoutMs: 60_000 },
    });

    try {
      const first = instance.startLatencyProbe();
      expect(first.started).toBe(true);

      // The first attempt is in flight and nothing has answered yet.
      await vi.waitFor(() => {
        expect(held.sent()).toBeGreaterThan(0);
      });

      const second = instance.startLatencyProbe();
      expect(second.started).toBe(false);
      expect(second.status.running).toBe(true);
      expect(second.status.startedAt).toBe(first.status.startedAt);
      // Only one run is probing: a second one would have opened a second socket.
      expect(held.sent()).toBe(1);

      held.release();
      expect(instance.cancelLatencyProbe()).toBe(true);
      await settle(instance);
      expect(instance.latencyProbeStatus().outcome).toBe("cancelled");
    } finally {
      instance.dispose();
    }
  });

  test("reports progress and the regions measured so far while the run is going", async () => {
    const clock = makeClock();
    const held = heldSocket();
    let sockets = 0;
    const instance = service({
      probe: {
        udp: () => {
          sockets += 1;
          return sockets === 1 ? answeringSocket(clock, 7) : held.socket;
        },
        now: clock.now,
      },
    });

    try {
      instance.startLatencyProbe();

      // The first region answered, the second attempt is still waiting.
      await vi.waitFor(() => {
        expect(instance.latencyProbeStatus().measured).toBe(1);
      });

      const status = instance.latencyProbeStatus();
      expect(status.running).toBe(true);
      expect(status.total).toBe(ATTEMPTS);
      expect(status.completed).toBe(1);
      expect(status.regions).toEqual({ "20": 7 });
      expect(status.outcome).toBeUndefined();
      expect(status.error).toBeUndefined();

      // The stop control ends the run and keeps what it measured.
      expect(instance.cancelLatencyProbe()).toBe(true);
      await settle(instance);

      const stopped = instance.latencyProbeStatus();
      expect(stopped.running).toBe(false);
      expect(stopped.outcome).toBe("cancelled");
      expect(stopped.regions).toEqual({ "20": 7 });
      // Nothing is left to stop, and that is not an error.
      expect(instance.cancelLatencyProbe()).toBe(false);
    } finally {
      instance.dispose();
    }
  });

  test("abandons the rest of the run when its budget runs out and stores the partials", async () => {
    const clock = makeClock();
    let sockets = 0;
    const instance = service({
      probe: {
        udp: () => {
          sockets += 1;
          return sockets <= 2 ? answeringSocket(clock, 9) : silentSocket();
        },
        now: clock.now,
        timeoutMs: 60_000,
        overallTimeoutMs: 25,
      },
    });

    try {
      instance.startLatencyProbe();
      await settle(instance);

      const status = instance.latencyProbeStatus();
      expect(status.running).toBe(false);
      expect(status.outcome).toBe("partial");
      expect(status.regions).toEqual({ "20": 9 });

      // The run's own record, in the shape the numbering reads: per-family
      // bests, the per-node values behind them, the run's timestamp and source.
      const document = await readDerpMirrorDocument(dir);
      const stored = document.settings.latency;
      expect(stored?.measuredAt).toBe(MEASURED_AT.toISOString());
      expect(stored?.outcome).toBe("partial");
      expect(stored?.regions.map((entry) => entry.regionId)).toEqual([20]);
      expect(stored?.regions[0]?.regionCode).toBe("hkg");
      expect(stored?.regions[0]?.bestV4).toBe(9);
      expect(stored?.regions[0]?.bestV6).toBe(9);
      expect(stored?.regions[0]?.source).toBe("measured");
      expect(stored?.regions[0]?.measuredAt).toBe(MEASURED_AT.toISOString());
      expect(stored?.regions[0]?.nodes.map((entry) => [entry.family, entry.latencyMs])).toEqual([
        ["ipv4", 9],
        ["ipv6", 9],
      ]);
    } finally {
      instance.dispose();
    }
  });

  test("keeps the measurements an earlier run stored when a later run measures less", async () => {
    // A previous run reached New York; this one only gets as far as Hong Kong.
    // The earlier reading is recent enough to still be worth keeping.
    await writeDerpMirrorDocument(dir, {
      settings: {
        ...DEFAULT_DERP_MIRROR_SETTINGS,
        latency: {
          measuredAt: "2026-02-02T00:00:00.000Z",
          outcome: "partial",
          regions: [
            {
              regionId: 25,
              regionCode: "nyc",
              bestV4: 120,
              nodes: [
                {
                  name: "nyc1",
                  hostname: "nyc1.example.com",
                  family: "ipv4",
                  target: "1.2.3.1",
                  latencyMs: 120,
                  method: "stun",
                },
              ],
              measuredAt: "2026-02-02T00:00:00.000Z",
              source: "measured",
            },
          ],
        },
      },
    });

    const clock = makeClock();
    let sockets = 0;
    const instance = service({
      probe: {
        udp: () => {
          sockets += 1;
          return sockets <= 2 ? answeringSocket(clock, 4) : silentSocket();
        },
        now: clock.now,
        timeoutMs: 60_000,
        overallTimeoutMs: 25,
      },
    });

    try {
      instance.startLatencyProbe();
      await settle(instance);

      // The status describes this run alone: it measured Hong Kong and nothing
      // else. The stored record is where the earlier measurement survives.
      expect(instance.latencyProbeStatus().regions).toEqual({ "20": 4 });

      const document = await readDerpMirrorDocument(dir);
      const stored = document.settings.latency;
      expect(stored?.measuredAt).toBe(MEASURED_AT.toISOString());
      expect(stored?.outcome).toBe("partial");
      expect(stored?.regions.map((entry) => [entry.regionId, entry.measuredAt])).toEqual([
        [20, MEASURED_AT.toISOString()],
        [25, "2026-02-02T00:00:00.000Z"],
      ]);
      expect(stored?.regions.find((entry) => entry.regionId === 25)?.bestV4).toBe(120);
    } finally {
      instance.dispose();
    }
  });

  test("records an all-timeout run as empty instead of leaving nothing behind", async () => {
    const instance = service({
      probe: { udp: () => silentSocket(), timeoutMs: 5 },
    });

    try {
      instance.startLatencyProbe();
      await settle(instance);

      const status = instance.latencyProbeStatus();
      expect(status.outcome).toBe("empty");
      expect(status.error).toBeUndefined();
      expect(status.regions).toEqual({});

      // The honest record the card turns into "UDP 3478 may be blocked".
      const document = await readDerpMirrorDocument(dir);
      expect(document.settings.latency?.outcome).toBe("empty");
      expect(document.settings.latency?.regions).toEqual([]);
    } finally {
      instance.dispose();
    }
  });

  test("records why it could not probe at all when no official map is readable", async () => {
    const instance = service({ loadOfficialRegions: async () => ({ attempts: [] }) });
    try {
      const started = instance.startLatencyProbe();
      expect(started.started).toBe(true);

      await settle(instance);
      const status = instance.latencyProbeStatus();
      expect(status.error).toBe("derpMirrorUnavailable");
      expect(status.running).toBe(false);
      expect(status.outcome).toBeUndefined();

      // A run that could not probe writes nothing: earlier measurements stand.
      const document = await readDerpMirrorDocument(dir);
      expect(document.settings.latency).toBeUndefined();
    } finally {
      instance.dispose();
    }
  });

  test("ranks a region by the value this server measured itself", async () => {
    const clock = makeClock();
    // Five regions, in the order the map lists them: Hong Kong (two nodes, four
    // attempts), Singapore, Tokyo, Frankfurt, New York. Tokyo answers slowly and
    // Frankfurt quickly, so a fresh ranking puts Frankfurt first of the two.
    const scripted = [5, 5, 5, 5, 5, 5, 500, 500, 1, 1, 5, 5];
    let index = 0;
    const instance = service({
      probe: {
        udp: () => answeringSocket(clock, scripted[index++] ?? 5),
        now: clock.now,
      },
    });

    try {
      await instance.update({
        targetPath: join(dir, "official-mirror.yaml"),
        officialRegionIds: [HKG, SIN, TOK, FRA],
        autoReload: false,
      });

      instance.startLatencyProbe();
      await settle(instance);
      expect(instance.latencyProbeStatus().outcome).toBe("complete");

      // Reassigning is the run that re-ranks by today's measurements, and the
      // values it ranks on are the ones this server just measured.
      const run = await instance.reassign();

      expect(run?.assignment).toEqual({ [HKG]: 901, [SIN]: 902, [FRA]: 903, [TOK]: 904 });
    } finally {
      instance.dispose();
    }
  });
});
