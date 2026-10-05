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
