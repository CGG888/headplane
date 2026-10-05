import { describe, expect, test } from "vitest";

import {
  classifyIpv6Address,
  classifyNetworkNamespace,
  compareHostIpv6Candidates,
  isGlobalUnicastIpv6,
  selectHostIpv6Address,
  selectRelayIpv6,
  type HostIpv6Candidate,
} from "~/server/host-addresses";

function candidate(
  address: string,
  interfaceName = "eth0",
  temporary?: boolean,
): HostIpv6Candidate {
  return {
    address,
    interfaceName,
    ...(temporary === undefined ? {} : { temporary }),
  };
}

describe("classifyIpv6Address", () => {
  test("keeps global unicast addresses", () => {
    expect(classifyIpv6Address("2001:db8::1")).toBe("global");
    expect(classifyIpv6Address("2a00:1450:4001:81b::200e")).toBe("global");
    expect(classifyIpv6Address("2001:db8::211:22ff:fe33:4455")).toBe("global");
    expect(isGlobalUnicastIpv6("2001:db8::1")).toBe(true);
  });

  test("names every address a client could never reach", () => {
    expect(classifyIpv6Address("fe80::1")).toBe("link-local");
    expect(classifyIpv6Address("fe80::a00:27ff:fe4e:66a1")).toBe("link-local");
    expect(classifyIpv6Address("fc00::1")).toBe("ula");
    expect(classifyIpv6Address("fd12:3456:789a::1")).toBe("ula");
    expect(classifyIpv6Address("::1")).toBe("loopback");
    expect(classifyIpv6Address("::")).toBe("unspecified");
    expect(classifyIpv6Address("::ffff:192.0.2.1")).toBe("mapped");
    expect(classifyIpv6Address("ff02::1")).toBe("multicast");
    expect(classifyIpv6Address("100::1")).toBe("other");
  });

  test("rejects anything that is not an IPv6 address", () => {
    expect(classifyIpv6Address("192.0.2.1")).toBe("invalid");
    expect(classifyIpv6Address("derp.example.com")).toBe("invalid");
    expect(classifyIpv6Address("")).toBe("invalid");
    expect(classifyIpv6Address("2001:db8:::1")).toBe("invalid");
    expect(isGlobalUnicastIpv6("fe80::1")).toBe(false);
    expect(isGlobalUnicastIpv6("not-an-address")).toBe(false);
  });

  test("unwraps brackets and a zone id", () => {
    expect(classifyIpv6Address("[2001:db8::1]")).toBe("global");
    expect(classifyIpv6Address("2001:db8::1%eth0")).toBe("global");
    expect(classifyIpv6Address("fe80::1%eth0")).toBe("link-local");
  });
});

