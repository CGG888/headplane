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

/**
 * The `host:port` clients dial for the embedded DERP server, derived from
 * Headscale's `server_url` (DERP shares Headscale's HTTPS endpoint). IPv6
 * literals keep their brackets. `undefined` when `server_url` cannot be read.
 */
export function derpEndpointSummary(serverUrl: string | undefined): string | undefined {
  const endpoint = deriveDerpPublicEndpoint(serverUrl);
  return endpoint ? formatDerpPublicEndpoint(endpoint) : undefined;
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
