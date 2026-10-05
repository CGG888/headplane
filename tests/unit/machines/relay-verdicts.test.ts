import { describe, expect, test } from "vitest";

import {
  relayFamilyVerdicts,
  relayResolutionBlamesSystemResolver,
} from "~/routes/machines/relay-verdicts";
import type { RelayAddressComparison, RelayResolution } from "~/server/relay-dns";

function comparison(
  family: RelayAddressComparison["family"],
  verdict: RelayAddressComparison["verdict"],
  declared?: string,
): RelayAddressComparison {
  return {
    family,
    verdict,
    resolved: ["198.51.100.7"],
    ...(declared === undefined ? {} : { declared }),
  };
}

const systemAnswer: RelayResolution = {
  host: "derp.example.com",
  kind: "hostname",
  ipv4: ["198.51.100.7"],
  ipv6: [],
  resolver: "system",
};

describe("relayFamilyVerdicts", () => {
  test("keeps every verdict a declaration can be compared against", () => {
    const verdicts = relayFamilyVerdicts([
      comparison("ipv4", "declared-but-not-resolved", "198.51.100.9"),
      comparison("ipv6", "resolver-unavailable", "2001:db8::9"),
    ]);

    expect(verdicts).toEqual([
      { family: "ipv4", verdict: "declared-but-not-resolved", declared: "198.51.100.9" },
      { family: "ipv6", verdict: "resolver-unavailable", declared: "2001:db8::9" },
    ]);
  });

  test("drops the verdicts that would only repeat the row they sit under", () => {
    // With nothing declared, a match and a missing record say nothing new.
    expect(
      relayFamilyVerdicts([comparison("ipv4", "matches"), comparison("ipv6", "no-records")]),
    ).toEqual([{ family: "ipv4" }, { family: "ipv6" }]);

    // The same verdicts are worth printing once the configuration declares an
    // address, because then they answer a question the row cannot.
    expect(
      relayFamilyVerdicts([
        comparison("ipv4", "matches", "198.51.100.7"),
        comparison("ipv6", "no-records", "2001:db8::9"),
      ]),
    ).toEqual([
      { family: "ipv4", verdict: "matches", declared: "198.51.100.7" },
      { family: "ipv6", verdict: "no-records", declared: "2001:db8::9" },
    ]);
  });

  test("an unread resolution is no verdict at all", () => {
    expect(relayFamilyVerdicts([])).toEqual([]);
  });
});

describe("relayResolutionBlamesSystemResolver", () => {
  test("is true when the host's own resolver left a family empty", () => {
    expect(relayResolutionBlamesSystemResolver(systemAnswer)).toBe(true);
    expect(
      relayResolutionBlamesSystemResolver({ ...systemAnswer, ipv4: [], ipv6: ["2001:db8::7"] }),
    ).toBe(true);
  });

  test("is false when a configured resolver or a full answer is in play", () => {
    expect(relayResolutionBlamesSystemResolver(undefined)).toBe(false);
    // A literal endpoint never ran a lookup, so no resolver can be blamed.
    expect(
      relayResolutionBlamesSystemResolver({
        host: "[2001:db8::1]",
        kind: "literal",
        ipv4: [],
        ipv6: [],
      }),
    ).toBe(false);
    expect(relayResolutionBlamesSystemResolver({ ...systemAnswer, resolver: "configured" })).toBe(
      false,
    );
    expect(relayResolutionBlamesSystemResolver({ ...systemAnswer, ipv6: ["2001:db8::7"] })).toBe(
      false,
    );
  });
});
