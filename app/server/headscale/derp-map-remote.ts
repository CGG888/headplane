/**
 * The remote DERP maps Headscale merges from `derp.urls`, read for their region
 * names.
 *
 * Headscale fetches those maps itself and never exposes the merged result, so
 * Headplane reads the same URLs to learn which region id belongs to which code
 * and name. Nothing here may fail a page: a timeout, a non-200 answer, a body
 * that is not a DERP map and a body larger than the editor's cap all resolve to
 * "no regions", are logged once at debug level, and are cached for a short
 * window so an unreachable URL cannot be dialled on every render.
 *
 * A successful answer is cached for a few hours. `derp.auto_update_enabled`
 * and `derp.update_frequency` only say how often Headscale re-reads the map, so
 * they are used as the cache window when they are set, clamped to something that
 * makes sense for a page: never shorter than a few minutes, never longer than
 * the default.
 */

import { MAX_DERP_MAP_BYTES } from "~/routes/settings/headscale/derp-map-limits";
import {
  readDerpMapRegions,
  type DerpMapRegionEntry,
} from "~/routes/settings/headscale/derp-map-schema";
import { parseDerpUpdateFrequencySeconds } from "~/routes/settings/headscale/derp-settings";
import log from "~/utils/log";

import { readDerpMapNodes, type DerpMapRegionDetail } from "./derp-map-nodes";

/** How long one URL may take before its map is treated as unreachable. */
export const DERP_MAP_FETCH_TIMEOUT_MS = 3_000;

/** How long a fetched map is reused; the maps change rarely. */
export const DERP_MAP_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;

/** How long a failed fetch is remembered, so a broken URL is retried rarely. */
export const DERP_MAP_FAILURE_TTL_MS = 5 * 60 * 1000;

/** Floor for a cache window derived from `derp.update_frequency`. */
export const DERP_MAP_MIN_TTL_MS = 5 * 60 * 1000;

/** Ceiling for a cache window derived from `derp.update_frequency`. */
export const DERP_MAP_MAX_TTL_MS = DERP_MAP_SUCCESS_TTL_MS;

/** The `derp.*` settings that decide how long a fetched map stays valid. */
export interface DerpMapCacheSettings {
  /** `derp.auto_update_enabled`: whether Headscale re-reads the map at all. */
  autoUpdateEnabled: boolean;
  /** `derp.update_frequency`, a Go duration such as `3h`. */
  updateFrequency: string;
}

/**
 * How long a successful fetch may be reused. Without Headscale's background
 * refresh the map is read once at startup, so the long default applies; with it,
 * the configured frequency is honoured as long as it stays inside a range that
 * is sensible for a cached page lookup.
 */
export function remoteDerpMapTtlMs(settings: DerpMapCacheSettings): number {
  if (!settings.autoUpdateEnabled) {
    return DERP_MAP_SUCCESS_TTL_MS;
  }

  const seconds = parseDerpUpdateFrequencySeconds(settings.updateFrequency);
  if (seconds === undefined) {
    return DERP_MAP_SUCCESS_TTL_MS;
  }

  return Math.min(Math.max(seconds * 1000, DERP_MAP_MIN_TTL_MS), DERP_MAP_MAX_TTL_MS);
}

/** The part of a `fetch` answer this module reads. */
export interface DerpMapResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/** `fetch`, narrowed to what a DERP map download needs. */
export type DerpMapFetch = (url: string, init: { signal: AbortSignal }) => Promise<DerpMapResponse>;

export interface RemoteDerpMapOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: DerpMapFetch;
  timeoutMs?: number;
  now?: () => number;
  /** Overrides the success window for tests and callers with their own policy. */
  ttlMs?: number;
  failureTtlMs?: number;
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface CacheEntry {
  /** The parsed regions, or undefined when the last attempt failed. */
  regions: DerpMapRegionDetail[] | undefined;
  expiresAt: number;
}

/** One process-wide cache: both DERP cards and the Overview share the fetches. */
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DerpMapRegionDetail[] | undefined>>();

/** Drops every cached answer, so the next lookup dials the URL again. */
export function clearRemoteDerpMapCache(): void {
  cache.clear();
}

