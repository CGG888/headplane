/**
 * The rules that decide whether a detected address may be advertised, plus the
 * "write only on change" planner the sync service runs before it touches
 * Headscale's configuration.
 *
 * IPv4 and IPv6 are validated differently on purpose. A DNS A answer is the
 * only source for IPv4 behind NAT, and a resolver will happily hand back a
 * private, loopback or carrier-grade-NAT address (a split-horizon zone, a
 * misconfigured DDNS client, a hijacked name), so each answer is classified and
 * only a genuinely public one is accepted. IPv6 has no NAT, so the machine's
 * own global unicast address is the source and the classification is exactly
 * the one the relay card already uses — there is only one implementation of it,
 * in `app/server/host-addresses.ts`.
 *
 * Everything here is pure: no clock, no filesystem, no network, so the rules
 * and the planner can be unit tested directly.
 */

import { parseIpv4, parseIpv6 } from "~/routes/settings/headscale/trusted-proxies";
import { classifyIpv6Address } from "~/server/host-addresses";

import type {
  DerpSyncCandidate,
  DerpSyncCandidateReason,
  DerpSyncFamily,
  DerpSyncSource,
  DerpSyncValue,
} from "./types";

// MARK: IPv4

/** What an IPv4 address is, from the point of view of "can clients reach it". */
export type DerpSyncIpv4Kind =
  | "public"
  | "private"
  | "loopback"
  | "link-local"
  | "cgnat"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "documentation"
  | "invalid";

/**
 * Classifies an IPv4 address. The ranges Headscale's relay must never advertise
 * are named individually rather than lumped into "not public", so a skipped run
 * can say which rule rejected the value.
 */
export function classifySyncIpv4(value: string): DerpSyncIpv4Kind {
  const octets = parseIpv4(value.trim());
  if (octets === undefined) {
    return "invalid";
  }

  const [a, b, c, d] = octets;

  if (a === 0) {
    return "unspecified";
  }

  if (a === 10) {
    return "private";
  }

  if (a === 127) {
    return "loopback";
  }

  // 169.254.0.0/16 is what an interface falls back to when DHCP never answered.
  if (a === 169 && b === 254) {
    return "link-local";
  }

  if (a === 172 && b >= 16 && b <= 31) {
    return "private";
  }

  if (a === 192 && b === 168) {
    return "private";
  }

  // 100.64.0.0/10 is the range ISPs and Tailscale itself use behind CGNAT.
  if (a === 100 && b >= 64 && b <= 127) {
    return "cgnat";
  }

  // 192.0.0.0/24 is IETF protocol assignment, not a host address.
  if (a === 192 && b === 0 && c === 0) {
    return "reserved";
  }

  // The three TEST-NET blocks, which documentations and examples use.
  if (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return "documentation";
  }

  // 198.18.0.0/15 is reserved for benchmarking.
  if (a === 198 && (b === 18 || b === 19)) {
    return "reserved";
  }

  if (a === 255 && b === 255 && c === 255 && d === 255) {
    return "reserved";
  }

  // 224.0.0.0/4 is multicast and 240.0.0.0/4 is reserved for future use.
  if (a >= 224) {
    return a >= 240 ? "reserved" : "multicast";
  }

  return "public";
}

/** True when the address is one a client anywhere could route to. */
export function isPublicSyncIpv4(value: string): boolean {
  return classifySyncIpv4(value) === "public";
}

/**
 * The first usable public answer in a DNS reply. A hostname often has several A
 * records, and one private address in the set does not invalidate the others.
 */
export function pickPublicSyncIpv4(values: readonly string[]): string | undefined {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && isPublicSyncIpv4(trimmed)) {
      return trimmed;
    }
  }

  return undefined;
}

// MARK: IPv6

/**
 * True when the address is global unicast (`2000::/3`). Delegates to the relay
 * card's classifier so link-local, ULA, loopback, multicast, unspecified and
 * IPv4-mapped addresses are rejected by exactly one implementation.
 */
