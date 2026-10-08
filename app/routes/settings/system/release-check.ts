// MARK: Headscale release check
//
// The system status page would like to tell the operator that a newer Headscale
// exists, but it must never depend on reaching the internet to render. Every
// failure mode (no network, DNS blocked, a proxy that blackholes GitHub, a rate
// limit, a missing redirect, or a request that simply takes too long) ends as
// `undefined`, which the page renders as "no update information" with no badge.
// Results are cached in-process so a page reload does not talk to GitHub again,
// and successful lookups are cached for much longer than failures so a
// temporary outage recovers without hammering the endpoint.
//
// Two routes are tried, in order:
//
//   1. the original address, `https://github.com/<owner>/<repo>/releases/latest`.
//      It answers with a 302 whose Location carries `/releases/tag/<tag>`, and
//      the HTML endpoint is not subject to the unauthenticated GitHub API rate
//      limit (60 requests per hour per address) that answers HTTP 403 "API rate
//      limit exceeded" from a shared address.
//   2. the same lookup through a mirror, `https://mirror/<original URL>`. A
//      mirror on a network that cannot reach github.com at all is the only way
//      out, and it is what makes this work behind a filtered egress. Each
//      prefix is asked for both the HTML URL and the `api.github.com` URL,
//      because a mirror usually serves only one of the two: the HTML form
//      answers 302 with the tag, the API form answers 200 with `tag_name`.
//
// An operator can point the check at their own mirror with
// `HEADPLANE_RELEASE_MIRROR=https://mirror.example/` (comma-separated prefixes,
// `off` disables the fallback), and a real HTTP proxy works too: Node 24 reads
// `HTTPS_PROXY`/`NO_PROXY` for `fetch` as soon as the process runs with
// `NODE_USE_ENV_PROXY=1`, which needs no code here.

import { parseServerVersion, type ServerVersion } from "~/server/headscale/api/server-version";
import log from "~/utils/log";

export const RELEASES_URL = "https://github.com/juanfont/headscale/releases/latest";

/** Headplane's own releases, looked up exactly the same way. */
export const HEADPLANE_RELEASES_URL = "https://github.com/CGG888/headplaneCN/releases/latest";

/**
 * Mirrors that stand in for GitHub when it cannot be reached. Each entry is a
 * prefix prepended to the original URL, the same shape the install guides use
 * to pull images from a registry mirror.
 */
export const DEFAULT_RELEASE_MIRRORS = [
  "https://ghproxy.net/",
  "https://ghfast.top/",
  "https://v6.gh-proxy.org/",
  "https://gh-proxy.com/",
];

/** The environment variable that overrides the mirror list above. */
export const RELEASE_MIRROR_ENV = "HEADPLANE_RELEASE_MIRROR";

/** Long enough for a healthy connection, short enough to never stall a page. */
export const REQUEST_TIMEOUT_MS = 3_000;

/** All attempts together, so a blocked network cannot hold a page forever. */
export const TOTAL_TIMEOUT_MS = 6_000;

/** A release cannot change often, so a hit is cached for most of a work day. */
export const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A miss is retried sooner, in case the network comes back. */
export const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;

