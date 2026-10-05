import type { NetworkInterfaceInfo } from "node:os";

import { describe, expect, test } from "vitest";

import { relayIpv6NoteKind } from "~/routes/overview-helpers";
import {
  classifyIpv6Address,
  classifyNetworkNamespace,
  compareHostIpv6Candidates,
  isGlobalUnicastIpv6,
  loadHostIpv6Addresses,
  selectHostIpv6Address,
  selectRelayIpv6,
  type HostAddressProbeDeps,
  type HostIpv6Candidate,
} from "~/server/host-addresses";

function candidate(
  address: string,
  interfaceName = "eth0",
  extra: Partial<HostIpv6Candidate> = {},
): HostIpv6Candidate {
  return { address, interfaceName, ...extra };
}

function iface(address: string, family: "IPv4" | "IPv6", internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: family === "IPv6" ? "ffff:ffff:ffff:ffff::" : "255.255.255.0",
    family,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: null,
    scopeid: 0,
  };
}

// MARK: The operator's host, as the three sources report it
//
// `ens18` carries a stable /128 and a rotating privacy address; the ULA pair and
// the link-local address must never be advertised, and the docker bridges only
// have IPv4 and link-local, exactly like the machine this was written for.

const STABLE = "240e:3b3:4030:1510::793";
const PRIVACY = "240e:3b3:4030:1510:152f:808e:9eb1:31c9";
const ULA = "fd9b:d247:c700::793";
const ULA_TEMP = "fd9b:d247:c700:0:152f:808e:9eb1:31c9";
const LINK_LOCAL = "fe80::1";
const BRIDGE_LINK_LOCAL = "fe80::42:acff:fe11:1";

const HOST_INTERFACES: Record<string, NetworkInterfaceInfo[] | undefined> = {
  lo: [iface("::1", "IPv6", true), iface("127.0.0.1", "IPv4", true)],
  ens18: [
    iface(STABLE, "IPv6"),
    iface(PRIVACY, "IPv6"),
    iface(ULA, "IPv6"),
    iface(ULA_TEMP, "IPv6"),
    iface(LINK_LOCAL, "IPv6"),
    iface("10.0.1.5", "IPv4"),
  ],
  docker0: [iface(BRIDGE_LINK_LOCAL, "IPv6"), iface("172.17.0.1", "IPv4")],
};

/** `/proc/net/if_inet6`: address, ifindex, plen, scope, `ifa_flags`, name. */
const HOST_PROC = [
  "00000000000000000000000000000001 01 80 10 80       lo",
  `fe800000000000000000000000000001 02 40 20 80     ens18`,
  `240e03b3403015100000000000000793 02 80 00 00     ens18`,
  `240e03b340301510152f808e9eb131c9 02 40 00 20     ens18`,
  `fd9bd247c70000000000000000000793 02 80 00 00     ens18`,
  `fd9bd247c7000000152f808e9eb131c9 02 40 00 20     ens18`,
  `fe800000000000000042acfffe110001 04 40 20 80     docker0`,
].join("\n");

/** `/sys/class/net` says ens18 is a real NIC; the bridge is not. */
const HOST_SYS = new Set(["/sys/class/net", "/sys/class/net/ens18/device"]);

function hostDeps(overrides: Partial<HostAddressProbeDeps> = {}): HostAddressProbeDeps {
  return {
    platform: "linux",
    networkInterfaces: () => HOST_INTERFACES,
    readText: async (path) => {
      if (path === "/proc/net/if_inet6") {
        return HOST_PROC;
      }

      throw new Error(`ENOENT: ${path}`);
    },
    pathExists: async (path) => HOST_SYS.has(path),
    containerized: async () => false,
    ...overrides,
  };
}

