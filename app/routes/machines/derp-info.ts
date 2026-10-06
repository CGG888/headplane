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

import type { DerpNodeSourceKind } from "~/routes/overview-helpers";
// Type-only: `derp-region-sources` reads the filesystem, and this module is part
// of the client bundle, so nothing may survive the type erasure here.
import type { DerpMapGroupReading } from "~/server/headscale/derp-region-sources";
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
  /** Region id parsed from the agent's latency map key, when the key names one. */
  regionId: number | undefined;
  /** Region key exactly as the agent reported it, trimmed. */
  region: string;
  /** Measured round trip in seconds, as Tailscale reports it. */
  seconds: number;
}

/** One measured region, as the card prints it. */
export interface DerpLatencyRow extends DerpLatencyEntry {
  /** The region label, resolved through the one name chain. */
  label: string;
}

export interface DerpLatencyRows {
  rows: DerpLatencyRow[];
  /** Measured regions that did not fit into `rows`. */
  hidden: number;
}

/**
 * A latency map key reduced to what a name lookup can use.
 *
 * Tailscale keys `NetInfo.DERPLatency` by the region a sample belongs to, with
 * the address family it was measured over appended — `"901-v4"`, `"901-v6"`
 * (`wgengine/magicsock`, `magicsock.go`) — while older clients used the STUN
 * server's `host:port` and a hand-written map can carry a region code. The key
 * is therefore normalised rather than assumed to be a bare region id.
 */
export interface DerpRegionKey {
  /** Region id the key names (`901`, `901-v4`, `901-v6`); undefined otherwise. */
  regionId: number | undefined;
  /** The key exactly as reported, trimmed; its own fallback label when unnamed. */
  key: string;
}

/** A bare region id, or the same id with the family suffix Tailscale appends. */
const DERP_REGION_KEY_PATTERN = /^(\d+)(?:-v[46])?$/;

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

/**
 * Reduces a latency map key to the region it names, whatever shape it arrived
 * in: a JSON object key (always a string at runtime, but a numeric record can
 * be handed in), a bare region id, or the id with Tailscale's `-v4`/`-v6`
 * family suffix. Anything else — a region code, a legacy STUN `host:port` —
 * keeps its own text as the key, which is what a row then prints.
 */
export function parseDerpRegionKey(region: string | number): DerpRegionKey {
  const key = String(region ?? "").trim();
  const match = DERP_REGION_KEY_PATTERN.exec(key);
  if (match === null) {
    return { regionId: undefined, key };
  }

  const parsed = Number(match[1]);
  return { regionId: Number.isSafeInteger(parsed) ? parsed : undefined, key };
}

/** Region ids reach the page as JSON object keys, so parse those defensively. */
export function parseDerpRegionId(region: string): number | undefined {
  return parseDerpRegionKey(region).regionId;
}

/** The identity two samples share when they measure the same region. */
function regionIdentity(key: DerpRegionKey): string {
  return key.regionId === undefined ? `key:${key.key}` : `id:${key.regionId}`;
}

/**
 * One entry per measured region, fastest first, dropping samples that are not
 * finite numbers.
 *
 * Tailscale measures a region over both address families, so `DERPLatency`
 * holds up to two samples for it (`"901-v4"` and `"901-v6"`). A row is a
 * region and the card counts regions, so the fastest sample of each region
 * stands for it: the family is how the sample was taken, not what the row is
 * about. Keys no id parses out of (a legacy `host:port`, a code) stand alone.
 */
export function sortDerpLatencies(
  latencies: Record<string | number, number> | undefined,
): DerpLatencyEntry[] {
  const fastest = new Map<string, DerpLatencyEntry>();
  for (const [region, seconds] of Object.entries(latencies ?? {})) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      continue;
    }

    const key = parseDerpRegionKey(region);
    const identity = regionIdentity(key);
    const existing = fastest.get(identity);
    if (existing === undefined || seconds < existing.seconds) {
      fastest.set(identity, { region: key.key, regionId: key.regionId, seconds });
    }
  }

  return [...fastest.values()].sort((a, b) => a.seconds - b.seconds);
}

