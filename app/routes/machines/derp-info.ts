/**
 * Relay information for a single machine, built from the Headplane Agent's host
 * info plus Headscale's embedded DERP configuration. Pure helpers so the
 * machine page and its tests share one implementation.
 *
 * Region names can only come from the embedded server's own `derp.server`
 * settings. Headscale hands its merged DERP map to Tailscale clients over the
 * control protocol, and its only `/derp` route (Headscale 0.29.2,
 * `hscontrol/app.go`) is mounted when the embedded server is enabled and speaks
 * the DERP protocol instead of returning the map, so external regions stay as
 * bare ids.
 */

import type { HostInfo } from "~/types";

/** Measured regions the machine page lists before summarising the rest. */
export const DERP_LATENCY_ROW_LIMIT = 8;

/** The parts of Headscale's `derp.server` a machine page needs. */
export interface DerpEmbeddedServer {
  enabled: boolean;
  regionId: number;
  regionCode: string;
  regionName: string;
}

export interface DerpRegionInfo {
  regionId: number;
  code?: string;
  name?: string;
}

export interface DerpRegionLabel {
  /** `#901`, or `#999 · headscale` when a local name is known. */
  label: string;
  /** True when this region is Headscale's embedded DERP server. */
  isEmbedded: boolean;
}

export interface DerpLatencyEntry {
  /** Region id parsed from the agent's latency map key, when it is numeric. */
  regionId: number | undefined;
  /** Region key exactly as the agent reported it. */
  region: string;
  /** Measured round trip in seconds, as Tailscale reports it. */
  seconds: number;
}

export interface DerpLatencyRows {
  rows: DerpLatencyEntry[];
  /** Measured regions that did not fit into `rows`. */
  hidden: number;
}

export interface DerpInfoView {
  /** False when the agent has not reported any relay data for this machine. */
  hasRelayData: boolean;
  home: DerpRegionLabel;
  preferred: DerpRegionLabel;
  latencies: DerpLatencyRows;
  /** True when at least one shown region has no local name and stays an id. */
  hasIdOnlyRegions: boolean;
}

/** The embedded server as a label source, or undefined when it is disabled. */
export function embeddedDerpRegion(
  server: DerpEmbeddedServer | undefined,
): DerpRegionInfo | undefined {
  if (!server?.enabled) {
    return undefined;
  }

  const code = server.regionCode.trim();
  const name = server.regionName.trim();
  return {
    regionId: server.regionId,
    code: code || undefined,
    name: name || undefined,
  };
}

/** Labels a region id, falling back to the caller's localized "unknown" text. */
export function regionLabel(
  region: number | undefined,
  embedded: DerpRegionInfo | undefined,
  unknown: string,
): DerpRegionLabel {
  if (region === undefined || !Number.isFinite(region)) {
    return { label: unknown, isEmbedded: false };
  }

  if (embedded !== undefined && embedded.regionId === region) {
    const name = embedded.code ?? embedded.name;
    return { label: name ? `#${region} · ${name}` : `#${region}`, isEmbedded: true };
  }

  return { label: `#${region}`, isEmbedded: false };
}

/** Region ids reach the page as JSON object keys, so parse those defensively. */
export function parseDerpRegionId(region: string): number | undefined {
  const trimmed = region.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Fastest first, dropping samples that are not finite numbers. */
export function sortDerpLatencies(
  latencies: Record<string, number> | undefined,
): DerpLatencyEntry[] {
  return Object.entries(latencies ?? {})
    .filter(([, seconds]) => typeof seconds === "number" && Number.isFinite(seconds))
    .map(([region, seconds]) => ({
      region,
      regionId: parseDerpRegionId(region),
      seconds,
    }))
    .sort((a, b) => a.seconds - b.seconds);
}

/** Keeps the fastest rows and counts how many regions were left out. */
export function capDerpLatencies(
  entries: DerpLatencyEntry[],
  limit = DERP_LATENCY_ROW_LIMIT,
): DerpLatencyRows {
  const capped = Math.max(0, limit);
  return {
    rows: entries.slice(0, capped),
    hidden: Math.max(0, entries.length - capped),
  };
}

/** Tailscale reports DERP latency in seconds; the UI shows milliseconds. */
export function formatDerpLatency(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  return `${Math.round(seconds * 1000)}ms`;
}

/** Everything the machine page renders about this machine's relays. */
export function buildDerpInfo(
  info: HostInfo | undefined,
  server: DerpEmbeddedServer | undefined,
  unknown: string,
): DerpInfoView {
  const embedded = embeddedDerpRegion(server);
  const home = readRegionId(info?.HomeDERP);
  const preferred = readRegionId(info?.NetInfo?.PreferredDERP);
  const latencies = sortDerpLatencies(info?.NetInfo?.DERPLatency);

  return {
    hasRelayData: home !== undefined || preferred !== undefined || latencies.length > 0,
    home: regionLabel(home, embedded, unknown),
    preferred: regionLabel(preferred, embedded, unknown),
    latencies: capDerpLatencies(latencies),
    hasIdOnlyRegions:
      isExternalRegion(home, embedded) ||
      isExternalRegion(preferred, embedded) ||
      latencies.some((entry) => isExternalRegion(entry.regionId, embedded)),
  };
}

function isExternalRegion(region: number | undefined, embedded: DerpRegionInfo | undefined) {
  return region !== undefined && region !== embedded?.regionId;
}

function readRegionId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
