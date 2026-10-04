// MARK: Headscale release check
//
// The system status page would like to tell the operator that a newer Headscale
// exists, but it must never depend on reaching the internet to render. Every
// failure mode (no network, DNS blocked, a proxy that blackholes GitHub, a rate
// limit, a malformed body, or a request that simply takes too long) ends as
// `undefined`, which the page renders as "no update information" with no badge.
// Results are cached in-process so a page reload does not talk to GitHub again,
// and successful lookups are cached for much longer than failures so a
// temporary outage recovers without hammering the API.

import { parseServerVersion, type ServerVersion } from "~/server/headscale/api/server-version";
import log from "~/utils/log";

export const RELEASES_URL = "https://api.github.com/repos/juanfont/headscale/releases/latest";

/** Long enough for a healthy connection, short enough to never stall a page. */
export const REQUEST_TIMEOUT_MS = 3_000;

/** A release cannot change often, so a hit is cached for most of a work day. */
export const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A miss is retried sooner, in case the network comes back. */
export const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;

export interface ReleaseCheckerOptions {
  url?: string;
  timeoutMs?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ReleaseChecker {
  /** The newest Headscale release, or `undefined` when it cannot be determined. */
  latest(): Promise<ServerVersion | undefined>;
}

export function createReleaseChecker(options: ReleaseCheckerOptions = {}): ReleaseChecker {
  const url = options.url ?? RELEASES_URL;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const successTtlMs = options.successTtlMs ?? SUCCESS_CACHE_TTL_MS;
  const failureTtlMs = options.failureTtlMs ?? FAILURE_CACHE_TTL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  let cached: { version: ServerVersion | undefined; expiresAt: number } | undefined;
  let inFlight: Promise<ServerVersion | undefined> | undefined;

  async function load(): Promise<ServerVersion | undefined> {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "headplane",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        log.debug("server", "Headscale release check returned HTTP %d", response.status);
        return undefined;
      }

      const body: unknown = await response.json();
      const tag = readTagName(body);
      if (!tag) {
        log.debug("server", "Headscale release check returned no tag name");
        return undefined;
      }

      const version = parseServerVersion(tag);
      if (version.unknown) {
        log.debug("server", "Headscale release check returned an unusable tag: %s", tag);
        return undefined;
      }

      return version;
    } catch (error) {
      log.debug("server", "Headscale release check failed: %s", String(error));
      return undefined;
    }
  }

  return {
    latest() {
      const timestamp = now();
      if (cached && cached.expiresAt > timestamp) {
        return Promise.resolve(cached.version);
      }

      // Concurrent page loads share one request instead of racing each other.
      inFlight ??= load().then((version) => {
        cached = {
          version,
          expiresAt: now() + (version ? successTtlMs : failureTtlMs),
        };
        inFlight = undefined;
        return version;
      });

      return inFlight;
    },
  };
}

function readTagName(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const tag = (body as Record<string, unknown>).tag_name;
  if (typeof tag !== "string") {
    return undefined;
  }

  const trimmed = tag.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The process-wide checker behind the system status page. Building it performs
 * no I/O; the first `latest()` call is what talks to GitHub.
 */
export const headscaleReleaseChecker = createReleaseChecker();
