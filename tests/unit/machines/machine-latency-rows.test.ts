import { describe, expect, test } from "vitest";

import {
  buildMachineLatencyRows,
  embeddedDerpRegion,
  relayRegionSources,
  servedDerpRegionIds,
  type DerpEmbeddedServer,
  type DerpRegionLabelSources,
  type MachineLatencyInventory,
} from "~/routes/machines/derp-info";
import { derpNodeSources } from "~/routes/overview-helpers";
import type { DerpMapGroupReading } from "~/server/headscale/derp-region-sources";

const UNKNOWN = "Unknown";

const EMBEDDED: DerpEmbeddedServer = {
  enabled: true,
  regionId: 999,
  regionCode: "headscale",
  regionName: "Headscale Embedded DERP",
};

/** The region mirror's own file, as `derp.paths` lists it. */
const MIRROR_GROUP: DerpMapGroupReading = {
  source: "/var/lib/headplane/official-mirror.yaml",
  kind: "mirror",
  state: "ok",
  regions: [
    { regionId: 901, code: "hkg", name: "香港", nodes: [] },
    { regionId: 902, code: "sin", name: "新加坡", nodes: [] },
  ],
};

/** The official map `derp.urls` advertises, which this deployment does not serve. */
const OFFICIAL_GROUP: DerpMapGroupReading = {
  source: "https://controlplane.tailscale.com/derpmap/default",
  kind: "remote",
  state: "ok",
  regions: [
    { regionId: 1, code: "ams", name: "Amsterdam", nodes: [] },
    { regionId: 2, code: "sin", name: "Singapore", nodes: [] },
  ],
};

/** The label chain the card resolves, exactly as the loader hands it over. */
const LABEL_SOURCES: DerpRegionLabelSources = {
  local: {
    "901": { regionId: 901, code: "hkg", name: "香港" },
    "902": { regionId: 902, code: "sin", name: "新加坡" },
  },
  remote: {
    "1": { regionId: 1, code: "ams", name: "Amsterdam" },
    "2": { regionId: 2, code: "sin", name: "Singapore" },
  },
  embedded: embeddedDerpRegion(EMBEDDED),
};

/** The served-node inventory the machine loader builds from the same maps. */
const NODE_SOURCES = derpNodeSources({
  embedded: {
    enabled: EMBEDDED.enabled,
    regionId: EMBEDDED.regionId,
    code: EMBEDDED.regionCode,
    name: EMBEDDED.regionName,
  },
  groups: [MIRROR_GROUP, OFFICIAL_GROUP],
  mirrorEnabled: true,
});

/** The region-to-source lookup the card badges each row with. */
const RELAY_SOURCES = relayRegionSources(
  [MIRROR_GROUP, OFFICIAL_GROUP],
  embeddedDerpRegion(EMBEDDED),
);

/** The inventory the loader prepares, with only the fields a test cares about. */
function inventory(overrides: Partial<MachineLatencyInventory> = {}): MachineLatencyInventory {
  return {
    servedRegionIds: servedDerpRegionIds(NODE_SOURCES),
    assignment: {},
    measured: {},
    ...overrides,
  };
}

describe("servedDerpRegionIds", () => {
  test("lists the embedded region and every region of a loaded map", () => {
    expect(servedDerpRegionIds(NODE_SOURCES)).toEqual([901, 902, 999]);
  });

  test("leaves out a region only the upstream map advertises", () => {
    // Regions 1 and 2 reach clients through `derp.urls`; this deployment does not
    // serve them itself, so they are not part of its inventory.
    const served = servedDerpRegionIds(NODE_SOURCES);
    expect(served).not.toContain(1);
    expect(served).not.toContain(2);
  });

  test("leaves out the filter's file while the configuration does not load it", () => {
    const pending = derpNodeSources({
      embedded: { enabled: false, regionId: 999 },
      groups: [{ ...MIRROR_GROUP, unlisted: true }],
      mirrorEnabled: true,
    });

    expect(servedDerpRegionIds(pending)).toEqual([]);
  });

  test("lists nothing for a disabled embedded relay with no map", () => {
    const empty = derpNodeSources({
      embedded: { enabled: false, regionId: 999 },
      groups: [],
      mirrorEnabled: false,
    });

    expect(servedDerpRegionIds(empty)).toEqual([]);
  });
});

