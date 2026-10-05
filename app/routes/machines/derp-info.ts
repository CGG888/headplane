/**
 * Relay information for a single machine, built from the Headplane Agent's host
 * info plus Headscale's embedded DERP configuration. Pure helpers so the
 * machine page, the Overview card and their tests share one implementation.
 *
 * Headscale hands its merged DERP map to Tailscale clients over the control
 * protocol, and its only `/derp` route (Headscale 0.29.2, `hscontrol/app.go`)
 * is mounted when the embedded server is enabled and speaks the DERP protocol
 * instead of returning the map, so a region name has to come from somewhere
 * else. The loader resolves it from the operator's manual mapping, the map
 * files listed in `derp.paths` and the maps fetched from `derp.urls`; this
 * module only holds the pure part — the precedence chain — so the browser
 * receives plain values and never imports a server module.
 */

import type { HostInfo } from "~/types";

/** Measured regions the machine page lists before summarising the rest. */
export const DERP_LATENCY_ROW_LIMIT = 8;

/** The parts of Headscale's `derp.server` a machine page needs. */
export interface DerpEmbeddedServer {
  enabled: boolean;
  regionId: number;
  regionCode: string;
  regionName: string;
}

/**
 * Region id (decimal string) to an operator-supplied name, as stored in
 * Headplane's data directory. The most deliberate source, so it wins over
 * everything else.
 */
export type DerpRegionNames = Record<string, string>;

/** Regions a DERP map describes, keyed by their decimal region id. */
export type DerpRegionMap = Record<string, DerpRegionInfo>;

/**
 * Every source a region name can come from, in precedence order: the manual
 * mapping, the local map files, the remote maps, then Headscale's own embedded
 * region. A region none of them describes stays `#id`.
 */
export interface DerpRegionLabelSources {
  manual?: DerpRegionNames;
  /** Regions from the files listed in `derp.paths`. */
  local?: DerpRegionMap;
  /** Regions from the maps fetched from `derp.urls`. */
  remote?: DerpRegionMap;
  /** Headscale's `derp.server` region, when the embedded server is enabled. */
  embedded?: DerpRegionInfo;
}

/** The sources a loader resolves; the embedded region travels with `server`. */
export type DerpRegionNameData = Omit<DerpRegionLabelSources, "embedded">;

export interface DerpRegionInfo {
  regionId: number;
  code?: string;
  name?: string;
}

export interface DerpRegionLabel {
  /** `#901`, `#999 · headscale · Headscale Embedded DERP`, or `#901 · Amsterdam`. */
  label: string;
  /** True when this region is Headscale's embedded DERP server. */
  isEmbedded: boolean;
}

export interface DerpLatencyEntry {
  /** Region id parsed from the agent's latency map key, when it is numeric. */
  regionId: number | undefined;
  /** Region key exactly as the agent reported it. */
  region: string;
  /** Measured round trip in seconds, as Tailscale reports it. */
  seconds: number;
}

export interface DerpLatencyRows {
  rows: DerpLatencyEntry[];
  /** Measured regions that did not fit into `rows`. */
  hidden: number;
}

export interface DerpInfoView {
  /** False when the agent has not reported any relay data for this machine. */
  hasRelayData: boolean;
  home: DerpRegionLabel;
  preferred: DerpRegionLabel;
  latencies: DerpLatencyRows;
  /** True when no source names at least one shown region, so it stays an id. */
  hasIdOnlyRegions: boolean;
}

/** The embedded server as a label source, or undefined when it is disabled. */
export function embeddedDerpRegion(
  server: DerpEmbeddedServer | undefined,
): DerpRegionInfo | undefined {
  return server?.enabled ? configuredDerpRegion(server) : undefined;
}

/**
 * The region `derp.server` configures, whether or not the embedded server is
 * switched on. The Overview card shows the configured region itself, so it uses
 * this; the machine card uses {@link embeddedDerpRegion}, because a disabled
 * server publishes nothing to relay through.
 */
export function configuredDerpRegion(
  server: DerpEmbeddedServer | undefined,
): DerpRegionInfo | undefined {
  if (server === undefined) {
    return undefined;
  }

  const code = server.regionCode.trim();
  const name = server.regionName.trim();
  return {
    regionId: server.regionId,
    code: code || undefined,
    name: name || undefined,
  };
}

/** The manual name for a region id, or undefined when there is none. */
function mappedRegionName(names: DerpRegionNames | undefined, region: number): string | undefined {
  const name = names?.[String(region)]?.trim();
  return name ? name : undefined;
}

/** One map's entry for a region, or undefined when it describes nothing usable. */
function mappedRegionInfo(
  map: DerpRegionMap | undefined,
  region: number,
): DerpRegionInfo | undefined {
  const entry = map?.[String(region)];
  if (!entry) {
    return undefined;
  }

  const code = entry.code?.trim();
  const name = entry.name?.trim();
  return code || name
    ? { regionId: region, code: code || undefined, name: name || undefined }
    : undefined;
}

/**
 * `#901 · ams · Amsterdam`, dropping a part that repeats one already printed, so
 * a region whose name is its code never reads twice.
 */
