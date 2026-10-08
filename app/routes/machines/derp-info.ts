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

// Type-only: the badge helper is a component module, and the tones only ever
// travel as types through this pure module, so nothing is imported at runtime.
import type { SettingsStatusTone } from "~/components/settings-nav";
import type { DerpNodeSourceKind, DerpNodeSourcesView } from "~/routes/overview-helpers";
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

/**
 * The code and name a region is known by, resolved through the same precedence
 * chain as its label: the operator's manual mapping first, then the local and
 * remote maps, then Headscale's embedded region. A region no source describes
 * (a bare `#id`, or an id the agent never reported) has neither.
 *
 * Surfaces that render a region's flag take this rather than the label: the
 * label is already formatted for a reader (`#901 · ams · Amsterdam`), while a
 * flag needs the parts — `~/utils/region-country` turns them into a country.
 */
export function resolveDerpRegionIdentity(
  region: number | undefined,
  sources: DerpRegionLabelSources,
): Pick<DerpRegionInfo, "code" | "name"> | undefined {
  if (region === undefined || !Number.isFinite(region)) {
    return undefined;
  }

  const manual = mappedRegionName(sources.manual, region);
  if (manual !== undefined) {
    return { name: manual };
  }

  for (const map of [sources.local, sources.remote]) {
    const info = mappedRegionInfo(map, region);
    if (info !== undefined) {
      return { code: info.code, name: info.name };
    }
  }

  const embedded = sources.embedded?.regionId === region ? sources.embedded : undefined;
  return embedded === undefined ? undefined : { code: embedded.code, name: embedded.name };
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

/**
 * Where one latency row's number came from: the machine's own report
 * (`NetInfo.DERPLatency`) or a measurement this server took itself. They are
 * never mixed silently — a local measurement is the path clients near this
 * server take, a reported one is the path that machine takes — so every row
 * says which one it shows.
 */
export type MachineLatencySource = "reported" | "measured";

/**
 * The tones the latency list's micro badges use, taken from the app's one badge
 * helper (`SettingsStatus`) rather than from a palette of this module's own:
 * the tones have to keep meaning the same thing here and everywhere else.
 */
export type MachineLatencyTone = SettingsStatusTone;

/** One relay a machine uses, as the card prints its row. */
export interface MachineRelayUse {
  /** Stable identity of the row: `id:901`, or the agent's own key for a legacy sample. */
  key: string;
  /** `#901 · ams · Amsterdam`, from the one label chain. */
  label: string;
  /**
   * The label's leading id column, e.g. `#901`. Absent for a key that names no
   * region (a legacy `host:port` sample), which the card's id column reads as a
   * dash instead.
   */
  idLabel?: string;
  /**
   * The label's name column, e.g. `hkg · 香港` (or the whole `host:port` key
   * when `idLabel` is absent). Absent while no source names the region.
   */
  nameLabel?: string;
  /** The region id the agent's key names, when it names one. */
  regionId?: number;
  /** The measured round trip, already formatted, when anyone measured it. */
  latency?: string;
  /** Which of the two sources produced `latency`, when there is one. */
  latencySource?: MachineLatencySource;
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
 * The relays this machine uses, as the card's summary rows: the agent's home and
 * preferred regions, each carrying the source that serves it. The "in use" flag
 * belongs to the preferred row alone — the home region is the one the control
 * plane assigned, and it is only a coincidence (the healthy case) when the
 * client is relaying through it, so marking both rows at once told the operator
 * nothing.
 *
 * The labels come from {@link buildDerpInfo}'s view, so a row words its region
 * exactly like every other row, and "in use" is the agent's own `PreferredDERP`
 * — nothing is inferred from latency or from the configuration. `key` is the
 * row's identity: the region id when the agent's key names one, and the agent's
 * own key for anything else.
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
    inUse: boolean,
  ): MachineRelayUse => ({
    key: regionId === undefined ? fallbackKey : `id:${regionId}`,
    label,
    ...(regionId === undefined ? {} : { regionId }),
    inUse,
    ...sourceOf(relaySources, regionId),
  });

  return {
    home: regionRow(homeId, view.home.label, "key:home", false),
    preferred: regionRow(
      preferredId,
      view.preferred.label,
      "key:preferred",
      preferredId !== undefined,
    ),
  };
}

