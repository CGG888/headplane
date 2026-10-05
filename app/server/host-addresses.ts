/**
 * The IPv6 addresses this machine itself holds, and whether Headplane can see
 * the host's network namespace at all.
 *
 * IPv4 and IPv6 are derived differently on purpose. A machine behind NAT cannot
 * know its own public IPv4 address, so `derp.server.ipv4` or the domain's A
 * record is the only source that can be right. IPv6 usually has no NAT, so the
 * public address lives on the machine — but a host behind NAT66, or one whose
 * router forwards a different address, is exactly the case where the machine's
 * own addresses are *not* what clients reach. The Overview card therefore reads
 * every source it can and keeps them apart instead of collapsing them:
 *
 * 1. `os.networkInterfaces()` — the addresses the OS reports.
 * 2. `/proc/net/if_inet6` — the interface flags, which are the only place a
 *    temporary (RFC 4941 privacy) address is distinguishable from a stable one,
 *    and a second, independent list of addresses.
 * 3. `/sys/class/net/<if>/device` and `/sys/class/net/<if>/type` — evidence that
 *    an interface is a real host NIC rather than a veth, bridge or tunnel.
 * 4. Optionally, an external echo endpoint (`host-echo.ts`) that reports the
 *    address the internet actually sees. That is the authoritative answer when
 *    the host sits behind NAT66 or a forwarded address, and it is off by default.
 *
 * Every source is optional: one that cannot be read adds a reason, never an
 * exception and never a silently missing candidate.
 *
 * Selection, in order:
 *
 * 1. `derp.server.ipv6` when it is set — the operator declared it. A detected
 *    address that disagrees is reported as a contradiction next to it, never
 *    written over it.
 * 2. The external echo answer, when the probe answered. It is what clients
 *    reach, whether or not any local interface carries it.
 * 3. The machine's own best address, ranked by {@link compareHostIpv6Candidates}:
 *    known-stable (no temporary flag, not EUI-64-derived, backed by a real NIC),
 *    then unknown, then known-temporary; the address the domain's AAAA names
 *    first within a class, then a real NIC over a virtual interface, then the
 *    interface name and finally the value, so a machine with several candidates
 *    always picks the same one whatever order the OS lists interfaces in.
 * 4. The domain's AAAA answer, labelled as unverified, when there is nothing
 *    better.
 *
 * A process whose network namespace cannot be shown to be the host's still gets
 * its candidates reported — the container may legitimately share the host's
 * stack — but they are marked unconfirmed, with the namespace verdict next to
 * them, instead of being hidden or silently promoted to "the host's address". A
 * container interface is never read as proof of isolation: a host that runs
 * Docker shows the same bridges and veths in its own namespace.
 *
 * Everything here is read-only and fail-soft: an unreadable interface list, a
 * missing `/proc` entry or a platform without `/sys/class/net` degrades to an
 * empty candidate list or to "cannot tell", never to an exception, so a broken
 * probe can never take the dashboard card down. The probe itself is cached, so a
 * dashboard render is one short-lived in-memory read at most.
 */

import { readFile, stat } from "node:fs/promises";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { parseIpv6 } from "~/routes/settings/headscale/trusted-proxies";
import type { RelayResolutionReason } from "~/server/relay-dns";
import log from "~/utils/log";

/** Linux `ifa_flags` that make an address a rotating one, from `iproute2`. */
const IFA_F_SECONDARY = 0x01;
const IFA_F_DEPRECATED = 0x20;

/** `ARPHRD_LOOPBACK` from `/sys/class/net/<if>/type`; a loopback is not a NIC. */
const ARPHRD_LOOPBACK = 772;

/** Where the kernel lists one line per IPv6 address, with its interface flags. */
const PROC_IF_INET6 = "/proc/net/if_inet6";

/** The directory whose child interfaces carry the real-NIC evidence. */
const SYS_CLASS_NET = "/sys/class/net";

/** Container runtimes that leave a marker in PID 1's cgroup. */
const CONTAINER_MARKERS = [/docker/i, /containerd/i, /kubepods/i, /libpod/i, /lxc/i];

/** How long one enumeration of the host's own addresses is reused. */
export const HOST_ADDRESS_CACHE_TTL_MS = 60_000;

// MARK: Addresses

/** What an IPv6 address is, from the point of view of "can clients reach it". */
export type Ipv6AddressKind =
  | "global"
  | "link-local"
  | "ula"
  | "loopback"
  | "mapped"
  | "multicast"
  | "unspecified"
  | "other"
  | "invalid";

interface ParsedHostAddress {
  groups: number[];
  /** Sixteen zero-padded groups, so two spellings of one address compare equal. */
  canonical: string;
  /** The address as written, lowercased and without a zone id. */
  display: string;
}

function canonicalGroups(groups: readonly number[]): string {
  return groups.map((group) => group.toString(16).padStart(4, "0")).join(":");
}