describe("buildMachineLatencyRows", () => {
  const base = { sources: LABEL_SOURCES, unknown: UNKNOWN, relaySources: RELAY_SOURCES };

  test("lists every served region, measured or not", () => {
    const { rows, summary } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { PreferredDERP: 901, DERPLatency: { "901": 0.02 } } },
      inventory: inventory({ assignment: { "1": 901, "2": 902 }, measured: { "1": 42, "2": 58 } }),
    });

    expect(rows.map((row) => [row.regionId, row.latency, row.latencySource])).toEqual([
      [901, "20ms", "reported"],
      [902, "58ms", "measured"],
      [999, undefined, undefined],
    ]);
    // Every label comes from the one chain, the embedded region marked like it.
    expect(rows.map((row) => row.label)).toEqual([
      "#901 · hkg · 香港",
      "#902 · sin · 新加坡",
      "#999 · headscale · Headscale Embedded DERP",
    ]);
    expect(summary).toEqual({ total: 3, reported: 1, measured: 1, unmeasured: 1 });
  });

  test("prefers the machine's own value over the server's measurement", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { DERPLatency: { "901": 0.02 } } },
      inventory: inventory({ assignment: { "1": 901 }, measured: { "1": 42 } }),
    });

    expect(rows.find((row) => row.regionId === 901)).toMatchObject({
      latency: "20ms",
      latencySource: "reported",
    });
  });

  test("translates the probe's official id into the mirrored number the row shows", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: undefined,
      inventory: inventory({ assignment: { "1": 901 }, measured: { "1": 42 } }),
    });

    expect(rows.map((row) => [row.regionId, row.latency, row.latencySource])).toEqual([
      [901, "42ms", "measured"],
      [902, undefined, undefined],
      [999, undefined, undefined],
    ]);
  });

  test("uses a measurement keyed by the row's own id before translating", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: undefined,
      inventory: inventory({ assignment: { "1": 901 }, measured: { "1": 42, "901": 77 } }),
    });

    expect(rows[0]).toMatchObject({ regionId: 901, latency: "77ms", latencySource: "measured" });
  });

  test("shows nothing for a measurement the assignment cannot attribute", () => {
    const { rows, summary } = buildMachineLatencyRows({
      ...base,
      info: undefined,
      // Official region 1 was measured, but no mirrored row carries its number.
      inventory: inventory({ measured: { "1": 42 } }),
    });

    expect(rows.map((row) => row.latency)).toEqual([undefined, undefined, undefined]);
    expect(summary).toEqual({ total: 3, reported: 0, measured: 0, unmeasured: 3 });
  });

  test("keeps a measured region the deployment does not serve", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { PreferredDERP: 902, DERPLatency: { "902": 0.058, "1": 0.06 } } },
      inventory: inventory(),
    });

    expect(rows).toEqual([
      {
        key: "id:902",
        label: "#902 · sin · 新加坡",
        regionId: 902,
        latency: "58ms",
        latencySource: "reported",
        inUse: true,
        source: "mirror",
      },
      // The machine measured an official relay this deployment only advertises:
      // the row stays, labelled with the upstream source that describes it.
      {
        key: "id:1",
        label: "#1 · ams · Amsterdam",
        regionId: 1,
        latency: "60ms",
        latencySource: "reported",
        inUse: false,
        source: "official",
      },
      { key: "id:901", label: "#901 · hkg · 香港", regionId: 901, inUse: false, source: "mirror" },
      {
        key: "id:999",
        label: "#999 · headscale · Headscale Embedded DERP",
        regionId: 999,
        inUse: false,
        source: "embedded",
      },
    ]);
  });

  test("keeps a legacy sample no region can be named for", () => {
    const { rows, summary } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { DERPLatency: { "derp1.tailscale.com:3478": 0.2 } } },
      inventory: inventory(),
    });

    expect(rows[0]).toEqual({
      key: "key:derp1.tailscale.com:3478",
      label: "derp1.tailscale.com:3478",
      latency: "200ms",
      latencySource: "reported",
      inUse: false,
    });
    expect(summary).toEqual({ total: 4, reported: 1, measured: 0, unmeasured: 3 });
  });

  test("keeps the machine's samples when the deployment serves nothing", () => {
    const { rows, summary } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { PreferredDERP: 999, DERPLatency: { "999": 0.031 } } },
      inventory: { servedRegionIds: [], assignment: {}, measured: {} },
    });

    expect(rows).toEqual([
      {
        key: "id:999",
        label: "#999 · headscale · Headscale Embedded DERP",
        regionId: 999,
        latency: "31ms",
        latencySource: "reported",
        inUse: true,
        source: "embedded",
      },
    ]);
    expect(summary).toEqual({ total: 1, reported: 1, measured: 0, unmeasured: 0 });
  });

  test("counts a region once when the machine measured both families", () => {
    const { rows, summary } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { DERPLatency: { "901-v4": 0.02, "901-v6": 0.03 } } },
      inventory: inventory(),
    });

    expect(rows[0]).toMatchObject({ regionId: 901, latency: "20ms", latencySource: "reported" });
    expect(summary).toEqual({ total: 3, reported: 1, measured: 0, unmeasured: 2 });
  });

  test("lists a region once however often the inventory names it", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: undefined,
      inventory: { servedRegionIds: [901, 901, 999], assignment: {}, measured: {} },
    });

    expect(rows.map((row) => row.key)).toEqual(["id:901", "id:999"]);
  });

  test("orders the fastest first and the unmeasured regions after them", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: { NetInfo: { PreferredDERP: 999, DERPLatency: { "999": 0.4, "901": 0.02 } } },
      inventory: inventory(),
    });

    // The used relay is the agent's own preference, never the fastest sample.
    expect(rows.map((row) => [row.regionId, row.inUse])).toEqual([
      [901, false],
      [999, true],
      [902, false],
    ]);
  });

  test("resolves every row through the name chain, manual names first", () => {
    const { rows } = buildMachineLatencyRows({
      ...base,
      info: undefined,
      inventory: inventory(),
      sources: { ...LABEL_SOURCES, manual: { "901": "广东东莞" } },
    });

    expect(rows.find((row) => row.regionId === 901)?.label).toBe("#901 · 广东东莞");
  });

  test("keeps the embedded region when no map is configured at all", () => {
    const nodeSources = derpNodeSources({
      embedded: {
        enabled: EMBEDDED.enabled,
        regionId: EMBEDDED.regionId,
        code: EMBEDDED.regionCode,
        name: EMBEDDED.regionName,
      },
      groups: [],
      mirrorEnabled: false,
    });

    const { rows, summary } = buildMachineLatencyRows({
      ...base,
      info: undefined,
      inventory: {
        servedRegionIds: servedDerpRegionIds(nodeSources),
        assignment: {},
        measured: {},
      },
    });

    expect(rows).toEqual([
      {
        key: "id:999",
        label: "#999 · headscale · Headscale Embedded DERP",
        regionId: 999,
        inUse: false,
        source: "embedded",
      },
    ]);
    expect(summary).toEqual({ total: 1, reported: 0, measured: 0, unmeasured: 1 });
  });
});
