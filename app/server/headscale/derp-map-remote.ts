/**
 * The remote DERP maps Headscale merges from `derp.urls`, read for their region
 * names.
 *
 * Headscale fetches those maps itself and never exposes the merged result, so
 * Headplane reads the same URLs to learn which region id belongs to which code
 * and name. Two spellings of the format arrive here: Headscale's local map files
 * (`regions`, `regionid`) and the wire map Tailscale serves at
 * `https://controlplane.tailscale.com/derpmap/default` (`Regions`, `RegionID`),
 * which the shared readers in `~/routes/settings/headscale/derp-map-schema` and
 * `./derp-map-nodes` both understand. Nothing here may fail a page: a timeout, a
 * non-200 answer, a body that is not a DERP map and a body larger than the
 * editor's cap all resolve to "no regions", are logged once at debug level, and
 * are cached for a short window so an unreachable URL cannot be dialled on every
 * render. The read also answers *why* it found nothing, as the stable code
 * {@link RemoteDerpMapFailure} that {@link loadRemoteDerpMapOutcome} returns and
 * the Region mirror tab localizes; {@link loadRemoteDerpMapDetail} keeps the
 * narrower "regions or undefined" answer the existing callers use.
 *
 * One URL is given a generous deadline — the official map is served over the
 * public internet — and a transport failure is retried once before it is
 * remembered, so a single slow or dropped connection does not hide the map for
 * the failure window.
 *
 * A successful answer is cached for a few hours. `derp.auto_update_enabled`
 * and `derp.update_frequency` only say how often Headscale re-reads the map, so
 * they are used as the cache window when they are set, clamped to something that
 * makes sense for a page: never shorter than a few minutes, never longer than
 * the default.
 */

import { MAX_DERP_MAP_BYTES } from "~/routes/settings/headscale/derp-map-limits";
import {
  readAnyDerpMapRegions,
  type DerpMapRegionEntry,
} from "~/routes/settings/headscale/derp-map-schema";
import { parseDerpUpdateFrequencySeconds } from "~/routes/settings/headscale/derp-settings";
import log from "~/utils/log";

import { readAnyDerpMapNodes, type DerpMapRegionDetail } from "./derp-map-nodes";

/** How long one URL may take before its map is treated as unreachable. */
export const DERP_MAP_FETCH_TIMEOUT_MS = 10_000;

/**
 * How many times a transport failure is retried before the map is given up on.
 * A refusal or a timeout is usually transient; an answered status or a body that
 * is not a map is the server's answer and is never dialled again.
 */
export const DERP_MAP_FETCH_RETRIES = 1;

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
  /**
   * The streaming halves of a real `fetch` answer. They are optional so a
   * caller can hand in a plain `{ ok, status, text }` stub; when they are
   * missing the body is read whole and measured afterwards instead.
   */
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
}

/** `fetch`, narrowed to what a DERP map download needs. */
export type DerpMapFetch = (url: string, init: { signal: AbortSignal }) => Promise<DerpMapResponse>;

/**
 * Why a remote map could not be read, as a stable code. The UI localizes it, so
 * no message text crosses this boundary: `timeout` and `network` are transport
 * failures (and the only two that are retried), `status` is a non-2xx answer,
 * `too-large` is a body over the editor's cap, and `unreadable` is a body that
 * is not a DERP map with any usable region.
 */
export type RemoteDerpMapFailure = "timeout" | "network" | "status" | "too-large" | "unreadable";

/** One URL's answer: the regions when it could be read, otherwise why not. */
export interface RemoteDerpMapOutcome {
  regions?: DerpMapRegionDetail[];
  reason?: RemoteDerpMapFailure;
}

export interface RemoteDerpMapOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: DerpMapFetch;
  timeoutMs?: number;
  /** Extra attempts after a transport failure; defaults to one. */
  retries?: number;
  now?: () => number;
  /** Overrides the success window for tests and callers with their own policy. */
  ttlMs?: number;
  failureTtlMs?: number;
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface CacheEntry {
  /** The last answer, with the regions absent and a reason set when it failed. */
  outcome: RemoteDerpMapOutcome;
  expiresAt: number;
}

/**
 * The most URLs one process keeps answers for. The keys are operator-supplied
 * URLs and a removed one would otherwise stay in the map forever; entries beyond
 * the cap are evicted least-recently-used first.
 */
const DERP_MAP_CACHE_MAX_ENTRIES = 200;

/** One process-wide cache: both DERP cards and the Overview share the fetches. */
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RemoteDerpMapOutcome>>();

/** Inserts an answer, refreshing its recency and evicting the oldest beyond the cap. */
function rememberOutcome(url: string, entry: CacheEntry): void {
  cache.delete(url);
  cache.set(url, entry);

  while (cache.size > DERP_MAP_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }

    cache.delete(oldest);
  }
}

/** Drops every cached answer, so the next lookup dials the URL again. */
export function clearRemoteDerpMapCache(): void {
  cache.clear();
}

