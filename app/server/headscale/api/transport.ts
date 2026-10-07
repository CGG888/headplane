// MARK: Headscale Transport
//
// Internal HTTP transport for talking to a Headscale server. Owns
// the Undici agent (and any custom CA), the base URL, error
// translation, and the distinction between authenticated `/api/v1`
// calls and unauthenticated public endpoints (`/version`, `/health`).
//
// This module is intentionally not exported from the package; all
// consumers should go through `Headscale` and `HeadscaleClient` in
// `./index.ts`, never the transport directly.

import { readFile } from "node:fs/promises";

import { data } from "react-router";
import { Agent, type Dispatcher, request } from "undici";

import log from "~/utils/log";

import { undiciToFriendlyError } from "./error";
import { type HeadscaleAPIError, isApiError } from "./error-client";

export interface TransportRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** API path without the `/api/` prefix (e.g. `v1/node`). */
  path: `v1/${string}`;
  apiKey: string;
  /** JSON request body for non-GET/DELETE requests. */
  body?: Record<string, unknown>;
  /** Query parameters for GET/DELETE requests. */
  query?: Record<string, unknown>;
}

export interface Transport {
  /**
   * Send an authenticated JSON request against `/api/{path}`.
   * Throws a React Router `data()` 502 response on transport errors
   * and a typed `HeadscaleAPIError` (wrapped in `data()`) on API
   * errors with statusCode >= 400.
   */
  request<T>(opts: TransportRequest): Promise<T>;

  /**
   * Send an unauthenticated GET against the server root
   * (e.g. `/version`, `/health`). Returns parsed JSON.
   */
  getPublic<T>(path: `/${string}`): Promise<T>;

  /** True if `GET /health` returns 200. Never throws. */
  health(): Promise<boolean>;

  /** Shut down the underlying Undici agent. */
  dispose(): Promise<void>;
}

export interface TransportOptions {
  url: string;
  certPath?: string;
}

/**
 * Hard ceiling for a single Headscale request. Undici's own defaults are 300 s
 * for headers and body, so a half-open peer (paused container, dropped SYN
 * behind a proxy) used to keep every poll and page load hanging for five
 * minutes.
 */
const REQUEST_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Ceiling for the text an error payload carries to the browser. A reverse proxy
 * in front of Headscale answers with its own HTML error page when it cannot
 * reach the backend, and those bytes used to be echoed into the console verbatim
 * (kilobytes of a stranger's markup, with whatever the proxy's page contains).
 */
const MAX_ERROR_DETAIL_CHARS = 512;

/**
 * Ceiling for the body we are willing to parse as Headscale's JSON error. Bigger
 * bodies are almost never the API's own error object, so they are left as text.
 */
const MAX_ERROR_JSON_CHARS = 8 * 1024;

/**
 * Reduce an upstream error body to the single line the console shows instead of
 * it. The body itself never leaves the server: it is not written for our users
 * and can carry internal host names, filesystem paths or a proxy's HTML.
 */
