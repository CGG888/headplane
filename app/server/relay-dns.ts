/**
 * What clients actually reach when they dial Headscale's relay endpoint.
 *
 * Headscale's `server_url` names the host clients use for the embedded DERP
 * server, but the addresses they connect to are whatever that name resolves to
 * — not the `derp.server.ipv4`/`ipv6` values the configuration declares. This
 * module resolves the name's A and AAAA records so both DERP cards can show the
 * real answer next to the declared one.
 *
 * Nothing here may fail a page. Every lookup is cached for a few minutes, runs
 * under a short deadline, and turns NXDOMAIN, a missing record, a timeout and a
 * resolver error into a result carrying a reason. A bracketed IPv6 literal is
 * returned as-is because there is nothing to look up.
 */

import { resolve4, resolve6 } from "node:dns/promises";

import log from "~/utils/log";

/** How long a resolved hostname stays in the cache before it is looked up again. */
export const RELAY_DNS_CACHE_TTL_MS = 5 * 60 * 1000;

/** How long the A and AAAA lookups may take before they report a timeout. */
export const RELAY_DNS_TIMEOUT_MS = 2_000;

/** Most addresses shown per family; a wild record set stays readable. */
export const RELAY_DNS_MAX_ADDRESSES = 8;

export type RelayAddressFamily = "ipv4" | "ipv6";

/** Why a family has no address, or no answer at all. Rendered as a reason. */
export type RelayResolutionReason =
  | "no-records"
  | "timeout"
  | "resolver-error"
  | "host-missing"
  | "invalid-host";

export interface RelayResolutionDetail {
  /** True when a lookup answered but returned nothing for that family. */
  ipv4Empty?: boolean;
  /** True when a lookup answered but returned nothing for that family. */
  ipv6Empty?: boolean;
  /** True when a lookup did not finish inside the deadline. */
  timedOut?: boolean;
  /** True when a lookup failed for a reason other than a missing record. */
  failed?: boolean;
}

export interface RelayResolution {
  /** Hostname (lowercased) or bracketed IPv6 literal whose answer this is. */
  host: string;
  kind: "literal" | "hostname";
  ipv4: string[];
  ipv6: string[];
  reason?: RelayResolutionReason;
  detail?: RelayResolutionDetail;
}

/** Every dependency of the resolver, so tests can supply their own. */
export interface RelayResolverDeps {
  resolve4: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  resolve6: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  cacheTtlMs: number;
  timeoutMs: number;
  now: () => number;
  setTimer: (handler: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface RelayResolverOptions {
  cacheTtlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Injected DNS entry points; default to `node:dns/promises`. */
  resolve4?: (hostname: string, signal: AbortSignal) => Promise<string[]>;
  resolve6?: (hostname: string, signal: AbortSignal) => Promise<string[]>;
}

export interface RelayResolver {
  resolve(host: string | undefined): Promise<RelayResolution>;
  clearCache(): void;
}

// A literal can never need a lookup, so it is shared: the cache holds hostname
// answers only, which keeps its size bounded by the names actually configured.
const LITERAL_RESOLUTION: RelayResolution = Object.freeze({
  host: "",
  kind: "literal",
  ipv4: [],
  ipv6: [],
});

function isBracketedIpv6(host: string): boolean {
  const match = /^\[([^\]]+)\]$/.exec(host);
  return match !== null && match[1].includes(":");
}

/**
 * A bracketed IPv6 literal, a bare IPv6 literal or a name to look up. Whatever
 * cannot be a hostname (empty, whitespace, a colon without brackets, a
 * bracketed value that is not an address) is reported as invalid rather than
 * handed to a resolver that would only fail.
 */
export function classifyRelayHost(host: string | undefined): {
  kind: "literal" | "hostname" | "invalid";
  host: string;
} {
  const trimmed = (host ?? "").trim();
  if (trimmed.length === 0) {
    return { kind: "invalid", host: trimmed };
  }

  if (isBracketedIpv6(trimmed)) {
    return { kind: "literal", host: trimmed };
  }

  // A malformed bracketed value, or a colon outside brackets, can only be a
  // mangled address: DNS would reject it, so the card says so instead.
  if (trimmed.includes(":") || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return { kind: "invalid", host: trimmed };
  }

  if (trimmed.includes(" ") || trimmed.includes("\t")) {
    return { kind: "invalid", host: trimmed };
  }

  return { kind: "hostname", host: trimmed.toLowerCase() };
}

function addressesOf(list: string[] | undefined): string[] | undefined {
  if (!Array.isArray(list) || list.length === 0) {
    return undefined;
  }

  return list
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, RELAY_DNS_MAX_ADDRESSES);
}