/**
 * The shortest common spelling of eight groups, used when an address only exists
 * in `/proc/net/if_inet6` and has no OS spelling to borrow.
 */
function formatGroups(groups: readonly number[]): string {
  const parts = groups.map((group) => group.toString(16));

  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (start < 0) {
        start = index;
      }
      length += 1;
      continue;
    }

    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
    start = -1;
    length = 0;
  }

  if (bestLength < 2) {
    return parts.join(":");
  }

  const head = parts.slice(0, bestStart).join(":");
  const tail = parts.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

/**
 * An address as its eight groups, or `undefined` for anything that is not an
 * IPv6 address. A bracketed value and a zone id (`fe80::1%eth0`) are unwrapped:
 * both are spellings, not different addresses.
 */
function parseHostAddress(value: string): ParsedHostAddress | undefined {
  const address = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const groups = parseIpv6(address);
  if (groups === undefined) {
    return undefined;
  }

  return { groups, canonical: canonicalGroups(groups), display: address.toLowerCase() };
}

/** The comparable spelling of an address, or `undefined` when it is not one. */
function canonicalAddress(value: string | undefined): string | undefined {
  return parseHostAddress(value ?? "")?.canonical;
}

/** True when two spellings name the same address. */
function sameAddress(a: string, b: string): boolean {
  const left = canonicalAddress(a);
  return left !== undefined && left === canonicalAddress(b);
}

/**
 * What a value is: only a global unicast address (`2000::/3`) is one clients can
 * reach over the internet. Link-local, unique-local (`fc00::/7`), loopback,
 * unspecified, multicast and IPv4-mapped addresses are named rather than lumped
 * together so a caller can explain why an address was dropped.
 */
export function classifyIpv6Address(value: string): Ipv6AddressKind {
  const parsed = parseHostAddress(value);
  if (parsed === undefined) {
    return "invalid";
  }

  const { groups } = parsed;
  const first = groups[0];

  if (groups.every((group) => group === 0)) {
    return "unspecified";
  }

  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return "loopback";
  }

  if ((first & 0xff00) === 0xff00) {
    return "multicast";
  }

  if ((first & 0xffc0) === 0xfe80) {
    return "link-local";
  }

  if ((first & 0xfe00) === 0xfc00) {
    return "ula";
  }

  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return "mapped";
  }

  return (first & 0xe000) === 0x2000 ? "global" : "other";
}

/** True when clients could route to this address over the public internet. */
export function isGlobalUnicastIpv6(value: string): boolean {
  return classifyIpv6Address(value) === "global";
}

/**
 * True when the interface identifier carries the EUI-64 `ff:fe` marker, which
 * means it was derived from a hardware address rather than generated at random
 * the way an RFC 4941 or RFC 7217 address is. It is a stable identifier, but it
 * also encodes the NIC's MAC address and is therefore never the first choice.
 */
function looksHardwareDerived(groups: readonly number[]): boolean {
  return (groups[5] & 0x00ff) === 0x00ff && (groups[6] & 0xff00) === 0xfe00;
}

// MARK: Candidates

/** Which source reported an address, or gave evidence about an interface. */
export type HostAddressOrigin = "os" | "proc";

/** A source that could not be read. Recorded as a note, never as a failure. */
export type HostAddressReadReason = "os-unreadable" | "proc-unreadable" | "sys-unreadable";

/**
 * Why the external echo probe has no answer. Declared here, next to the other
 * probe reasons, because the relay row renders them together; the probe itself
 * lives in `host-echo.ts`.
 */
export type HostEchoReason = "disabled" | "timeout" | "unreachable" | "invalid";

/** Every reason a probe can report next to the IPv6 row. */
export type HostProbeReason = HostAddressReadReason | HostEchoReason;

/** How the ranking treats one candidate's stability. */
export type HostIpv6Stability = "stable" | "unknown" | "temporary";

/** One global unicast address the machine holds. */
export interface HostIpv6Candidate {
  address: string;
  interfaceName: string;
  /**
   * True when the kernel marks the address as temporary (an RFC 4941 privacy
   * address, printed as `temporary` by `ip`), false when it is marked stable,
   * and absent when the flag could not be read at all.
   */
  temporary?: boolean;
  /**
   * True when `/sys/class/net/<if>/device` exists, so the interface is backed by
   * a real device rather than being a veth, bridge or tunnel; absent when `/sys`
   * could not be read.
   */
  realNic?: boolean;
  /** `/sys/class/net/<if>/type`, the kernel's ARPHRD kind, when readable. */
  interfaceType?: number;
  /** Which sources reported this address. */
  origins?: HostAddressOrigin[];
}

