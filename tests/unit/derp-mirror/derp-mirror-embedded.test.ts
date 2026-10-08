import { describe, expect, test } from "vitest";

import { embeddedRelayIdentity, isEmbeddedRelayRegion } from "~/server/derp-mirror/embedded";
import { buildMirrorMap } from "~/server/derp-mirror/generate";
import type { OfficialRegion } from "~/server/derp-mirror/types";

const GDDG = "999";
const HKG = "20";

function region(
  regionId: string,
  code: string,
  name: string,
  overrides: Partial<OfficialRegion["nodes"][number]> = {},
): OfficialRegion {
  return {
    regionId: Number(regionId),
    code,
    name,
    nodes: [
      {
        name: `${code}1`,
        hostname: `${code}1.example.com`,
        derpPort: 443,
        stunPort: 3478,
        stunOnly: false,
        ...overrides,
      },
    ],
  };
}

describe("embedded relay identity", () => {
  test("reads the id, the code and the host out of the DERP settings", () => {
    expect(
      embeddedRelayIdentity({
        serverUrl: "https://relay.example.com:8443",
        server: { regionId: 999, regionCode: "GDDG" },
      }),
    ).toEqual({ regionId: 999, regionCode: "GDDG", hostname: "relay.example.com" });
  });

  test("keeps an IPv6 literal bracketed, and ignores what is not an address", () => {
    expect(embeddedRelayIdentity({ serverUrl: "https://[2001:db8::1]:8443" })).toEqual({
      hostname: "[2001:db8::1]",
    });
    // No URL, no scheme the format uses, and nothing configured at all.
    expect(embeddedRelayIdentity({ serverUrl: "not a url" })).toBeUndefined();
    expect(embeddedRelayIdentity({ serverUrl: "mailto:relay@example.com" })).toBeUndefined();
    expect(embeddedRelayIdentity({})).toBeUndefined();
    expect(embeddedRelayIdentity({ server: { regionCode: "   " } })).toBeUndefined();
  });

  test("matches a region by id, by code whatever its case, or by node host", () => {
    const identity = { regionId: 999, regionCode: "GDDG", hostname: "relay.example.com" };

    // The id Headscale numbers it with.
    expect(
      isEmbeddedRelayRegion(region(GDDG, "gddg", "东莞", { hostname: "x.example.com" }), identity),
    ).toBe(true);
    // A copy that kept the code but was renumbered.
    expect(
      isEmbeddedRelayRegion(region("7", "GDDG", "Copy", { hostname: "x.example.com" }), identity),
    ).toBe(true);
    // A copy with neither, whose node still names the same host — even when the
    // node glued the port onto the name.
    expect(
      isEmbeddedRelayRegion(
        region("7", "foo", "Copy", { hostname: "relay.example.com:8443" }),
        identity,
      ),
    ).toBe(true);
    expect(
      isEmbeddedRelayRegion(
        region("7", "foo", "Other", { hostname: "other.example.com" }),
        identity,
      ),
    ).toBe(false);
    expect(isEmbeddedRelayRegion(region(GDDG, "gddg", "东莞"), undefined)).toBe(false);
  });
});

describe("mirror map and the deployment's own relay", () => {
  const identity = { regionId: 999, regionCode: "GDDG", hostname: "relay.example.com" };

  test("never writes the embedded region, even when it is selected and numbered", () => {
    const map = buildMirrorMap(
      [region(HKG, "hkg", "Hong Kong"), region(GDDG, "gddg", "东莞")],
      { [HKG]: 901, [GDDG]: 902 },
      [HKG, GDDG],
      identity,
    );

    expect(Object.keys(map.regions)).toEqual(["901"]);
  });

  test("splits a port glued onto a hostname into hostname and derpport", () => {
    const source: OfficialRegion = {
      regionId: 20,
      code: "hkg",
      name: "Hong Kong",
      nodes: [{ name: "hkg1", hostname: "relay.example.com:8443", stunOnly: false }],
    };

    const map = buildMirrorMap([source], { [HKG]: 901 }, [HKG]);

    expect(map.regions["901"].nodes[0]).toMatchObject({
      hostname: "relay.example.com",
      derpport: 8443,
    });
  });

  test("lets an explicit derpport win over a port inside the hostname", () => {
    const source: OfficialRegion = {
      regionId: 20,
      code: "hkg",
      name: "Hong Kong",
      nodes: [{ name: "hkg1", hostname: "relay.example.com:8443", derpPort: 443, stunOnly: false }],
    };

    const map = buildMirrorMap([source], { [HKG]: 901 }, [HKG]);

    expect(map.regions["901"].nodes[0]).toMatchObject({
      hostname: "relay.example.com",
      derpport: 443,
    });
  });
});