describe("selectHostIpv6Address", () => {
  test("the dns answer selects the host address it names", () => {
    expect(
      selectHostIpv6Address(
        [candidate("2001:db8::1", "eth0"), candidate("2001:db8::2", "eth1")],
        ["2001:db8::2"],
      ),
    ).toEqual({
      address: "2001:db8::2",
      alternates: ["2001:db8::1"],
      fromDns: true,
      temporary: false,
    });
  });

  test("a dns answer that names no host address keeps the host's own", () => {
    expect(selectHostIpv6Address([candidate("2001:db8::1")], ["2001:db8::99"])).toEqual({
      address: "2001:db8::1",
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });

  test("drops link-local, unique-local, loopback and IPv4-mapped addresses", () => {
    expect(
      selectHostIpv6Address([
        candidate("fe80::1"),
        candidate("fc00::1", "eth1"),
        candidate("::1", "lo"),
        candidate("::ffff:192.0.2.1"),
        candidate("2001:db8::1"),
      ]),
    ).toEqual({
      address: "2001:db8::1",
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });

  test("drops a privacy address while a stable one exists", () => {
    expect(
      selectHostIpv6Address([
        candidate("2001:db8::9", "eth0", true),
        candidate("2001:db8::1", "eth0", false),
      ]),
    ).toEqual({
      address: "2001:db8::1",
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });

  test("keeps a privacy address when it is all the machine has", () => {
    expect(selectHostIpv6Address([candidate("2001:db8::9", "eth0", true)])).toEqual({
      address: "2001:db8::9",
      alternates: [],
      fromDns: false,
      temporary: true,
    });
  });

  test("orders several candidates the same way whatever order they arrive in", () => {
    const addresses = [
      candidate("2001:db8::7", "eth1"),
      candidate("2001:db8::5", "eth0"),
      candidate("2001:db8::3", "eth0"),
    ];

    const forward = selectHostIpv6Address(addresses);
    const reverse = selectHostIpv6Address([...addresses].reverse());

    expect(forward).toEqual({
      address: "2001:db8::3",
      alternates: ["2001:db8::5", "2001:db8::7"],
      fromDns: false,
      temporary: false,
    });
    expect(reverse).toEqual(forward);
  });

  test("prefers a hardware-derived identifier over a random-looking one", () => {
    const hardware = candidate("2001:db8::211:22ff:fe33:4455", "eth0");
    const random = candidate("2001:db8::dead:beef", "eth0");

    expect(compareHostIpv6Candidates(hardware, random)).toBeLessThan(0);
    expect(selectHostIpv6Address([random, hardware]).address).toBe("2001:db8::211:22ff:fe33:4455");
  });

  test("drops malformed and duplicate candidates", () => {
    expect(
      selectHostIpv6Address([
        candidate("not-an-address"),
        candidate("192.0.2.1"),
        candidate("2001:db8::1", "eth0"),
        candidate("2001:0db8:0000::0001", "eth1"),
      ]),
    ).toEqual({
      address: "2001:db8::1",
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });

  test("a machine with no candidate has no address", () => {
    expect(selectHostIpv6Address([])).toEqual({
      alternates: [],
      fromDns: false,
      temporary: false,
    });
    expect(selectHostIpv6Address(undefined)).toEqual({
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });
});

describe("classifyNetworkNamespace", () => {
  test("every platform without network namespaces is the host", () => {
    expect(
      classifyNetworkNamespace({
        platform: "win32",
        containerized: true,
        deviceBacked: [],
        vethLike: ["eth0"],
      }),
    ).toBe("host");
  });

  test("a container with its own veth is isolated", () => {
    expect(
      classifyNetworkNamespace({
        platform: "linux",
        containerized: true,
        deviceBacked: [],
        vethLike: ["eth0"],
      }),
    ).toBe("isolated");
  });

  test("a host-networked container sees the host's own NICs", () => {
    expect(
      classifyNetworkNamespace({
        platform: "linux",
        containerized: true,
        deviceBacked: ["eth0"],
        vethLike: [],
      }),
    ).toBe("host");
  });

  test("a container with neither shape cannot be told apart", () => {
    expect(
      classifyNetworkNamespace({
        platform: "linux",
        containerized: true,
        deviceBacked: [],
        vethLike: [],
      }),
    ).toBe("unknown");
  });

  test("a bare-metal host with only container bridges stays the host", () => {
    expect(
      classifyNetworkNamespace({
        platform: "linux",
        containerized: false,
        deviceBacked: [],
        vethLike: ["veth1a2b"],
      }),
    ).toBe("unknown");
    expect(
      classifyNetworkNamespace({
        platform: "linux",
        containerized: false,
        deviceBacked: ["eno1"],
        vethLike: ["veth1a2b"],
      }),
    ).toBe("host");
    expect(
      classifyNetworkNamespace({
        platform: "linux",
        containerized: false,
        deviceBacked: [],
        vethLike: [],
      }),
    ).toBe("host");
  });
});

describe("selectRelayIpv6", () => {
  test("derp.server.ipv6 wins over the host and the dns answer", () => {
    expect(
      selectRelayIpv6({
        declared: "2001:db8::5",
        candidates: [candidate("2001:db8::1")],
        dns: ["2001:db8::2"],
      }),
    ).toMatchObject({
      source: "declared",
      addresses: ["2001:db8::5"],
      mismatch: false,
      alternates: [],
    });
  });

  test("an empty declaration falls through to the host's own address", () => {
    expect(
      selectRelayIpv6({ declared: "  ", candidates: [candidate("2001:db8::1")] }),
    ).toMatchObject({
      source: "host",
      addresses: ["2001:db8::1"],
      copy: "2001:db8::1",
    });
  });

  test("the host address beats a dns answer that names something else", () => {
    expect(
      selectRelayIpv6({
        candidates: [candidate("2001:db8::1")],
        dns: ["2001:db8::99"],
        namespace: "host",
      }),
    ).toMatchObject({
      source: "host",
      addresses: ["2001:db8::1"],
      dns: ["2001:db8::99"],
      mismatch: true,
      copy: "2001:db8::1",
    });
  });

  test("a dns answer that names the host address raises no warning", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate("2001:db8::1"), candidate("2001:db8::2", "eth1")],
      dns: ["2001:db8::1"],
      namespace: "host",
    });

    expect(selection).toMatchObject({
      source: "host",
      addresses: ["2001:db8::1"],
      alternates: ["2001:db8::2"],
      mismatch: false,
      dns: [],
    });
  });

  test("a machine with no global address says so instead of using dns", () => {
    expect(selectRelayIpv6({ candidates: [], dns: [], namespace: "host" })).toEqual({
      source: "none",
      addresses: [],
      alternates: [],
      dns: [],
      namespace: "host",
      mismatch: false,
      temporary: false,
      state: "no-host-address",
    });
  });

  test("a machine with no global address still shows the dns answer, unverified", () => {
    expect(selectRelayIpv6({ candidates: [], dns: ["2001:db8::99"] })).toMatchObject({
      source: "dns",
      addresses: ["2001:db8::99"],
      namespace: "host",
      state: "no-host-address",
    });
    expect(selectRelayIpv6({ candidates: [], dns: ["2001:db8::99"] }).copy).toBeUndefined();
  });

  test("a container outside the host namespace keeps the dns answer unverified", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate("2001:db8::1")],
      dns: ["2001:db8::99"],
      namespace: "isolated",
    });

    expect(selection).toMatchObject({
      source: "dns",
      addresses: ["2001:db8::99"],
      namespace: "isolated",
      mismatch: false,
    });
    // The container's own addresses are never promoted to the host's.
    expect(selection.copy).toBeUndefined();
    expect(selection.alternates).toEqual([]);
  });

  test("an unreadable namespace without a dns answer reports the resolver's reason", () => {
    expect(selectRelayIpv6({ dns: [], namespace: "unknown", reason: "no-records" })).toMatchObject({
      source: "none",
      addresses: [],
      namespace: "unknown",
      state: "no-records",
    });
  });

  test("a temporary host address is reported as such", () => {
    expect(
      selectRelayIpv6({
        candidates: [candidate("2001:db8::9", "eth0", true)],
        namespace: "host",
      }),
    ).toMatchObject({ source: "host", temporary: true, copy: "2001:db8::9" });
  });

  test("the dns answer is deduplicated, keeping the first spelling", () => {
    expect(selectRelayIpv6({ dns: ["2001:DB8:0:0:0:0:0:99", "2001:db8::99"] })).toMatchObject({
      source: "dns",
      addresses: ["2001:db8:0:0:0:0:0:99"],
    });
  });
});
