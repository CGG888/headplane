import { describe, expect, test } from "vitest";

import {
  countNodesHomedInRegion,
  countNodeStatus,
  declaredDerpAddresses,
  derpEndpointSummary,
  formatByteSize,
  hasIpv6StunWarning,
  isIpv4OnlyStunBind,
  readExtraRecordsPath,
  stunBindHost,
  tallyChecks,
  textOrReason,
} from "~/routes/overview-helpers";

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

describe("derpEndpointSummary", () => {
  test("derives the client endpoint from server_url", () => {
    expect(derpEndpointSummary("https://derp.example.com")).toBe("derp.example.com:443");
    expect(derpEndpointSummary("http://derp.example.com:8080")).toBe("derp.example.com:8080");
  });

  test("keeps IPv6 literals bracketed", () => {
    expect(derpEndpointSummary("https://[2001:db8::1]:8443")).toBe("[2001:db8::1]:8443");
  });

  test("says nothing when server_url cannot be used", () => {
    expect(derpEndpointSummary(undefined)).toBeUndefined();
    expect(derpEndpointSummary("")).toBeUndefined();
    expect(derpEndpointSummary("derp.example.com")).toBeUndefined();
    expect(derpEndpointSummary("ftp://derp.example.com")).toBeUndefined();
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
