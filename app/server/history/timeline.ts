// MARK: History maths
//
// Everything the availability cards need, as pure functions over the stored
// document: no I/O, no clock of its own and no React. Both windows the UI can
// ask for are buckets of equal width, and a bucket is only ever "known" when
// two things line up:
//
//   1. at least one tick fell inside it — the sampler was running, so the
//      record is continuous across that bucket; and
//   2. the node has a sample at or before the bucket opened — its state was
//      observed before the bucket started.
//
// Anything else is `unknown`, which renders as a gap. That distinction is the
// whole point: a period Headplane was not running must never be counted as
// either uptime or downtime.

import type { NodeHistoryDocument, NodeHistorySample } from "./types";

export type HistoryWindowKey = "24h" | "7d";

export interface HistoryWindowDefinition {
  durationMs: number;
  /** How many columns the bar draws. */
  buckets: number;
}

/** The windows the availability cards can show, oldest first. */
export const HISTORY_WINDOWS: Record<HistoryWindowKey, HistoryWindowDefinition> = {
  "24h": { durationMs: 24 * 60 * 60 * 1000, buckets: 24 },
  "7d": { durationMs: 7 * 24 * 60 * 60 * 1000, buckets: 28 },
};

/** The state of one node over one bucket; `unknown` is a gap, not "offline". */
export type TimelineState = "online" | "offline" | "unknown";

export interface NodeUptime {
  online: number;
  offline: number;
  unknown: number;
  total: number;
  /** `online / (online + offline)`; `undefined` when the window holds nothing known. */
  ratio: number | undefined;
}

export interface NodeTimeline {
  window: HistoryWindowKey;
  /** Window bounds, ISO. */
  from: string;
  to: string;
  /** One entry per bucket, oldest first. */
  buckets: TimelineState[];
  uptime: NodeUptime;
  /** The node's oldest retained sample: when collection for it began. */
  collectingSince?: string;
  /** True while the node's record is younger than the window. */
  partial: boolean;
}

export interface FleetTrendBucket {
  from: string;
  /** False when no tick landed in this bucket, so nothing can be said about it. */
  covered: boolean;
  /** Nodes known to be online in this bucket. */
  online: number;
  /** Nodes whose state is known in this bucket; the denominator of `online`. */
  known: number;
}

export interface FleetTrend {
  window: HistoryWindowKey;
  from: string;
  to: string;
  buckets: FleetTrendBucket[];
  /** The oldest tick the store holds: when collection began. */
  collectingSince?: string;
  /** True while the store is younger than the window. */
  partial: boolean;
}

interface ResolvedWindow {
  from: number;
  to: number;
  bucketMs: number;
  buckets: number;
}

function resolveWindow(window: HistoryWindowKey, now: number): ResolvedWindow {
  const definition = HISTORY_WINDOWS[window];
  const to = Math.floor(now);
  return {
    from: to - definition.durationMs,
    to,
    bucketMs: definition.durationMs / definition.buckets,
    buckets: definition.buckets,
  };
}

/**
 * Which buckets the sample ticks cover. Ticks and buckets are both in
 * chronological order, so one forward pass is enough.
 */
function coverageByBucket(ticks: readonly string[], resolved: ResolvedWindow): boolean[] {
  const times = ticks
    .map((tick) => Date.parse(tick))
    .filter((time) => Number.isFinite(time))
    .toSorted((a, b) => a - b);

  const covered: boolean[] = [];
  let index = 0;
  for (let bucket = 0; bucket < resolved.buckets; bucket += 1) {
    const start = resolved.from + bucket * resolved.bucketMs;
    const end = start + resolved.bucketMs;

    while (index < times.length && times[index] < start) {
      index += 1;
    }

    // Buckets are half-open, so a tick on a boundary belongs to the bucket it
    // starts and is counted exactly once. The window's end is the exception:
    // there is no bucket after the last one, so that bucket also claims a tick
    // at exactly `now` instead of dropping it.
    const isLastBucket = bucket === resolved.buckets - 1;
    covered.push(index < times.length && (isLastBucket ? times[index] <= end : times[index] < end));
  }

  return covered;
}