function formatRegionLabel(region: number, info: DerpRegionInfo): string {
  const parts = [`#${region}`];
  if (info.code) {
    parts.push(info.code);
  }

  if (info.name && info.name !== info.code) {
    parts.push(info.name);
  }

  return parts.join(" · ");
}

/**
 * Labels a region from every source Headplane has, in precedence order: the
 * operator's manual mapping, the local `derp.paths` maps, the remote
 * `derp.urls` maps, then Headscale's own embedded region. A region no source
 * describes keeps its bare `#id`, and an id the agent never reported (or
 * reported as a non-numeric key) reads as the caller's localized `unknown`.
 *
 * `isEmbedded` marks the region Headscale runs itself, whichever source named
 * it, so the card can still say which relay is the embedded one.
 */
export function resolveDerpRegionLabel(
  region: number | undefined,
  sources: DerpRegionLabelSources,
  unknown: string,
): DerpRegionLabel {
  if (region === undefined || !Number.isFinite(region)) {
    return { label: unknown, isEmbedded: false };
  }

  const embedded = sources.embedded?.regionId === region ? sources.embedded : undefined;
  const isEmbedded = embedded !== undefined;

  const manual = mappedRegionName(sources.manual, region);
  if (manual !== undefined) {
    return { label: `#${region} · ${manual}`, isEmbedded };
  }

  for (const map of [sources.local, sources.remote]) {
    const info = mappedRegionInfo(map, region);
    if (info !== undefined) {
      return { label: formatRegionLabel(region, info), isEmbedded };
    }
  }

  if (embedded !== undefined) {
    return { label: formatRegionLabel(region, embedded), isEmbedded: true };
  }

  return { label: `#${region}`, isEmbedded: false };
}

/**
 * {@link resolveDerpRegionLabel} for callers that already hold the embedded
 * region and the manual mapping, e.g. the DERP settings status list.
 */
export function regionLabel(
  region: number | undefined,
  embedded: DerpRegionInfo | undefined,
  unknown: string,
  names?: DerpRegionNames,
): DerpRegionLabel {
  return resolveDerpRegionLabel(region, { embedded, manual: names }, unknown);
}

/** True when no source has anything to say about a region but its id. */
function isUnresolvedRegion(region: number | undefined, sources: DerpRegionLabelSources): boolean {
  if (region === undefined) {
    return false;
  }

  return (
    mappedRegionName(sources.manual, region) === undefined &&
    mappedRegionInfo(sources.local, region) === undefined &&
    mappedRegionInfo(sources.remote, region) === undefined &&
    sources.embedded?.regionId !== region
  );
}

/** Region ids reach the page as JSON object keys, so parse those defensively. */
export function parseDerpRegionId(region: string): number | undefined {
  const trimmed = region.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Fastest first, dropping samples that are not finite numbers. */
export function sortDerpLatencies(
  latencies: Record<string, number> | undefined,
): DerpLatencyEntry[] {
  return Object.entries(latencies ?? {})
    .filter(([, seconds]) => typeof seconds === "number" && Number.isFinite(seconds))
    .map(([region, seconds]) => ({
      region,
      regionId: parseDerpRegionId(region),
      seconds,
    }))
    .sort((a, b) => a.seconds - b.seconds);
}

/** Keeps the fastest rows and counts how many regions were left out. */
export function capDerpLatencies(
  entries: DerpLatencyEntry[],
  limit = DERP_LATENCY_ROW_LIMIT,
): DerpLatencyRows {
  const capped = Math.max(0, limit);
  return {
    rows: entries.slice(0, capped),
    hidden: Math.max(0, entries.length - capped),
  };
}

/** Tailscale reports DERP latency in seconds; the UI shows milliseconds. */
export function formatDerpLatency(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  return `${Math.round(seconds * 1000)}ms`;
}

/**
 * Everything the machine page renders about this machine's relays. `regions`
 * carries the loader-resolved map sources; the embedded region is read from
 * `server` so both come from the same precedence chain.
 */
export function buildDerpInfo(
  info: HostInfo | undefined,
  server: DerpEmbeddedServer | undefined,
  unknown: string,
  regions: DerpRegionNameData = {},
): DerpInfoView {
  const sources: DerpRegionLabelSources = { ...regions, embedded: embeddedDerpRegion(server) };
  const home = readRegionId(info?.HomeDERP);
  const preferred = readRegionId(info?.NetInfo?.PreferredDERP);
  const latencies = sortDerpLatencies(info?.NetInfo?.DERPLatency);

  return {
    hasRelayData: home !== undefined || preferred !== undefined || latencies.length > 0,
    home: resolveDerpRegionLabel(home, sources, unknown),
    preferred: resolveDerpRegionLabel(preferred, sources, unknown),
    latencies: capDerpLatencies(latencies),
    hasIdOnlyRegions:
      isUnresolvedRegion(home, sources) ||
      isUnresolvedRegion(preferred, sources) ||
      latencies.some((entry) => isUnresolvedRegion(entry.regionId, sources)),
  };
}

function readRegionId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