export function isPublicSyncIpv6(value: string): boolean {
  return classifyIpv6Address(value.trim()) === "global";
}

// MARK: Comparison

function canonicalSyncIpv4(value: string): string | undefined {
  const octets = parseIpv4(value.trim());
  return octets === undefined ? undefined : octets.join(".");
}

/** Expands eight groups to four hex digits, so two spellings compare equal. */
function canonicalSyncIpv6(value: string): string | undefined {
  const address = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const groups = parseIpv6(address);
  return groups === undefined
    ? undefined
    : groups.map((group) => group.toString(16).padStart(4, "0")).join(":");
}

/** A comparable spelling of one address; malformed values fall back to text. */
export function canonicalSyncAddress(family: DerpSyncFamily, value: string): string {
  const canonical = family === "ipv4" ? canonicalSyncIpv4(value) : canonicalSyncIpv6(value);
  return canonical ?? value.trim().toLowerCase();
}

/** The configured address and the detected one are the same address. */
export function syncAddressesMatch(family: DerpSyncFamily, a: string, b: string): boolean {
  return canonicalSyncAddress(family, a) === canonicalSyncAddress(family, b);
}

// MARK: Candidates
//
// The settings card shows the whole decision, not just its outcome, so every
// detection reports the answers it considered. These builders turn the raw
// answers into panel rows: the chosen one, the usable alternates that ranked
// below it, and the answers a rule rejected.

/** One IPv4 answer a detection considered, before it is ranked. */
export interface DerpSyncIpv4CandidateInput {
  address: string;
  /** A DNS answer or a literal address in `server_url`. */
  source: DerpSyncSource;
}

/** Panel rows for the IPv4 answers a detection saw. */
export function buildIpv4Candidates(
  inputs: readonly DerpSyncIpv4CandidateInput[],
  chosen: string | undefined,
): DerpSyncCandidate[] {
  return inputs.map((input) => {
    const address = input.address.trim();
    const selected = chosen !== undefined && syncAddressesMatch("ipv4", address, chosen);
    const kind = classifySyncIpv4(address);
    const publicAddress = kind === "public";

    return {
      family: "ipv4",
      address,
      source: input.source,
      chosen: selected,
      reason: selected ? "selected" : publicAddress ? "ranked-lower" : "not-public",
      ...(publicAddress ? {} : { detail: kind }),
    } satisfies DerpSyncCandidate;
  });
}

/** One address read from a host interface, as the IPv6 detection saw it. */
export interface DerpSyncIpv6CandidateInput {
  address: string;
  interfaceName: string;
  /** The kernel marks it as a rotating RFC 4941 privacy address. */
  temporary: boolean;
}

/**
 * Panel rows for the host's own IPv6 addresses.
 *
 * `echoApplied` says the external echo answer won, which is why none of these
 * was chosen; a temporary candidate then reads as overridden rather than as
 * merely outranked.
 */
export function buildIpv6HostCandidates(
  inputs: readonly DerpSyncIpv6CandidateInput[],
  chosen: string | undefined,
  echoApplied: boolean,
): DerpSyncCandidate[] {
  return inputs.map((input) => {
    const address = input.address.trim();
    const selected = chosen !== undefined && syncAddressesMatch("ipv6", address, chosen);
    const reason: DerpSyncCandidateReason = selected
      ? "selected"
      : echoApplied
        ? "echo-wins"
        : input.temporary
          ? "temporary"
          : "ranked-lower";

    return {
      family: "ipv6",
      address,
      source: "host",
      chosen: selected,
      reason,
      ...(input.temporary ? { temporary: true } : {}),
      ...(input.interfaceName.length > 0 ? { interfaceName: input.interfaceName } : {}),
    } satisfies DerpSyncCandidate;
  });
}

/**
 * Panel rows for the addresses the host probe saw and excluded. They are shown
 * rather than hidden, so "this machine has an address but it is a ULA" is
 * visible instead of looking like a machine with no IPv6 at all.
 */
