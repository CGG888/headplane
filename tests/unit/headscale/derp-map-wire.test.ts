import { beforeEach, describe, expect, test } from "vitest";

import {
  readAnyDerpMapRegions,
  readDerpMapRegions,
  readTailscaleDerpMapRegions,
} from "~/routes/settings/headscale/derp-map-schema";
import { readAnyDerpMapNodes, readDerpMapNodes } from "~/server/headscale/derp-map-nodes";
import {
  clearRemoteDerpMapCache,
  DERP_MAP_FETCH_TIMEOUT_MS,
  loadRemoteDerpMap,
  loadRemoteDerpMapDetail,
  loadRemoteDerpMapOutcome,
  type DerpMapFetch,
  type DerpMapResponse,
} from "~/server/headscale/derp-map-remote";

/**
 * A byte-for-byte slice of the official map served at
 * `https://controlplane.tailscale.com/derpmap/default`: region `1` (New York
 * City) and region `3` (Singapore), with every node the map listed for them.
 * The wire map is PascalCase; this is the shape that used to parse as zero
 * regions because only the lower-case local spelling was understood.
 */
const WIRE_EXCERPT = `{"Regions":{"1":{"RegionID":1,"RegionCode":"nyc","RegionName":"New York City","Latitude":40.7128,"Longitude":-74.006,"Nodes":[{"Name":"1f","RegionID":1,"HostName":"derp1f.tailscale.com","IPv4":"199.38.181.104","IPv6":"2607:f740:f::bc","CanPort80":true},{"Name":"1g","RegionID":1,"HostName":"derp1g.tailscale.com","IPv4":"209.177.145.120","IPv6":"2607:f740:f::3eb","CanPort80":true},{"Name":"1h","RegionID":1,"HostName":"derp1h.tailscale.com","IPv4":"199.38.181.93","IPv6":"2607:f740:f::afd","CanPort80":true},{"Name":"1i","RegionID":1,"HostName":"derp1i.tailscale.com","IPv4":"199.38.181.103","IPv6":"2607:f740:f::e19","CanPort80":true}]},"3":{"RegionID":3,"RegionCode":"sin","RegionName":"Singapore","Latitude":1.3521,"Longitude":103.8198,"Nodes":[{"Name":"3e","RegionID":3,"HostName":"derp3e.tailscale.com","IPv4":"172.237.72.43","IPv6":"2600:3c15::2000:6cff:fee4:d799","CanPort80":true},{"Name":"3f","RegionID":3,"HostName":"derp3f.tailscale.com","IPv4":"172.237.72.8","IPv6":"2600:3c15::2000:53ff:fe48:a668","CanPort80":true},{"Name":"3g","RegionID":3,"HostName":"derp3g.tailscale.com","IPv4":"172.237.72.79","IPv6":"2600:3c15::2000:adff:fe08:6fab","CanPort80":true},{"Name":"3h","RegionID":3,"HostName":"derp3h.tailscale.com","IPv4":"172.237.66.30","IPv6":"2600:3c15::2000:3dff:fe44:50aa","CanPort80":true}]}}}`;

/** The lower-case local shape the map editor and validator own. */
const LOCAL_MAP = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes:
      - name: 901a
        hostname: derp901a.example.com
        regionid: 901
        derpport: 8443
        stunport: 0
        ipv4: 192.0.2.1
        ipv6: "2001:db8::1"
