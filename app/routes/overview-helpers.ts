/**
 * Pure aggregation and formatting behind the Overview dashboard.
 *
 * The page loader only reads values and the component only renders them, so
 * every rule that needs a decision lives here as a plain function: no I/O, no
 * React and no i18n. Each helper degrades to `undefined` (which the page
 * renders as an em dash with a short reason) instead of throwing, so one value
 * nobody could read can never take the dashboard down.
 */

import {
  resolveDerpRegionLabel,
  type DerpRegionInfo,
  type DerpRegionMap,
} from "~/routes/machines/derp-info";
import { DERP_DEFAULT_PORT } from "~/routes/settings/headscale/derp-map-limits";
import {
  deriveDerpPublicEndpoint,
  formatDerpPublicEndpoint,
} from "~/routes/settings/headscale/derp-settings";
import { parseIpv4, parseIpv6 } from "~/routes/settings/headscale/trusted-proxies";
import type { FleetTrend } from "~/server/history/timeline";

// MARK: Counts

export type NodeStatusCounts = {
  total: number;
  online: number;
  offline: number;
};

/** The node totals behind the counts card, split by the online flag. */
export function countNodeStatus(nodes: readonly { online: boolean }[]): NodeStatusCounts {
  let online = 0;
  for (const node of nodes) {
    if (node.online) {
      online += 1;
    }
  }

  return { total: nodes.length, online, offline: nodes.length - online };
}

export type CheckStatus = "pass" | "warning" | "fail";

/**
 * A type alias rather than an interface so the tally can be handed straight to
 * the i18n `t()` helper as a placeholder map.
 */
export type CheckTally = {
  total: number;
  pass: number;
  warning: number;
  fail: number;
};

/** The pass/warning/fail tallies of a diagnostics or configuration-check list. */
export function tallyChecks(checks: readonly { status: CheckStatus }[]): CheckTally {
  const tally: CheckTally = { total: checks.length, pass: 0, warning: 0, fail: 0 };
  for (const check of checks) {
    tally[check.status] += 1;
  }

  return tally;
}

/** Every status in the order the dashboard shows it: best result first. */
const CHECK_STATUS_ORDER = ["pass", "warning", "fail"] as const;

export interface CheckStatusCount {
  status: CheckStatus;
  count: number;
}

/**
 * A tally as a list of per-status counts, so the page can render one chip per
 * status without depending on the property order of the tally object.
 */
