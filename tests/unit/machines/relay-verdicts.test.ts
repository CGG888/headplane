import { describe, expect, test } from "vitest";

import { relayFamilyVerdicts } from "~/routes/machines/relay-verdicts";
import type { RelayAddressComparison } from "~/server/relay-dns";

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