/** The stability class of one candidate, as the ranking documents it. */
export function hostCandidateStability(candidate: HostIpv6Candidate): HostIpv6Stability {
  if (candidate.temporary === true) {
    return "temporary";
  }

  const groups = parseHostAddress(candidate.address)?.groups;
  const stable =
    candidate.temporary === false &&
    candidate.realNic === true &&
    groups !== undefined &&
    !looksHardwareDerived(groups);

  return stable ? "stable" : "unknown";
}

const STABILITY_ORDER: Record<HostIpv6Stability, number> = {
  stable: 0,
  unknown: 1,
  temporary: 2,
};

/** The canonical spellings of a preferred set, from either a list or a set. */
function preferredSet(
  preferred: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> {
  if (preferred === undefined) {
    return new Set<string>();
  }

  if (Array.isArray(preferred)) {
    return new Set(
      (preferred as readonly string[]).map((value) => canonicalAddress(value) ?? value),
    );
  }

  return preferred as ReadonlySet<string>;
}

/**
 * The documented order of {@link selectHostIpv6Address}: a known-stable address
 * before one whose stability could not be established before a known-temporary
 * one, then an address the caller marked as preferred (the domain's AAAA answer
 * or the internet echo), then a real NIC before a virtual interface, then the
 * interface name and the value. The last two make the choice independent of the
 * order the OS enumerated the interfaces in.
 */
export function compareHostIpv6Candidates(
  a: HostIpv6Candidate,
  b: HostIpv6Candidate,
  preferred?: ReadonlySet<string> | readonly string[],
): number {
  const stability =
    STABILITY_ORDER[hostCandidateStability(a)] - STABILITY_ORDER[hostCandidateStability(b)];
  if (stability !== 0) {
    return stability;
  }

  const preferredAddresses = preferredSet(preferred);
  const named = (candidate: HostIpv6Candidate) => {
    const canonical = canonicalAddress(candidate.address);
    return canonical !== undefined && preferredAddresses.has(canonical) ? 0 : 1;
  };
  if (named(a) !== named(b)) {
    return named(a) - named(b);
  }

  const nic = (candidate: HostIpv6Candidate) => (candidate.realNic === true ? 0 : 1);
  if (nic(a) !== nic(b)) {
    return nic(a) - nic(b);
  }

  if (a.interfaceName !== b.interfaceName) {
    return a.interfaceName < b.interfaceName ? -1 : 1;
  }

  const aGroups = parseHostAddress(a.address)?.groups;
  const bGroups = parseHostAddress(b.address)?.groups;
  for (let index = 0; index < 8; index += 1) {
    const left = aGroups?.[index] ?? 0;
    const right = bGroups?.[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }

  return 0;
}

/** Why one candidate was or was not the address that got chosen. */
export interface HostIpv6Assessment {
  address: string;
  interfaceName: string;
  stability: HostIpv6Stability;
  temporary: boolean;
  /** The interface identifier carries the EUI-64 `ff:fe` marker. */
  hardwareDerived: boolean;
  /** Backed by `/sys/class/net/<if>/device`; false when it is a veth or bridge. */
  realNic: boolean;
  /** `/sys/class/net/<if>/type`, when it could be read. */
  interfaceType?: number;
  /** The domain's AAAA answer names this address. */
  fromDns: boolean;
  /** The internet echo returned this address. */
  fromEcho: boolean;
  /** This is the address the selection settled on. */
  chosen: boolean;
  origins: HostAddressOrigin[];
}

// MARK: Selection

/** One machine address, chosen from the candidates, and what was left over. */
export interface HostIpv6Selection {
  /** The address to advertise; absent when the machine has no usable one. */
  address?: string;
  /** The other global addresses the machine holds, in the same order. */
  alternates: string[];
  /** True when the DNS answer named the selected address. */
  fromDns: boolean;
  /** True when the only global addresses found are temporary (privacy) ones. */
  temporary: boolean;
  /**
   * Every global candidate, in ranked order, with why it was or was not chosen.
   * Empty when the machine holds none (or when nothing could be read).
   */
  candidates: HostIpv6Assessment[];
}

interface RankedCandidate extends HostIpv6Candidate {
  canonical: string;
  groups: number[];
  origins: HostAddressOrigin[];
}

/**
 * Picks the address to advertise out of the machine's own candidates. The DNS
 * answer wins within a stability class — that is the address clients already
 * resolve, so it is the one to keep using unless it is a rotating privacy
 * address and a stable one exists. Nothing here throws: malformed candidates are
 * dropped, and no candidate at all comes back as an empty selection.
 */
export function selectHostIpv6Address(
  candidates: readonly HostIpv6Candidate[] | undefined,
  dnsAddresses: readonly string[] | undefined = [],
  echoAddress?: string,
): HostIpv6Selection {
  const seen = new Set<string>();
  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates ?? []) {
    const parsed = parseHostAddress(candidate.address);
    if (parsed === undefined || classifyIpv6Address(candidate.address) !== "global") {
      continue;
    }

    if (seen.has(parsed.canonical)) {
      continue;
    }

    seen.add(parsed.canonical);
    ranked.push({
      address: parsed.display,
      interfaceName: candidate.interfaceName,
      ...(candidate.temporary === undefined ? {} : { temporary: candidate.temporary }),
      ...(candidate.realNic === undefined ? {} : { realNic: candidate.realNic }),
      ...(candidate.interfaceType === undefined ? {} : { interfaceType: candidate.interfaceType }),
      origins: [...(candidate.origins ?? [])],
      canonical: parsed.canonical,
      groups: parsed.groups,
    });
  }

  const dns = new Set(
    (dnsAddresses ?? []).flatMap((value) => {
      const parsed = parseHostAddress(value);
      return parsed === undefined ? [] : [parsed.canonical];
    }),
  );

  const echo = canonicalAddress(echoAddress);
  const ordered = [...ranked].sort((a, b) =>
    compareHostIpv6Candidates(a, b, dns.size === 0 ? undefined : dns),
  );

  const assessments: HostIpv6Assessment[] = ordered.map((candidate) => ({
    address: candidate.address,
    interfaceName: candidate.interfaceName,
    stability: hostCandidateStability(candidate),
    temporary: candidate.temporary === true,
    hardwareDerived: looksHardwareDerived(candidate.groups),
    realNic: candidate.realNic === true,
    ...(candidate.interfaceType === undefined ? {} : { interfaceType: candidate.interfaceType }),
    fromDns: dns.has(candidate.canonical),
    fromEcho: echo !== undefined && echo === candidate.canonical,
    chosen: false,
    origins: candidate.origins,
  }));

  const selected = ordered[0];
  if (selected === undefined) {
    return { alternates: [], fromDns: false, temporary: false, candidates: [] };
  }

  const selectedAssessment = assessments[0];
  if (selectedAssessment !== undefined) {
    selectedAssessment.chosen = true;
  }

  return {
    address: selected.address,
    alternates: ordered
      .filter((candidate) => candidate.canonical !== selected.canonical)
      .map((candidate) => candidate.address),
    fromDns: dns.has(selected.canonical),
    temporary: selected.temporary === true,
    candidates: assessments,
  };
}

/** Why the relay row has no IPv6 address to print. */
export type RelayIpv6State = RelayResolutionReason | "no-host-address" | "unavailable";

/** Where the IPv6 address the relay card prints came from. */
export type RelayIpv6Source = "declared" | "host" | "echo" | "dns" | "none";

/** What the external echo endpoint answered, as the card needs it. */
export interface HostEchoObservation {
  address: string;
  /** The endpoint that answered, when the caller knows it. */
  url?: string;
}

/** The IPv6 half of the relay address block, ready to render. */
export interface RelayIpv6Selection {
  source: RelayIpv6Source;
  /** The address(es) to print; empty when the row has only a state to show. */
  addresses: string[];
  /** The machine's other global addresses, in ranked order. */
  alternates: string[];
  /** The domain's AAAA answer, when it is not the address this machine holds. */
  dns: string[];
  /**
   * Whether Headplane could see the host's network namespace. Anything but
   * `host` means the printed machine addresses are the container's own until
   * proven otherwise.
   */
  namespace: HostNamespace;
  /**
   * True when the printed address came from local interfaces that are not
   * confirmed to be the host's. Those candidates are shown, labelled as such,
   * rather than hidden.
   */
  unconfirmed: boolean;
  /** True when the domain's AAAA does not name the address this machine holds. */
  mismatch: boolean;
  /** True when the printed machine address is a temporary (privacy) one. */
  temporary: boolean;
  /** The address an operator should paste into `derp.server.ipv6`. */
  copy?: string;
  /** Why there is nothing to print; only set when `addresses` is empty. */
  state?: RelayIpv6State;
  /** Every global candidate, ranked, with why it was or was not chosen. */
  candidates: HostIpv6Assessment[];
  /** Addresses that were seen and excluded, so nothing is silently dropped. */
  excluded: HostExcludedAddress[];
  /** Where the internet echo landed, when the probe answered. */
  echo?: { address: string; matchesLocal: boolean; url?: string };
  /** The declared address and the detected one that contradicts it. */
  contradiction?: { declared: string; detected: string; source: "host" | "echo" };
  /** Sources that could not be read, and probes with no answer. */
  probeReasons: HostProbeReason[];
}

export interface RelayIpv6Input {
  /** `derp.server.ipv6`, which wins over everything else when it is set. */
  declared?: string;
  candidates?: readonly HostIpv6Candidate[];
  /** The domain's AAAA answer for the relay hostname. */
  dns?: readonly string[];
  /** What {@link classifyNetworkNamespace} decided for this process. */
  namespace?: HostNamespace;
  /** The resolver's own reason, when it returned no AAAA at all. */
  reason?: RelayResolutionReason;
  /** The internet echo answer, when the probe is enabled and answered. */
  echo?: HostEchoObservation;
  /** Sources that could not be read, and probes with no answer. */
  probeReasons?: readonly HostProbeReason[];
  /** Addresses the probe saw and excluded, reported so nothing is hidden. */
  excluded?: readonly HostExcludedAddress[];
}

function uniqueAddresses(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const value of values ?? []) {
    const parsed = parseHostAddress(value);
    if (parsed === undefined || seen.has(parsed.canonical)) {
      continue;
    }

    seen.add(parsed.canonical);
    addresses.push(parsed.display);
  }

  return addresses;
}