/** The last sample at or before `at`, or `undefined` when the record predates none of it. */
function stateAt(samples: readonly NodeHistorySample[], at: number): NodeHistorySample | undefined {
  let low = 0;
  let high = samples.length - 1;
  let found: NodeHistorySample | undefined;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const time = Date.parse(samples[middle].at);
    if (Number.isFinite(time) && time <= at) {
      found = samples[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

function bounds(resolved: ResolvedWindow): { from: string; to: string } {
  return { from: new Date(resolved.from).toISOString(), to: new Date(resolved.to).toISOString() };
}

/** `true` while the record starts inside the window instead of before it. */
function isPartial(since: string | undefined, from: number): boolean {
  if (since === undefined) {
    return true;
  }

  const time = Date.parse(since);
  return !Number.isFinite(time) || time > from;
}

/** One node's bucketed timeline and uptime over a window. */
export function computeNodeTimeline(
  document: NodeHistoryDocument,
  nodeId: string,
  window: HistoryWindowKey,
  now: number,
): NodeTimeline {
  const resolved = resolveWindow(window, now);
  const covered = coverageByBucket(document.ticks, resolved);
  const record = document.nodes.find((entry) => entry.id === nodeId);

  const buckets: TimelineState[] = [];
  for (let bucket = 0; bucket < resolved.buckets; bucket += 1) {
    if (!covered[bucket]) {
      buckets.push("unknown");
      continue;
    }

    const sample = record
      ? stateAt(record.samples, resolved.from + bucket * resolved.bucketMs)
      : undefined;
    buckets.push(sample === undefined ? "unknown" : sample.online ? "online" : "offline");
  }

  let online = 0;
  let offline = 0;
  for (const state of buckets) {
    if (state === "online") {
      online += 1;
    } else if (state === "offline") {
      offline += 1;
    }
  }

  const collectingSince = record?.samples[0]?.at;
  return {
    window,
    ...bounds(resolved),
    buckets,
    uptime: {
      online,
      offline,
      unknown: resolved.buckets - online - offline,
      total: resolved.buckets,
      ratio: online + offline === 0 ? undefined : online / (online + offline),
    },
    ...(collectingSince === undefined ? {} : { collectingSince }),
    partial: isPartial(collectingSince, resolved.from),
  };
}

/** The fleet-wide online count per bucket over a window. */
export function computeFleetTrend(
  document: NodeHistoryDocument,
  window: HistoryWindowKey,
  now: number,
): FleetTrend {
  const resolved = resolveWindow(window, now);
  const covered = coverageByBucket(document.ticks, resolved);

  const buckets: FleetTrendBucket[] = [];
  for (let bucket = 0; bucket < resolved.buckets; bucket += 1) {
    const start = resolved.from + bucket * resolved.bucketMs;
    let online = 0;
    let known = 0;

    if (covered[bucket]) {
      for (const record of document.nodes) {
        const sample = stateAt(record.samples, start);
        if (sample === undefined) {
          continue;
        }

        known += 1;
        if (sample.online) {
          online += 1;
        }
      }
    }

    buckets.push({ from: new Date(start).toISOString(), covered: covered[bucket], online, known });
  }

  const collectingSince = document.ticks[0];
  return {
    window,
    ...bounds(resolved),
    buckets,
    ...(collectingSince === undefined ? {} : { collectingSince }),
    partial: isPartial(collectingSince, resolved.from),
  };
}

/** A whole-number uptime percentage, or `undefined` when nothing is known yet. */
export function uptimePercent(uptime: NodeUptime): number | undefined {
  return uptime.ratio === undefined ? undefined : Math.round(uptime.ratio * 100);
}
