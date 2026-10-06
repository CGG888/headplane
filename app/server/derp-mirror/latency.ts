// MARK: Measured relay latency per official region
//
// Ranking the mirror's region numbers by latency needs a measurement, and the
// only one Headplane already has is the one the Headplane Agent collects: every
// connected client reports its own `NetInfo.DERPLatency`, in seconds, keyed by
// the region it measured. Both families are measured, so one region can appear
// twice (`"900-v4"`, `"900-v6"`); the fastest sample stands for the region.
//
// The samples are taken from every host that reported one and reduced to the
// fastest per region, in milliseconds, because that is the unit the numbering
// rule is written in. A region nobody measured simply has no entry, which ranks
// it last instead of failing the run.

import { parseDerpRegionId } from "~/routes/machines/derp-info";
import type { AgentHostRecord } from "~/utils/agent-coverage";

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
