/**
 * The optional "external echo" probe: what address the internet actually sees.
 *
 * A machine behind NAT66, or one whose router forwards a different IPv6 address,
 * holds an address that no client can reach; the domain's AAAA may point at the
 * router instead. Only an outside observer can tell those apart, so Headplane
 * can ask a public echo endpoint over IPv6 and report the answer as the address
 * clients must be able to reach.
 *
 * This is a network call to a third party, so it is **off by default** and only
 * runs when an operator turns it on (Overview → Relay Addresses, or the DERP
 * address sync, which reads the same setting). The setting and the endpoint live
 * in Headplane's own data directory, like the relay DNS servers, so nothing has
 * to be written into Headscale's configuration.
 *
 * The request is IPv6-only on purpose: the name is resolved with `family: 6`,
 * so a host without a usable IPv6 route fails here instead of reporting the
 * IPv4 address the endpoint would otherwise echo back. Every answer is cached
 * (answers and failures for different windows) so a dashboard render never waits
 * on the network twice, and nothing here throws: a timeout, a connection error
 * and a garbage body are all reported as a reason.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { dirname, resolve } from "node:path";

import { classifyIpv6Address, type HostEchoReason } from "~/server/host-addresses";
import log from "~/utils/log";

/** The endpoint asked by default: JSON, and it echoes whatever family it saw. */
export const DEFAULT_HOST_ECHO_URL = "https://api64.ipify.org?format=json";

/**
 * The endpoints tried after the configured one, so one endpoint being down does
 * not lose the answer. They are only ever contacted while the probe is enabled.
 */
export const FALLBACK_HOST_ECHO_URLS = [
  "https://api6.ipify.org?format=json",
  "https://v6.ident.me/",
] as const;

/** How long one endpoint may take before it is reported as a timeout. */
export const HOST_ECHO_TIMEOUT_MS = 1_200;

/** How long all endpoints together may take, so a page load stays bounded. */
export const HOST_ECHO_BUDGET_MS = 2_500;

/** How long an answer, and a failure, stay cached. */
export const HOST_ECHO_CACHE_TTL_MS = 5 * 60 * 1000;
export const HOST_ECHO_FAILURE_TTL_MS = 60 * 1000;

/** Most of a response body that is read; an echo answer is a few dozen bytes. */
const MAX_BODY_BYTES = 4_096;

/** File under Headplane's `server.data_path`. */
export const HOST_ECHO_FILE = "host-echo.json";

// MARK: Settings

export interface HostEchoSettings {
  /** Off by default: this asks a third party. */
  enabled: boolean;
  /** The first endpoint asked; the built-in fallbacks follow it. */
  url: string;
}

export const DEFAULT_HOST_ECHO_SETTINGS: HostEchoSettings = {
  enabled: false,
  url: DEFAULT_HOST_ECHO_URL,
};

/**
 * An http(s) URL, or `undefined` for anything that is not one. Only the two
 * protocols Node can dial are accepted, so a stored value can never turn the
 * probe into a file read. The value is kept as written, so what the settings
 * page shows is what is asked.
 */
export function parseHostEchoUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    return url.hostname.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Turns a stored or posted value into usable settings, defaulting the rest. */
export function normalizeHostEchoSettings(value: unknown): HostEchoSettings {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    enabled: source.enabled === true,
    url: parseHostEchoUrl(source.url) ?? DEFAULT_HOST_ECHO_SETTINGS.url,
  };
}

// MARK: Store

/** `<data_path>/host-echo.json` — the file the settings card reads and writes. */
export function hostEchoPath(dataPath: string): string {
  return resolve(dataPath, HOST_ECHO_FILE);
}

/** Parses the stored document; anything unusable reads as the defaults. */
export function parseHostEchoSettingsDocument(raw: string | undefined | null): HostEchoSettings {
  if (!raw) {
    return DEFAULT_HOST_ECHO_SETTINGS;
  }

  try {
    return normalizeHostEchoSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_HOST_ECHO_SETTINGS;
  }
}

/** Stable, human-editable JSON with a trailing newline. */
export function serializeHostEchoSettingsDocument(settings: HostEchoSettings): string {
  return `${JSON.stringify(normalizeHostEchoSettings(settings), null, 2)}\n`;
}

