/**
 * Relay information the Headplane Agent reports per machine. Pure helpers so
 * the settings page and its tests share one implementation.
 */

import type { HostInfo, Machine } from "~/types";

export interface DerpLatencySample {
  region: string;
  seconds: number;
}

export interface DerpRelayRow {
  nodeKey: string;
  name: string;
  homeRegion: number | undefined;
  preferredRegion: number | undefined;
  /** The fastest DERP region the agent measured, if it reported any. */
  latency: DerpLatencySample | undefined;
}

function readRegionId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Picks the lowest reported latency, ignoring entries that are not numbers. */
export function fastestDerpLatency(
  latencies: Record<string, number> | undefined,
): DerpLatencySample | undefined {
  if (!latencies) {
    return undefined;
  }

  let fastest: DerpLatencySample | undefined;
  for (const [region, seconds] of Object.entries(latencies)) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      continue;
    }

    if (!fastest || seconds < fastest.seconds) {
      fastest = { region, seconds };
    }
  }

  return fastest;
}

export function buildDerpRelayRows(
  nodes: Machine[],
  stats?: Record<string, HostInfo>,
): DerpRelayRow[] {
  return nodes
    .map((node) => {
      const info = stats?.[node.nodeKey];

      return {
        nodeKey: node.nodeKey,
        name: node.givenName || node.name,
        homeRegion: readRegionId(info?.HomeDERP),
        preferredRegion: readRegionId(info?.NetInfo?.PreferredDERP),
        latency: fastestDerpLatency(info?.NetInfo?.DERPLatency),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
