import { describe, expect, test } from "vitest";

import {
  DERP_DEFAULT_STUN_PORT,
  DERP_NODE_RESOLVE_LIMIT,
  derpNodeDerpPort,
  derpNodeResolvedAddresses,
  derpNodeStunPort,
  derpNodeSummary,
  derpRegionSummaries,
  type DerpMapNodeInput,
  type DerpMapRegionInput,
} from "~/routes/overview-helpers";

function node(overrides: Partial<DerpMapNodeInput> = {}): DerpMapNodeInput {
  return { name: "901a", hostname: "derp-ams.example.com", stunOnly: false, ...overrides };
}

function region(overrides: Partial<DerpMapRegionInput> = {}): DerpMapRegionInput {
  return {
    regionId: 901,
    code: "ams",
    name: "Amsterdam",
    origin: { kind: "local", source: "/etc/headscale/derp-maps/a.yaml" },
    nodes: [],
    ...overrides,
  };
}

describe("derpNodeDerpPort", () => {
  test("prints the port the map declares", () => {
    expect(derpNodeDerpPort({ derpPort: 8443 })).toEqual({ port: 8443, defaulted: false });
  });

  test("falls back to the format default when the map leaves it out", () => {
    expect(derpNodeDerpPort({})).toEqual({ port: 443, defaulted: true });
  });
});

describe("derpNodeStunPort", () => {
  test("defaults to 3478 when the map leaves stunport out", () => {
    expect(derpNodeStunPort({})).toEqual({ port: DERP_DEFAULT_STUN_PORT, defaulted: true });
    expect(DERP_DEFAULT_STUN_PORT).toBe(3478);
  });

  test("reads stunport 0 as not offered, not as a default", () => {
    expect(derpNodeStunPort({ stunPort: 0 })).toEqual({ defaulted: false });
  });

  test("keeps a port the map declares", () => {
    expect(derpNodeStunPort({ stunPort: 3479 })).toEqual({ port: 3479, defaulted: false });
  });
});

describe("derpNodeResolvedAddresses", () => {
  test("shows the A and AAAA records of a looked-up hostname", () => {
    const resolved = derpNodeResolvedAddresses("derp-ams.example.com", {
      "derp-ams.example.com": {
        kind: "hostname",
        ipv4: ["198.51.100.7"],
        ipv6: ["2001:db8::7"],
      },
    });

    expect(resolved).toEqual({ ipv4: "198.51.100.7", ipv6: "2001:db8::7" });
  });

  test("carries the resolver's own reason for an empty family", () => {
    const resolved = derpNodeResolvedAddresses("stun-only.example.com", {
      "stun-only.example.com": { kind: "hostname", ipv4: [], ipv6: [], reason: "no-records" },
    });

    expect(resolved).toEqual({ ipv4Reason: "no-records", ipv6Reason: "no-records" });
  });

  test("looks a hostname up case-insensitively", () => {
    const resolved = derpNodeResolvedAddresses("DERP-AMS.example.com", {
      "derp-ams.example.com": { kind: "hostname", ipv4: ["198.51.100.7"], ipv6: [] },
    });

    expect(resolved.ipv4).toBe("198.51.100.7");
    expect(resolved.ipv6Reason).toBe("unavailable");
  });

  test("an address used as a hostname is its own answer", () => {
    const resolved = derpNodeResolvedAddresses("198.51.100.7", {
      "198.51.100.7": { kind: "literal", host: "198.51.100.7", ipv4: [], ipv6: [] },
    });

    expect(resolved.ipv4).toBe("198.51.100.7");
    expect(resolved.ipv6Reason).toBe("unavailable");
  });

  test("a hostname nobody looked up reads as not resolved", () => {
    expect(derpNodeResolvedAddresses("derp-ams.example.com", {})).toEqual({
      ipv4Reason: "unavailable",
      ipv6Reason: "unavailable",
    });
    expect(derpNodeResolvedAddresses("derp-ams.example.com", undefined)).toEqual({
      ipv4Reason: "unavailable",
      ipv6Reason: "unavailable",
    });
  });
});

describe("derpNodeSummary", () => {
  test("prints hostname and derpport, marking an omitted port as the default", () => {
    expect(derpNodeSummary(node())).toMatchObject({
      endpoint: "derp-ams.example.com:443",
      portDefaulted: true,
      stunEndpoint: "derp-ams.example.com:3478",
      stunPortDefaulted: true,
    });
    expect(derpNodeSummary(node({ derpPort: 8443 }))).toMatchObject({
      endpoint: "derp-ams.example.com:8443",
      portDefaulted: false,
    });
  });

  test("a stunport of 0 leaves the node without a STUN endpoint", () => {
    const summary = derpNodeSummary(node({ stunPort: 0 }));

    expect(summary.stunEndpoint).toBeUndefined();
    expect(summary.stunPortDefaulted).toBe(false);
  });

  test("keeps a STUN-only marker and the declared addresses", () => {
    const summary = derpNodeSummary(
      node({ name: "902a", stunOnly: true, stunPort: 3479, ipv4: "198.51.100.8" }),
    );

    expect(summary.stunOnly).toBe(true);
    expect(summary.stunEndpoint).toBe("derp-ams.example.com:3479");
    expect(summary.ipv4).toBe("198.51.100.8");
    expect(summary.ipv6).toBeUndefined();
  });
});