function uniqueReasons(values: readonly HostProbeReason[] | undefined): HostProbeReason[] {
  return [...new Set(values ?? [])];
}

/**
 * The IPv6 row of the relay card: what `derp.server` declares, what the internet
 * echo sees, the machine's own address (cross-checked against the domain's
 * AAAA), or the DNS answer as an unverified fallback.
 *
 * A declared address is never silently contradicted: when a detected address
 * disagrees with it, the row keeps the declared value, carries the detected one
 * next to it as a contradiction, and offers the detected one to copy. A machine
 * with no global address and no AAAA answer comes back as `no-host-address` so
 * the card can say so in plain words instead of showing nothing.
 */
export function selectRelayIpv6(input: RelayIpv6Input = {}): RelayIpv6Selection {
  const namespace = input.namespace ?? "host";
  const dns = uniqueAddresses(input.dns);
  const declared = (input.declared ?? "").trim();
  const probeReasons = uniqueReasons(input.probeReasons);

  const host = selectHostIpv6Address(input.candidates, dns, input.echo?.address);
  const echoCanonical = canonicalAddress(input.echo?.address);
  const echoMatchesLocal =
    echoCanonical !== undefined &&
    host.candidates.some((candidate) => canonicalAddress(candidate.address) === echoCanonical);
  const echo =
    input.echo === undefined
      ? undefined
      : {
          address: input.echo.address,
          matchesLocal: echoMatchesLocal,
          ...(input.echo.url === undefined ? {} : { url: input.echo.url }),
        };

  const base: RelayIpv6Selection = {
    source: "none",
    addresses: [],
    alternates: [],
    dns: [],
    namespace,
    unconfirmed: false,
    mismatch: false,
    temporary: false,
    candidates: host.candidates,
    excluded: [...(input.excluded ?? [])],
    probeReasons,
    ...(echo === undefined ? {} : { echo }),
  };

  if (declared.length > 0) {
    const detected = echo?.address ?? host.address;
    const contradiction =
      detected === undefined || sameAddress(declared, detected)
        ? undefined
        : {
            declared,
            detected,
            source: (echo === undefined ? "host" : "echo") as "host" | "echo",
          };

    return {
      ...base,
      source: "declared",
      addresses: [declared],
      ...(contradiction === undefined ? {} : { contradiction, copy: contradiction.detected }),
    };
  }

  if (echo !== undefined) {
    const mismatch = dns.length > 0 && !dns.some((value) => sameAddress(value, echo.address));
    return {
      ...base,
      source: "echo",
      addresses: [echo.address],
      alternates: host.alternates,
      ...(mismatch ? { dns, mismatch: true } : {}),
      copy: echo.address,
    };
  }

  if (host.address !== undefined) {
    const mismatch = dns.length > 0 && !host.fromDns;
    return {
      ...base,
      source: "host",
      addresses: [host.address],
      alternates: host.alternates,
      dns: mismatch ? dns : [],
      mismatch,
      unconfirmed: namespace !== "host",
      temporary: host.temporary,
      copy: host.address,
    };
  }

  if (dns.length > 0) {
    return {
      ...base,
      source: "dns",
      addresses: dns,
      ...(namespace === "host" ? { state: "no-host-address" as const } : {}),
    };
  }

  return {
    ...base,
    // With nothing detected anywhere, "this machine has no public IPv6" is the
    // honest state whatever the namespace; a resolver that never answered says
    // more, so its own reason wins when there is one.
    state: namespace === "host" || input.reason === undefined ? "no-host-address" : input.reason,
  };
}

