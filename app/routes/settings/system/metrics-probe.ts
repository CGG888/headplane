// MARK: Headscale metrics probe
//
// The I/O half of the metrics panel: it reads `metrics_listen_addr` out of
// Headscale's own `config.yaml` and fetches the endpoint it names.
//
// Everything here is fail-soft and read-only. Headscale's metrics listener
// usually binds `127.0.0.1`, which a Headplane running in another container
// cannot reach, so an unreachable listener is a normal state the panel
// explains rather than an error page. Nothing is ever written back to
// Headscale.

import log from "~/utils/log";

import { readHeadscaleConfig } from "./config-probe";
import { deriveMetricsTarget, parseMetrics, summarizeMetrics, type MetricsReport } from "./metrics";

/** Short enough that an unreachable listener cannot stall the status page. */
export const METRICS_TIMEOUT_MS = 1_500;

/** How much exposition text is kept for the raw view. */
export const RAW_METRICS_LIMIT = 16_000;

export interface MetricsProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Reads the metrics address from Headscale's configuration file and fetches it.
 * Never throws: a page that cannot show metrics still has to render.
 */
export async function loadMetrics(
  configPath: string | undefined,
  headscaleUrl: string | undefined,
  options: MetricsProbeOptions = {},
): Promise<MetricsReport> {
  const target = deriveMetricsTarget(await readHeadscaleConfig(configPath), headscaleUrl);
  if (target.kind === "disabled") {
    return { state: "disabled" };
  }
  if (target.kind === "invalid") {
    return { state: "invalid", raw: target.raw };
  }
  if (target.kind === "unknown") {
    return { state: "unknown" };
  }

  const text = await fetchMetricsText(target.url, options);
  if (text === undefined) {
    return { state: "unreachable", address: target.address, url: target.url };
  }

  const parsed = parseMetrics(text);
  if (parsed.samples.length === 0) {
    log.debug("server", "Metrics endpoint at %s returned no parsable samples", target.url);
    return { state: "unreachable", address: target.address, url: target.url };
  }

  return {
    state: "ok",
    address: target.address,
    url: target.url,
    summary: summarizeMetrics(parsed, options.now?.() ?? Date.now()),
    raw: text.slice(0, RAW_METRICS_LIMIT),
    truncated: text.length > RAW_METRICS_LIMIT,
  };
}

/** Fetches the exposition text, or `undefined` for every failure mode. */
export async function fetchMetricsText(
  url: string,
  options: MetricsProbeOptions = {},
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "text/plain" },
      signal: AbortSignal.timeout(options.timeoutMs ?? METRICS_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.debug("server", "Metrics endpoint %s returned HTTP %d", url, response.status);
      return undefined;
    }

    return await response.text();
  } catch (error) {
    log.debug("server", "Metrics endpoint %s could not be read: %s", url, String(error));
    return undefined;
  }
}