function isTimeoutError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code === "ETIMEDOUT" || code === "ETIMEOUT" || code === "EAI_AGAIN";
}

function isNoRecordsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === "ENOTFOUND" || code === "ENODATA" || code === "NODATA") {
    return true;
  }

  // Node reports "no records of the requested type" with a message instead of
  // a code in some resolver implementations.
  const message = error instanceof Error ? error.message : "";
  return message.includes("ENODATA") || message.includes("no records");
}

interface FamilyAnswer {
  addresses: string[];
  /** True when the lookup answered with at least one address. */
  resolved: boolean;
  timedOut: boolean;
  failed: boolean;
}

async function resolveFamily(
  deps: RelayResolverDeps,
  lookup: (hostname: string, signal: AbortSignal) => Promise<string[]>,
  hostname: string,
): Promise<FamilyAnswer> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = deps.setTimer(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs);

  try {
    const list = addressesOf(await lookup(hostname, controller.signal)) ?? [];
    return { addresses: list, resolved: list.length > 0, timedOut, failed: false };
  } catch (error) {
    // A missing record is a normal answer, not a failure; a timeout is its own
    // outcome so the card can say the lookup may simply need another try.
    if (!timedOut && isNoRecordsError(error)) {
      return { addresses: [], resolved: false, timedOut: false, failed: false };
    }

    return {
      addresses: [],
      resolved: false,
      timedOut: timedOut || isTimeoutError(error),
      failed: !timedOut && !isTimeoutError(error),
    };
  } finally {
    deps.clearTimer(timer);
  }
}

function reasonFromDetail(detail: RelayResolutionDetail): RelayResolutionReason {
  if (detail.timedOut) {
    return "timeout";
  }

  if (detail.failed) {
    return "resolver-error";
  }

  return "no-records";
}

/**
 * Builds a resolver with its own in-memory cache. The cache is keyed by
 * hostname, holds successful and empty answers for a few minutes, and coalesces
 * lookups that arrive at the same time so one page render asks DNS twice at
 * most — once per family, not once per card.
 */
export function createRelayResolver(options: RelayResolverOptions = {}): RelayResolver {
  const deps: RelayResolverDeps = {
    resolve4: options.resolve4 ?? resolve4,
    resolve6: options.resolve6 ?? resolve6,
    cacheTtlMs: options.cacheTtlMs ?? RELAY_DNS_CACHE_TTL_MS,
    timeoutMs: options.timeoutMs ?? RELAY_DNS_TIMEOUT_MS,
    now: options.now ?? Date.now,
    setTimer:
      options.setTimer ??
      ((handler, ms) => {
        const timer = setTimeout(handler, ms);
        timer.unref?.();
        return timer;
      }),
    clearTimer: options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout)),
  };

  const cache = new Map<string, { expiresAt: number; value: RelayResolution }>();
  const inFlight = new Map<string, Promise<RelayResolution>>();

  async function lookup(host: string): Promise<RelayResolution> {
    const [ipv4, ipv6] = await Promise.all([
      resolveFamily(deps, deps.resolve4, host),
      resolveFamily(deps, deps.resolve6, host),
    ]);

    const resolution: RelayResolution = {
      host,
      kind: "hostname",
      ipv4: ipv4.addresses,
      ipv6: ipv6.addresses,
    };

    if (ipv4.addresses.length > 0 || ipv6.addresses.length > 0) {
      // At least one family answered: a partial answer is still an answer, so
      // the card shows it without a reason and only the missing family is empty.
      cache.set(host, { expiresAt: deps.now() + deps.cacheTtlMs, value: resolution });
      return resolution;
    }

    const detail: RelayResolutionDetail = {
      ipv4Empty: !ipv4.resolved,
      ipv6Empty: !ipv6.resolved,
      timedOut: ipv4.timedOut || ipv6.timedOut,
      failed: ipv4.failed || ipv6.failed,
    };
    resolution.reason = reasonFromDetail(detail);
    resolution.detail = detail;

    if (!detail.timedOut && !detail.failed) {
      // A name with no records today can gain some, but the negative answer is
      // cached for the same short window so a broken name cannot be hammered.
      cache.set(host, { expiresAt: deps.now() + deps.cacheTtlMs, value: resolution });
    }

    return resolution;
  }

  return {
    async resolve(host: string | undefined): Promise<RelayResolution> {
      const classified = classifyRelayHost(host);
      if (classified.kind === "invalid") {
        return {
          ...LITERAL_RESOLUTION,
          host: classified.host,
          reason: classified.host.length === 0 ? "host-missing" : "invalid-host",
        };
      }

      if (classified.kind === "literal") {
        return { ...LITERAL_RESOLUTION, host: classified.host };
      }

      const hostname = classified.host;
      const cached = cache.get(hostname);
      if (cached !== undefined && cached.expiresAt > deps.now()) {
        log.debug("server", `Relay DNS cache hit for ${hostname}`);
        return cached.value;
      }

      if (cached !== undefined) {
        cache.delete(hostname);
      }

      const pending = inFlight.get(hostname);
      if (pending !== undefined) {
        log.debug("server", `Relay DNS lookup already running for ${hostname}, reusing it`);
        return pending;
      }

      log.debug("server", `Resolving relay endpoint ${hostname} (A and AAAA)`);
      const started = lookup(hostname);
      inFlight.set(hostname, started);
      try {
        return await started;
      } finally {
        if (inFlight.get(hostname) === started) {
          inFlight.delete(hostname);
        }
      }
    },
    clearCache() {
      cache.clear();
    },
  };
}