// MARK: Network namespace

/**
 * Where the process's network namespace stands relative to the host's.
 *
 * `host` means the machine's addresses can be trusted; `isolated` means the
 * process is known to have its own namespace and enumerates only its own
 * interfaces; `unknown` means neither could be shown, which is reported instead
 * of guessed at. {@link classifyNetworkNamespace} never returns `isolated`:
 * a container interface is not proof of anything, so the strongest verdict that
 * rule can justify is `host` or "cannot tell".
 */
export type HostNamespace = "host" | "isolated" | "unknown";

/** Everything {@link classifyNetworkNamespace} needs, so the rule is testable. */
export interface NetworkNamespaceProbe {
  platform: string;
  /** True when a container runtime marker was found. */
  containerized: boolean;
  /**
   * Interfaces that are backed by a real device
   * (`/sys/class/net/<name>/device`) *and* carry a global unicast address. That
   * combination is the one shape only the host's own NIC can have.
   */
  deviceBackedGlobal: readonly string[];
  /** Interfaces whose peer lives in another namespace (`iflink != ifindex`). */
  vethLike: readonly string[];
}

/**
 * Whether this process shares the host's network namespace.
 *
 * Only Linux isolates a process into a network namespace, so every other
 * platform is the host. There, a device-backed NIC that carries a global
 * unicast address settles it: a container with its own namespace reaches the
 * network through a veth and never sees one, while `network_mode: host` shows
 * the host's NICs exactly as they are.
 *
 * Bridges and veths decide nothing. A host that runs Docker always has
 * `docker0`, `br-*` and `veth*` in the very namespace this process is reading,
 * so finding them says nothing about which namespace that is — the earlier
 * reading of them as proof of isolation was wrong. Without such a NIC the
 * verdict is therefore "cannot tell" whenever a container marker or a
 * container-style interface is in play, and it is never asserted that the
 * process is isolated.
 */
