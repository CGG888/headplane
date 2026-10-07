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
//
// A finished run is merged over what the store already held
// ({@link mergeLatencyReadings}): a run that was stopped, or that ran out of its
// overall budget, only measured part of the map, and it must not drop the
// regions an earlier run had already measured.

import { parseDerpRegionId } from "~/routes/machines/derp-info";
import type { AgentHostRecord } from "~/utils/agent-coverage";

import type { DerpLatencyRegionReading, DerpMirrorLatency } from "./types";

/** Seconds to milliseconds. */
const MS_PER_SECOND = 1000;

/**
 * How long a stored measurement stays usable. Probing is on demand, so a record
 * can be weeks old; an ancient reading must not outrank the latency the machines
 * report today, and the stored record must not grow forever.
 */
export const LATENCY_READING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
 * True while a stored reading is young enough to be ranked on. A reading without
 * a usable timestamp is treated as stale: it cannot be shown to be current.
 */
function isFreshReading(reading: DerpLatencyRegionReading, now: Date): boolean {
  const measuredMs = Date.parse(reading.measuredAt);
  return Number.isFinite(measuredMs) && now.getTime() - measuredMs < LATENCY_READING_TTL_MS;
}

/**
 * The fastest value this server measured itself per region id, in milliseconds.
 *
 * The family bests are the intended source; the per-node values are read too, so
 * a record written without them still reduces to something rankable. A region
 * with no usable value is simply absent, and neither is a reading older than
 * {@link LATENCY_READING_TTL_MS}: the numbering then uses what the machines
 * report instead of a measurement nobody can call current.
 */
export function locallyMeasuredRegionLatencies(
  latency: DerpMirrorLatency | undefined,
  now: Date = new Date(),
): Record<string, number> {
  const fresh = (latency?.regions ?? []).filter((region) => isFreshReading(region, now));
  return regionLatencyBests(fresh);
}

/**
 * The fastest usable value per region id across a set of readings, in
 * milliseconds. Both the stored record and a run still in flight reduce through
 * here, so progress the card shows while a run is going and the value that run
 * finally stores can never be ranked differently.
 */
export function regionLatencyBests(
  readings: readonly DerpLatencyRegionReading[],
): Record<string, number> {
  const fastest = new Map<number, number>();

  for (const region of readings) {
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
 * One finished probe run, merged over what the store already held.
 *
 * A run that the operator stopped, or that ran out of its overall budget, only
 * ever measured some of the regions, and storing its record as it stands would
 * drop every region an earlier run had measured. So the regions this run did
 * measure replace their entries and every other entry is carried over with the
 * timestamp of the run that actually measured it — but only while that reading
 * is still younger than {@link LATENCY_READING_TTL_MS}, so the record cannot
 * accumulate measurements forever. The record's own `measuredAt` and `outcome`
 * are always this run's, so the card reports the run that just happened —
 * including the honest "nothing answered" one.
 */
export function mergeLatencyReadings(
  previous: DerpMirrorLatency | undefined,
  next: DerpMirrorLatency,
): DerpMirrorLatency {
  const merged = new Map<number, DerpLatencyRegionReading>();
  for (const region of next.regions) {
    merged.set(region.regionId, region);
  }

  // This run's own timestamp is the reference: an entry is carried over only
  // while it is still fresh as of the run being stored.
  const referenceMs = Date.parse(next.measuredAt);
  if (Number.isFinite(referenceMs)) {
    const reference = new Date(referenceMs);
    for (const region of previous?.regions ?? []) {
      if (!merged.has(region.regionId) && isFreshReading(region, reference)) {
        merged.set(region.regionId, region);
      }
    }
  }

  return {
    measuredAt: next.measuredAt,
    outcome: next.outcome,
    regions: [...merged.values()].toSorted((a, b) => a.regionId - b.regionId),
  };
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