/** The fastest measured regions, and how many did not fit. */
export interface DerpLatencySelection {
  rows: DerpLatencyEntry[];
  hidden: number;
}

/** Keeps the fastest rows and counts how many regions were left out. */
export function capDerpLatencies(
  entries: DerpLatencyEntry[],
  limit = DERP_LATENCY_ROW_LIMIT,
): DerpLatencySelection {
  const capped = Math.max(0, limit);
  return {
    rows: entries.slice(0, capped),
    hidden: Math.max(0, entries.length - capped),
  };
}

/** Labels every capped entry with the region name the one chain resolves. */
function labelDerpLatencies(
  selection: DerpLatencySelection,
  sources: DerpRegionLabelSources,
  unknown: string,
): DerpLatencyRows {
  return {
    rows: selection.rows.map((entry) => ({
      ...entry,
      label: resolveDerpLatencyKeyLabel(entry.region, sources, unknown),
    })),
    hidden: selection.hidden,
  };
}

/** The lowest region id a map gives one code, or undefined when it gives none. */
function mappedCodeRegionId(map: DerpRegionMap | undefined, code: string): number | undefined {
  let found: number | undefined;
  for (const entry of Object.values(map ?? {})) {
    if (entry.code?.trim().toLowerCase() !== code || !Number.isFinite(entry.regionId)) {
      continue;
    }

    if (found === undefined || entry.regionId < found) {
      found = entry.regionId;
    }
  }

  return found;
}

/**
 * The region a code-like key belongs to, from the same sources and in the same
 * precedence order as every other label: the local map files, the remote maps,
 * then the embedded region.
 */
function regionIdForCode(sources: DerpRegionLabelSources, code: string): number | undefined {
  const wanted = code.toLowerCase();
  if (wanted === "") {
    return undefined;
  }

  const matched =
    mappedCodeRegionId(sources.local, wanted) ?? mappedCodeRegionId(sources.remote, wanted);
  if (matched !== undefined) {
    return matched;
  }

  const embeddedCode = sources.embedded?.code?.trim().toLowerCase();
  return embeddedCode === wanted ? sources.embedded?.regionId : undefined;
}

/**
 * The label one latency row prints.
 *
 * A key carrying a region id resolves through {@link resolveDerpRegionLabel},
 * so a latency row words its region exactly like the home and preferred rows. A
 * key naming a region code is matched against the configured maps first, so a
 * sample keyed by code still reads as the region it belongs to. Any other key
 * prints as the key itself — a legacy STUN `host:port` says more than the word
 * "unknown" — and only a key that is not there at all falls back to the
 * caller's localized unknown.
 */
export function resolveDerpLatencyKeyLabel(
  key: string | number,
  sources: DerpRegionLabelSources,
  unknown: string,
): string {
  const parsed = parseDerpRegionKey(key);
  if (parsed.key === "") {
    return unknown;
  }

  if (parsed.regionId !== undefined) {
    return resolveDerpRegionLabel(parsed.regionId, sources, unknown).label;
  }

  const byCode = regionIdForCode(sources, parsed.key);
  return byCode === undefined ? parsed.key : resolveDerpRegionLabel(byCode, sources, unknown).label;
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
    latencies: labelDerpLatencies(capDerpLatencies(latencies), sources, unknown),
    hasIdOnlyRegions:
      isUnresolvedRegion(home, sources) ||
      isUnresolvedRegion(preferred, sources) ||
      latencies.some((entry) => isUnresolvedRegion(entry.regionId, sources)),
  };
}

function readRegionId(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  // The agent sends these as JSON numbers, but a re-serialised payload can hand
  // an id over as a string; an id that arrived is still an id to name.
  return typeof value === "string" ? parseDerpRegionKey(value).regionId : undefined;
}

// MARK: Relays this machine uses