// MARK: Latency by region

/**
 * Every region the latency table lists, taken from the served-node inventory the
 * Overview card is built from: the embedded relay's region plus every region of
 * the maps this deployment actually loads — the `derp.paths` files, the region
 * mirror's own file included. A region the configuration only advertises
 * upstream (`derp.urls`, the `official` source) is not served by this machine
 * and is not listed here; the table keeps such a region only when the machine
 * measured it itself.
 *
 * This is a projection of {@link derpNodeSources}, never a second reading of the
 * configuration, so the machine card and the Overview card cannot disagree about
 * what `served` means.
 */
export function servedDerpRegionIds(view: DerpNodeSourcesView): number[] {
  const ids = new Set<number>();
  for (const source of view.sources) {
    if (source.state !== "served") {
      continue;
    }

    for (const region of source.regions) {
      ids.add(region.regionId);
    }
  }

  return [...ids].toSorted((a, b) => a - b);
}

/** The readings the latency table is built from, all prepared by the loader. */
export interface MachineLatencyInventory {
  /** Every region this deployment serves, from {@link servedDerpRegionIds}. */
  servedRegionIds?: readonly number[];
  /**
   * The values this server measured itself, keyed by the official region id the
   * probe dialled, in milliseconds.
   */
  measured?: Readonly<Record<string, number>>;
  /**
   * The region mirror's stored assignment: official region id to the number the
   * region is mirrored as. It is what turns a measurement of an official region
   * into the value of the mirrored row that carries its number.
   */
  assignment?: Readonly<Record<string, number>>;
}

/** One latency reading that can be printed. */
function usableLatencyMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Milliseconds as a locally measured row prints them. */
function formatLatencyMs(milliseconds: number): string {
  return `${Math.round(milliseconds)}ms`;
}

/**
 * The value this server measured for one displayed region, in milliseconds.
 *
 * The row's own id is tried first, because a region the probe dialled directly
 * is that region. A mirrored row carries the number the filter assigned instead,
 * so the stored assignment is what maps it back to the official region the probe
 * measured. Two official regions mirrored onto one number cannot happen in the
 * settings, and the lowest official id wins if a hand-edited store ever holds
 * one.
 */
function measuredRegionMs(
  region: number,
  measured: Readonly<Record<string, number>>,
  assignment: Readonly<Record<string, number>>,
): number | undefined {
  const direct = usableLatencyMs(measured[String(region)]);
  if (direct !== undefined) {
    return direct;
  }

  let value: number | undefined;
  let officialId: number | undefined;
  for (const [id, number] of Object.entries(assignment)) {
    if (number !== region) {
      continue;
    }

    const candidate = usableLatencyMs(measured[id]);
    if (candidate === undefined) {
      continue;
    }

    const parsed = Number(id);
    if (!Number.isSafeInteger(parsed)) {
      continue;
    }

    if (officialId === undefined || parsed < officialId) {
      officialId = parsed;
      value = candidate;
    }
  }

  return value;
}

/**
 * The tone of the badge naming which configured source describes a region.
 *
 * One chain of meaning: a region this deployment actually serves (`embedded`,
 * the `derp.paths` files, the region mirror's own file) reads in the app's "ok"
 * green, a region only advertised upstream (`official`) reads in its "warn"
 * amber, and a region no source describes has no badge at all.
 */
export function relaySourceTone(
  source: DerpNodeSourceKind | undefined,
): MachineLatencyTone | undefined {
  switch (source) {
    case "embedded":
    case "local":
    case "mirror":
      return "ok";
    case "official":
      return "warn";
    default:
      return undefined;
  }
}

/**
 * The tone of the badge naming where a latency number came from. A measurement
 * this server took is "ok" — it is the local path, the same green the locally
 * served relays use — a client's own report is "neutral" (relayed data, nothing
 * wrong with it), and a row nobody measured stays neutral too: the card tones
 * that one down further rather than colouring it as a problem.
 */
export function latencySourceTone(source: MachineLatencySource | undefined): MachineLatencyTone {
  return source === "measured" ? "ok" : "neutral";
}

/**
 * A row's label split into the two columns the latency list lines up: the id
 * (`#901`) and the name (`hkg · 香港`). A key that names no region — a legacy
 * `host:port` sample, or the caller's "unknown" text — has no id column, so the
 * whole label is the name column and the card prints a dash for the id.
 */