interface ResolvedOptions {
  fetch: DerpMapFetch;
  timeoutMs: number;
  retries: number;
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
    retries: Math.max(0, options.retries ?? DERP_MAP_FETCH_RETRIES),
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
 * Reads a response body as text without buffering much more than `limit` bytes.
 *
 * `Content-Length` is checked first because it costs nothing, but it is only a
 * hint: a chunked response, or one whose header understates the body, is cut off
 * mid-stream instead of being materialized and measured afterwards. Returns
 * `null` when the body is over the limit.
 */
async function readBodyWithin(response: DerpMapResponse, limit: number): Promise<string | null> {
  const declared = response.headers?.get("content-length") ?? null;
  const declaredBytes = declared === null ? Number.NaN : Number(declared);
  if (Number.isFinite(declaredBytes) && declaredBytes > limit) {
    return null;
  }

  // A `fetch` answer without a stream — a test stub, or an adapter that only
  // implements `text` — is read whole and measured afterwards. The cap still
  // applies, it just lands once the body is already in memory.
  if (response.body === undefined) {
    const body = await response.text();
    return Buffer.byteLength(body, "utf8") > limit ? null : body;
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Downloads one map once, under the deadline, and parses its regions with the
 * nodes they list. Every failure — a rejected fetch, a timeout, a non-200
 * status, an oversized body, a body that is not a DERP map, a map with no usable
 * regions — resolves to a reason instead of throwing.
 */
async function downloadDerpMapOnce(
  url: string,
  deps: ResolvedOptions,
): Promise<RemoteDerpMapOutcome> {
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
      return { reason: "status" };
    }

    // Read under the ceiling rather than reading and then measuring: a hostile
    // or misconfigured URL must not be able to make the server hold it all.
    const body = await readBodyWithin(response, MAX_DERP_MAP_BYTES);
    if (body === null) {
      log.debug("config", `DERP map ${url} is larger than the supported size`);
      return { reason: "too-large" };
    }

    // Regions, their names and their nodes come from the shared readers, which
    // understand both the local shape and the wire map Tailscale serves.
    const regions = readAnyDerpMapRegions(body);
    const nodes = readAnyDerpMapNodes(body);
    if (!nodes.ok || regions.length === 0) {
      log.debug("config", `DERP map ${url} describes no regions`);
      return { reason: "unreadable" };
    }

    return {
      regions: regions.map((entry) => ({ ...entry, nodes: nodes.nodes.get(entry.regionId) ?? [] })),
    };
  } catch (error) {
    // A timeout aborts the request, so it lands here as well; the flag keeps the
    // log line and the reason honest about which of the two happened.
    log.debug(
      "config",
      `Unable to read the DERP map at ${url}${timedOut ? " (timed out)" : ""}: ${String(error)}`,
    );
    return { reason: timedOut ? "timeout" : "network" };
  } finally {
    deps.clearTimer(timer);
  }
}

/**
 * One map with one retry: a transport failure is dialled again, because a slow
 * or dropped connection is transient. An answered status or a body that is not a
 * map is definitive and is returned as it is.
 */
async function downloadDerpMap(url: string, deps: ResolvedOptions): Promise<RemoteDerpMapOutcome> {
  let outcome = await downloadDerpMapOnce(url, deps);
  for (let attempt = 0; attempt < deps.retries; attempt += 1) {
    if (outcome.reason !== "timeout" && outcome.reason !== "network") {
      return outcome;
    }

    outcome = await downloadDerpMapOnce(url, deps);
  }

  return outcome;
}

/**
 * The regions of one remote map with the nodes they list, cached in-process,
 * together with the reason the last attempt failed when it did. Concurrent
 * callers for the same URL share a single request, and a failure is remembered
 * only briefly so a transient network problem does not hide the names for hours.
 *
 * The returned objects are the cache's own values: callers must treat them as
 * read-only. {@link loadRemoteDerpMapDetail} is the same answer without the
 * reason.
 */
export async function loadRemoteDerpMapOutcome(
  url: string,
  settings: DerpMapCacheSettings,
  options: RemoteDerpMapOptions = {},
): Promise<RemoteDerpMapOutcome> {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return {};
  }

  const deps = resolveOptions(settings, options);
  const cached = cache.get(trimmed);
  if (cached !== undefined && cached.expiresAt > deps.now()) {
    // A hit still counts as a use, so the least-recently-used entry is the one
    // that goes when the cap is reached.
    rememberOutcome(trimmed, cached);
    return cached.outcome;
  }

  if (cached !== undefined) {
    cache.delete(trimmed);
  }

  const pending = inFlight.get(trimmed);
  if (pending !== undefined) {
    return pending;
  }

  const started = (async () => {
    const outcome = await downloadDerpMap(trimmed, deps);
    rememberOutcome(trimmed, {
      outcome,
      expiresAt: deps.now() + (outcome.regions === undefined ? deps.failureTtlMs : deps.ttlMs),
    });
    return outcome;
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
 * The regions of one remote map with the nodes they list, cached in-process.
 * `undefined` covers every failure, exactly as before; callers that can show the
 * operator why use {@link loadRemoteDerpMapOutcome} instead.
 *
 * The returned objects are the cache's own values: callers must treat them as
 * read-only. {@link loadRemoteDerpMap} is the same answer without the nodes.
 */
export async function loadRemoteDerpMapDetail(
  url: string,
  settings: DerpMapCacheSettings,
  options: RemoteDerpMapOptions = {},
): Promise<DerpMapRegionDetail[] | undefined> {
  const outcome = await loadRemoteDerpMapOutcome(url, settings, options);
  return outcome.regions;
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
