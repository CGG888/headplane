import { describe, expect, test } from "vitest";

import {
  canonicalSyncAddress,
  classifySyncIpv4,
  isPublicSyncIpv4,
  isPublicSyncIpv6,
  literalSyncIpv4,
  pickPublicSyncIpv4,
  planDerpSync,
  relayHostnameFromServerUrl,
  syncAddressesMatch,
} from "~/server/derp-sync/addresses";

describe("IPv4 acceptance", () => {
  test("accepts ordinary public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "203.1.113.1"]) {
      expect(isPublicSyncIpv4(address), address).toBe(true);
    }
  });

  test("rejects the private ranges", () => {
    expect(classifySyncIpv4("10.1.2.3")).toBe("private");
    expect(classifySyncIpv4("172.16.0.1")).toBe("private");
    expect(classifySyncIpv4("172.31.255.255")).toBe("private");
    expect(classifySyncIpv4("192.168.1.1")).toBe("private");
  });

  test("rejects loopback, link-local, unspecified and broadcast addresses", () => {
    expect(classifySyncIpv4("127.0.0.1")).toBe("loopback");
    expect(classifySyncIpv4("169.254.10.1")).toBe("link-local");
    expect(classifySyncIpv4("0.0.0.0")).toBe("unspecified");
    expect(classifySyncIpv4("255.255.255.255")).toBe("reserved");
    expect(classifySyncIpv4("224.0.0.1")).toBe("multicast");
  });

  test("rejects carrier-grade NAT, which Tailscale itself occupies", () => {
    expect(classifySyncIpv4("100.64.0.1")).toBe("cgnat");
    expect(classifySyncIpv4("100.127.255.255")).toBe("cgnat");
  });

  test("rejects the documentation and benchmarking blocks", () => {
    expect(classifySyncIpv4("192.0.2.1")).toBe("documentation");
    expect(classifySyncIpv4("198.51.100.7")).toBe("documentation");
    expect(classifySyncIpv4("203.0.113.7")).toBe("documentation");
    expect(classifySyncIpv4("198.18.0.1")).toBe("reserved");
    expect(classifySyncIpv4("192.0.0.1")).toBe("reserved");
  });

  test("rejects anything that is not an address", () => {
    expect(classifySyncIpv4("not-an-ip")).toBe("invalid");
    expect(classifySyncIpv4("999.1.1.1")).toBe("invalid");
    expect(classifySyncIpv4("8.8.8")).toBe("invalid");
    expect(classifySyncIpv4("2606:4700::1111")).toBe("invalid");
  });

  test("picks the first usable answer out of a mixed record set", () => {
    expect(pickPublicSyncIpv4(["10.0.0.5", "8.8.8.8", "1.1.1.1"])).toBe("8.8.8.8");
    expect(pickPublicSyncIpv4(["10.0.0.5", "192.168.1.1"])).toBeUndefined();
    expect(pickPublicSyncIpv4([])).toBeUndefined();
  });
});

describe("IPv6 acceptance", () => {
  test("accepts global unicast addresses, bracketed or not", () => {
    expect(isPublicSyncIpv6("2606:4700:4700::1111")).toBe(true);
    expect(isPublicSyncIpv6("2001:db8::1")).toBe(true);
    expect(isPublicSyncIpv6("[2606:4700::1111]")).toBe(true);
  });

  test("rejects link-local, ULA, loopback, multicast and mapped addresses", () => {
    expect(isPublicSyncIpv6("fe80::1")).toBe(false);
    expect(isPublicSyncIpv6("fd00::1")).toBe(false);
    expect(isPublicSyncIpv6("fc00::1")).toBe(false);
    expect(isPublicSyncIpv6("::1")).toBe(false);
    expect(isPublicSyncIpv6("::")).toBe(false);
    expect(isPublicSyncIpv6("ff02::1")).toBe(false);
    expect(isPublicSyncIpv6("::ffff:8.8.8.8")).toBe(false);
    expect(isPublicSyncIpv6("192.168.1.1")).toBe(false);
  });
});

