import { describe, expect, test } from "vitest";

import {
  locallyMeasuredRegionLatencies,
  mergeLatencyReadings,
  officialRegionLatencies,
  preferredRegionLatencies,
} from "~/server/derp-mirror/latency";
import type { DerpMirrorLatency } from "~/server/derp-mirror/types";
import type { HostInfo } from "~/types";
import type { AgentHostRecord } from "~/utils/agent-coverage";

function record(nodeKey: string, latencies: Record<string, number> | undefined): AgentHostRecord {
  return {
    nodeKey,
    updatedAt: null,
    host: { NetInfo: { DERPLatency: latencies } } as HostInfo,
  };
}

describe("measured relay latency per region", () => {
  test("reduces every host and family to the fastest sample per region, in milliseconds", () => {
    const latencies = officialRegionLatencies([
      record("a", { "901": 0.02, "901-v6": 0.05, "903": 0.2 }),
      record("b", { "901": 0.01, "903-v4": 0.3, "904": 0.5 }),
    ]);

    expect(latencies).toEqual({ "901": 10, "903": 200, "904": 500 });
  });

  test("ignores samples that name no region or are not usable numbers", () => {
    const latencies = officialRegionLatencies([
      record("a", {
        "hkg.example.com:3478": 0.01,
        hkg: 0.02,
        "901": Number.NaN,
        "903": -1,
        "905": Number.POSITIVE_INFINITY,
      }),
    ]);

    expect(latencies).toEqual({});
  });

  test("reads nothing from hosts that reported nothing", () => {
    expect(officialRegionLatencies([])).toEqual({});
    expect(officialRegionLatencies([record("a", undefined)])).toEqual({});
    expect(
      officialRegionLatencies([{ nodeKey: "a", host: {} as HostInfo, updatedAt: null }]),
    ).toEqual({});
  });
});

/** One stored region, reduced to the fields these tests vary. */
function measuredRegion(
  regionId: number,
  values: { bestV4?: number; bestV6?: number; nodes?: number[] },
): DerpMirrorLatency["regions"][number] {
  return {
    regionId,
    regionCode: `r${regionId}`,
    ...(values.bestV4 === undefined ? {} : { bestV4: values.bestV4 }),
    ...(values.bestV6 === undefined ? {} : { bestV6: values.bestV6 }),
    nodes: (values.nodes ?? []).map((latencyMs, index) => ({
      name: `n${index}`,
      hostname: `n${index}.example.com`,
      family: "ipv4" as const,
      target: `44.1.1.${index + 1}`,
      latencyMs,
      method: "stun" as const,
    })),
    measuredAt: "2026-01-02T03:04:05.000Z",
    source: "measured",
  };
}

describe("latencies measured on this server", () => {
  test("reduces each region to its fastest family, in milliseconds", () => {
    const latency: DerpMirrorLatency = {
      measuredAt: "2026-01-02T03:04:05.000Z",
      outcome: "complete",
      regions: [measuredRegion(20, { bestV4: 30, bestV6: 12 }), measuredRegion(3, { bestV4: 45 })],
    };

    expect(locallyMeasuredRegionLatencies(latency, new Date("2026-01-03T00:00:00.000Z"))).toEqual({
      "20": 12,
      "3": 45,
    });
  });

  test("reads the per-node values of a record written without family bests", () => {
    const latency: DerpMirrorLatency = {
      measuredAt: "2026-01-02T03:04:05.000Z",
      outcome: "complete",
      regions: [measuredRegion(20, { nodes: [30, 12, 44] })],
    };

    expect(locallyMeasuredRegionLatencies(latency, new Date("2026-01-03T00:00:00.000Z"))).toEqual({
      "20": 12,
    });
  });

  test("reads nothing from a record that has none", () => {
    expect(locallyMeasuredRegionLatencies(undefined)).toEqual({});
    expect(
      locallyMeasuredRegionLatencies({
        measuredAt: "2026-01-02T03:04:05.000Z",
        outcome: "empty",
        regions: [],
      }),
    ).toEqual({});
  });

  test("prefers the local value and keeps the reported one everywhere else", () => {
    expect(preferredRegionLatencies({ "20": 12 }, { "20": 300, "3": 45 })).toEqual({
      "20": 12,
      "3": 45,
    });
  });
});

describe("stored latency age", () => {
  test("a reading older than the TTL is no longer a measurement", () => {
    const latency: DerpMirrorLatency = {
      measuredAt: "2026-01-02T03:04:05.000Z",
      outcome: "complete",
      regions: [measuredRegion(20, { bestV4: 30 })],
    };

    // Probing happens on demand, so a reading from weeks ago must not outrank
    // the latency the relay reports today.
    expect(locallyMeasuredRegionLatencies(latency, new Date("2026-01-20T00:00:00.000Z"))).toEqual(
      {},
    );
    expect(locallyMeasuredRegionLatencies(latency, new Date("2026-01-03T00:00:00.000Z"))).toEqual({
      "20": 30,
    });
  });

  test("merging drops an entry older than the run being stored", () => {
    const previous: DerpMirrorLatency = {
      measuredAt: "2026-01-02T03:04:05.000Z",
      outcome: "complete",
      regions: [measuredRegion(20, { bestV4: 30 }), measuredRegion(21, { bestV4: 40 })],
    };

    const merged = mergeLatencyReadings(previous, {
      measuredAt: "2026-02-02T03:04:05.000Z",
      outcome: "partial",
      regions: [measuredRegion(20, { bestV4: 12 })],
    });

    expect(merged.measuredAt).toBe("2026-02-02T03:04:05.000Z");
    // Region 21 was measured by a run that is now stale, so it is not carried
    // forward; region 20 is this run's own value.
    expect(merged.regions.map((region) => region.regionId)).toEqual([20]);
    expect(merged.regions[0]?.bestV4).toBe(12);
  });
});