interface ResolvedOptions {
  fetch: DerpMapFetch;
  timeoutMs: number;
  now: () => number;
  ttlMs: number;
  failureTtlMs: number;
  setTimer: (handler: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

function resolveOptions(
  settings: DerpMapCacheSettings,
  options: RemoteDerpMapOptions,
): ResolvedOptions {
  return {
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    timeoutMs: options.timeoutMs ?? DERP_MAP_FETCH_TIMEOUT_MS,
    now: options.now ?? Date.now,
    ttlMs: options.ttlMs ?? remoteDerpMapTtlMs(settings),
    failureTtlMs: options.failureTtlMs ?? DERP_MAP_FAILURE_TTL_MS,
    setTimer:
      options.setTimer ??
      ((handler, ms) => {
        const timer = setTimeout(handler, ms);
        timer.unref?.();
        return timer;
      }),
    clearTimer: options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout)),
  };
}

/**
 * Downloads one map under a short deadline and parses its regions with the
 * nodes they list. Every failure — a rejected fetch, a timeout, a non-200
 * status, an oversized or unparsable body, a map with no usable regions —
 * resolves to `undefined` instead of throwing.
 */
async function downloadDerpMap(
  url: string,
  deps: ResolvedOptions,
): Promise<DerpMapRegionDetail[] | undefined> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = deps.setTimer(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs);

  try {
    const response = await deps.fetch(url, { signal: controller.signal });
    if (!response.ok) {
      log.debug("config", `DERP map ${url} answered with status ${response.status}`);
      return undefined;
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_DERP_MAP_BYTES) {
      log.debug("config", `DERP map ${url} is larger than the supported size`);
      return undefined;
    }

    // Regions and their names come from the shared reader; the nodes come from
    // the second, read-only pass that reader deliberately does not make.
    const regions = readDerpMapRegions(body);
    const nodes = readDerpMapNodes(body);
    if (!nodes.ok || regions.length === 0) {
      log.debug("config", `DERP map ${url} describes no regions`);
      return undefined;
    }

    return regions.map((entry) => ({ ...entry, nodes: nodes.nodes.get(entry.regionId) ?? [] }));
  } catch (error) {
    // A timeout aborts the request, so it lands here as well; the flag keeps
    // the log line honest about which of the two happened.
    log.debug(
      "config",
      `Unable to read the DERP map at ${url}${timedOut ? " (timed out)" : ""}: ${String(error)}`,
    );
    return undefined;
  } finally {
    deps.clearTimer(timer);
  }
}

/**
 * The regions of one remote map with the nodes they list, cached in-process.
 * Concurrent callers for the same URL share a single request, and a failure is
 * remembered only briefly so a transient network problem does not hide the
 * names for hours.
 *
 * The returned objects are the cache's own values: callers must treat them as
 * read-only. {@link loadRemoteDerpMap} is the same answer without the nodes.
 */
export async function loadRemoteDerpMapDetail(
  url: string,
  settings: DerpMapCacheSettings,
  options: RemoteDerpMapOptions = {},
): Promise<DerpMapRegionDetail[] | undefined> {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const deps = resolveOptions(settings, options);
  const cached = cache.get(trimmed);
  if (cached !== undefined && cached.expiresAt > deps.now()) {
    return cached.regions;
  }

  if (cached !== undefined) {
    cache.delete(trimmed);
  }

  const pending = inFlight.get(trimmed);
  if (pending !== undefined) {
    return pending;
  }

  const started = (async () => {
    const regions = await downloadDerpMap(trimmed, deps);
    cache.set(trimmed, {
      regions,
      expiresAt: deps.now() + (regions === undefined ? deps.failureTtlMs : deps.ttlMs),
    });
    return regions;
  })();

  inFlight.set(trimmed, started);
  try {
    return await started;
  } finally {
    if (inFlight.get(trimmed) === started) {
      inFlight.delete(trimmed);
    }
  }
}

/**
 * The regions of one remote map, without the nodes. The region-name chain and
 * the machine page only need the id, code and name, so they take the narrow
 * answer; both go through the same cache as {@link loadRemoteDerpMapDetail}, so
 * one URL is dialled once per cache window no matter how many callers ask.
 */
export async function loadRemoteDerpMap(
  url: string,
  settings: DerpMapCacheSettings,
  options: RemoteDerpMapOptions = {},
): Promise<DerpMapRegionEntry[] | undefined> {
  const regions = await loadRemoteDerpMapDetail(url, settings, options);
  return regions?.map(({ regionId, code, name }) => ({ regionId, code, name }));
}