describe("derpRegionSummaries", () => {
  test("labels a region and counts its nodes", () => {
    const [summary] = derpRegionSummaries({
      regions: [region({ nodes: [node(), node({ name: "901b", hostname: "b.example.com" })] })],
      unknown: "Unknown",
    });

    expect(summary).toMatchObject({
      regionId: 901,
      label: "#901 · ams · Amsterdam",
      nameSource: "map",
      map: { kind: "local", source: "/etc/headscale/derp-maps/a.yaml" },
      nodeCount: 2,
    });
    expect(summary?.nodes[1]?.endpoint).toBe("b.example.com:443");
  });

  test("two files describing one region keep the first file's name and chip", () => {
    const [summary] = derpRegionSummaries({
      regions: [
        region({ nodes: [node()] }),
        region({
          code: "xxx",
          name: "Second",
          origin: { kind: "local", source: "/etc/headscale/derp-maps/b.yaml" },
          nodes: [node({ name: "901b" }), node({ name: "901c" })],
        }),
      ],
      unknown: "Unknown",
    });

    expect(summary?.label).toBe("#901 · ams · Amsterdam");
    expect(summary?.map.source).toBe("/etc/headscale/derp-maps/a.yaml");
    expect(summary?.nodeCount).toBe(1);
  });

  test("a local file beats a remote map, whichever order they arrive in", () => {
    const remote = region({
      code: "sfo",
      name: "San Francisco",
      origin: { kind: "remote", source: "https://example.com/derp.yaml" },
      nodes: [node({ name: "901r" }), node({ name: "901s" })],
    });

    const [summary] = derpRegionSummaries({
      regions: [remote, region({ nodes: [node()] })],
      unknown: "Unknown",
    });

    expect(summary?.label).toBe("#901 · ams · Amsterdam");
    expect(summary?.map).toEqual({ kind: "local", source: "/etc/headscale/derp-maps/a.yaml" });
    expect(summary?.nodeCount).toBe(1);
  });

  test("a remote map alone is credited with its URL", () => {
    const [summary] = derpRegionSummaries({
      regions: [
        region({
          regionId: 903,
          code: "sfo",
          name: "San Francisco",
          origin: { kind: "remote", source: "https://example.com/derp.yaml" },
          nodes: [node({ name: "903a", hostname: "derp-sfo.example.com" })],
        }),
      ],
      unknown: "Unknown",
    });

    expect(summary).toMatchObject({
      label: "#903 · sfo · San Francisco",
      map: { kind: "remote", source: "https://example.com/derp.yaml" },
      nodeCount: 1,
    });
  });

  test("the manual mapping names a region and takes the chip", () => {
    const [summary] = derpRegionSummaries({
      regions: [region()],
      manual: { "901": "  Amsterdam Depot  " },
      unknown: "Unknown",
    });

    expect(summary?.label).toBe("#901 · Amsterdam Depot");
    expect(summary?.nameSource).toBe("manual");
    // The map that described the region is still named, next to the chip.
    expect(summary?.map.source).toBe("/etc/headscale/derp-maps/a.yaml");
  });

  test("falls back to the embedded region, then to the bare id", () => {
    const unnamed = derpRegionSummaries({
      regions: [region({ regionId: 902, code: undefined, name: undefined, nodes: [] })],
      unknown: "Unknown",
    });
    expect(unnamed[0]?.label).toBe("#902");

    const embedded = derpRegionSummaries({
      regions: [region({ regionId: 999, code: undefined, name: undefined, nodes: [] })],
      embedded: { regionId: 999, code: "hdp", name: "Headplane" },
      unknown: "Unknown",
    });
    expect(embedded[0]?.label).toBe("#999 · hdp · Headplane");
  });

  test("resolves the hostnames of every node through the shared answers", () => {
    const [summary] = derpRegionSummaries({
      regions: [
        region({
          nodes: [node(), node({ name: "901b", hostname: "b.example.com", stunPort: 0 })],
        }),
      ],
      resolutions: {
        "derp-ams.example.com": { kind: "hostname", ipv4: ["198.51.100.7"], ipv6: [] },
      },
      unknown: "Unknown",
    });

    expect(summary?.nodes[0]?.resolved.ipv4).toBe("198.51.100.7");
    expect(summary?.nodes[1]?.resolved.ipv6Reason).toBe("unavailable");
  });

  test("an empty inventory has nothing to list", () => {
    expect(derpRegionSummaries({ regions: [], unknown: "Unknown" })).toEqual([]);
  });

  test("the resolution limit stays a small, bounded number", () => {
    expect(DERP_NODE_RESOLVE_LIMIT).toBeGreaterThan(0);
    expect(DERP_NODE_RESOLVE_LIMIT).toBeLessThanOrEqual(64);
  });
});
