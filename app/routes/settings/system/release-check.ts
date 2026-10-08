// MARK: Headscale release check
//
// The system status page would like to tell the operator that a newer Headscale
// exists, but it must never depend on reaching the internet to render. Every
// failure mode (no network, DNS blocked, a proxy that blackholes GitHub, a rate
// limit, a missing redirect, or a request that simply takes too long) ends as
// `undefined`, which the page renders as "no update information" with no badge.
// Results are cached in-process so a page reload does not talk to GitHub again,
// and successful lookups are cached for much longer than failures so a
// temporary outage recovers without hammering the API.
//
// The tag is read from the HTML endpoint `https://github.com/<owner>/<repo>/
// releases/latest`, which answers with a 302 to `/releases/tag/<tag>`. That
// endpoint is not subject to the unauthenticated GitHub API rate limit (60
// requests per hour per address), which answers HTTP 403 "API rate limit
// exceeded" from a shared address and made the version card read "not
// reported" on an install whose network was perfectly fine.

import { parseServerVersion, type ServerVersion } from "~/server/headscale/api/server-version";
import log from "~/utils/log";

export const RELEASES_URL = "https://github.com/juanfont/headscale/releases/latest";

/** Headplane's own releases, looked up exactly the same way. */
export const HEADPLANE_RELEASES_URL = "https://github.com/CGG888/headplaneCN/releases/latest";

/** Long enough for a healthy connection, short enough to never stall a page. */
export const REQUEST_TIMEOUT_MS = 3_000;

/** A release cannot change often, so a hit is cached for most of a work day. */
export const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A miss is retried sooner, in case the network comes back. */
export const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;

export interface ReleaseCheckerOptions {
  url?: string;
  /** Names the lookup in the debug log when two checkers run side by side. */
  label?: string;
  timeoutMs?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ReleaseChecker {
  /** The newest release of the watched repository, or `undefined` on failure. */
  latest(): Promise<ServerVersion | undefined>;
}

export function createReleaseChecker(options: ReleaseCheckerOptions = {}): ReleaseChecker {
  const url = options.url ?? RELEASES_URL;
  const label = options.label ?? "Headscale";
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
          accept: "text/html",
          "user-agent": "headplane",
        },
        // The tag only exists in the Location header, so the redirect must not
        // be followed: `manual` hands the 302 back untouched.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });

      const tag = readTagName(response);
      if (!tag) {
        log.debug(
          "server",
          "%s release check returned no release tag (HTTP %d)",
          label,
          response.status,
        );
        return undefined;
      }

      const version = parseServerVersion(tag);
      if (version.unknown) {
        log.debug("server", "%s release check returned an unusable tag: %s", label, tag);
        return undefined;
      }

      return version;
    } catch (error) {
      log.debug("server", "%s release check failed: %s", label, String(error));
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

/**
 * Reads the release tag out of GitHub's `releases/latest` answer: a 302 whose
 * `Location` ends in `/releases/tag/<tag>`. A response that already travelled
 * through the redirect is accepted as well, so a `fetch` that follows redirects
 * anyway still yields a version instead of nothing.
 */
function readTagName(response: Response): string | undefined {
  const fromLocation = tagFromUrl(response.headers.get("location"));
  if (fromLocation) {
    return fromLocation;
  }

  if (response.status < 300 || response.status >= 400) {
    return tagFromUrl(response.url);
  }

  return undefined;
}

function tagFromUrl(url: string | undefined | null): string | undefined {
  const marker = "/releases/tag/";
  const index = url?.indexOf(marker) ?? -1;
  if (index === -1) {
    return undefined;
  }

  const rest = url!.slice(index + marker.length);
  const tag = rest.split(/[?#]/)[0]?.trim();
  return tag ? decodeURIComponent(tag) : undefined;
}

/**
 * The process-wide checker behind the system status page. Building it performs
 * no I/O; the first `latest()` call is what talks to GitHub.
 */
export const headscaleReleaseChecker = createReleaseChecker();

/**
 * The same lookup pointed at Headplane's own repository. Its result feeds the
 * self-update notice, which compares it against the version baked into this
 * build as `__VERSION__`.
 */
export const headplaneReleaseChecker = createReleaseChecker({
  url: HEADPLANE_RELEASES_URL,
  label: "Headplane",
});