// MARK: View

export interface RelayHostView {
  /** Hostname as written in `server_url`, brackets kept on an IPv6 literal. */
  hostname: string;
  /** The port clients dial, derived from `server_url`. */
  port: number;
  /** `host:port`, exactly how clients address the relay. */
  endpoint: string;
}

export interface RelayAddressRow {
  family: RelayAddressFamily;
  addresses: string[];
}

export interface RelayAddressView {
  rows: RelayAddressRow[];
  reason?: RelayResolutionReason;
  /** Per-family detail behind `reason`; useful for an operator-facing tooltip. */
  detail?: RelayResolutionDetail;
}

export interface RelayView {
  host?: RelayHostView;
  /** Present when `server_url` could not be read at all. */
  endpointReason?: "host-missing" | "invalid-host";
  address?: RelayAddressView;
}

export interface RelayEndpoint {
  host: string;
  port: number;
}

/**
 * The rows the cards render: the endpoint, then one row per family that has an
 * address. An empty family carries the resolver's reason so the page never
 * prints a bare "not resolved" without saying why.
 */
export function buildRelayView(
  endpoint: RelayEndpoint | undefined,
  resolution: RelayResolution | undefined,
): RelayView {
  if (endpoint === undefined) {
    return { endpointReason: "invalid-host" };
  }

  if (endpoint.host.trim().length === 0) {
    return { endpointReason: "host-missing" };
  }

  const host: RelayHostView = {
    hostname: endpoint.host,
    port: endpoint.port,
    endpoint: `${endpoint.host}:${endpoint.port}`,
  };

  if (resolution === undefined) {
    return { host };
  }

  const rows: RelayAddressRow[] = [];
  if (resolution.ipv4.length > 0) {
    rows.push({ family: "ipv4", addresses: resolution.ipv4 });
  }
  if (resolution.ipv6.length > 0) {
    rows.push({ family: "ipv6", addresses: resolution.ipv6 });
  }

  return {
    host,
    address: {
      rows,
      reason: resolution.reason,
      detail: resolution.detail,
    },
  };
}

/**
 * Resolves a relay host and never throws: a card that cannot reach DNS loses
 * its resolved rows, never the page. Callers pass the resolver they built so a
 * request reuses one cache.
 */
export async function loadRelayResolution(
  resolver: RelayResolver,
  host: string | undefined,
): Promise<RelayResolution | undefined> {
  try {
    return await resolver.resolve(host);
  } catch {
    return undefined;
  }
}

/** One process-wide cache, so both DERP cards share the same lookups. */
const sharedResolver = createRelayResolver();

/**
 * Resolves the relay host of one page load against the shared cache. Never
 * throws: `undefined` means the card shows no resolved addresses at all.
 */
export function loadSharedRelayResolution(
  host: string | undefined,
): Promise<RelayResolution | undefined> {
  return loadRelayResolution(sharedResolver, host);
}
