import { describe, expect, test } from "vitest";

import {
  countNodesHomedInRegion,
  countNodeStatus,
  declaredDerpAddresses,
  formatByteSize,
  hasIpv6StunWarning,
  isIpv4OnlyStunBind,
  readExtraRecordsPath,
  relayAddressDisplay,
  relayHostSummary,
  stunBindHost,
  summarizeFleetTrend,
  tallyChecks,
  tallyEntries,
  textOrReason,
} from "~/routes/overview-helpers";
import type { FleetTrend } from "~/server/history/timeline";

describe("countNodeStatus", () => {
  test("splits the nodes by their online flag", () => {
    expect(
      countNodeStatus([{ online: true }, { online: false }, { online: true }, { online: true }]),
    ).toEqual({ total: 4, online: 3, offline: 1 });
  });

  test("handles an empty tailnet", () => {
    expect(countNodeStatus([])).toEqual({ total: 0, online: 0, offline: 0 });
  });
});

describe("tallyChecks", () => {
  test("counts every status and the total", () => {
    expect(
      tallyChecks([
        { status: "pass" },
        { status: "pass" },
        { status: "warning" },
        { status: "fail" },
      ]),
    ).toEqual({ total: 4, pass: 2, warning: 1, fail: 1 });
  });

  test("an empty list is all zeroes", () => {
    expect(tallyChecks([])).toEqual({ total: 0, pass: 0, warning: 0, fail: 0 });
  });
});

describe("tallyEntries", () => {
  test("lists pass, warning and fail in reading order", () => {
    expect(tallyEntries({ total: 4, pass: 2, warning: 1, fail: 1 })).toEqual([
      { status: "pass", count: 2 },
      { status: "warning", count: 1 },
      { status: "fail", count: 1 },
    ]);
  });

  test("keeps a zero count so every status stays visible", () => {
    expect(tallyEntries({ total: 1, pass: 1, warning: 0, fail: 0 })).toEqual([
      { status: "pass", count: 1 },
      { status: "warning", count: 0 },
      { status: "fail", count: 0 },
    ]);
  });
});

