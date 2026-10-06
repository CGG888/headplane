/**
 * Resolves which region names the configured DERP maps describe, for the DERP
 * cards. Loader-only: the browser receives the resulting plain mapping, never a
 * module that reaches the filesystem or the network.
 *
 * Two sources are read, and they stay apart because they have different
 * precedence:
 *
 * - the local map files listed in `derp.paths`, parsed with the same reader the
 *   DERP map editor uses (see `~/routes/settings/headscale/derp-map-schema`),
 *   cached by path, size and modification time so a page render does not reparse
 *   an unchanged file;
 * - the remote maps listed in `derp.urls`, fetched and cached by
 *   `./derp-map-remote`.
 *
 * Every read is fail-soft and the two run together, so one unreadable file or
 * one dead URL only means fewer known names. The operator's manual mapping is
 * Headplane state and is read by the caller.
 *
 * {@link loadDerpRegionInventory} is the same read with the detail the Overview
 * card shows: which map contributed each region and the nodes that map lists.
 * {@link loadDerpNodeInventory} is that read held apart by source instead of
 * merged, so the node card can count each source — the embedded relay, the
 * `derp.paths` files, the region mirror's file and the official map — on its own.
 */

import { readFile, stat } from "node:fs/promises";

import type {
  DerpRegionInfo,
  DerpRegionMap,
  DerpRegionNameData,
} from "~/routes/machines/derp-info";
import { MAX_DERP_MAP_BYTES } from "~/routes/settings/headscale/derp-map-limits";
import {
  readDerpMapRegions,
  type DerpMapRegionEntry,
} from "~/routes/settings/headscale/derp-map-schema";
import { resolveTargetPath, samePath } from "~/server/snapshots/paths";
import log from "~/utils/log";

import {
  readDerpMapNodes,
  type DerpMapNodeEntry,
  type DerpMapRegionDetail,
} from "./derp-map-nodes";
import {
  loadRemoteDerpMapDetail,
  type DerpMapFetch,
  type RemoteDerpMapOptions,
} from "./derp-map-remote";

/** The filesystem calls the local reader makes. */
export interface DerpRegionFs {
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  readFile: (path: string) => Promise<string>;
}

export interface DerpRegionSourceInput {
  /** `derp.paths`, as Headscale's configuration lists it. */
  paths: readonly string[];
  /** `derp.urls`, as Headscale's configuration lists it. */
  urls: readonly string[];
  /** `derp.auto_update_enabled`. */
  autoUpdateEnabled: boolean;
  /** `derp.update_frequency`. */
  updateFrequency: string;
  /** Directory relative `derp.paths` entries resolve against. */
  baseDir?: string;
}

export interface DerpRegionSourceOptions {
  /** Injected for tests; defaults to `node:fs/promises`. */
  fs?: DerpRegionFs;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: DerpMapFetch;
  timeoutMs?: number;
  now?: () => number;
}

/** How one configured `derp.paths` entry reads to this process. */
export type DerpMapFileState = "ok" | "unreadable" | "invalid" | "empty";

/** What one configured `derp.paths` entry turned out to be. */
export interface DerpMapFileReading {
  /** The path as it resolved for this process. */
  path: string;
  /**
   * `ok` for a map with at least one region, `empty` for a map that describes
   * none, `invalid` for a document that is not a DERP map, and `unreadable` for
   * a path this process cannot read at all — which is also what a missing bind
   * mount looks like.
   */
  state: DerpMapFileState;
}

/** One region as the configured maps describe it. */
export interface DerpMapRegionReading {
  regionId: number;
  code?: string;
  name?: string;
  /** The first configured map that describes this region. */
  origin: { kind: "local" | "remote"; source: string };
  nodes: DerpMapNodeEntry[];
}

/** Everything the Overview card needs to show what the configured maps say. */
export interface DerpRegionInventory extends DerpRegionNameData {
  /** Every region the configured maps describe, ordered by region id. */
  regions: DerpMapRegionReading[];
  /** Every configured `derp.paths` entry, in configuration order. */
  files: DerpMapFileReading[];
  /** True when at least one configured `derp.urls` map could not be read. */
  remoteUnavailable: boolean;
}

/**
 * One configured map on its own: the regions *this* map describes and the nodes
 * they list, with nothing merged away. The Overview node card groups these by
 * source (a local file, the region mirror's file, or a URL), which the merged
 * {@link DerpRegionInventory} cannot express because it keeps only the first map
 * that described a region.
 */