export function classifyNetworkNamespace(probe: NetworkNamespaceProbe): HostNamespace {
  if (probe.platform !== "linux") {
    return "host";
  }

  if (probe.deviceBackedGlobal.length > 0) {
    return "host";
  }

  // No NIC of the host's own carries a global address. A veth or a bridge is a
  // hint that this may be a container-only view, never a demonstration of it,
  // so it is reported as "unknown" rather than as "isolated".
  return probe.containerized || probe.vethLike.length > 0 ? "unknown" : "host";
}

// MARK: Reading the machine

/** An address that was seen and excluded, with the reason it is unusable. */
export interface HostExcludedAddress {
  address: string;
  interfaceName: string;
  kind: Ipv6AddressKind;
}

/** What {@link loadHostIpv6Addresses} found on this machine. */
export interface HostIpv6Addresses {
  namespace: HostNamespace;
  candidates: HostIpv6Candidate[];
  /** Sources that could not be read, in the order they were probed. */
  reasons?: HostAddressReadReason[];
  /** Addresses that were seen but cannot be reached by a client, with why. */
  excluded?: HostExcludedAddress[];
}

/** Every side effect the probe needs, so tests can fake each source. */
export interface HostAddressProbeDeps {
  platform: string;
  /** `os.networkInterfaces`; rejects when the interface list is unreadable. */
  networkInterfaces: () => Record<string, NetworkInterfaceInfo[] | undefined>;
  /** Reads a text file; rejects when it cannot be read. */
  readText: (path: string) => Promise<string>;
  /** True when the path exists; `false` for ENOENT, rejects otherwise. */
  pathExists: (path: string) => Promise<boolean>;
  /** True when a container runtime marker was found. */
  containerized: () => Promise<boolean>;
}

export interface HostAddressLoadOptions {
  /** Overrides of the OS and file probes; tests supply fakes for every source. */
  deps?: Partial<HostAddressProbeDeps>;
  /** Set true or false to force the cache; defaults to on without custom deps. */
  cache?: boolean;
  /** Injectable clock, for tests. */
  now?: () => number;
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as { code?: unknown } | undefined)?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

const defaultDeps: HostAddressProbeDeps = {
  platform: process.platform,
  networkInterfaces: () => networkInterfaces(),
  readText: (path) => readFile(path, "utf8"),
  pathExists: defaultPathExists,
  containerized: async () => {
    if (
      (await defaultPathExists("/.dockerenv")) ||
      (await defaultPathExists("/run/.containerenv"))
    ) {
      return true;
    }

    try {
      const cgroup = await readFile("/proc/1/cgroup", "utf8");
      return CONTAINER_MARKERS.some((marker) => marker.test(cgroup));
    } catch {
      return false;
    }
  },
};

/** One address line of `/proc/net/if_inet6`. */
interface ProcAddress {
  canonical: string;
  groups: number[];
  interfaceName: string;
  temporary: boolean;
}

/**
 * Parses `/proc/net/if_inet6`, whose columns are the address in hex, the
 * interface index, the prefix length, the scope, `ifa_flags` and the interface
 * name. The flags are the only place the kernel distinguishes a temporary
 * (privacy) address from a stable one; everything else here is a cross-check of
 * what `os.networkInterfaces()` already reported.
 */
function parseIfInet6(contents: string): ProcAddress[] {
  const addresses: ProcAddress[] = [];

  for (const line of contents.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6 || !/^[0-9a-f]{32}$/i.test(parts[0])) {
      continue;
    }

    const groups: number[] = [];
    for (let index = 0; index < 32; index += 4) {
      groups.push(Number.parseInt(parts[0].slice(index, index + 4), 16));
    }

    const flags = Number.parseInt(parts[4], 16);
    if (!Number.isSafeInteger(flags) || !isSafeInterfaceName(parts[5])) {
      continue;
    }

    addresses.push({
      canonical: canonicalGroups(groups),
      groups,
      interfaceName: parts[5],
      temporary: (flags & IFA_F_SECONDARY) !== 0 || (flags & IFA_F_DEPRECATED) !== 0,
    });
  }

  return addresses;
}

