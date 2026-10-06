import { describe, expect, test } from "vitest";

import { officialRegionLatencies } from "~/server/derp-mirror/latency";
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