function latencyLabelColumns(label: string): { idLabel?: string; nameLabel?: string } {
  const separator = label.indexOf(" · ");
  if (separator < 0) {
    return label.startsWith("#") ? { idLabel: label } : { nameLabel: label };
  }

  const idLabel = label.slice(0, separator);
  const nameLabel = label.slice(separator + 3);
  return {
    ...(idLabel.length === 0 ? {} : { idLabel }),
    ...(nameLabel.length === 0 ? {} : { nameLabel }),
  };
}

/** One served region as a latency row, with or without a number. */
function servedLatencyRow(
  regionId: number,
  label: string,
  preferredId: number | undefined,
  relaySources: Readonly<Record<string, DerpNodeSourceKind>>,
  latency: string | undefined,
  latencySource: MachineLatencySource | undefined,
): MachineRelayUse {
  return {
    key: `id:${regionId}`,
    label,
    ...latencyLabelColumns(label),
    regionId,
    ...(latency === undefined ? {} : { latency }),
    ...(latencySource === undefined ? {} : { latencySource }),
    inUse: preferredId !== undefined && regionId === preferredId,
    ...sourceOf(relaySources, regionId),
  };
}

/** The rows the machine card's latency section prints, and what they add up to. */
export interface MachineLatencyRows {
  /** Every region this deployment serves, fastest first, unmeasured last. */
  rows: MachineRelayUse[];
  /** How many rows carry a number, per source, and how many carry none. */
  summary: {
    /** Rows the table lists. */
    total: number;
    /** Rows the reporting machine measured. */
    reported: number;
    /** Rows this server measured. */
    measured: number;
    /** Rows nobody measured. */
    unmeasured: number;
  };
}

export interface MachineLatencyRowsInput {
  info: HostInfo | undefined;
  /** The label chain's sources, exactly as {@link buildDerpInfo} receives them. */
  sources: DerpRegionLabelSources;
  /** The localized text a region no source names reads as. */
  unknown: string;
  /** Which configured source serves each region, keyed by region id. */
  relaySources?: Readonly<Record<string, DerpNodeSourceKind>>;
  /** The served regions and the values this server measured itself. */
  inventory?: MachineLatencyInventory;
}

/**
 * The latency table for one machine: **every** region this deployment serves,
 * whether or not anybody measured it, plus any region the machine measured that
 * this deployment does not serve (an upstream relay, or a legacy `host:port`
 * sample) so a measurement is never silently dropped.
 *
 * Each row's number comes from, in order, the reporting machine's own value and
 * then this server's measurement of the same region — translated through the
 * mirror's assignment when the row carries a mirrored number, so the number
 * always belongs to the id the row shows. A region neither source measured keeps
 * its row with no number, which is what tells the reader the region exists and
 * simply was not measured.
 *
 * The order is the fastest first, exactly as every other latency list in
 * Headplane reads, with the unmeasured regions after them in region-id order.
 */