export interface ReleaseCheckerOptions {
  url?: string;
  /** Names the lookup in the debug log when two checkers run side by side. */
  label?: string;
  timeoutMs?: number;
  budgetMs?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  /** Mirror prefixes; `[]` disables the fallback, `undefined` uses the default. */
  mirrors?: string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ReleaseChecker {
  /** The newest release of the watched repository, or `undefined` on failure. */
  latest(): Promise<ServerVersion | undefined>;
}

/**
 * The mirror prefixes to use: `HEADPLANE_RELEASE_MIRROR` when it is set
 * (comma-separated, `off`/`none`/`-`/`0` to disable the fallback), otherwise the
 * built-in list.
 */
export function releaseMirrorPrefixes(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env[RELEASE_MIRROR_ENV]?.trim();
  if (configured !== undefined && configured !== "") {
    if (/^(off|none|-|0)$/i.test(configured)) {
      return [];
    }

    return configured
      .split(",")
      .map((prefix) => prefix.trim())
      .filter((prefix) => prefix.length > 0)
      .map((prefix) => (prefix.endsWith("/") ? prefix : `${prefix}/`));
  }

  return [...DEFAULT_RELEASE_MIRRORS];
}

/** `https://github.com/<owner>/<repo>/releases/latest` → the API equivalent. */
function apiUrlFrom(releasesUrl: string): string | undefined {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/?$/.exec(releasesUrl);
  if (!match) {
    return undefined;
  }

  return `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`;
}

interface ReleaseCandidate {
  url: string;
  /** Shown in the debug log, e.g. `github.com` or `https://ghproxy.net/ (api)`. */
  label: string;
}

function buildCandidates(releasesUrl: string, mirrors: string[]): ReleaseCandidate[] {
  const candidates: ReleaseCandidate[] = [{ url: releasesUrl, label: "github.com" }];
  const apiUrl = apiUrlFrom(releasesUrl);

  for (const prefix of mirrors) {
    candidates.push({ url: `${prefix}${releasesUrl}`, label: `${prefix} (html)` });
    if (apiUrl) {
      candidates.push({ url: `${prefix}${apiUrl}`, label: `${prefix} (api)` });
    }
  }

  return candidates;
}

export function createReleaseChecker(options: ReleaseCheckerOptions = {}): ReleaseChecker {
  const url = options.url ?? RELEASES_URL;
  const label = options.label ?? "Headscale";
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? TOTAL_TIMEOUT_MS;
  const successTtlMs = options.successTtlMs ?? SUCCESS_CACHE_TTL_MS;
  const failureTtlMs = options.failureTtlMs ?? FAILURE_CACHE_TTL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const mirrors = options.mirrors ?? releaseMirrorPrefixes();

  // The route that worked last time is tried first, so an install that depends
  // on a mirror does not pay for the dead direct attempt on every refresh.
  const order = buildCandidates(url, mirrors);

  let cached: { version: ServerVersion | undefined; expiresAt: number } | undefined;
  let inFlight: Promise<ServerVersion | undefined> | undefined;

  async function lookup(
    candidate: ReleaseCandidate,
    remaining: number,
  ): Promise<string | undefined> {
    const response = await fetchImpl(candidate.url, {
      headers: {
        accept: "text/html, application/json",
        "user-agent": "headplane",
      },
      // The tag is normally in the Location header, so the request asks for the
      // redirect itself instead of downloading a release page.
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(250, remaining)),
    });

    return readTag(response);
  }

  async function load(): Promise<ServerVersion | undefined> {
    const deadline = Date.now() + budgetMs;

    for (const candidate of order) {
      const remaining = deadline - Date.now();
      if (remaining <= 250) {
        log.debug("server", "%s release check ran out of time before %s", label, candidate.label);
        break;
      }

      let tag: string | undefined;
      try {
        tag = await lookup(candidate, Math.min(timeoutMs, remaining));
      } catch (error) {
        log.debug(
          "server",
          "%s release check via %s failed: %s",
          label,
          candidate.label,
          String(error),
        );
        continue;
      }

      if (!tag) {
        continue;
      }

      const version = parseServerVersion(tag);
      if (version.unknown) {
        log.debug(
          "server",
          "%s release check via %s returned an unusable tag: %s",
          label,
          candidate.label,
          tag,
        );
        continue;
      }

      const index = order.indexOf(candidate);
      if (index > 0) {
        order.splice(index, 1);
        order.unshift(candidate);
      }
      log.debug("server", "%s release check used %s", label, candidate.label);
      return version;
    }

    return undefined;
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
 * Reads the release tag out of whatever the endpoint answered: the `Location`
 * header of GitHub's 302, the URL a followed redirect ended on, the `tag_name`
 * of an API payload, or a `/releases/tag/<tag>` link inside an HTML page (some
 * mirrors proxy the page instead of the redirect).
 */
async function readTag(response: Response): Promise<string | undefined> {
  const fromLocation = tagFromUrl(response.headers?.get("location"));
  if (fromLocation) {
    return fromLocation;
  }

  const fromUrl = tagFromUrl(response.url);
  if (fromUrl) {
    return fromUrl;
  }

  if (response.status >= 400) {
    return undefined;
  }

  const body = await response.text();
  return tagFromBody(body);
}

function tagFromBody(body: string): string | undefined {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as { tag_name?: unknown };
      if (typeof payload.tag_name === "string" && payload.tag_name.trim().length > 0) {
        return payload.tag_name.trim();
      }
    } catch {
      // Fall through to the HTML scan below.
    }
  }

  const match = /\/releases\/tag\/([^"'\s?#<>\\]+)/.exec(body);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
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