/** Reads the settings; a missing, unreadable or corrupt file reads as off. */
export async function readHostEchoSettings(dataPath: string): Promise<HostEchoSettings> {
  try {
    return parseHostEchoSettingsDocument(await readFile(hostEchoPath(dataPath), "utf8"));
  } catch {
    return DEFAULT_HOST_ECHO_SETTINGS;
  }
}

let tempCounter = 0;

/**
 * Writes the settings atomically (temp file plus rename). Returns false instead
 * of throwing, because the settings form surfaces the failure as a localized
 * error and an unwritable data directory must not break the page.
 */
export async function writeHostEchoSettings(
  dataPath: string,
  settings: HostEchoSettings,
): Promise<boolean> {
  const path = hostEchoPath(dataPath);
  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeHostEchoSettingsDocument(settings), "utf8");
    await rename(temp, path);
    return true;
  } catch (error) {
    log.warn("config", "Unable to save the host IPv6 echo settings: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

// MARK: Probe

/** What one probe found: the observed address, or why there is none. */
export interface HostEchoResult {
  /** The address the internet sees; absent when the probe has no answer. */
  address?: string;
  /** The endpoint that answered. */
  url?: string;
  /** Why there is no address. */
  reason?: HostEchoReason;
  /** The endpoints that were tried, in order. */
  attempted: string[];
}

/** The endpoints one probe dials, in order: the configured one first. */
export function hostEchoUrls(url: string | undefined): string[] {
  const configured = parseHostEchoUrl(url) ?? DEFAULT_HOST_ECHO_URL;
  return [configured, ...FALLBACK_HOST_ECHO_URLS.filter((entry) => entry !== configured)];
}

/**
 * The address in an echo response. Endpoints answer either with JSON
 * (`{"ip":"2001:db8::1"}`) or with the bare address as text, so both are tried;
 * anything that is not a global unicast IPv6 address — an IPv4 answer, a mapped
 * address, a captive-portal HTML page — is rejected rather than reported.
 */
export function parseHostEchoBody(body: string): string | undefined {
  const text = body.trim();
  if (text.length === 0) {
    return undefined;
  }

  let candidate = text;
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }

    const found = jsonAddress(parsed);
    if (found === undefined) {
      return undefined;
    }

    candidate = found;
  } else if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        candidate = parsed;
      }
    } catch {
      return undefined;
    }
  }

  const value = (
    candidate
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/\s+/)[0] ?? ""
  ).trim();
  return classifyIpv6Address(value) === "global" ? value.toLowerCase() : undefined;
}

/** The address field of an echo answer, whatever the endpoint named it. */
function jsonAddress(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  for (const key of ["ip", "address", "ipv6", "ip_address"]) {
    if (typeof source[key] === "string") {
      return source[key];
    }
  }

  return undefined;
}

/** Injected side effects, so the probe is testable without a network. */
export interface HostEchoProbeOptions {
  /** Performs the request over IPv6 only and resolves the response body. */
  fetchText?: (url: string, signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  budgetMs?: number;
  cacheTtlMs?: number;
  failureTtlMs?: number;
  now?: () => number;
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface HostEchoProbe {
  probe(settings: HostEchoSettings): Promise<HostEchoResult>;
  clearCache(): void;
}

function isTimeoutError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return (
    code === "ETIMEDOUT" || code === "ETIMEOUT" || code === "EAI_AGAIN" || code === "ABORT_ERR"
  );
}

/**
 * The real transport: `node:https` with `family: 6`, which resolves the
 * endpoint over IPv6 only and never falls back to IPv4. `fetch` is not used
 * because it offers no way to pin the address family without a dependency.
 */
function createRequestTransport(): (url: string, signal: AbortSignal) => Promise<string> {
  return (url, signal) =>
    new Promise<string>((resolvePromise, reject) => {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        reject(new Error("invalid url"));
        return;
      }

      const onResponse = (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (body.length < MAX_BODY_BYTES) {
            body += chunk;
          }
        });
        response.on("end", () => resolvePromise(body));
        response.on("error", reject);
      };