export function buildIpv6ExcludedCandidates(
  excluded: readonly { address: string; interfaceName: string; kind: string }[],
): DerpSyncCandidate[] {
  return excluded.map((entry) => ({
    family: "ipv6",
    address: entry.address.trim(),
    source: "host",
    chosen: false,
    reason: "excluded",
    ...(entry.interfaceName.length > 0 ? { interfaceName: entry.interfaceName } : {}),
    detail: entry.kind,
  }));
}

// MARK: Server URL

/**
 * The hostname `server_url` names, without a port. A bracketed IPv6 literal is
 * returned bracketed, and anything that cannot be read as an http(s) URL yields
 * `undefined` so the caller can record why IPv4 was skipped.
 */
export function relayHostnameFromServerUrl(serverUrl: string | undefined): string | undefined {
  const trimmed = (serverUrl ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.hostname.length > 0 ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The usable IPv4 answer of a `server_url` host. A literal address needs no
 * lookup, so it is its own answer; a bracketless hostname is resolved by the
 * caller. `undefined` means "not an IPv4 host" rather than "no address".
 */
export function literalSyncIpv4(host: string | undefined): string | undefined {
  // A bracketed IPv6 literal arrives that way from `server_url`; the brackets
  // are URL syntax rather than part of the address, so they come off before the
  // literal check decides whether this is an IPv4 host at all.
  const trimmed = (host ?? "").trim().replace(/^\[|\]$/g, "");
  if (trimmed.length === 0 || trimmed.includes(":")) {
    return undefined;
  }

  return parseIpv4(trimmed) === undefined ? undefined : trimmed;
}

/**
 * True when the host is an address literal rather than a name to look up. The
 * IPv4 detection uses it to keep a literal away from the resolver: an IPv6
 * literal has no A record to read, and handing a bracketed value to a resolver
 * would produce a lookup failure that never happened.
 */
export function isIpLiteralHost(host: string | undefined): boolean {
  const trimmed = (host ?? "").trim().replace(/^\[|\]$/g, "");
  return trimmed.length > 0 && (trimmed.includes(":") || parseIpv4(trimmed) !== undefined);
}

// MARK: Plan

/** The two values `derp.server` currently declares; empty means "unset". */
export interface DerpSyncCurrent {
  ipv4: string;
  ipv6: string;
}

export interface DerpSyncPatch {
  path: string;
  value: string;
}

export interface DerpSyncPlan {
  /** The config keys to write, one per family whose value actually differs. */
  patches: DerpSyncPatch[];
  changes: Array<{ family: DerpSyncFamily; from?: string; to: string }>;
  /** Families whose detected address already matches the configuration. */
  unchanged: DerpSyncFamily[];
}

/** The config key each family writes through the Headscale config helper. */
export function derpSyncConfigPath(family: DerpSyncFamily): string {
  return `derp.server.${family}`;
}

/**
 * Decides what a run would write. A family is only patched when the detected
 * address differs from the configured one — comparing spellings, so
 * `2001:DB8::1` does not rewrite `2001:db8::1`. A family with nothing detected
 * is left exactly as it is.
 */
export function planDerpSync(
  current: DerpSyncCurrent,
  detected: Partial<Record<DerpSyncFamily, DerpSyncValue>>,
): DerpSyncPlan {
  const plan: DerpSyncPlan = { patches: [], changes: [], unchanged: [] };

  for (const family of ["ipv4", "ipv6"] as const) {
    const next = detected[family];
    if (next === undefined) {
      continue;
    }

    const existing = (current[family] ?? "").trim();
    if (existing.length > 0 && syncAddressesMatch(family, existing, next.address)) {
      plan.unchanged.push(family);
      continue;
    }

    plan.changes.push({
      family,
      ...(existing.length > 0 ? { from: existing } : {}),
      to: next.address,
    });
    plan.patches.push({ path: derpSyncConfigPath(family), value: next.address });
  }

  return plan;
}
