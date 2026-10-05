/**
 * Validation for the DNS servers Headplane may use for relay lookups.
 *
 * Headplane resolves `server_url`'s hostname itself so the relay cards can show
 * the addresses clients would actually reach. A host resolver that filters AAAA
 * records — or forwards only A queries — makes a name look like it has no IPv6
 * address, so the DERP settings let an operator point these lookups at their own
 * DNS servers. The list is Headplane state: it is stored in Headplane's data
 * directory, not in Headscale's config.
 *
 * Kept free of server imports so the DERP form applies the same rules before it
 * submits them, and so `node:dns` never sees an entry it would reject. A port of
 * zero is one of those: Node's c-ares binding aborts the process on it instead
 * of raising an error.
 */

import type { RelayResolution } from "~/server/relay-dns";

import { parseIpv4, parseIpv6 } from "./trusted-proxies";

/** Most servers one lookup may be given; `node:dns` tries them in order. */
export const MAX_RELAY_DNS_SERVERS = 5;

/** Renders eight 16-bit groups in the shortest RFC 5952 form. */
function formatIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;

  for (const [index, group] of groups.entries()) {
    if (group === 0) {
      start = start === -1 ? index : start;
      length++;
      if (length > bestLength) {
        bestLength = length;
        bestStart = start;
      }

      continue;
    }

    start = -1;
    length = 0;
  }

  // RFC 5952 only shortens a run of two or more groups.
  if (bestLength < 2) {
    bestStart = -1;
  }

  const head = groups
    .slice(0, bestStart === -1 ? groups.length : bestStart)
    .map((group) => group.toString(16));
  const tail =
    bestStart === -1 ? [] : groups.slice(bestStart + bestLength).map((group) => group.toString(16));

  return bestStart === -1 ? head.join(":") : `${head.join(":")}::${tail.join(":")}`;
}

/** A port a DNS server can listen on; `undefined` for anything else. */
function parsePort(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value)) {
    return undefined;
  }

  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

/**
 * Canonicalizes one entry the way `resolver.setServers` accepts it and the list
 * stores it: `1.1.1.1`, `1.1.1.1:5353`, `2606:4700:4700::1111` or
 * `[2606:4700:4700::1111]:5353`. Returns `undefined` for anything that is not a
 * literal address with an optional port — a hostname, a CIDR, a malformed
 * bracket or a port outside the valid range.
 */
export function parseRelayDnsServer(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return undefined;
  }

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) {
      return undefined;
    }

    const groups = parseIpv6(trimmed.slice(1, end));
    if (groups === undefined) {
      return undefined;
    }

    const address = formatIpv6(groups);
    const rest = trimmed.slice(end + 1);
    if (rest.length === 0) {
      // Node accepts the bracketed form without a port too; the stored value
      // keeps the bare literal, which says the same thing more simply.
      return address;
    }

    if (!rest.startsWith(":")) {
      return undefined;
    }

    const port = parsePort(rest.slice(1));
    return port === undefined ? undefined : `[${address}]:${port}`;
  }

  const colons = [...trimmed].filter((character) => character === ":").length;
  if (colons > 1) {
    // An embedded IPv4 tail (`::ffff:1.2.3.4`) is the only place a dot belongs in
    // a bare IPv6 literal. A dot before the last colon means a mangled pair such
    // as `1.1.1.1:53:54`, which must not quietly turn into an IPv6 address.
    if (trimmed.includes(".") && trimmed.indexOf(".") < trimmed.lastIndexOf(":")) {
      return undefined;
    }

    const groups = parseIpv6(trimmed);
    return groups === undefined ? undefined : formatIpv6(groups);
  }

  if (colons === 0) {
    const octets = parseIpv4(trimmed);
    return octets === undefined ? undefined : octets.join(".");
  }

  // Exactly one colon: an IPv4 literal with a port. A bare IPv6 literal always
  // has at least two, and one with a port has to be bracketed.
  const [address, port] = trimmed.split(":");
  const octets = parseIpv4(address ?? "");
  const parsed = parsePort(port ?? "");
  return octets === undefined || parsed === undefined ? undefined : `${octets.join(".")}:${parsed}`;
}

/**
 * Cleans a stored or submitted list: every entry that is not a usable server is
 * dropped, duplicates collapse, and the list stops at
 * {@link MAX_RELAY_DNS_SERVERS} so a hand-edited document cannot hand `node:dns`
 * an unbounded server set.
 */
export function normalizeRelayDnsServers(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const servers: string[] = [];
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }

    const server = parseRelayDnsServer(entry);
    if (server === undefined || servers.includes(server)) {
      continue;
    }

    servers.push(server);
    if (servers.length >= MAX_RELAY_DNS_SERVERS) {
      break;
    }
  }

  return servers;
}

/** Why the resource route refused a change; the form maps it onto a message. */
export type RelayDnsErrorCode =
  | "invalidRelayDnsServer"
  | "duplicateRelayDnsServer"
  | "relayDnsServerLimit"
  | "relayDnsServerNotFound"
  | "relayDnsWriteFailed"
  | "invalidAction";

/** The host and port clients dial, derived from Headscale's `server_url`. */
export interface RelayDnsEndpoint {
  host: string;
  port: number;
}

/**
 * What the DERP card renders: the stored list, whether this viewer may change
 * it, and the lookup the relay cards would show.
 */
export interface RelayDnsResourceData {
  canEdit: boolean;
  servers: string[];
  maxServers: number;
  /** Absent when `server_url` names no usable relay host. */
  endpoint?: RelayDnsEndpoint;
  /** Absent only when the resolver itself threw, which the cards treat as "unknown". */
  resolution?: RelayResolution;
}

export type RelayDnsActionResult =
  | ({ ok: true } & RelayDnsResourceData)
  | { ok: false; errorCode: RelayDnsErrorCode };
