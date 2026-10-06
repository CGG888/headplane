import { describe, expect, test } from "vitest";

import {
  buildDerpInfo,
  buildMachineRelayUse,
  embeddedDerpRegion,
  relayRegionSources,
  type DerpEmbeddedServer,
} from "~/routes/machines/derp-info";
import type { DerpMapGroupReading } from "~/server/headscale/derp-region-sources";

const UNKNOWN = "Unknown";

const EMBEDDED: DerpEmbeddedServer = {
  enabled: true,
  regionId: 999,
  regionCode: "headscale",
  regionName: "Headscale Embedded DERP",
};

function group(
  kind: DerpMapGroupReading["kind"],
  regionIds: number[],
  source = "derp.yaml",
): DerpMapGroupReading {
  return {
    source,
    kind,
    state: "ok",
    regions: regionIds.map((regionId) => ({ regionId, code: "", name: "", nodes: [] })),
  };
}

describe("relayRegionSources", () => {
  test("claims the embedded relay first, then each configured map in order", () => {
    expect(
      relayRegionSources(
        [group("local", [999, 901]), group("remote", [901, 903])],
        embeddedDerpRegion(EMBEDDED),
      ),
    ).toEqual({ "901": "local", "903": "official", "999": "embedded" });
  });

  test("keeps the region mirror's file apart from a plain local map", () => {
    expect(
      relayRegionSources(
        [group("local", [901]), group("mirror", [902], "/var/lib/headplane/derp.json")],
        undefined,
      ),
    ).toEqual({ "901": "local", "902": "mirror" });
  });

  test("describes no region without an enabled embedded relay or a readable map", () => {
    expect(relayRegionSources([], embeddedDerpRegion({ ...EMBEDDED, enabled: false }))).toEqual({});
    expect(relayRegionSources([], undefined)).toEqual({});
  });
});

describe("buildMachineRelayUse", () => {
  test("badges every relay row with its source and the preferred one as in use", () => {
    const info = {
      HomeDERP: 901,
      NetInfo: { PreferredDERP: 902, DERPLatency: { "901": 0.02, "902": 0.05, "903": 0.4 } },
    };
    const view = buildDerpInfo(info, { ...EMBEDDED, enabled: false }, UNKNOWN, {
      local: { "901": { regionId: 901, code: "ams", name: "Amsterdam" } },
    });
    const usage = buildMachineRelayUse(info, view, {
      "901": "local",
      "902": "mirror",
      "903": "official",
    });

    expect(usage.home).toEqual({
      key: "id:901",
      label: "#901 · ams · Amsterdam",
      regionId: 901,
      inUse: false,
      source: "local",
    });
    expect(usage.preferred).toEqual({
      key: "id:902",
      label: "#902",
      regionId: 902,
      inUse: true,
      source: "mirror",
    });
    expect(usage.latencies).toEqual([
      {
        key: "id:901",
        label: "#901 · ams · Amsterdam",
        regionId: 901,
        latency: "20ms",
        inUse: false,
        source: "local",
      },
      {
        key: "id:902",
        label: "#902",
        regionId: 902,
        latency: "50ms",
        inUse: true,
        source: "mirror",
      },
      {
        key: "id:903",
        label: "#903",
        regionId: 903,
        latency: "400ms",
        inUse: false,
        source: "official",
      },
    ]);
  });

  test("marks the agent's own preferred region, never the fastest one", () => {
    const info = { NetInfo: { PreferredDERP: 903, DERPLatency: { "903": 0.4, "901": 0.02 } } };
    const view = buildDerpInfo(info, { ...EMBEDDED, enabled: false }, UNKNOWN);
    const usage = buildMachineRelayUse(info, view, { "903": "official" });

    expect(usage.preferred.inUse).toBe(true);
    // The fastest sample is not the used relay.
    expect(usage.latencies.map((row) => [row.regionId, row.inUse])).toEqual([
      [901, false],
      [903, true],
    ]);
  });

  test("badges nothing for a legacy key no map can name", () => {
    const info = {
      NetInfo: {
        PreferredDERP: 999,
        DERPLatency: { "derp1.tailscale.com:3478": 0.2, "999": 0.01 },
      },
    };
    const view = buildDerpInfo(info, EMBEDDED, UNKNOWN);
    const usage = buildMachineRelayUse(info, view, { "999": "embedded" });

    expect(usage.preferred).toEqual({
      key: "id:999",
      label: "#999 · headscale · Headscale Embedded DERP",
      regionId: 999,
      inUse: true,
      source: "embedded",
    });
    expect(usage.latencies.map((row) => [row.key, row.latency, row.source])).toEqual([
      ["id:999", "10ms", "embedded"],
      ["key:derp1.tailscale.com:3478", "200ms", undefined],
    ]);
    // A key that names no region id is not an unresolved region, so the card's
    // id-only note stays off; only the badge is missing from that row.
    expect(view.hasIdOnlyRegions).toBe(false);
  });

  test("leaves every row unused before the agent reports a preferred region", () => {
    const info = { HomeDERP: 901 };
    const view = buildDerpInfo(info, { ...EMBEDDED, enabled: false }, UNKNOWN);
    const usage = buildMachineRelayUse(info, view);

    expect(usage.home).toEqual({
      key: "id:901",
      label: "#901",
      regionId: 901,
      inUse: false,
    });
    expect(usage.preferred).toEqual({ key: "key:preferred", label: UNKNOWN, inUse: false });
    expect(usage.latencies).toEqual([]);
  });
});