/** Interface names are used as path segments, so anything odd is skipped. */
function isSafeInterfaceName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && name !== "." && name !== "..";
}

/**
 * A veth's `iflink` names its peer in another namespace, so `iflink` and
 * `ifindex` differ; for every other interface (including a bridge and a bond)
 * they are the same number. An unreadable pair returns `undefined` rather than
 * guessing that the interface is a veth.
 */
async function isVethLike(deps: HostAddressProbeDeps, name: string): Promise<boolean | undefined> {
  const [iflink, ifindex] = await Promise.all([
    readSysNumber(deps, `${SYS_CLASS_NET}/${name}/iflink`),
    readSysNumber(deps, `${SYS_CLASS_NET}/${name}/ifindex`),
  ]);

  if (iflink === undefined || ifindex === undefined) {
    return undefined;
  }

  return iflink !== ifindex;
}

async function readSysNumber(
  deps: HostAddressProbeDeps,
  path: string,
): Promise<number | undefined> {
  try {
    const value = Number.parseInt((await deps.readText(path)).trim(), 10);
    return Number.isSafeInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** `true`/`false`/`undefined` for a `/sys` entry, where ENOENT is an answer. */
async function sysFlag(deps: HostAddressProbeDeps, path: string): Promise<boolean | undefined> {
  try {
    return await deps.pathExists(path);
  } catch {
    return undefined;
  }
}

/** What `/sys` said about one interface, when it could be read at all. */
interface InterfaceEvidence {
  realNic?: boolean;
  interfaceType?: number;
}

/**
 * The evidence `/sys/class/net` holds about each interface. A missing entry
 * under `/sys/class/net/<if>/device` is a definitive "this is not a real NIC"
 * (a bridge and a veth have none); an unreadable `/sys` is reported instead of
 * being read as "virtual".
 */
async function probeInterfaces(
  deps: HostAddressProbeDeps,
  names: readonly string[],
): Promise<{ evidence: Map<string, InterfaceEvidence>; readable: boolean }> {
  const evidence = new Map<string, InterfaceEvidence>();
  if (deps.platform !== "linux") {
    return { evidence, readable: true };
  }

  let readable: boolean;
  try {
    readable = await deps.pathExists(SYS_CLASS_NET);
  } catch {
    readable = false;
  }

  if (!readable) {
    return { evidence, readable: false };
  }

  await Promise.all(
    names.map(async (name) => {
      const [device, interfaceType] = await Promise.all([
        sysFlag(deps, `${SYS_CLASS_NET}/${name}/device`),
        readSysNumber(deps, `${SYS_CLASS_NET}/${name}/type`),
      ]);

      const realNic = device === true && interfaceType !== ARPHRD_LOOPBACK;
      evidence.set(name, {
        ...(device === undefined ? {} : { realNic }),
        ...(interfaceType === undefined ? {} : { interfaceType }),
      });
    }),
  );

  return { evidence, readable: true };
}

/** Whether a container runtime marker was found; a failed probe reads as "no". */
async function probeContainerized(deps: HostAddressProbeDeps): Promise<boolean> {
  if (deps.platform !== "linux") {
    return false;
  }

  try {
    return await deps.containerized();
  } catch {
    return false;
  }
}

/**
 * The interfaces whose peer lives in another namespace. They are collected only
 * as a hint for {@link classifyNetworkNamespace}: on a machine that runs Docker
 * the host's own namespace holds them too, so finding one proves nothing.
 */
async function probeVethLike(
  deps: HostAddressProbeDeps,
  names: readonly string[],
): Promise<string[]> {
  if (deps.platform !== "linux") {
    return [];
  }

  const found = await Promise.all(
    names
      .filter(isSafeInterfaceName)
      .map(async (name) => ((await isVethLike(deps, name)) ? name : undefined)),
  );

  return found.filter((name): name is string => name !== undefined);
}

/** One candidate while the sources are being merged. */
interface PendingCandidate {
  address: string;
  canonical: string;
  interfaceName: string;
  origins: Set<HostAddressOrigin>;
  temporary?: boolean;
  realNic?: boolean;
  interfaceType?: number;
}

/**
 * Reads every source once and merges them into one candidate list. Nothing is
 * dropped for want of a source: an unreadable `/proc` only means the temporary
 * flag is unknown, and an unreadable OS list still leaves whatever `/proc` knows.
 */
async function collect(deps: HostAddressProbeDeps): Promise<HostIpv6Addresses> {
  const reasons: HostAddressReadReason[] = [];

  let interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = {};
  try {
    interfaces = deps.networkInterfaces();
  } catch (error) {
    reasons.push("os-unreadable");
    log.warn("server", "Unable to read the host network interfaces: %s", String(error));
  }

  let proc: ProcAddress[] = [];
  try {
    proc = parseIfInet6(await deps.readText(PROC_IF_INET6));
  } catch {
    reasons.push("proc-unreadable");
  }

  const tempFlags = new Map(proc.map((entry) => [entry.canonical, entry.temporary]));
  const names = [
    ...new Set([...Object.keys(interfaces), ...proc.map((entry) => entry.interfaceName)]),
  ].filter(isSafeInterfaceName);

  const [{ evidence, readable: sysReadable }, vethLike, containerized] = await Promise.all([
    probeInterfaces(deps, names),
    probeVethLike(deps, names),
    probeContainerized(deps),
  ]);
  if (!sysReadable) {
    reasons.push("sys-unreadable");
  }

  const candidates = new Map<string, PendingCandidate>();
  const excluded = new Map<string, HostExcludedAddress>();

  const add = (value: string, interfaceName: string, origin: HostAddressOrigin) => {
    const parsed = parseHostAddress(value);
    if (parsed === undefined || !isSafeInterfaceName(interfaceName)) {
      return;
    }

    const kind = classifyIpv6Address(value);
    const key = `${interfaceName}\n${parsed.canonical}`;
    if (kind !== "global") {
      excluded.set(key, { address: parsed.display, interfaceName, kind });
      return;
    }

    const existing = candidates.get(key);
    const evidenceForInterface = evidence.get(interfaceName) ?? {};
    const temporary = tempFlags.get(parsed.canonical);
    if (existing === undefined) {
      candidates.set(key, {
        address: parsed.display,
        canonical: parsed.canonical,
        interfaceName,
        origins: new Set([origin]),
        ...(temporary === undefined ? {} : { temporary }),
        ...evidenceForInterface,
      });
      return;
    }

    existing.origins.add(origin);
  };

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv6" || entry.internal) {
        continue;
      }

      add(entry.address, interfaceName, "os");
    }
  }

  for (const entry of proc) {
    add(formatGroups(entry.groups), entry.interfaceName, "proc");
  }

  const ordered = [...candidates.values()]
    .map((candidate): HostIpv6Candidate => ({
      address: candidate.address,
      interfaceName: candidate.interfaceName,
      ...(candidate.temporary === undefined ? {} : { temporary: candidate.temporary }),
      ...(candidate.realNic === undefined ? {} : { realNic: candidate.realNic }),
      ...(candidate.interfaceType === undefined ? {} : { interfaceType: candidate.interfaceType }),
      origins: [...candidate.origins].sort(),
    }))
    .sort(compareHostIpv6Candidates);

  // A real NIC that carries one of these global addresses can only be the
  // host's own, whatever bridges and veths are also visible; the namespace rule
  // reads that fact from the candidates rather than from a second `/sys` pass.
  const deviceBackedGlobal = [
    ...new Set(
      [...candidates.values()]
        .filter((candidate) => candidate.realNic === true)
        .map((candidate) => candidate.interfaceName),
    ),
  ];
  const namespace = classifyNetworkNamespace({
    platform: deps.platform,
    containerized,
    deviceBackedGlobal,
    vethLike,
  });

  return {
    namespace,
    candidates: ordered,
    reasons,
    excluded: [...excluded.values()],
  };
}