describe("formatByteSize", () => {
  test("formats whole bytes without a decimal", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1023)).toBe("1023 B");
  });

  test("uses binary units with one decimal", () => {
    expect(formatByteSize(1024)).toBe("1.0 KB");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(formatByteSize(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  test("rejects sizes that are not usable numbers", () => {
    expect(formatByteSize(undefined)).toBeUndefined();
    expect(formatByteSize(-1)).toBeUndefined();
    expect(formatByteSize(Number.NaN)).toBeUndefined();
    expect(formatByteSize(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("stunBindHost", () => {
  test("reads the host out of a host:port pair", () => {
    expect(stunBindHost("0.0.0.0:3478")).toBe("0.0.0.0");
    expect(stunBindHost(" 127.0.0.1:3478 ")).toBe("127.0.0.1");
    expect(stunBindHost("derp.example.com:443")).toBe("derp.example.com");
  });

  test("keeps an empty host, which Go binds for both families", () => {
    expect(stunBindHost(":3478")).toBe("");
  });

  test("strips the brackets of an IPv6 literal", () => {
    expect(stunBindHost("[::]:3478")).toBe("::");
    expect(stunBindHost("[2001:db8::1]:3478")).toBe("2001:db8::1");
  });

  test("returns undefined for anything that is not a usable address", () => {
    expect(stunBindHost("0.0.0.0")).toBeUndefined();
    expect(stunBindHost("0.0.0.0:0")).toBeUndefined();
    expect(stunBindHost("0.0.0.0:99999")).toBeUndefined();
    expect(stunBindHost("")).toBeUndefined();
    expect(stunBindHost(undefined)).toBeUndefined();
  });
});

describe("isIpv4OnlyStunBind", () => {
  test("is true for IPv4 literals, including the unspecified address", () => {
    expect(isIpv4OnlyStunBind("0.0.0.0:3478")).toBe(true);
    expect(isIpv4OnlyStunBind("127.0.0.1:3478")).toBe(true);
    expect(isIpv4OnlyStunBind("192.168.1.5:3478")).toBe(true);
  });

  test("is false for IPv6 and dual-stack binds", () => {
    expect(isIpv4OnlyStunBind("[::]:3478")).toBe(false);
    expect(isIpv4OnlyStunBind("[2001:db8::1]:3478")).toBe(false);
    expect(isIpv4OnlyStunBind(":3478")).toBe(false);
  });

  test("is false when nothing certain can be said", () => {
    expect(isIpv4OnlyStunBind("stun.example.com:3478")).toBe(false);
    expect(isIpv4OnlyStunBind("0.0.0.0")).toBe(false);
    expect(isIpv4OnlyStunBind(undefined)).toBe(false);
  });
});

describe("hasIpv6StunWarning", () => {
  const base = { enabled: true, ipv6: "2001:db8::1", stunListenAddr: "0.0.0.0:3478" };

  test("warns when an IPv6 relay address meets an IPv4-only STUN bind", () => {
    expect(hasIpv6StunWarning(base)).toBe(true);
    expect(isIpv4OnlyStunBind(base.stunListenAddr)).toBe(true);
  });

  test("stays quiet when STUN listens on IPv6 or on every interface", () => {
    expect(hasIpv6StunWarning({ ...base, stunListenAddr: "[::]:3478" })).toBe(false);
    expect(hasIpv6StunWarning({ ...base, stunListenAddr: ":3478" })).toBe(false);
  });

  test("stays quiet without an IPv6 address or a running embedded server", () => {
    expect(hasIpv6StunWarning({ ...base, ipv6: "" })).toBe(false);
    expect(hasIpv6StunWarning({ ...base, ipv6: undefined })).toBe(false);
    expect(hasIpv6StunWarning({ ...base, enabled: false })).toBe(false);
  });
});

describe("declaredDerpAddresses", () => {
  test("lists the addresses the configuration declares", () => {
    expect(declaredDerpAddresses({ ipv4: "203.0.113.7", ipv6: "2001:db8::1" })).toEqual([
      { family: "ipv4", value: "203.0.113.7" },
      { family: "ipv6", value: "2001:db8::1" },
    ]);
  });

  test("omits unset families and trims what is there", () => {
    expect(declaredDerpAddresses({ ipv4: " 203.0.113.7 ", ipv6: "" })).toEqual([
      { family: "ipv4", value: "203.0.113.7" },
    ]);
    expect(declaredDerpAddresses({})).toEqual([]);
  });
});

describe("relayHostSummary", () => {
  test("splits the hostname and the port clients dial", () => {
    expect(relayHostSummary("https://derp.example.com")).toEqual({
      endpoint: "derp.example.com:443",
      host: "derp.example.com",
      port: "443",
      source: "hostname",
    });
    expect(relayHostSummary("http://derp.example.com:8080")).toMatchObject({
      endpoint: "derp.example.com:8080",
      port: "8080",
    });
  });

  test("marks a bracketed IPv6 literal as a host clients use as-is", () => {
    expect(relayHostSummary("https://[2001:db8::1]:8443")).toEqual({
      endpoint: "[2001:db8::1]:8443",
      host: "[2001:db8::1]",
      port: "8443",
      source: "literal",
    });
  });

  test("says the endpoint is invalid when server_url cannot be read", () => {
    expect(relayHostSummary(undefined)).toEqual({ source: "invalid" });
    expect(relayHostSummary("derp.example.com")).toEqual({ source: "invalid" });
  });
});

describe("relayAddressDisplay", () => {
  test("joins the resolved records of one family with newlines", () => {
    expect(
      relayAddressDisplay(
        [
          { family: "ipv4", addresses: ["198.51.100.7", "198.51.100.8"] },
          { family: "ipv6", addresses: ["2001:db8::7"] },
        ],
        undefined,
      ),
    ).toEqual({ ipv4: "198.51.100.7\n198.51.100.8", ipv6: "2001:db8::7" });
  });

  test("carries the resolver's reason for a family with no address", () => {
    expect(
      relayAddressDisplay([{ family: "ipv4", addresses: ["198.51.100.7"] }], "no-records"),
    ).toEqual({
      ipv4: "198.51.100.7",
      ipv6Reason: "no-records",
    });
  });

  test("reads as unavailable when no lookup ran and no reason was given", () => {
    expect(relayAddressDisplay(undefined, undefined)).toEqual({
      ipv4Reason: "unavailable",
      ipv6Reason: "unavailable",
    });
    expect(relayAddressDisplay([], "timeout")).toEqual({
      ipv4Reason: "timeout",
      ipv6Reason: "timeout",
    });
  });
});

describe("countNodesHomedInRegion", () => {
  test("counts only the machines reporting the region", () => {
    expect(
      countNodesHomedInRegion(
        {
          a: { HomeDERP: 999 },
          b: { HomeDERP: 901 },
          c: { HomeDERP: 999 },
          d: undefined,
          e: {},
        },
        999,
      ),
    ).toBe(2);
  });

  test("a region nobody uses counts zero", () => {
    expect(countNodesHomedInRegion({ a: { HomeDERP: 901 } }, 999)).toBe(0);
  });
});

describe("readExtraRecordsPath", () => {
  test("reads dns.extra_records_path out of a parsed config", () => {
    expect(readExtraRecordsPath({ dns: { extra_records_path: "/etc/records.json" } })).toBe(
      "/etc/records.json",
    );
    expect(readExtraRecordsPath({ dns: { extra_records_path: " /etc/records.json " } })).toBe(
      "/etc/records.json",
    );
  });

  test("returns undefined for a missing, empty or unusable value", () => {
    expect(readExtraRecordsPath({ dns: {} })).toBeUndefined();
    expect(readExtraRecordsPath({ dns: { extra_records_path: "  " } })).toBeUndefined();
    expect(readExtraRecordsPath({ dns: { extra_records_path: 42 } })).toBeUndefined();
    expect(readExtraRecordsPath({})).toBeUndefined();
    expect(readExtraRecordsPath(null)).toBeUndefined();
    expect(readExtraRecordsPath("nope")).toBeUndefined();
  });
});

describe("textOrReason", () => {
  test("returns the trimmed value when there is one", () => {
    expect(textOrReason(" value ", "missing")).toEqual({ text: "value" });
  });

  test("returns the reason for an unreadable value", () => {
    expect(textOrReason(undefined, "missing")).toEqual({ reason: "missing" });
    expect(textOrReason("   ", "missing")).toEqual({ reason: "missing" });
    expect(textOrReason(null, "missing")).toEqual({ reason: "missing" });
  });
});

describe("summarizeFleetTrend", () => {
  const trend = (buckets: { covered: boolean; online: number }[]): FleetTrend => ({
    window: "24h",
    from: "2026-01-07T12:00:00.000Z",
    to: "2026-01-08T12:00:00.000Z",
    buckets: buckets.map((bucket, index) => ({
      from: `bucket-${index}`,
      covered: bucket.covered,
      online: bucket.online,
      known: bucket.online,
    })),
    partial: false,
  });

  test("counts the covered buckets and the peak they held", () => {
    expect(
      summarizeFleetTrend(
        trend([
          { covered: true, online: 3 },
          { covered: true, online: 7 },
          { covered: true, online: 5 },
        ]),
      ),
    ).toEqual({ covered: 3, total: 3, peak: 7 });
  });

  test("an uncovered bucket counts towards neither the coverage nor the peak", () => {
    // The fleet was sampled twice, then nothing: the gap must not read as a
    // fleet that dropped to zero nodes.
    expect(
      summarizeFleetTrend(
        trend([
          { covered: true, online: 2 },
          { covered: false, online: 0 },
          { covered: false, online: 0 },
        ]),
      ),
    ).toEqual({ covered: 1, total: 3, peak: 2 });
  });

  test("a store with no samples covers nothing", () => {
    expect(summarizeFleetTrend(trend([{ covered: false, online: 0 }]))).toEqual({
      covered: 0,
      total: 1,
      peak: 0,
    });
  });
});