export interface DerpMapGroupReading {
  /** The resolved path, or the URL, this reading came from. */
  source: string;
  /**
   * `local` for a file listed in `derp.paths`, `mirror` for the file the region
   * mirror maintains, `remote` for a URL listed in `derp.urls`.
   */
  kind: "local" | "mirror" | "remote";
  /** `ok` only when this map described at least one region. */
  state: DerpMapFileState;
  /** The regions this map alone describes, in the order it listed them. */
  regions: DerpMapRegionDetail[];
  /**
   * True for the region mirror's own file when `derp.paths` does not list it:
   * the file is read and its nodes are real, but clients are not handed it yet.
   * Absent for every group whose maps the configuration actually loads.
   */
  unlisted?: boolean;
}

/** The configured maps held apart by source, for the Overview node card. */
export interface DerpNodeInventory extends DerpRegionNameData {
  /** Every configured map in configuration order: `derp.paths`, then `derp.urls`. */
  groups: DerpMapGroupReading[];
}

/** {@link loadDerpNodeInventory} input: the maps, plus the mirror's own file. */
export interface DerpNodeInventoryInput extends DerpRegionSourceInput {
  /**
   * The region mirror's target file, as Headplane's own settings hold it. A path
   * that is also listed in `derp.paths` is tagged as the mirror's source instead
   * of reading as a plain local map; a path that is *not* listed is read anyway
   * and tagged `unlisted`, so a filtered map an operator has not wired up yet
   * still shows the nodes it holds.
   */
  mirrorPath?: string;
  /**
   * Whether the region filter itself is switched on. Only an on filter has a
   * file worth reading when `derp.paths` does not list one: the settings always
   * name a default target path, and an off filter must not turn a path nobody
   * wrote into a source the card reports as unreadable. Absent means off.
   */
  mirrorEnabled?: boolean;
}

const nodeFs: DerpRegionFs = {
  stat: async (path) => {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },
  readFile: (path) => readFile(path, "utf8"),
};

/** One file as it was read: its state, its regions and their nodes. */
interface LocalReading {
  state: DerpMapFileState;
  regions: DerpMapRegionEntry[];
  nodes: Map<number, DerpMapNodeEntry[]>;
}

const NO_REGIONS: Map<number, DerpMapNodeEntry[]> = new Map();

/** Parsed files, keyed by resolved path and invalidated by size and mtime. */
const localCache = new Map<string, LocalReading & { key: string }>();

/** Forgets every parsed local map, so the next read goes back to the disk. */
export function clearLocalDerpRegionCache(): void {
  localCache.clear();
}

/** One map's regions as a lookup keyed by decimal region id; first entry wins. */
function toRegionMap(entries: readonly DerpMapRegionEntry[]): DerpRegionMap {
  const map: DerpRegionMap = {};
  for (const entry of entries) {
    const id = String(entry.regionId);
    if (map[id] !== undefined) {
      continue;
    }

    map[id] = {
      regionId: entry.regionId,
      code: entry.code.length > 0 ? entry.code : undefined,
      name: entry.name.length > 0 ? entry.name : undefined,
    };
  }

  return map;
}

/**
 * One local file's regions and their nodes. The state says why a file
 * contributed nothing, so the card can tell "this container cannot see it"
 * apart from "this is not a map" and from "this map names no region".
 */
async function readLocalDerpMap(path: string, fs: DerpRegionFs): Promise<LocalReading> {
  let cacheKey: string | undefined;
  try {
    const info = await fs.stat(path);
    cacheKey = `${info.mtimeMs}:${info.size}`;
    const cached = localCache.get(path);
    if (cached !== undefined && cached.key === cacheKey) {
      return { state: cached.state, regions: cached.regions, nodes: cached.nodes };
    }
  } catch {
    // A file that cannot be stat'd is simply read; nothing is cached for it.
  }

  let body: string;
  try {
    body = await fs.readFile(path);
  } catch (error) {
    log.debug("config", `Unable to read the DERP map at ${path}: ${String(error)}`);
    return { state: "unreadable", regions: [], nodes: NO_REGIONS };
  }

  let reading: LocalReading;
  if (Buffer.byteLength(body, "utf8") > MAX_DERP_MAP_BYTES) {
    log.debug("config", `The DERP map at ${path} is larger than the supported size`);
    reading = { state: "invalid", regions: [], nodes: NO_REGIONS };
  } else {
    const nodes = readDerpMapNodes(body);
    const regions = readDerpMapRegions(body);
    if (!nodes.ok) {
      log.debug("config", `The DERP map at ${path} is not a DERP map`);
      reading = { state: "invalid", regions: [], nodes: NO_REGIONS };
    } else if (regions.length === 0) {
      log.debug("config", `The DERP map at ${path} describes no regions`);
      reading = { state: "empty", regions: [], nodes: nodes.nodes };
    } else {
      reading = { state: "ok", regions, nodes: nodes.nodes };
    }
  }

  if (cacheKey !== undefined) {
    localCache.set(path, { key: cacheKey, ...reading });
  }

  return reading;
}