export function buildMachineLatencyRows({
  info,
  sources,
  unknown,
  relaySources = {},
  inventory = {},
}: MachineLatencyRowsInput): MachineLatencyRows {
  const reported = sortDerpLatencies(info?.NetInfo?.DERPLatency);
  const preferredId = readRegionId(info?.NetInfo?.PreferredDERP);
  const measured = inventory.measured ?? {};
  const assignment = inventory.assignment ?? {};

  // The client measures a region over both families and the card counts regions,
  // so the fastest sample of a region is the one that stands for it.
  const reportedByRegion = new Map<number, DerpLatencyEntry>();
  for (const entry of reported) {
    if (entry.regionId !== undefined && !reportedByRegion.has(entry.regionId)) {
      reportedByRegion.set(entry.regionId, entry);
    }
  }

  const rows: { row: MachineRelayUse; milliseconds?: number }[] = [];
  const claimed = new Set<string>();

  for (const regionId of new Set(inventory.servedRegionIds ?? [])) {
    const label = resolveDerpRegionLabel(regionId, sources, unknown).label;
    const reportedEntry = reportedByRegion.get(regionId);
    if (reportedEntry !== undefined) {
      claimed.add(regionIdentity(parseDerpRegionKey(reportedEntry.region)));
      rows.push({
        milliseconds: reportedEntry.seconds * 1000,
        row: servedLatencyRow(
          regionId,
          label,
          preferredId,
          relaySources,
          formatDerpLatency(reportedEntry.seconds),
          "reported",
        ),
      });
      continue;
    }

    const local = measuredRegionMs(regionId, measured, assignment);
    rows.push({
      ...(local === undefined ? {} : { milliseconds: local }),
      row: servedLatencyRow(
        regionId,
        label,
        preferredId,
        relaySources,
        local === undefined ? undefined : formatLatencyMs(local),
        local === undefined ? undefined : "measured",
      ),
    });
  }

  // A sample that names a region this deployment does not serve stays listed:
  // the machine measured it, and a legacy `host:port` key only ever exists as
  // the agent reported it.
  for (const entry of reported) {
    const key = regionIdentity(parseDerpRegionKey(entry.region));
    if (claimed.has(key)) {
      continue;
    }

    const label = resolveDerpLatencyKeyLabel(entry.region, sources, unknown);
    rows.push({
      milliseconds: entry.seconds * 1000,
      row: {
        key,
        label,
        ...latencyLabelColumns(label),
        ...(entry.regionId === undefined ? {} : { regionId: entry.regionId }),
        latency: formatDerpLatency(entry.seconds),
        latencySource: "reported",
        inUse: entry.regionId !== undefined && entry.regionId === preferredId,
        ...sourceOf(relaySources, entry.regionId),
      },
    });
  }

  rows.sort((a, b) => {
    if ((a.milliseconds === undefined) !== (b.milliseconds === undefined)) {
      return a.milliseconds === undefined ? 1 : -1;
    }

    if (a.milliseconds !== undefined && b.milliseconds !== undefined) {
      const byLatency = a.milliseconds - b.milliseconds;
      if (byLatency !== 0) {
        return byLatency;
      }
    }

    return (
      (a.row.regionId ?? Number.MAX_SAFE_INTEGER) - (b.row.regionId ?? Number.MAX_SAFE_INTEGER) ||
      a.row.key.localeCompare(b.row.key)
    );
  });

  const summary = { total: rows.length, reported: 0, measured: 0, unmeasured: 0 };
  for (const { row } of rows) {
    summary[row.latencySource ?? "unmeasured"] += 1;
  }

  return { rows: rows.map((entry) => entry.row), summary };
}

// MARK: One machine's relay, as the machines list prints it

/**
 * The relay a machine is using right now, as the machines list's relay column
 * prints it in its single cell: the region the agent reports as preferred
 * (`NetInfo.PreferredDERP`, the sample the machine card marks "in use"),
 * resolved through the one name chain.
 *
 * `undefined` means the agent has not reported a preferred region for this
 * machine yet, so the list shows its own localized not-reported text instead of
 * a label no source can support.
 *
 * This reads the same field and resolves through the same helpers as
 * {@link buildDerpInfo}, with the same `regions` shape and the same embedded
 * server, so this column and the machine card's "in use" row can never name a
 * region differently.
 */
export function preferredRelayLabel(
  info: HostInfo | undefined,
  server: DerpEmbeddedServer | undefined,
  unknown: string,
  regions: DerpRegionNameData = {},
): string | undefined {
  const preferred = readRegionId(info?.NetInfo?.PreferredDERP);
  if (preferred === undefined) {
    return undefined;
  }

  return resolveDerpRegionLabel(
    preferred,
    { ...regions, embedded: embeddedDerpRegion(server) },
    unknown,
  ).label;
}

/**
 * The code and name behind that same label, so the list's relay cell can draw
 * the region's flag beside it. `undefined` when the agent reports no preferred
 * region, or when no source describes the region it names.
 */
export function preferredRelayIdentity(
  info: HostInfo | undefined,
  server: DerpEmbeddedServer | undefined,
  regions: DerpRegionNameData = {},
): Pick<DerpRegionInfo, "code" | "name"> | undefined {
  const preferred = readRegionId(info?.NetInfo?.PreferredDERP);
  if (preferred === undefined) {
    return undefined;
  }

  return resolveDerpRegionIdentity(preferred, {
    ...regions,
    embedded: embeddedDerpRegion(server),
  });
}