`;

/** Wire-format nodes that state their ports explicitly. */
const WIRE_PORTS = `{"Regions":{"9":{"RegionID":9,"RegionCode":"dfw","RegionName":"Dallas","Nodes":[{"Name":"9d","RegionID":9,"HostName":"derp9d.tailscale.com","IPv4":"209.177.156.94","IPv6":"2607:f740:100::c05","DERPPort":8443,"STUNPort":3479,"STUNOnly":true,"CanPort80":false}]}}}`;

const SETTINGS = { autoUpdateEnabled: false, updateFrequency: "3h" };

function textResponse(body: string, status = 200): DerpMapResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  };
}

/** A fetch that answers with `body` and counts how often it was dialled. */
function countingFetch(body: string, status = 200) {
  const calls: string[] = [];
  const fetch: DerpMapFetch = (url) => {
    calls.push(url);
    return Promise.resolve(textResponse(body, status));
  };

  return { calls, fetch };
}

beforeEach(() => {
  clearRemoteDerpMapCache();
});

describe("wire-format DERP map reading", () => {
  test("reads the official map's regions, which the local reader alone cannot", () => {
    expect(readTailscaleDerpMapRegions(WIRE_EXCERPT)).toEqual([
      { regionId: 1, code: "nyc", name: "New York City" },
      { regionId: 3, code: "sin", name: "Singapore" },
    ]);
    expect(readAnyDerpMapRegions(WIRE_EXCERPT)).toEqual(readTailscaleDerpMapRegions(WIRE_EXCERPT));
    // The bug this guards: the local-shape reader finds nothing in a wire body.
    expect(readDerpMapRegions(WIRE_EXCERPT)).toEqual([]);
  });

  test("reads every node of the official map with its addresses and markers", () => {
    const reading = readAnyDerpMapNodes(WIRE_EXCERPT);
    expect(reading.ok).toBe(true);

    const newYork = reading.nodes.get(1) ?? [];
    expect(newYork).toHaveLength(4);
    expect(newYork.map((node) => node.name)).toEqual(["1f", "1g", "1h", "1i"]);
    expect(newYork.map((node) => node.hostname)).toEqual([
      "derp1f.tailscale.com",
      "derp1g.tailscale.com",
      "derp1h.tailscale.com",
      "derp1i.tailscale.com",
    ]);
    expect(newYork.map((node) => node.ipv4)).toEqual([
      "199.38.181.104",
      "209.177.145.120",
      "199.38.181.93",
      "199.38.181.103",
    ]);
    expect(newYork.map((node) => node.ipv6)).toEqual([
      "2607:f740:f::bc",
      "2607:f740:f::3eb",
      "2607:f740:f::afd",
      "2607:f740:f::e19",
    ]);
    // The official nodes state no ports, so the format's defaults apply.
    expect(newYork.map((node) => node.derpPort)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(newYork.map((node) => node.stunPort)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(newYork.map((node) => node.canPort80)).toEqual([true, true, true, true]);
    expect(newYork[0]).toEqual({
      name: "1f",
      hostname: "derp1f.tailscale.com",
      ipv4: "199.38.181.104",
      ipv6: "2607:f740:f::bc",
      stunOnly: false,
      canPort80: true,
    });

    const singapore = reading.nodes.get(3) ?? [];
    expect(singapore).toHaveLength(4);
    expect(singapore.map((node) => node.hostname)).toEqual([
      "derp3e.tailscale.com",
      "derp3f.tailscale.com",
      "derp3g.tailscale.com",
      "derp3h.tailscale.com",
    ]);
    expect(singapore.map((node) => node.ipv4)).toEqual([
      "172.237.72.43",
      "172.237.72.8",
      "172.237.72.79",
      "172.237.66.30",
    ]);
    expect(singapore.map((node) => node.ipv6)).toEqual([
      "2600:3c15::2000:6cff:fee4:d799",
      "2600:3c15::2000:53ff:fe48:a668",
      "2600:3c15::2000:adff:fe08:6fab",
      "2600:3c15::2000:3dff:fe44:50aa",
    ]);
    expect(singapore.map((node) => node.canPort80)).toEqual([true, true, true, true]);
  });

  test("reads the wire map's declared ports and markers", () => {
    const reading = readAnyDerpMapNodes(WIRE_PORTS);
    expect(reading.ok).toBe(true);
    expect(reading.nodes.get(9)).toEqual([
      {
        name: "9d",
        hostname: "derp9d.tailscale.com",
        derpPort: 8443,
        stunPort: 3479,
        stunOnly: true,
        canPort80: false,
        ipv4: "209.177.156.94",
        ipv6: "2607:f740:100::c05",
      },
    ]);
  });

  test("reads the lower-case local shape through the dispatching readers unchanged", () => {
    expect(readAnyDerpMapRegions(LOCAL_MAP)).toEqual(readDerpMapRegions(LOCAL_MAP));
    expect(readAnyDerpMapRegions(LOCAL_MAP)).toEqual([
      { regionId: 901, code: "ams", name: "Amsterdam" },
    ]);
    expect(readAnyDerpMapNodes(LOCAL_MAP)).toEqual(readDerpMapNodes(LOCAL_MAP));
    expect(readAnyDerpMapNodes(LOCAL_MAP).nodes.get(901)).toEqual([
      {
        name: "901a",
        hostname: "derp901a.example.com",
        derpPort: 8443,
        stunPort: 0,
        stunOnly: false,
        ipv4: "192.0.2.1",
        ipv6: "2001:db8::1",
      },
    ]);
  });

  test("reads a body that is neither shape as nothing, without throwing", () => {
    const bodies = [
      "",
      "[]",
      "{ not yaml",
      "not: [a, derp, map",
      "regions: [1, 2, 3]",
      '{"Regions":[]}',
      '{"regions":[]}',
    ];

    for (const body of bodies) {
      expect(() => readAnyDerpMapRegions(body), body).not.toThrow();
      expect(readAnyDerpMapRegions(body), body).toEqual([]);
      expect(() => readAnyDerpMapNodes(body), body).not.toThrow();
      expect(readAnyDerpMapNodes(body).ok, body).toBe(false);
    }

    // A document in either spelling that names no usable region is a DERP map
    // with nothing to contribute: no region, no node, and no throw.
    const shapeless = [
      "regions:\n  901:\n    regioncode: ams",
      '{"Regions":{"1":{"RegionCode":"nyc"}}}',
    ];

    for (const body of shapeless) {
      expect(readAnyDerpMapRegions(body), body).toEqual([]);
      expect(readAnyDerpMapNodes(body).nodes.size, body).toBe(0);
    }
  });
});

describe("remote reading of a wire-format official map", () => {
  test("surfaces the official regions and their nodes through the shared reader", async () => {
    const { calls, fetch } = countingFetch(WIRE_EXCERPT);
    const url = "https://controlplane.tailscale.com/derpmap/default";

    const detail = await loadRemoteDerpMapDetail(url, SETTINGS, { fetch });
    expect(detail?.map((region) => [region.regionId, region.code, region.name])).toEqual([
      [1, "nyc", "New York City"],
      [3, "sin", "Singapore"],
    ]);
    expect(detail?.map((region) => region.nodes.length)).toEqual([4, 4]);
    expect(detail?.[0]?.nodes[0]?.hostname).toBe("derp1f.tailscale.com");

    const names = await loadRemoteDerpMap(url, SETTINGS, { fetch });
    expect(names).toEqual([
      { regionId: 1, code: "nyc", name: "New York City" },
      { regionId: 3, code: "sin", name: "Singapore" },
    ]);
    // Both answers came from one dial: the cache is keyed by URL.
    expect(calls).toEqual([url]);
  });

  test("gives a remote map a ten second deadline", () => {
    expect(DERP_MAP_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  test("retries a timed-out download once and reports the reason", async () => {
    const calls: string[] = [];
    const fetch: DerpMapFetch = (url, { signal }) => {
      calls.push(url);
      return new Promise<DerpMapResponse>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };

    const outcome = await loadRemoteDerpMapOutcome("https://example.com/slow.yaml", SETTINGS, {
      fetch,
      timeoutMs: 5,
    });

    expect(outcome).toEqual({ reason: "timeout" });
    expect(calls).toHaveLength(2);
  });

  test("retries a refused connection but not an answered error status", async () => {
    const refused: DerpMapFetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const refusedOutcome = await loadRemoteDerpMapOutcome(
      "https://example.com/refused.yaml",
      SETTINGS,
      { fetch: refused },
    );
    expect(refusedOutcome).toEqual({ reason: "network" });

    const { calls, fetch } = countingFetch("", 500);
    const statusOutcome = await loadRemoteDerpMapOutcome(
      "https://example.com/error.yaml",
      SETTINGS,
      {
        fetch,
      },
    );
    expect(statusOutcome).toEqual({ reason: "status" });
    expect(calls).toHaveLength(1);
  });

  test("reports an unreadable body and keeps the narrow answer compatible", async () => {
    const { calls, fetch } = countingFetch("regions: [1, 2, 3]");
    const url = "https://example.com/unreadable.yaml";

    const outcome = await loadRemoteDerpMapOutcome(url, SETTINGS, { fetch });
    expect(outcome).toEqual({ reason: "unreadable" });
    expect(calls).toHaveLength(1);

    // The old signature still answers "no regions" for every caller.
    await expect(loadRemoteDerpMapDetail(url, SETTINGS, { fetch })).resolves.toBeUndefined();
    await expect(loadRemoteDerpMap(url, SETTINGS, { fetch })).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("caches a failure's reason for the short window", async () => {
    const { calls, fetch } = countingFetch("", 503);
    let now = 1_000;
    const options = { fetch, now: () => now, ttlMs: 10 * 60 * 1000 };

    expect(
      await loadRemoteDerpMapOutcome("https://example.com/down.yaml", SETTINGS, options),
    ).toEqual({ reason: "status" });
    expect(
      await loadRemoteDerpMapOutcome("https://example.com/down.yaml", SETTINGS, options),
    ).toEqual({ reason: "status" });
    expect(calls).toHaveLength(1);

    now += 5 * 60 * 1000;
    await loadRemoteDerpMapOutcome("https://example.com/down.yaml", SETTINGS, options);
    expect(calls).toHaveLength(2);
  });
});
