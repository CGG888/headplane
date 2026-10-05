import { describe, expect, test } from "vitest";

import { appendHistorySample } from "~/server/history/sample";
import {
  computeFleetTrend,
  computeNodeTimeline,
  HISTORY_WINDOWS,
  uptimePercent,
} from "~/server/history/timeline";
import {
  emptyHistoryDocument,
  type NodeHistoryDocument,
  type NodeHistoryInput,
} from "~/server/history/types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 0, 8, 12, 0, 0);
const FROM_24H = NOW - 24 * HOUR;
const FROM_7D = NOW - 7 * DAY;

const iso = (at: number) => new Date(at).toISOString();

interface Step {
  at: number;
  nodes: NodeHistoryInput[];
}

/** Builds a document the way the sampler would, tick by tick. */
function buildDocument(steps: readonly Step[]): NodeHistoryDocument {
  return steps.reduce(
    (document, step) => appendHistorySample(document, step.nodes, step.at),
    emptyHistoryDocument(),
  );
}

/** One tick per hour across a 24 hour window, with the same nodes each time. */
function hourlyTicks(nodes: NodeHistoryInput[], hours = 24): Step[] {
  return Array.from({ length: hours }, (_, hour) => ({
    at: FROM_24H + hour * HOUR,
    nodes,
  }));
}

describe("computeNodeTimeline", () => {
  test("a covered window with a node that never left is 100% uptime", () => {
    const document = buildDocument(hourlyTicks([{ id: "1", name: "alpha", online: true }]));

    const timeline = computeNodeTimeline(document, "1", "24h", NOW);

    expect(timeline.buckets).toEqual(Array.from({ length: 24 }, () => "online"));
    expect(timeline.uptime).toEqual({ online: 24, offline: 0, unknown: 0, total: 24, ratio: 1 });
    expect(timeline.from).toBe(iso(FROM_24H));
    expect(timeline.to).toBe(iso(NOW));
    expect(timeline.collectingSince).toBe(iso(FROM_24H));
    expect(timeline.partial).toBe(false);
  });

  test("an offline stretch reads offline, never as a gap", () => {
    // Offline for the middle half of the day: the state changes at hour 6 and
    // back at hour 18, and every bucket in between must read offline.
    const document = buildDocument(
      Array.from({ length: 24 }, (_, hour) => ({
        at: FROM_24H + hour * HOUR,
        nodes: [{ id: "1", name: "alpha", online: hour < 6 || hour >= 18 }],
      })),
    );

    const timeline = computeNodeTimeline(document, "1", "24h", NOW);
    expect(timeline.buckets.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => "online"));
    expect(timeline.buckets.slice(6, 18)).toEqual(Array.from({ length: 12 }, () => "offline"));
    expect(timeline.buckets.slice(18)).toEqual(Array.from({ length: 6 }, () => "online"));
    expect(timeline.uptime).toEqual({ online: 12, offline: 12, unknown: 0, total: 24, ratio: 0.5 });
  });

  test("a gap in the record is unknown, not offline", () => {
    // The sampler ran until four hours ago and then stopped, while the node
    // itself was online the whole time.
    const document = buildDocument(
      Array.from({ length: 21 }, (_, hour) => ({
        at: FROM_24H + hour * HOUR,
        nodes: [{ id: "1", name: "alpha", online: true }],
      })),
    );

    const timeline = computeNodeTimeline(document, "1", "24h", NOW);

    expect(timeline.buckets.slice(0, 21).every((state) => state === "online")).toBe(true);
    expect(timeline.buckets.slice(21)).toEqual(["unknown", "unknown", "unknown"]);
    expect(timeline.uptime).toEqual({ online: 21, offline: 0, unknown: 3, total: 24, ratio: 1 });
  });

  test("a brand new store has no known bucket and no ratio", () => {
    const timeline = computeNodeTimeline(emptyHistoryDocument(), "1", "24h", NOW);

    expect(timeline.buckets).toEqual(Array.from({ length: 24 }, () => "unknown"));
    expect(timeline.uptime).toEqual({
      online: 0,
      offline: 0,
      unknown: 24,
      total: 24,
      ratio: undefined,
    });
    expect(timeline.collectingSince).toBeUndefined();
    expect(timeline.partial).toBe(true);
  });

  test("an unknown node id is all unknown, even with a full record", () => {
    const document = buildDocument(hourlyTicks([{ id: "1", online: true }]));

    const timeline = computeNodeTimeline(document, "99", "24h", NOW);

    expect(timeline.uptime.ratio).toBeUndefined();
    expect(timeline.uptime.unknown).toBe(24);
  });

  test("a record younger than the window counts only the buckets it covers", () => {
    const document = buildDocument(
      Array.from({ length: 6 }, (_, hour) => ({
        at: FROM_24H + (18 + hour) * HOUR,
        nodes: [{ id: "1", name: "alpha", online: true }],
      })),
    );

    const timeline = computeNodeTimeline(document, "1", "24h", NOW);

    expect(timeline.buckets.slice(0, 18)).toEqual(Array.from({ length: 18 }, () => "unknown"));
    expect(timeline.buckets.slice(18)).toEqual(Array.from({ length: 6 }, () => "online"));
    expect(timeline.uptime).toEqual({ online: 6, offline: 0, unknown: 18, total: 24, ratio: 1 });
    expect(timeline.collectingSince).toBe(iso(FROM_24H + 18 * HOUR));
    expect(timeline.partial).toBe(true);
  });

  test("the seven day window buckets into six hour periods", () => {
    const document = buildDocument(
      Array.from({ length: 28 }, (_, bucket) => ({
        at: FROM_7D + bucket * (HISTORY_WINDOWS["7d"].durationMs / 28),
        nodes: [{ id: "1", name: "alpha", online: true }],
      })),
    );

    const timeline = computeNodeTimeline(document, "1", "7d", NOW);

    expect(timeline.buckets).toHaveLength(28);
    expect(timeline.buckets.every((state) => state === "online")).toBe(true);
    expect(timeline.uptime.ratio).toBe(1);
  });
});