/**
 * Reads every configured DERP map for its region names: local files first, then
 * remote URLs, each in the order the configuration lists them. An entry that is
 * already known from an earlier source is kept, so the earliest configuration
 * entry decides a conflict.
 *
 * Nothing here throws: a path this process cannot see, a URL that does not
 * answer and a document that is not a map all simply contribute no names.
 */
export async function loadDerpRegionSources(
  input: DerpRegionSourceInput,
  options: DerpRegionSourceOptions = {},
): Promise<DerpRegionNameData> {
  const inventory = await loadDerpRegionInventory(input, options);
  return { local: inventory.local, remote: inventory.remote };
}

/**
 * Everything the Overview card needs about the configured maps: the region
 * names the shared chain resolves, plus one entry per region carrying the map
 * that contributes it and the nodes that map lists.
 *
 * This is the same read {@link loadDerpRegionSources} makes — one read per
 * local file, one fetch per URL through the remote cache — so the card costs a
 * page render nothing beyond the document passes it already paid for. Regions
 * keep the first source that described them, exactly like the names do, which
 * is what makes the source chip agree with the label.
 */
export async function loadDerpRegionInventory(
  input: DerpRegionSourceInput,
  options: DerpRegionSourceOptions = {},
): Promise<DerpRegionInventory> {
  const read = await readDerpMaps(input, options);

  return {
    local: read.local.size > 0 ? Object.fromEntries(read.local) : undefined,
    remote: read.remote.size > 0 ? Object.fromEntries(read.remote) : undefined,
    regions: [...read.regions.values()].toSorted((a, b) => a.regionId - b.regionId),
    files: read.localPaths.map((path, index) => ({
      path,
      state: read.localReads[index]?.state ?? "unreadable",
    })),
    remoteUnavailable: read.remoteUnavailable,
  };
}

/**
 * The configured maps held apart by source, for the Overview node card: one
 * group per `derp.paths` entry, the file the region mirror maintains tagged as
 * its own kind, then one group per `derp.urls` map.
 *
 * The mirror's target file is read even when `derp.paths` does not list it, so
 * the card can show the nodes the filter produced before the operator wires the
 * file up; that group carries `unlisted: true` and its regions stay out of the
 * merged local names, because Headscale does not load the file yet. This only
 * happens while the filter itself is on (`mirrorEnabled`), because the settings
 * always name a default target path and a filter nobody turned on must not turn
 * that path into a source. The read goes through the same cached local reader as
 * every other file, so it costs one stat and at most one parse per change.
 *
 * This is otherwise the *same* read {@link loadDerpRegionInventory} makes — one
 * read per local file (cached by path, size and mtime) and one fetch per URL
 * through the shared remote cache — so a page that needs both pays for the
 * documents once. Nothing here throws: a file this process cannot see, a URL
 * that does not answer and a document that is not a map all become a group with
 * a state that says so.
 */
export async function loadDerpNodeInventory(
  input: DerpNodeInventoryInput,
  options: DerpRegionSourceOptions = {},
): Promise<DerpNodeInventory> {
  const read = await readDerpMaps(input, options);
  const mirrorPath = (input.mirrorPath ?? "").trim();
  const mirror = mirrorPath.length > 0 ? resolveTargetPath(mirrorPath, input.baseDir) : undefined;

  const groups: DerpMapGroupReading[] = [];
  read.localPaths.forEach((path, index) => {
    const reading = read.localReads[index];
    groups.push({
      source: path,
      kind: mirror !== undefined && samePath(path, mirror) ? "mirror" : "local",
      state: reading?.state ?? "unreadable",
      regions: detailRegions(reading),
    });
  });

  // The filter's file is read whether or not `derp.paths` lists it, as long as
  // the filter is on. It is put after the listed local files and before the
  // remote maps, which is the order the card claims regions in: a region the
  // filter's file describes is never credited to the upstream map that repeats
  // it.
  if (
    mirror !== undefined &&
    input.mirrorEnabled === true &&
    !read.localPaths.some((path) => samePath(path, mirror))
  ) {
    const reading = await readLocalDerpMap(mirror, options.fs ?? nodeFs);
    groups.push({
      source: mirror,
      kind: "mirror",
      unlisted: true,
      state: reading.state,
      regions: detailRegions(reading),
    });
  }

  read.remoteUrls.forEach((url, index) => {
    const entries = read.remoteReads[index];
    groups.push({
      source: url,
      kind: "remote",
      state: entries === undefined ? "unreadable" : entries.length > 0 ? "ok" : "empty",
      regions: entries ?? [],
    });
  });

  return {
    local: read.local.size > 0 ? Object.fromEntries(read.local) : undefined,
    remote: read.remote.size > 0 ? Object.fromEntries(read.remote) : undefined,
    groups,
  };
}

