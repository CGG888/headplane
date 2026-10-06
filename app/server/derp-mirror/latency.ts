// MARK: Measured relay latency per official region
//
// Ranking the mirror's region numbers by latency needs a measurement, and there
// are two sources for one:
//
// - the Headplane Agent's machines, which report their own `NetInfo.DERPLatency`
//   per region they measured (see {@link officialRegionLatencies}); and
// - this server itself, which can probe the official regions on demand because a
//   client only ever knows the map Headscale handed it (see `./probe.server`).
//
// Both families are measured, so one region can appear twice (`"900-v4"`,
// `"900-v6"`); the fastest sample stands for the region. The samples are reduced
// to the fastest per region, in milliseconds, because that is the unit the
// numbering rule is written in. A region nobody measured simply has no entry,
// which ranks it last instead of failing the run.
//
// A local measurement wins over a reported one for the same region: it is the
// path the clients near this server actually take, and it exists precisely for
// the official regions no client can report on. Where there is no local value,
// the reported one is used unchanged.

import { parseDerpRegionId } from "~/routes/machines/derp-info";
import type { AgentHostRecord } from "~/utils/agent-coverage";

import type { DerpMirrorLatency } from "./types";

/** Seconds to milliseconds. */
const MS_PER_SECOND = 1000;

/**
 * The fastest agent-reported latency per region id, in milliseconds. Keys are
 * decimal region-id strings, matching what the numbering rule reads; a sample
 * that does not name a region (a legacy `host:port` key, a code) is ignored
 * because it cannot be attributed to one.
 */
export function officialRegionLatencies(
  records: readonly AgentHostRecord[],
): Record<string, number> {
  const fastest = new Map<number, number>();

  for (const record of records) {
    const latencies = record.host?.NetInfo?.DERPLatency;
    if (latencies === undefined || latencies === null) {
      continue;
    }

    for (const [key, seconds] of Object.entries(latencies)) {
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
        continue;
      }

      const regionId = parseDerpRegionId(key);
      if (regionId === undefined) {
        continue;
      }

      const ms = seconds * MS_PER_SECOND;
      const existing = fastest.get(regionId);
      if (existing === undefined || ms < existing) {
        fastest.set(regionId, ms);
      }
    }
  }

  return Object.fromEntries([...fastest].map(([regionId, ms]) => [String(regionId), ms]));
}

/** A stored latency value that can be ranked, or undefined for "not measured". */
function usableLatency(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The fastest value this server measured itself per region id, in milliseconds.
 *
 * The family bests are the intended source; the per-node values are read too, so
 * a record written without them still reduces to something rankable. A region
 * with no usable value is simply absent.
 */
export function locallyMeasuredRegionLatencies(
  latency: DerpMirrorLatency | undefined,
): Record<string, number> {
  const fastest = new Map<number, number>();

  for (const region of latency?.regions ?? []) {
    const candidates = [
      usableLatency(region.bestV4),
      usableLatency(region.bestV6),
      ...region.nodes.map((node) => usableLatency(node.latencyMs)),
    ].filter((value): value is number => value !== undefined);

    for (const ms of candidates) {
      const existing = fastest.get(region.regionId);
      if (existing === undefined || ms < existing) {
        fastest.set(region.regionId, ms);
      }
    }
  }

  return Object.fromEntries([...fastest].map(([regionId, ms]) => [String(regionId), ms]));
}

/**
 * The values the numbering ranks on: the locally measured ones where this server
 * has one, the machine-reported ones everywhere else. Both records are keyed by
 * decimal region id, and a local value never loses to a reported one.
 */
export function preferredRegionLatencies(
  measured: Record<string, number>,
  reported: Record<string, number>,
): Record<string, number> {
  return { ...reported, ...measured };
}