describe("classifyIpv6Address", () => {
  test("keeps global unicast addresses", () => {
    expect(classifyIpv6Address("2001:db8::1")).toBe("global");
    expect(classifyIpv6Address("2a00:1450:4001:81b::200e")).toBe("global");
    expect(classifyIpv6Address("2001:db8::211:22ff:fe33:4455")).toBe("global");
    expect(classifyIpv6Address(STABLE)).toBe("global");
    expect(isGlobalUnicastIpv6("2001:db8::1")).toBe(true);
  });

  test("names every address a client could never reach", () => {
    expect(classifyIpv6Address("fe80::1")).toBe("link-local");
    expect(classifyIpv6Address("fe80::a00:27ff:fe4e:66a1")).toBe("link-local");
    expect(classifyIpv6Address("fc00::1")).toBe("ula");
    expect(classifyIpv6Address(ULA)).toBe("ula");
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

describe("loadHostIpv6Addresses", () => {
  test("merges every source and ranks the stable address first", async () => {
    const result = await loadHostIpv6Addresses({ deps: hostDeps() });

    expect(result.namespace).toBe("host");
    expect(result.reasons).toEqual([]);
    expect(result.candidates).toEqual([
      {
        address: STABLE,
        interfaceName: "ens18",
        temporary: false,
        realNic: true,
        origins: ["os", "proc"],
      },
      {
        address: PRIVACY,
        interfaceName: "ens18",
        temporary: true,
        realNic: true,
        origins: ["os", "proc"],
      },
    ]);
  });

  test("keeps the excluded addresses as evidence instead of dropping them", async () => {
    const result = await loadHostIpv6Addresses({ deps: hostDeps() });
    const kinds = (result.excluded ?? []).map((entry) => entry.kind);

    expect(kinds).toContain("ula");
    expect(kinds).toContain("link-local");
    expect(kinds).toContain("loopback");
    expect(kinds).not.toContain("global");
    expect((result.excluded ?? []).map((entry) => entry.address)).toContain(ULA);
    expect((result.excluded ?? []).map((entry) => entry.address)).not.toContain(STABLE);
  });

  test("an unreadable /proc and /sys are reasons, not failures", async () => {
    const result = await loadHostIpv6Addresses({
      deps: hostDeps({
        readText: async () => {
          throw new Error("EACCES");
        },
        pathExists: async () => {
          throw new Error("EACCES");
        },
        containerized: async () => true,
      }),
    });

    expect(result.reasons).toEqual(["proc-unreadable", "sys-unreadable"]);
    // The addresses the OS could still name are shown, with the flags the
    // unreadable sources could not supply left absent.
    expect(result.candidates).toEqual([
      {
        address: STABLE,
        interfaceName: "ens18",
        origins: ["os"],
      },
      {
        address: PRIVACY,
        interfaceName: "ens18",
        origins: ["os"],
      },
    ]);
    // A container whose namespace cannot be shown is not assumed to be the host.
    expect(result.namespace).toBe("unknown");
  });

  test("a bridged container is isolated and still reports its own addresses", async () => {
    const result = await loadHostIpv6Addresses({
      deps: hostDeps({
        networkInterfaces: () => ({
          lo: [iface("::1", "IPv6", true)],
          eth0: [iface(BRIDGE_LINK_LOCAL, "IPv6"), iface("172.17.0.2", "IPv4")],
        }),
        readText: async (path) => {
          if (path.endsWith("/iflink")) {
            return "7\n";
          }

          if (path.endsWith("/ifindex")) {
            return "42\n";
          }

          throw new Error("ENOENT");
        },
        pathExists: async (path) => path === "/sys/class/net",
        containerized: async () => true,
      }),
    });

    expect(result.namespace).toBe("isolated");
    // Only link-local IPv6 addresses exist, so there is nothing to advertise.
    expect(result.candidates).toEqual([]);
  });

  test("an unreadable OS list still leaves what /proc knows", async () => {
    const result = await loadHostIpv6Addresses({
      deps: hostDeps({
        networkInterfaces: () => {
          throw new Error("EPERM");
        },
      }),
    });

    expect(result.reasons).toEqual(["os-unreadable"]);
    expect(result.candidates.map((entry) => entry.address)).toEqual([STABLE, PRIVACY]);
    expect(result.candidates[0]?.origins).toEqual(["proc"]);
  });
});

describe("selectHostIpv6Address", () => {
  test("the dns answer selects the host address it names", () => {
    expect(
      selectHostIpv6Address(
        [candidate("2001:db8::1", "eth0"), candidate("2001:db8::2", "eth1")],
        ["2001:db8::2"],
      ),
    ).toMatchObject({
      address: "2001:db8::2",
      alternates: ["2001:db8::1"],
      fromDns: true,
      temporary: false,
    });
  });

  test("a dns answer that names no host address keeps the host's own", () => {
    expect(selectHostIpv6Address([candidate("2001:db8::1")], ["2001:db8::99"])).toMatchObject({
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
    ).toMatchObject({
      address: "2001:db8::1",
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });

  test("a stable address beats a privacy address, whatever the dns answer names", () => {
    const addresses = [
      candidate(PRIVACY, "ens18", { temporary: true, realNic: true }),
      candidate(STABLE, "ens18", { temporary: false, realNic: true }),
    ];

    expect(selectHostIpv6Address(addresses, [PRIVACY])).toMatchObject({
      address: STABLE,
      alternates: [PRIVACY],
      fromDns: false,
      temporary: false,
    });
  });

  test("keeps a privacy address when it is all the machine has", () => {
    expect(
      selectHostIpv6Address([candidate("2001:db8::9", "eth0", { temporary: true })]),
    ).toMatchObject({
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

    expect(forward).toMatchObject({
      address: "2001:db8::3",
      alternates: ["2001:db8::5", "2001:db8::7"],
      fromDns: false,
      temporary: false,
    });
    expect(reverse).toEqual(forward);
  });

  test("a real NIC beats a virtual interface of the same stability", () => {
    const virtual = candidate("2001:db8::9", "docker0", { realNic: false });
    const real = candidate("2001:db8::1", "ens18", { realNic: true });

    expect(compareHostIpv6Candidates(real, virtual)).toBeLessThan(0);
    expect(selectHostIpv6Address([virtual, real]).address).toBe("2001:db8::1");
  });

  test("an EUI-64 identifier is never the known-stable address", () => {
    const hardware = candidate("2001:db8::211:22ff:fe33:4455", "ens18", {
      temporary: false,
      realNic: true,
    });
    const generated = candidate("2001:db8::dead:beef", "ens18", {
      temporary: false,
      realNic: true,
    });

    expect(compareHostIpv6Candidates(generated, hardware)).toBeLessThan(0);
    expect(selectHostIpv6Address([hardware, generated]).address).toBe("2001:db8::dead:beef");
  });

  test("explains every candidate, chosen or not", () => {
    const selection = selectHostIpv6Address(
      [
        candidate(PRIVACY, "ens18", { temporary: true, realNic: true }),
        candidate(STABLE, "ens18", { temporary: false, realNic: true }),
      ],
      [STABLE],
    );

    expect(selection.candidates).toEqual([
      {
        address: STABLE,
        interfaceName: "ens18",
        stability: "stable",
        temporary: false,
        hardwareDerived: false,
        realNic: true,
        fromDns: true,
        fromEcho: false,
        chosen: true,
        origins: [],
      },
      {
        address: PRIVACY,
        interfaceName: "ens18",
        stability: "temporary",
        temporary: true,
        hardwareDerived: false,
        realNic: true,
        fromDns: false,
        fromEcho: false,
        chosen: false,
        origins: [],
      },
    ]);
  });

  test("drops malformed and duplicate candidates", () => {
    expect(
      selectHostIpv6Address([
        candidate("not-an-address"),
        candidate("192.0.2.1"),
        candidate("2001:db8::1", "eth0"),
        candidate("2001:0db8:0000::0001", "eth1"),
      ]),
    ).toMatchObject({
      address: "2001:db8::1",
      alternates: [],
      fromDns: false,
      temporary: false,
    });
  });

  test("a machine with no candidate has no address", () => {
    expect(selectHostIpv6Address([])).toMatchObject({
      alternates: [],
      fromDns: false,
      temporary: false,
      candidates: [],
    });
    expect(selectHostIpv6Address(undefined)).toMatchObject({
      alternates: [],
      fromDns: false,
      temporary: false,
      candidates: [],
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
      unconfirmed: false,
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
    expect(selectRelayIpv6({ candidates: [], dns: [], namespace: "host" })).toMatchObject({
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

  test("a container outside the host namespace shows its own addresses, unconfirmed", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate("2001:db8::1")],
      dns: ["2001:db8::99"],
      namespace: "isolated",
    });

    // The candidate is reported rather than hidden, but it is never presented
    // as the host's own address.
    expect(selection).toMatchObject({
      source: "host",
      addresses: ["2001:db8::1"],
      namespace: "isolated",
      unconfirmed: true,
      mismatch: true,
      dns: ["2001:db8::99"],
    });
    expect(relayIpv6NoteKind(selection)).toEqual({
      kind: "unconfirmed",
      namespace: "isolated",
    });
  });

  test("an unconfirmed namespace keeps the address and labels it", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate("2001:db8::1")],
      namespace: "unknown",
    });

    expect(selection).toMatchObject({ source: "host", unconfirmed: true, namespace: "unknown" });
    expect(relayIpv6NoteKind(selection)).toEqual({
      kind: "unconfirmed",
      namespace: "unknown",
    });
  });

  test("a container with nothing found reports the resolver's reason", () => {
    expect(selectRelayIpv6({ dns: [], namespace: "unknown", reason: "no-records" })).toMatchObject({
      source: "none",
      addresses: [],
      namespace: "unknown",
      state: "no-records",
    });
  });

  test("a container with nothing found and no resolver reason says so honestly", () => {
    expect(selectRelayIpv6({ dns: [], namespace: "isolated" })).toMatchObject({
      source: "none",
      state: "no-host-address",
    });
  });

  test("a temporary host address is reported as such", () => {
    const selection = selectRelayIpv6({
      candidates: [
        candidate(PRIVACY, "ens18", { temporary: true, realNic: true }),
        candidate(STABLE, "ens18", { temporary: false, realNic: true }),
      ],
      namespace: "host",
    });

    expect(selection).toMatchObject({
      source: "host",
      addresses: [STABLE],
      alternates: [PRIVACY],
      temporary: false,
      copy: STABLE,
    });
  });

  test("a machine that only holds a privacy address says it rotates", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate(PRIVACY, "ens18", { temporary: true, realNic: true })],
      namespace: "host",
    });

    expect(selection).toMatchObject({ source: "host", temporary: true });
    expect(relayIpv6NoteKind(selection)).toEqual({ kind: "temporary" });
  });

  test("a declared address no source agrees with becomes a contradiction", () => {
    const selection = selectRelayIpv6({
      declared: "2001:db8::5",
      candidates: [candidate("2001:db8::1")],
      namespace: "host",
    });

    expect(selection).toMatchObject({
      source: "declared",
      addresses: ["2001:db8::5"],
      contradiction: { declared: "2001:db8::5", detected: "2001:db8::1", source: "host" },
      copy: "2001:db8::1",
    });
  });

  test("the domain's AAAA pointing elsewhere is the existing mismatch", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
      dns: ["240e:3b3:4030:1510::1"],
      namespace: "host",
    });

    expect(selection).toMatchObject({
      source: "host",
      addresses: [STABLE],
      mismatch: true,
      dns: ["240e:3b3:4030:1510::1"],
    });
  });

  test("the dns answer is deduplicated, keeping the first spelling", () => {
    expect(selectRelayIpv6({ dns: ["2001:DB8:0:0:0:0:0:99", "2001:db8::99"] })).toMatchObject({
      source: "dns",
      addresses: ["2001:db8:0:0:0:0:0:99"],
    });
  });

  test("a source that could not be read is reported, never hidden", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate("2001:db8::1")],
      namespace: "host",
      probeReasons: ["proc-unreadable", "sys-unreadable", "timeout"],
    });

    expect(selection.probeReasons).toEqual(["proc-unreadable", "sys-unreadable", "timeout"]);
    expect(relayIpv6NoteKind(selection)).toEqual({
      kind: "probe",
      reasons: ["proc-unreadable", "sys-unreadable", "timeout"],
    });
  });
});

