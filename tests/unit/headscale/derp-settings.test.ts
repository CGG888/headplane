import { describe, expect, test } from "vitest";

import {
  DERP_REGION_ID_MAX,
  DERP_REGION_ID_MIN,
  isDerpRegionId,
  isHttpUrl,
  parseDerpRegionId,
  parseDerpUpdateFrequencySeconds,
} from "~/routes/settings/headscale/derp-settings";
import { buildDerpRelayRows, fastestDerpLatency } from "~/routes/settings/headscale/derp-status";
import type { Machine } from "~/types";

function node(overrides: Partial<Machine> & { nodeKey: string }): Machine {
  return {
    id: overrides.nodeKey,
    machineKey: `machine-${overrides.nodeKey}`,
    discoKey: `disco-${overrides.nodeKey}`,
    ipAddresses: [],
    name: overrides.nodeKey,
    lastSeen: "2025-01-01T00:00:00Z",
    expiry: null,
    createdAt: "2025-01-01T00:00:00Z",
    registerMethod: "REGISTER_METHOD_AUTH_KEY",
    tags: [],
    givenName: overrides.nodeKey,
    online: true,
    approvedRoutes: [],
    availableRoutes: [],
    subnetRoutes: [],
    ...overrides,
  };
}

describe("DERP region IDs", () => {
  test("accepts only the range Headscale reserves for embedded regions", () => {
    expect(DERP_REGION_ID_MIN).toBe(900);
    expect(DERP_REGION_ID_MAX).toBe(999);
    expect(isDerpRegionId(900)).toBe(true);
    expect(isDerpRegionId(950)).toBe(true);
    expect(isDerpRegionId(999)).toBe(true);
    expect(isDerpRegionId(899)).toBe(false);
    expect(isDerpRegionId(1000)).toBe(false);
    expect(isDerpRegionId(900.5)).toBe(false);
  });

  test("parses form values and rejects anything outside the range", () => {
    expect(parseDerpRegionId(" 901 ")).toBe(901);
    expect(parseDerpRegionId("999")).toBe(999);
    expect(parseDerpRegionId("899")).toBeUndefined();
    expect(parseDerpRegionId("1000")).toBeUndefined();
    expect(parseDerpRegionId("9.5")).toBeUndefined();
    expect(parseDerpRegionId("-901")).toBeUndefined();
    expect(parseDerpRegionId("")).toBeUndefined();
    expect(parseDerpRegionId("nine")).toBeUndefined();
  });
});

describe("DERP update frequency", () => {
  test("accepts Go durations Headscale can parse", () => {
    expect(parseDerpUpdateFrequencySeconds("3h")).toBe(10_800);
    expect(parseDerpUpdateFrequencySeconds(" 30m ")).toBe(1_800);
    expect(parseDerpUpdateFrequencySeconds("1h30m")).toBe(5_400);
  });

  test("rejects zero, empty and non-duration values", () => {
    // A zero interval would make Headscale's DERP updater busy-loop.
    expect(parseDerpUpdateFrequencySeconds("0")).toBeUndefined();
    expect(parseDerpUpdateFrequencySeconds("")).toBeUndefined();
    expect(parseDerpUpdateFrequencySeconds("3")).toBeUndefined();
    expect(parseDerpUpdateFrequencySeconds("3d")).toBeUndefined();
    expect(parseDerpUpdateFrequencySeconds("soon")).toBeUndefined();
  });
});

describe("DERP map URLs", () => {
  test("only accepts http(s)", () => {
    expect(isHttpUrl("https://controlplane.tailscale.com/derpmap/default")).toBe(true);
    expect(isHttpUrl("http://derp.internal/map.yaml")).toBe(true);
    expect(isHttpUrl("ftp://derp.internal/map.yaml")).toBe(false);
    expect(isHttpUrl("/etc/headscale/derp.yaml")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("agent relay rows", () => {
  test("picks the fastest reported latency", () => {
    expect(fastestDerpLatency({ "900": 0.052, "901": 0.011, "902": 0.4 })).toEqual({
      region: "901",
      seconds: 0.011,
    });
    expect(fastestDerpLatency({})).toBeUndefined();
    expect(fastestDerpLatency(undefined)).toBeUndefined();
    expect(fastestDerpLatency({ "900": Number.NaN })).toBeUndefined();
  });

  test("maps host info onto named, sorted rows", () => {
    const rows = buildDerpRelayRows(
      [node({ nodeKey: "b", givenName: "zulu" }), node({ nodeKey: "a", givenName: "alpha" })],
      {
        a: { HomeDERP: 900, NetInfo: { PreferredDERP: 901, DERPLatency: { "900": 0.2 } } },
      },
    );

    expect(rows.map((row) => row.name)).toEqual(["alpha", "zulu"]);
    expect(rows[0]).toEqual({
      nodeKey: "a",
      name: "alpha",
      homeRegion: 900,
      preferredRegion: 901,
      latency: { region: "900", seconds: 0.2 },
    });
    // A machine the agent has not reported on still gets a row.
    expect(rows[1]).toEqual({
      nodeKey: "b",
      name: "zulu",
      homeRegion: undefined,
      preferredRegion: undefined,
      latency: undefined,
    });
  });
});