/** One map's regions with the nodes it lists under each, as one list. */
function detailRegions(reading: LocalReading | undefined): DerpMapRegionDetail[] {
  if (reading === undefined) {
    return [];
  }

  return reading.regions.map((entry) => ({
    ...entry,
    nodes: reading.nodes.get(entry.regionId) ?? [],
  }));
}

/** What one read of every configured map produced, before it is projected. */
interface DerpMapReading {
  localPaths: string[];
  remoteUrls: string[];
  localReads: LocalReading[];
  remoteReads: (DerpMapRegionDetail[] | undefined)[];
  local: Map<string, DerpRegionInfo>;
  remote: Map<string, DerpRegionInfo>;
  regions: Map<string, DerpMapRegionReading>;
  remoteUnavailable: boolean;
}

/** One read of every configured map: the work both loaders above share. */
async function readDerpMaps(
  input: DerpRegionSourceInput,
  options: DerpRegionSourceOptions,
): Promise<DerpMapReading> {
  const fs = options.fs ?? nodeFs;
  const remoteOptions: RemoteDerpMapOptions = {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    now: options.now,
  };
  const settings = {
    autoUpdateEnabled: input.autoUpdateEnabled,
    updateFrequency: input.updateFrequency,
  };

  const localPaths = input.paths
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => resolveTargetPath(path, input.baseDir));
  const remoteUrls = [
    ...new Set(input.urls.map((url) => url.trim()).filter((url) => url.length > 0)),
  ];

  const local = new Map<string, DerpRegionInfo>();
  const remote = new Map<string, DerpRegionInfo>();
  const regions = new Map<string, DerpMapRegionReading>();

  const [localReads, remoteReads] = await Promise.all([
    Promise.all(localPaths.map((path) => readLocalDerpMap(path, fs))),
    Promise.all(remoteUrls.map((url) => loadRemoteDerpMapDetail(url, settings, remoteOptions))),
  ]);

  localReads.forEach((reading, index) => {
    mergeRegionEntries(local, reading.regions);
    if (reading.state !== "ok") {
      return;
    }

    const source = localPaths[index] ?? "";
    for (const entry of reading.regions) {
      addRegionReading(regions, entry, reading.nodes.get(entry.regionId) ?? [], {
        kind: "local",
        source,
      });
    }
  });

  remoteReads.forEach((entries, index) => {
    mergeRegionEntries(remote, entries);
    if (entries === undefined) {
      return;
    }

    const source = remoteUrls[index] ?? "";
    for (const entry of entries) {
      addRegionReading(regions, entry, entry.nodes, { kind: "remote", source });
    }
  });

  return {
    localPaths,
    remoteUrls,
    localReads,
    remoteReads,
    local,
    remote,
    regions,
    remoteUnavailable:
      remoteUrls.length > 0 && remoteReads.some((entries) => entries === undefined),
  };
}

/** Records one region's first source; a later map never displaces it. */
function addRegionReading(
  target: Map<string, DerpMapRegionReading>,
  entry: DerpMapRegionEntry,
  nodes: DerpMapNodeEntry[],
  origin: DerpMapRegionReading["origin"],
): void {
  const id = String(entry.regionId);
  if (target.has(id)) {
    return;
  }

  target.set(id, {
    regionId: entry.regionId,
    ...(entry.code.length > 0 ? { code: entry.code } : {}),
    ...(entry.name.length > 0 ? { name: entry.name } : {}),
    origin,
    nodes,
  });
}

/** Adds one map's regions to a running lookup; the first source keeps a region. */
function mergeRegionEntries(
  target: Map<string, DerpRegionInfo>,
  entries: readonly DerpMapRegionEntry[] | undefined,
): void {
  if (entries === undefined) {
    return;
  }

  for (const [id, info] of Object.entries(toRegionMap(entries))) {
    if (!target.has(id)) {
      target.set(id, info);
    }
  }
}