describe("relayIpv6NoteKind", () => {
  test("a declared address keeps the verdict line the row already had", () => {
    expect(relayIpv6NoteKind(selectRelayIpv6({ declared: "2001:db8::5" }))).toEqual({
      kind: "declared",
    });
  });

  test("a dns-only row on the host says the machine has no public IPv6", () => {
    expect(relayIpv6NoteKind(selectRelayIpv6({ candidates: [], dns: ["2001:db8::99"] }))).toEqual({
      kind: "dns-fallback",
    });
  });

  test("a dns-only row in a container is marked unverified", () => {
    expect(
      relayIpv6NoteKind(
        selectRelayIpv6({ candidates: [], dns: ["2001:db8::99"], namespace: "isolated" }),
      ),
    ).toEqual({ kind: "unverified" });
  });

  test("a value that speaks for itself has no note", () => {
    expect(
      relayIpv6NoteKind(
        selectRelayIpv6({
          candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
          namespace: "host",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("selectRelayIpv6 with the external echo", () => {
  test("an echo answer that matches a local address is used and marked", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
      namespace: "host",
      echo: { address: STABLE, url: "https://api64.ipify.org?format=json" },
    });

    expect(selection).toMatchObject({
      source: "echo",
      addresses: [STABLE],
      copy: STABLE,
      echo: { address: STABLE, matchesLocal: true, url: "https://api64.ipify.org?format=json" },
    });
    expect(selection.candidates[0]?.fromEcho).toBe(true);
    expect(relayIpv6NoteKind(selection)).toEqual({ kind: "echo-match", address: STABLE });
  });

  test("an echo answer no local address holds is still what clients reach", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
      namespace: "host",
      echo: { address: "240e:3b3:4030:1510::1" },
    });

    expect(selection).toMatchObject({
      source: "echo",
      addresses: ["240e:3b3:4030:1510::1"],
      echo: { address: "240e:3b3:4030:1510::1", matchesLocal: false },
      copy: "240e:3b3:4030:1510::1",
    });
    expect(relayIpv6NoteKind(selection)).toEqual({
      kind: "echo-forwarded",
      address: "240e:3b3:4030:1510::1",
    });
  });

  test("an echo answer beats a declared address that disagrees with it", () => {
    const selection = selectRelayIpv6({
      declared: "240e:3b3:4030:1510::5",
      candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
      namespace: "host",
      echo: { address: "240e:3b3:4030:1510::1" },
    });

    expect(selection).toMatchObject({
      source: "declared",
      addresses: ["240e:3b3:4030:1510::5"],
      contradiction: {
        declared: "240e:3b3:4030:1510::5",
        detected: "240e:3b3:4030:1510::1",
        source: "echo",
      },
      copy: "240e:3b3:4030:1510::1",
    });
  });

  test("a declared address the echo confirms raises no contradiction", () => {
    const selection = selectRelayIpv6({
      declared: "240e:3b3:4030:1510::1",
      namespace: "host",
      echo: { address: "240e:3b3:4030:1510::1" },
    });

    expect(selection.contradiction).toBeUndefined();
    expect(selection.copy).toBeUndefined();
  });

  test("with the probe off the local address is still what is shown", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
      namespace: "host",
      probeReasons: [],
    });

    expect(selection).toMatchObject({ source: "host", addresses: [STABLE] });
    expect(selection.echo).toBeUndefined();
    expect(relayIpv6NoteKind(selection)).toBeUndefined();
  });

  test("a failed probe is a note, not a missing address", () => {
    const selection = selectRelayIpv6({
      candidates: [candidate(STABLE, "ens18", { temporary: false, realNic: true })],
      namespace: "host",
      probeReasons: ["timeout"],
    });

    expect(selection).toMatchObject({ source: "host", addresses: [STABLE] });
    expect(relayIpv6NoteKind(selection)).toEqual({ kind: "probe", reasons: ["timeout"] });
  });

  test("a bridged container with no address and a failed probe stays honest", () => {
    const selection = selectRelayIpv6({
      candidates: [],
      dns: [],
      namespace: "isolated",
      probeReasons: ["unreachable"],
    });

    expect(selection).toMatchObject({ source: "none", addresses: [], state: "no-host-address" });
  });
});