function summarizeErrorBody(raw: string): string {
  const collapsed = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");

  const printable = [...collapsed]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      // Control characters would let an upstream body rewrite the terminal-like
      // layout of the error card (and tag along into log files).
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");

  if (printable.length === 0) {
    return "";
  }

  // An HTML document is a proxy's answer, not Headscale's: it says nothing about
  // what went wrong with the API call, and it is the case that made the old
  // "render the body as-is" behaviour worth removing.
  if (/^\s*</.test(printable) || /<!doctype\s+html/i.test(printable)) {
    return "(the upstream service answered with an HTML document)";
  }

  return printable.length > MAX_ERROR_DETAIL_CHARS
    ? `${printable.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
    : printable;
}

/**
 * Parse the upstream body as Headscale's JSON error, keeping the size bounded:
 * the parsed object is part of the payload the console renders, so it must not
 * be a way to smuggle a large body past `summarizeErrorBody`.
 */
function parseErrorBody(raw: string): Record<string, unknown> | null {
  if (raw.length > MAX_ERROR_JSON_CHARS) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read a 2xx body as JSON. A non-JSON body (reverse-proxy error page, HTML
 * login page, truncated response) used to surface as a raw `SyntaxError` that
 * none of the `isApiError`/`isDataWithApiError` checks recognise, turning into
 * an untranslated 500. Empty bodies resolve to `undefined` so 204-style
 * responses stay usable.
 */
async function readJsonBody<T>(
  body: { text(): Promise<string> },
  requestUrl: `${string} ${string}`,
): Promise<T> {
  const raw = await body.text();
  if (raw.trim().length === 0) {
    return undefined as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw data(
      {
        requestUrl,
        statusCode: 502,
        detail: summarizeErrorBody(raw),
        data: null,
      } satisfies HeadscaleAPIError,
      { status: 502, statusText: "Bad Gateway" },
    );
  }
}

export async function createTransport(opts: TransportOptions): Promise<Transport> {
  const agent = await createUndiciAgent(opts.certPath);
  const baseUrl = opts.url;

  async function rawRequest(
    url: string,
    options: Partial<Dispatcher.RequestOptions> & { method: string },
  ): Promise<Dispatcher.ResponseData> {
    log.debug("api", "%s %s", options.method, url);
    try {
      return await request(new URL(url, baseUrl), {
        dispatcher: agent,
        headers: {
          ...options.headers,
          Accept: "application/json",
          "User-Agent": `Headplane/${__VERSION__}`,
        },
        body: options.body,
        method: options.method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const errorBody = undiciToFriendlyError(error, `${options.method} ${url}`);
      throw data(errorBody, { status: 502, statusText: "Bad Gateway" });
    }
  }

  return {
    async request<T>({ method, path, apiKey, body, query }: TransportRequest): Promise<T> {
      // `new URL(url, baseUrl)` normalizes `..` segments, so a path that
      // contains one escapes the endpoint the caller meant to hit. Resource
      // modules are expected to validate/encode their own path segments (see
      // `nodePath` in `resources/nodes.ts`); this is a backstop.
      if (path.split(/[/?#]/).includes("..")) {
        throw new Error(`Refusing to request an API path containing "..": ${path}`);
      }

      let url = `/api/${path}`;
      const options: Partial<Dispatcher.RequestOptions> & { method: string } = {
        method,
        headers: { Authorization: `Bearer ${apiKey}` },
      };

      if (query && (method === "GET" || method === "DELETE")) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined) {
            params.append(key, String(value));
          }
        }
        if ([...params.keys()].length > 0) {
          url += `?${params.toString()}`;
        }
      } else if (body && method !== "GET" && method !== "DELETE") {
        options.body = JSON.stringify(body);
        options.headers = { ...options.headers, "Content-Type": "application/json" };
      }

      const res = await rawRequest(url, options);
      if (res.statusCode >= 400) {
        log.debug("api", "%s %s failed with status %d", method, path, res.statusCode);
        const rawBody = await res.body.text();
        const jsonData = parseErrorBody(rawBody);

        throw data(
          {
            requestUrl: `${method} ${path}`,
            statusCode: res.statusCode,
            detail: summarizeErrorBody(rawBody),
            data: jsonData,
          } satisfies HeadscaleAPIError,
          { status: 502, statusText: "Bad Gateway" },
        );
      }

      return readJsonBody<T>(res.body, `${method} ${path}`);
    },

    async getPublic<T>(path: `/${string}`): Promise<T> {
      const res = await rawRequest(path, { method: "GET" });
      if (res.statusCode >= 400) {
        const rawBody = await res.body.text();
        const jsonData = parseErrorBody(rawBody);
        throw data(
          {
            requestUrl: `GET ${path}`,
            statusCode: res.statusCode,
            detail: summarizeErrorBody(rawBody),
            data: jsonData,
          } satisfies HeadscaleAPIError,
          { status: 502, statusText: "Bad Gateway" },
        );
      }
      return readJsonBody<T>(res.body, `GET ${path}`);
    },

    async health() {
      try {
        const res = await rawRequest("/health", { method: "GET" });
        // Drain the body so the connection can be reused.
        await res.body.dump();
        return res.statusCode === 200;
      } catch (error) {
        if (isApiError(error)) {
          log.debug("api", "Health check failed: %d", error.statusCode);
        }
        return false;
      }
    },

    async dispose() {
      await agent.close();
    },
  };
}

async function createUndiciAgent(certPath?: string): Promise<Agent> {
  const timeouts = {
    headersTimeout: REQUEST_TIMEOUT_MS,
    bodyTimeout: REQUEST_TIMEOUT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };

  if (!certPath) {
    return new Agent(timeouts);
  }

  try {
    log.debug("config", "Loading certificate from %s", certPath);
    const cert = await readFile(certPath, "utf8");
    log.info("config", "Using certificate from %s", certPath);
    return new Agent({ ...timeouts, connect: { ca: cert.trim() } });
  } catch (error) {
    log.error("config", "Failed to load Headscale TLS cert: %s", error);
    log.debug("config", "Error Details: %o", error);
    return new Agent(timeouts);
  }
}
