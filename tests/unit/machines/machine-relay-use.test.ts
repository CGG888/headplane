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
  test("badges the relay in use and the region this machine calls home", () => {
    const info = { HomeDERP: 901, NetInfo: { PreferredDERP: 902 } };
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
  });

  test("marks only the relay in use when the home region serves it", () => {
    // The healthy case: the client relays through its home region. Only the
    // preferred row is the relay in use, because "home" describes the region the
    // control plane assigned, not a second relay the client is connected to.
    const info = { HomeDERP: 901, NetInfo: { PreferredDERP: 901 } };
    const view = buildDerpInfo(info, { ...EMBEDDED, enabled: false }, UNKNOWN);
    const usage = buildMachineRelayUse(info, view);

    expect(usage.home).toEqual({
      key: "id:901",
      label: "#901",
      regionId: 901,
      inUse: false,
    });
    expect(usage.preferred).toEqual({
      key: "id:901",
      label: "#901",
      regionId: 901,
      inUse: true,
    });
  });

  test("names the embedded region the agent reports as preferred", () => {
    const info = { NetInfo: { PreferredDERP: 999 } };
    const view = buildDerpInfo(info, EMBEDDED, UNKNOWN);
    const usage = buildMachineRelayUse(info, view, { "999": "embedded" });

    expect(usage.preferred).toEqual({
      key: "id:999",
      label: "#999 · headscale · Headscale Embedded DERP",
      regionId: 999,
      inUse: true,
      source: "embedded",
    });
    // A key that names no region id is not an unresolved region, so the card's
    // id-only note stays off.
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
  });
});