describe("server_url host", () => {
  test("reads the hostname without the port", () => {
    expect(relayHostnameFromServerUrl("https://relay.example.com:8443/derp")).toBe(
      "relay.example.com",
    );
    expect(relayHostnameFromServerUrl("  https://relay.example.com  ")).toBe("relay.example.com");
    expect(relayHostnameFromServerUrl("https://[2001:db8::1]:443")).toBe("[2001:db8::1]");
  });

  test("reports nothing for an unusable value", () => {
    expect(relayHostnameFromServerUrl(undefined)).toBeUndefined();
    expect(relayHostnameFromServerUrl("")).toBeUndefined();
    expect(relayHostnameFromServerUrl("relay.example.com")).toBeUndefined();
    expect(relayHostnameFromServerUrl("ftp://relay.example.com")).toBeUndefined();
  });

  test("a bare IPv4 host is already the answer", () => {
    expect(literalSyncIpv4("1.2.3.4")).toBe("1.2.3.4");
    expect(literalSyncIpv4("relay.example.com")).toBeUndefined();
    expect(literalSyncIpv4("[2001:db8::1]")).toBeUndefined();
  });
});

describe("address comparison", () => {
  test("two spellings of one address compare equal", () => {
    expect(syncAddressesMatch("ipv6", "2001:DB8::1", "2001:0db8:0:0:0:0:0:1")).toBe(true);
    expect(syncAddressesMatch("ipv4", "008.008.008.008", "8.8.8.8")).toBe(true);
    expect(syncAddressesMatch("ipv6", "2001:db8::1", "2001:db8::2")).toBe(false);
  });

  test("keeps an unparsable value comparable as text", () => {
    expect(canonicalSyncAddress("ipv6", "  Not-An-Address ")).toBe("not-an-address");
  });
});

describe("write-only-on-change planning", () => {
  test("writes nothing when both families already match", () => {
    const plan = planDerpSync(
      { ipv4: "8.8.8.8", ipv6: "2606:4700::1111" },
      {
        ipv4: { address: "8.8.8.8", source: "dns" },
        ipv6: { address: "2606:4700::1111", source: "host" },
      },
    );

    expect(plan.patches).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toEqual(["ipv4", "ipv6"]);
  });

  test("writes one key when only that family changed", () => {
    const plan = planDerpSync(
      { ipv4: "9.9.9.9", ipv6: "2606:4700::1111" },
      {
        ipv4: { address: "8.8.8.8", source: "dns" },
        ipv6: { address: "2606:4700::1111", source: "host" },
      },
    );

    expect(plan.patches).toEqual([{ path: "derp.server.ipv4", value: "8.8.8.8" }]);
    expect(plan.changes).toEqual([{ family: "ipv4", from: "9.9.9.9", to: "8.8.8.8" }]);
    expect(plan.unchanged).toEqual(["ipv6"]);
  });

  test("an unset key is a change without a previous value", () => {
    const plan = planDerpSync(
      { ipv4: "", ipv6: "" },
      { ipv4: { address: "8.8.8.8", source: "dns" } },
    );

    expect(plan.patches).toEqual([{ path: "derp.server.ipv4", value: "8.8.8.8" }]);
    expect(plan.changes).toEqual([{ family: "ipv4", to: "8.8.8.8" }]);
  });

  test("a family with nothing detected is left alone", () => {
    const plan = planDerpSync(
      { ipv4: "9.9.9.9", ipv6: "" },
      { ipv4: { address: "9.9.9.9", source: "dns" } },
    );

    expect(plan.patches).toEqual([]);
    expect(plan.unchanged).toEqual(["ipv4"]);
  });

  test("a differently spelled address is not a change", () => {
    const plan = planDerpSync(
      { ipv4: "8.8.8.8", ipv6: "2001:db8::1" },
      { ipv6: { address: "2001:0DB8:0000::1", source: "host" } },
    );

    expect(plan.patches).toEqual([]);
    expect(plan.unchanged).toEqual(["ipv6"]);
  });
});