      const options: RequestOptions = {
        protocol: target.protocol,
        hostname: target.hostname,
        ...(target.port === "" ? {} : { port: Number(target.port) }),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        // IPv6 only: that is the whole point of the probe.
        family: 6,
        headers: {
          accept: "application/json, text/plain",
          "user-agent": "headplane",
        },
        signal,
      };

      const request =
        target.protocol === "https:"
          ? httpsRequest(options, onResponse)
          : httpRequest(options, onResponse);

      request.on("error", reject);
      request.end();
    });
}

/**
 * Builds a probe with its own cache. The cache is keyed by the endpoint list, so
 * changing the URL or the switch can never serve an answer another setting
 * produced, and lookups that arrive together share one round of requests.
 */
export function createHostEchoProbe(options: HostEchoProbeOptions = {}): HostEchoProbe {
  const fetchText = options.fetchText ?? createRequestTransport();
  const timeoutMs = options.timeoutMs ?? HOST_ECHO_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? HOST_ECHO_BUDGET_MS;
  const cacheTtlMs = options.cacheTtlMs ?? HOST_ECHO_CACHE_TTL_MS;
  const failureTtlMs = options.failureTtlMs ?? HOST_ECHO_FAILURE_TTL_MS;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((handler: () => void, ms: number) => {
      const timer = setTimeout(handler, ms);
      timer.unref?.();
      return timer;
    });
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

  const cache = new Map<string, { expiresAt: number; value: HostEchoResult }>();
  const inFlight = new Map<string, Promise<HostEchoResult>>();

  async function attempt(url: string): Promise<HostEchoResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const body = await fetchText(url, controller.signal);
      const address = parseHostEchoBody(body);
      return address === undefined
        ? { reason: "invalid", attempted: [url] }
        : { address, url, attempted: [url] };
    } catch (error) {
      return {
        reason: timedOut || isTimeoutError(error) ? "timeout" : "unreachable",
        attempted: [url],
      };
    } finally {
      clearTimer(timer);
    }
  }

  async function run(urls: string[]): Promise<HostEchoResult> {
    const started = now();
    const attempted: string[] = [];
    let reason: HostEchoReason = "unreachable";

    for (const url of urls) {
      attempted.push(url);
      const result = await attempt(url);
      if (result.address !== undefined) {
        return { address: result.address, url, attempted };
      }

      reason = result.reason ?? reason;
      // The budget keeps one dashboard render bounded even when every endpoint
      // is unreachable; the failure is cached, so the next render is free.
      if (now() - started >= budgetMs) {
        break;
      }
    }

    return { reason, attempted };
  }

  return {
    async probe(settings: HostEchoSettings): Promise<HostEchoResult> {
      if (!settings.enabled) {
        return { reason: "disabled", attempted: [] };
      }

      const urls = hostEchoUrls(settings.url);
      const key = urls.join("\n");
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAt > now()) {
        return cached.value;
      }

      const pending = inFlight.get(key);
      if (pending !== undefined) {
        return pending;
      }

      const started = run(urls).then((value) => {
        cache.set(key, {
          expiresAt: now() + (value.address === undefined ? failureTtlMs : cacheTtlMs),
          value,
        });
        return value;
      });

      inFlight.set(key, started);
      try {
        return await started;
      } finally {
        if (inFlight.get(key) === started) {
          inFlight.delete(key);
        }
      }
    },

    clearCache() {
      cache.clear();
      inFlight.clear();
    },
  };
}

/**
 * One process-wide cache, the way the relay DNS resolver is shared. It is built
 * lazily so this module has no top-level side effect: a bundler can then drop it
 * entirely from the client build, where nothing may reach `node:https`.
 */
let sharedProbe: HostEchoProbe | undefined;

function probe(): HostEchoProbe {
  sharedProbe ??= createHostEchoProbe();
  return sharedProbe;
}

/** What the internet sees, through the shared cached probe. Never throws. */
export async function loadHostEcho(settings: HostEchoSettings): Promise<HostEchoResult> {
  try {
    return await probe().probe(settings);
  } catch (error) {
    log.warn("server", "The host IPv6 echo probe failed: %s", String(error));
    return { reason: "unreachable", attempted: [] };
  }
}

/** Drops every cached echo answer, so the next read asks again. */
export function clearHostEchoCache(): void {
  sharedProbe?.clearCache();
}