describe("computeFleetTrend", () => {
  test("counts the nodes online in every covered bucket", () => {
    const document = buildDocument(
      Array.from({ length: 24 }, (_, hour) => ({
        at: FROM_24H + hour * HOUR,
        nodes: [
          { id: "a", name: "alpha", online: true },
          { id: "b", name: "beta", online: false },
          { id: "c", name: "gamma", online: hour < 12 },
        ],
      })),
    );

    const trend = computeFleetTrend(document, "24h", NOW);

    expect(trend.buckets).toHaveLength(24);
    expect(trend.buckets[0]).toEqual({ from: iso(FROM_24H), covered: true, online: 2, known: 3 });
    expect(trend.buckets[11].online).toBe(2);
    expect(trend.buckets[12].online).toBe(1);
    expect(trend.buckets[23]).toEqual({
      from: iso(FROM_24H + 23 * HOUR),
      covered: true,
      online: 1,
      known: 3,
    });
    expect(trend.collectingSince).toBe(iso(FROM_24H));
    expect(trend.partial).toBe(false);
  });

  test("an uncovered bucket reports no coverage and no counts", () => {
    const document = buildDocument(hourlyTicks([{ id: "a", online: true }], 21));

    const trend = computeFleetTrend(document, "24h", NOW);

    expect(trend.buckets[20].covered).toBe(true);
    expect(trend.buckets.slice(21)).toEqual([
      { from: iso(FROM_24H + 21 * HOUR), covered: false, online: 0, known: 0 },
      { from: iso(FROM_24H + 22 * HOUR), covered: false, online: 0, known: 0 },
      { from: iso(FROM_24H + 23 * HOUR), covered: false, online: 0, known: 0 },
    ]);
  });

  test("a brand new store covers nothing", () => {
    const trend = computeFleetTrend(emptyHistoryDocument(), "24h", NOW);

    expect(trend.buckets).toHaveLength(24);
    expect(trend.buckets.every((bucket) => !bucket.covered)).toBe(true);
    expect(trend.collectingSince).toBeUndefined();
    expect(trend.partial).toBe(true);
  });

  test("the seven day window keeps its own bucket count", () => {
    const trend = computeFleetTrend(emptyHistoryDocument(), "7d", NOW);

    expect(trend.buckets).toHaveLength(28);
    expect(trend.from).toBe(iso(FROM_7D));
    expect(HISTORY_WINDOWS["24h"].buckets).toBe(24);
    expect(HISTORY_WINDOWS["7d"].buckets).toBe(28);
  });
});

describe("uptimePercent", () => {
  test("rounds a ratio to a whole percentage", () => {
    expect(uptimePercent({ online: 23, offline: 1, unknown: 0, total: 24, ratio: 23 / 24 })).toBe(
      96,
    );
  });

  test("says nothing when nothing is known", () => {
    expect(
      uptimePercent({ online: 0, offline: 0, unknown: 24, total: 24, ratio: undefined }),
    ).toBeUndefined();
  });
});