let cache: { at: number; value: HostIpv6Addresses } | undefined;
let inFlight: Promise<HostIpv6Addresses> | undefined;

/** Drops the cached enumeration, so the next read probes again. */
export function clearHostAddressCache(): void {
  cache = undefined;
  inFlight = undefined;
}

/**
 * The machine's global unicast IPv6 addresses and whether this process can see
 * the host at all. Never throws: an interface list that cannot be read comes
 * back as a reason with no candidates, which the relay card renders as a DNS
 * answer labelled unverified. The enumeration is cached briefly so a dashboard
 * render does not re-stat every interface of a machine running dozens of
 * containers.
 */
export async function loadHostIpv6Addresses(
  options: HostAddressLoadOptions = {},
): Promise<HostIpv6Addresses> {
  const deps: HostAddressProbeDeps = { ...defaultDeps, ...options.deps };
  const now = options.now ?? Date.now;
  const cached = options.cache ?? options.deps === undefined;
  if (!cached) {
    return collect(deps);
  }

  const current = cache;
  if (current !== undefined && current.at + HOST_ADDRESS_CACHE_TTL_MS > now()) {
    return current.value;
  }

  inFlight ??= collect(deps)
    .then((value) => {
      cache = { at: now(), value };
      return value;
    })
    .finally(() => {
      inFlight = undefined;
    });

  return inFlight;
}