/**
 * Which configured source serves each region, in the order the Overview "DERP
 * nodes" card claims regions: Headscale's embedded relay first, then every
 * configured map as the configuration lists it — a `derp.paths` file (or the
 * region mirror's own file), then a `derp.urls` map. A region an earlier source
 * already described is not claimed twice, which is exactly how Headscale merges
 * the maps.
 *
 * `derpNodeSources` in `~/routes/overview-helpers` groups the same claim into
 * node lists for the Overview card; a relay row only needs the kind that serves
 * it, so this keys the answer by region id.
 */
export function relayRegionSources(
  groups: readonly DerpMapGroupReading[],
  embedded: DerpRegionInfo | undefined,
): Record<string, DerpNodeSourceKind> {
  const sources: Record<string, DerpNodeSourceKind> = {};
  if (embedded !== undefined) {
    sources[String(embedded.regionId)] = "embedded";
  }

  for (const group of groups) {
    const kind: DerpNodeSourceKind = group.kind === "remote" ? "official" : group.kind;
    for (const region of group.regions) {
      const id = String(region.regionId);
      if (!Object.hasOwn(sources, id)) {
        sources[id] = kind;
      }
    }
  }

  return sources;
}

/** One relay a machine uses, as the card prints its row. */
export interface MachineRelayUse {
  /** Stable identity of the row: `id:901`, or the agent's own key for a legacy sample. */
  key: string;
  /** `#901 · ams · Amsterdam`, from the one label chain. */
  label: string;
  /** The region id the agent's key names, when it names one. */
  regionId?: number;
  /** The measured round trip, already formatted, when the machine measured it. */
  latency?: string;
  /** True for the region the agent reports as the one this machine uses. */
  inUse: boolean;
  /** Which configured source describes this region, when one does. */
  source?: DerpNodeSourceKind;
}

export interface MachineRelayUseView {
  /** The region the agent reports as this machine's home. */
  home: MachineRelayUse;
  /** The region the agent reports as the one it currently uses. */
  preferred: MachineRelayUse;
  /** Every measured region, fastest first, as the card's latency rows. */
  latencies: MachineRelayUse[];
}

/** The source serving one region, or nothing when no source describes it. */
function sourceOf(
  sources: Readonly<Record<string, DerpNodeSourceKind>>,
  regionId: number | undefined,
): { source?: DerpNodeSourceKind } {
  if (regionId === undefined) {
    return {};
  }

  const source = sources[String(regionId)];
  return source === undefined ? {} : { source };
}

/**
 * The relays this machine uses, as rows: the agent's home and preferred regions,
 * plus every region it measured, each carrying the source that serves it and
 * whether it is the one currently in use.
 *
 * The labels come from {@link buildDerpInfo}'s view, so a row words its region
 * exactly like every other row, and "in use" is the agent's own `PreferredDERP`
 * — nothing is inferred from latency or from the configuration. `key` is the
 * row's identity: the region id when the agent's key names one, and the agent's
 * own key for a legacy `host:port` sample no map can name.
 */
export function buildMachineRelayUse(
  info: HostInfo | undefined,
  view: DerpInfoView,
  relaySources: Readonly<Record<string, DerpNodeSourceKind>> = {},
): MachineRelayUseView {
  const homeId = readRegionId(info?.HomeDERP);
  const preferredId = readRegionId(info?.NetInfo?.PreferredDERP);

  const regionRow = (
    regionId: number | undefined,
    label: string,
    fallbackKey: string,
  ): MachineRelayUse => ({
    key: regionId === undefined ? fallbackKey : `id:${regionId}`,
    label,
    ...(regionId === undefined ? {} : { regionId }),
    inUse: regionId !== undefined && regionId === preferredId,
    ...sourceOf(relaySources, regionId),
  });

  return {
    home: regionRow(homeId, view.home.label, "key:home"),
    preferred: regionRow(preferredId, view.preferred.label, "key:preferred"),
    latencies: view.latencies.rows.map((row): MachineRelayUse => ({
      key: regionIdentity(parseDerpRegionKey(row.region)),
      label: row.label,
      ...(row.regionId === undefined ? {} : { regionId: row.regionId }),
      latency: formatDerpLatency(row.seconds),
      inUse: preferredId !== undefined && row.regionId === preferredId,
      ...sourceOf(relaySources, row.regionId),
    })),
  };
}