export function tallyEntries(tally: CheckTally): CheckStatusCount[] {
  return CHECK_STATUS_ORDER.map((status) => ({ status, count: tally[status] }));
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A human-readable byte size, using binary units. Returns `undefined` for a
 * value that is not a usable size so the caller can say "unknown" instead of
 * printing `NaN`.
 */
export function formatByteSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return undefined;
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole bytes are always exact; every larger unit keeps one decimal.
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

// MARK: DERP

/**
 * The host part of a `host:port` bind address, with the brackets of an IPv6
 * literal removed. An empty host (`:3478`) is returned as an empty string,
 * which is a valid Go listen address for both families.
 */
export function stunBindHost(address: string | undefined): string | undefined {
  const trimmed = (address ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/.exec(trimmed);
  const plain = bracketed ? undefined : /^([^\s:]*):(\d{1,5})$/.exec(trimmed);
  const match = bracketed ?? plain;
  if (!match) {
    return undefined;
  }

  const port = Number(match[2]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? match[1] : undefined;
}

/**
 * True when a bind address can only be reached over IPv4. Go's
 * `net.Listen("udp", "0.0.0.0:3478")` binds an IPv4 literal as IPv4 only, so a
 * client without an IPv4 stack never reaches STUN there. An empty host
 * (`:3478`, both families), an IPv6 literal (`[::]` is dual-stack) and a
 * hostname (which may resolve either way) all return false, because nothing
 * certain can be said about them.
 */
export function isIpv4OnlyStunBind(address: string | undefined): boolean {
  const host = stunBindHost(address);
  if (host === undefined || host.length === 0) {
    return false;
  }

  if (parseIpv6(host)) {
    return false;
  }

  return parseIpv4(host) !== undefined;
}

export interface Ipv6StunWarningInput {
  /** `derp.server.enabled`; STUN only listens while the embedded server runs. */
  enabled: boolean;
  /** `derp.server.ipv6`. */
  ipv6: string | undefined;
  /** `derp.server.stun_listen_addr`. */
  stunListenAddr: string | undefined;
}

/**
 * The one DERP configuration that silently strands IPv6-only clients: an
 * embedded server advertises an IPv6 address, but its STUN listener is bound to
 * an IPv4 literal, so those clients cannot discover their endpoint.
 */
export function hasIpv6StunWarning({
  enabled,
  ipv6,
  stunListenAddr,
}: Ipv6StunWarningInput): boolean {
  if (!enabled || (ipv6 ?? "").trim().length === 0) {
    return false;
  }

  return isIpv4OnlyStunBind(stunListenAddr);
}

export interface DeclaredDerpAddress {
  family: "ipv4" | "ipv6";
  value: string;
}

/**
 * The relay addresses `derp.server` declares, in the order the page lists
 * them. Only configured values are returned: an unset key says nothing, and
 * the page shows that family as "not configured" rather than as an address.
 */
export function declaredDerpAddresses(server: {
  ipv4?: string;
  ipv6?: string;
}): DeclaredDerpAddress[] {
  const addresses: DeclaredDerpAddress[] = [];
  const ipv4 = (server.ipv4 ?? "").trim();
  const ipv6 = (server.ipv6 ?? "").trim();

  if (ipv4.length > 0) {
    addresses.push({ family: "ipv4", value: ipv4 });
  }
  if (ipv6.length > 0) {
    addresses.push({ family: "ipv6", value: ipv6 });
  }

  return addresses;
}

/** Where the endpoint host clients use comes from. */
export type RelayHostSource = "hostname" | "literal" | "invalid";

export interface RelayHostSummary {
  /** `host:port` as written, or `undefined` when `server_url` cannot be read. */
  endpoint?: string;
  /** The host on its own, ready for a row of its own. */
  host?: string;
  /** The port clients dial, as text so the page never formats a number. */
  port?: string;
  source: RelayHostSource;
}

/**
 * The hostname and port clients actually dial, split out of `server_url`. An
 * IPv6 literal arrives bracketed and is a host clients use as-is, so the page
 * can say so instead of promising a DNS answer that does not exist.
 */
export function relayHostSummary(serverUrl: string | undefined): RelayHostSummary {
  const endpoint = deriveDerpPublicEndpoint(serverUrl);
  if (endpoint === undefined) {
    return { source: "invalid" };
  }

  return {
    endpoint: formatDerpPublicEndpoint(endpoint),
    host: endpoint.host,
    port: String(endpoint.port),
    source: endpoint.host.startsWith("[") ? "literal" : "hostname",
  };
}

/** The reason keys the resolver can report, without the renderer's em dash. */
export type RelayReason =
  | "no-records"
  | "timeout"
  | "resolver-error"
  | "host-missing"
  | "invalid-host"
  | "unavailable";

export interface RelayAddressDisplay {
  ipv4?: string;
  ipv4Reason?: RelayReason;
  ipv6?: string;
  ipv6Reason?: RelayReason;
}

/**
 * The resolved addresses for a row: a newline-separated list per family, or the
 * reason that family is empty. A timeout and a resolver failure are reported as
 * such because they say "try again", while a name with no AAAA record simply
 * has none. Without a reason at all the family reads "unavailable".
 */
export function relayAddressDisplay(
  addresses: readonly { family: "ipv4" | "ipv6"; addresses: string[] }[] | undefined,
  reason: RelayReason | undefined,
): RelayAddressDisplay {
  const display: RelayAddressDisplay = {};
  const fallback = reason ?? "unavailable";

  for (const family of ["ipv4", "ipv6"] as const) {
    const entry = addresses?.find((row) => row.family === family);
    const values = entry?.addresses ?? [];
    const text = values.join("\n").trim();
    if (text.length > 0) {
      display[family] = text;
    } else {
      display[`${family}Reason`] = fallback;
    }
  }

  return display;
}

/**
 * How many machines report the given region as their home relay. The home
 * region only exists in the Headplane Agent's host info, so a missing entry
 * counts as "not known" rather than as "not using it".
 */
export function countNodesHomedInRegion(
  stats: Record<string, { HomeDERP?: number } | undefined>,
  regionId: number,
): number {
  let count = 0;
  for (const info of Object.values(stats)) {
    if (info?.HomeDERP === regionId) {
      count += 1;
    }
  }

  return count;
}

// MARK: DERP map regions

/**
 * `stunport` defaults to 3478 when a node omits it; `0` is the format's way of
 * saying that this node does not answer STUN at all.
 */
export const DERP_DEFAULT_STUN_PORT = 3478;

/**
 * Most node hostnames one render resolves. A public DERP map lists dozens of
 * nodes and every lookup is a DNS query, so the box resolves a bounded prefix
 * of them and says how many it left out; the shared relay cache makes every
 * later render free.
 */
export const DERP_NODE_RESOLVE_LIMIT = 24;

/** One node as a configured DERP map declares it. */
export interface DerpMapNodeInput {
  name: string;
  hostname: string;
  /** `derpport` as declared; unset means the format's default (443). */
  derpPort?: number;
  /** `stunport` as declared; `0` means this node does not answer STUN. */
  stunPort?: number;
  stunOnly: boolean;
  ipv4?: string;
  ipv6?: string;
}

/** One region as a configured DERP map declares it, with its source. */
export interface DerpMapRegionInput {
  regionId: number;
  code?: string;
  name?: string;
  /** The first configured map that describes this region. */
  origin: { kind: "local" | "remote"; source: string };
  nodes: readonly DerpMapNodeInput[];
}

/** What one node hostname resolved to, as the shared relay cache reports it. */
export interface DerpNodeResolution {
  /** `literal` when the hostname is already an address, so nothing was looked up. */
  kind?: "literal" | "hostname";
  host?: string;
  ipv4: string[];
  ipv6: string[];
  reason?: RelayReason;
}

/** One port as the map declares it: the value, and whether it is the default. */
export interface DerpPortValue {
  port: number;
  /** True when the map omitted the port, so the card prints the default. */
  defaulted: boolean;
}

/** The STUN port of a node, absent when that node does not answer STUN. */
export interface DerpStunPortValue {
  port?: number;
  defaulted: boolean;
}

/** The DERP port clients dial for a node. */
export function derpNodeDerpPort(node: { derpPort?: number }): DerpPortValue {
  return node.derpPort === undefined
    ? { port: DERP_DEFAULT_PORT, defaulted: true }
    : { port: node.derpPort, defaulted: false };
}

/** The STUN port a node answers on, or no port when it does not offer STUN. */
export function derpNodeStunPort(node: { stunPort?: number }): DerpStunPortValue {
  if (node.stunPort === undefined) {
    return { port: DERP_DEFAULT_STUN_PORT, defaulted: true };
  }

  return node.stunPort === 0 ? { defaulted: false } : { port: node.stunPort, defaulted: false };
}

/**
 * The A/AAAA answer for one node hostname, per family, with the resolver's own
 * reason for a family it could not fill. A hostname that is already an address
 * is its own answer; a name nobody looked up reads "not resolved", exactly as
 * an empty family under the address block does.
 */
export function derpNodeResolvedAddresses(
  hostname: string,
  resolutions: Readonly<Record<string, DerpNodeResolution | undefined>> | undefined,
): RelayAddressDisplay {
  const resolution = resolutions?.[hostname.trim().toLowerCase()];
  if (resolution === undefined) {
    return relayAddressDisplay(undefined, undefined);
  }

  if (resolution.kind === "literal") {
    const literal = (resolution.host ?? hostname).trim().replace(/^\[|\]$/g, "");
    return relayAddressDisplay(
      [
        { family: "ipv4", addresses: parseIpv4(literal) === undefined ? [] : [literal] },
        { family: "ipv6", addresses: parseIpv6(literal) === undefined ? [] : [literal] },
      ],
      undefined,
    );
  }

  return relayAddressDisplay(
    [
      { family: "ipv4", addresses: [...resolution.ipv4] },
      { family: "ipv6", addresses: [...resolution.ipv6] },
    ],
    resolution.reason,
  );
}

/** One node of the box, from the map's declaration and the shared lookup. */
export interface DerpNodeSummary {
  name: string;
  /** `hostname:derpport`, the address a client dials for this node. */
  endpoint: string;
  /** True when the map omitted `derpport`, so the endpoint prints the default. */
  portDefaulted: boolean;
  /** `hostname:stunport`, or undefined when the node does not answer STUN. */
  stunEndpoint?: string;
  /** True when the map omitted `stunport`, so the port shown is the default. */
  stunPortDefaulted: boolean;
  stunOnly: boolean;
  /** The address the map itself declares for this node, when it declares one. */
  ipv4?: string;
  ipv6?: string;
  /** The A/AAAA answer for the node's hostname. */
  resolved: RelayAddressDisplay;
}

/** One node as the box prints it. */
export function derpNodeSummary(
  node: DerpMapNodeInput,
  resolutions?: Readonly<Record<string, DerpNodeResolution | undefined>>,
): DerpNodeSummary {
  const derp = derpNodeDerpPort(node);
  const stun = derpNodeStunPort(node);

  return {
    name: node.name,
    endpoint: `${node.hostname}:${derp.port}`,
    portDefaulted: derp.defaulted,
    ...(stun.port === undefined ? {} : { stunEndpoint: `${node.hostname}:${stun.port}` }),
    stunPortDefaulted: stun.defaulted,
    stunOnly: node.stunOnly,
    ...(node.ipv4 === undefined ? {} : { ipv4: node.ipv4 }),
    ...(node.ipv6 === undefined ? {} : { ipv6: node.ipv6 }),
    resolved: derpNodeResolvedAddresses(node.hostname, resolutions),
  };
}

/** One region of the box, with the map it came from and its nodes. */
export interface DerpRegionSummary {
  regionId: number;
  /** `#901 · ams · Amsterdam`, from the shared region-label chain. */
  label: string;
  /** Where the displayed name came from: the manual mapping, or a map itself. */
  nameSource: "manual" | "map";
  /** The configured map that contributes this region; the first one wins. */
  map: { kind: "local" | "remote"; source: string };
  nodeCount: number;
  nodes: DerpNodeSummary[];
}

export interface DerpRegionSummaryInput {
  /** Every region the configured maps describe, in configuration order. */
  regions: readonly DerpMapRegionInput[];
  /** The operator's manual region-id to name mapping. */
  manual?: Readonly<Record<string, string>>;
  /** Headscale's own embedded region, which names itself. */
  embedded?: DerpRegionInfo;
  /** The shared relay cache's answer per hostname, lowercased. */
  resolutions?: Readonly<Record<string, DerpNodeResolution | undefined>>;
  /** The localized text a region no source names reads as. */
  unknown: string;
}

/**
 * The configured maps as the box lists them. Regions keep the order they were
 * read in, each label comes from {@link resolveDerpRegionLabel} — the same chain
 * the region row above uses, so the two cards cannot word a region differently —
 * and each chip names the first map that described the region, which is the map
 * whose name the label shows.
 */
export function derpRegionSummaries(input: DerpRegionSummaryInput): DerpRegionSummary[] {
  const local: DerpRegionMap = {};
  const remote: DerpRegionMap = {};
  const preferred = new Map<string, DerpMapRegionInput>();

  for (const region of input.regions) {
    const id = String(region.regionId);
    const target = region.origin.kind === "local" ? local : remote;
    if (target[id] === undefined) {
      target[id] = { regionId: region.regionId, code: region.code, name: region.name };
    }

    // The label chain prefers a local file over a remote map, so the chip has to
    // as well, or it would credit a map whose name the label did not use.
    const current = preferred.get(id);
    if (
      current === undefined ||
      (current.origin.kind === "remote" && region.origin.kind === "local")
    ) {
      preferred.set(id, region);
    }
  }

  const summaries: DerpRegionSummary[] = [];
  const seen = new Set<string>();

  for (const region of input.regions) {
    const id = String(region.regionId);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    const source = preferred.get(id) ?? region;
    const manual = input.manual?.[id]?.trim();
    const { label } = resolveDerpRegionLabel(
      region.regionId,
      { manual: input.manual, local, remote, embedded: input.embedded },
      input.unknown,
    );

    summaries.push({
      regionId: region.regionId,
      label,
      nameSource: manual === undefined || manual.length === 0 ? "map" : "manual",
      map: { kind: source.origin.kind, source: source.origin.source },
      nodeCount: source.nodes.length,
      nodes: source.nodes.map((node) => derpNodeSummary(node, input.resolutions)),
    });
  }

  return summaries;
}

/**
 * Most regions the collapsed "Local DERP nodes" box lists before it summarises
 * the rest. The box now names its regions while it is closed, so the cap is what
 * keeps a map with dozens of regions from turning one card into a wall.
 */
export const DERP_MAP_REGION_LINE_LIMIT = 6;

/** The regions the collapsed box lists, and how many it left out. */
export interface DerpRegionLines {
  lines: DerpRegionSummary[];
  hidden: number;
}

/**
 * The first `limit` regions for the collapsed box, plus a count of the rest so
 * the card can end with one "+N more" line instead of growing without bound.
 * The order the summaries arrived in is kept, because that is the order the
 * configured maps listed them in.
 */
export function capDerpRegionLines(
  regions: readonly DerpRegionSummary[],
  limit = DERP_MAP_REGION_LINE_LIMIT,
): DerpRegionLines {
  const capped = Math.max(0, Math.trunc(limit));
  return {
    lines: regions.slice(0, capped),
    hidden: Math.max(0, regions.length - capped),
  };
}

// MARK: Headscale configuration

/**
 * `dns.extra_records_path` out of Headscale's parsed `config.yaml`. Headplane
 * keeps its own records file and only points Headscale at a JSON file through
 * this key, so the value doubles as "is an extra-records file in use".
 */
export function readExtraRecordsPath(config: unknown): string | undefined {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return undefined;
  }

  const dns = (config as Record<string, unknown>).dns;
  if (dns === null || typeof dns !== "object" || Array.isArray(dns)) {
    return undefined;
  }

  const path = (dns as Record<string, unknown>).extra_records_path;
  return typeof path === "string" && path.trim().length > 0 ? path.trim() : undefined;
}

// MARK: Availability history

export interface FleetTrendSummary {
  /** Buckets the sampler covered; 0 means there is no history for this window. */
  covered: number;
  /** Buckets in the window, covered or not. */
  total: number;
  /** Most nodes seen online in one covered bucket. */
  peak: number;
}

/**
 * The one-line summary behind the fleet availability card. An uncovered bucket
 * contributes nothing — neither to the coverage count nor to the peak — so a
 * gap in the record can never be read as a fleet that was entirely offline.
 */
export function summarizeFleetTrend(trend: FleetTrend): FleetTrendSummary {
  let covered = 0;
  let peak = 0;

  for (const bucket of trend.buckets) {
    if (!bucket.covered) {
      continue;
    }

    covered += 1;
    if (bucket.online > peak) {
      peak = bucket.online;
    }
  }

  return { covered, total: trend.buckets.length, peak };
}

// MARK: Rendering inputs

export interface OptionalText {
  text?: string;
  reason?: string;
}

/**
 * A value for one dashboard row: the trimmed text when there is something to
 * show, otherwise the caller's short reason for the em dash.
 */
export function textOrReason(value: string | undefined | null, reason: string): OptionalText {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? { text: trimmed } : { reason };
}
