/**
 * The IPv6 addresses this machine itself holds, and whether Headplane can see
 * the host's network namespace at all.
 *
 * IPv4 and IPv6 are derived differently on purpose. A machine behind NAT cannot
 * know its own public IPv4 address, so `derp.server.ipv4` or the domain's A
 * record is the only source that can be right. IPv6 has no NAT: the public
 * address lives on the machine, while a domain's AAAA can be a temporary
 * privacy address, a record from a prefix that has since rotated, or another
 * machine entirely. The Overview card therefore reads the machine's own global
 * unicast addresses and treats the DNS answer as a clearly labelled fallback.
 *
 * Selection, in order:
 *
 * 1. `derp.server.ipv6` when it is set — the operator declared it.
 * 2. The machine's own address that the domain's AAAA names, so the address
 *    Headplane suggests and the address clients resolve agree.
 * 3. Otherwise the best of the machine's own addresses, ranked by
 *    {@link compareHostIpv6Candidates}: a known-stable address, then one whose
 *    stability could not be read, then a known-temporary privacy address; among
 *    equals an EUI-64-shaped interface identifier (the `ff:fe` marker of a
 *    hardware-derived address, which a privacy address never carries); then the
 *    interface name and finally the value, so a machine with several candidates
 *    always picks the same one whatever order the OS lists interfaces in.
 * 4. The domain's AAAA answer, labelled as unverified, when the machine has no
 *    global address or when Headplane cannot see the host's namespace.
 *
 * Everything here is read-only and fail-soft: an unreadable interface list, a
 * missing `/proc` entry or a platform without `/sys/class/net` degrades to an
 * empty candidate list or to "cannot tell", never to an exception, so a broken
 * probe can never take the dashboard card down.
 */

import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";

import { parseIpv6 } from "~/routes/settings/headscale/trusted-proxies";
import type { RelayResolutionReason } from "~/server/relay-dns";
import log from "~/utils/log";

/** Linux `ifa_flags` that make an address a rotating one, from `iproute2`. */
const IFA_F_SECONDARY = 0x01;
const IFA_F_DEPRECATED = 0x20;

/** Container runtimes that leave a marker in PID 1's cgroup. */
const CONTAINER_MARKERS = [/docker/i, /containerd/i, /kubepods/i, /libpod/i, /lxc/i];

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
 * the way an RFC 4941 privacy address is.
 */
function looksHardwareDerived(groups: readonly number[]): boolean {
  return (groups[5] & 0x00ff) === 0x00ff && (groups[6] & 0xff00) === 0xfe00;
}

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
}

interface RankedCandidate extends HostIpv6Candidate {
  canonical: string;
  groups: number[];
}

/**
 * The documented order of {@link selectHostIpv6Address}: a stable address
 * before one of unknown stability before a temporary one, then an EUI-64-shaped
 * identifier, then the interface name and the value. The last two make the
 * choice independent of the order the OS enumerated the interfaces in.
 */
export function compareHostIpv6Candidates(
  a: HostIpv6Candidate,
  b: HostIpv6Candidate,
): number {
  const stability = (candidate: HostIpv6Candidate) =>
    candidate.temporary === true ? 2 : candidate.temporary === false ? 0 : 1;
  if (stability(a) !== stability(b)) {
    return stability(a) - stability(b);
  }

  const aGroups = parseHostAddress(a.address)?.groups;
  const bGroups = parseHostAddress(b.address)?.groups;
  const shape = (groups: number[] | undefined) =>
    groups !== undefined && looksHardwareDerived(groups) ? 0 : 1;
  if (shape(aGroups) !== shape(bGroups)) {
    return shape(aGroups) - shape(bGroups);
  }

  if (a.interfaceName !== b.interfaceName) {
    return a.interfaceName < b.interfaceName ? -1 : 1;
  }

  for (let index = 0; index < 8; index += 1) {
    const left = aGroups?.[index] ?? 0;
    const right = bGroups?.[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }

  return 0;
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
  /** True when the only global address found is a temporary (privacy) one. */
  temporary: boolean;
}

/**
 * Picks the address to advertise out of the machine's own candidates. The DNS
 * answer wins over the ranking when it names one of the machine's addresses —
 * that is the address clients already resolve, so it is the one to keep using.
 * Nothing here throws: malformed candidates are dropped, and no candidate at all
 * comes back as an empty selection.
 */
export function selectHostIpv6Address(
  candidates: readonly HostIpv6Candidate[] | undefined,
  dnsAddresses: readonly string[] | undefined = [],
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
      canonical: parsed.canonical,
      groups: parsed.groups,
    });
  }

  // A known-temporary address is dropped while a stable one exists; when
  // privacy addresses are all the machine has, the best of them is still far
  // better than pretending there is no address at all.
  const stable = ranked.filter((candidate) => candidate.temporary !== true);
  const pool = stable.length > 0 ? stable : ranked;
  if (pool.length === 0) {
    return { alternates: [], fromDns: false, temporary: false };
  }

  const dns = new Set(
    (dnsAddresses ?? []).flatMap((value) => {
      const parsed = parseHostAddress(value);
      return parsed === undefined ? [] : [parsed.canonical];
    }),
  );

  const ordered = [...pool].sort(compareHostIpv6Candidates);
  const matched = ordered.find((candidate) => dns.has(candidate.canonical));
  const selected = matched ?? ordered[0];

  return {
    address: selected.address,
    alternates: ordered
      .filter((candidate) => candidate.canonical !== selected.canonical)
      .map((candidate) => candidate.address),
    fromDns: matched !== undefined,
    temporary: selected.temporary === true,
  };
}

/** Why the relay row has no IPv6 address to print. */
export type RelayIpv6State = RelayResolutionReason | "no-host-address" | "unavailable";

/** Where the IPv6 address the relay card prints came from. */
export type RelayIpv6Source = "declared" | "host" | "dns" | "none";

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
   * `host` means the row is showing a DNS answer nobody could check.
   */
  namespace: HostNamespace;
  /** True when the domain's AAAA does not name the address this machine holds. */
  mismatch: boolean;
  /** True when the printed machine address is a temporary (privacy) one. */
  temporary: boolean;
  /** The machine address to paste into `derp.server.ipv6`. */
  copy?: string;
  /** Why there is nothing to print; only set when `addresses` is empty. */
  state?: RelayIpv6State;
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

/**
 * The IPv6 row of the relay card: what `derp.server` declares, the machine's own
 * address (cross-checked against the domain's AAAA), or the DNS answer as an
 * unverified fallback. A machine with no global address and no AAAA answer comes
 * back as `no-host-address` so the card can say so in plain words instead of
 * showing nothing.
 */
export function selectRelayIpv6(input: RelayIpv6Input = {}): RelayIpv6Selection {
  const namespace = input.namespace ?? "host";
  const dns = uniqueAddresses(input.dns);
  const declared = (input.declared ?? "").trim();

  const base: RelayIpv6Selection = {
    source: "none",
    addresses: [],
    alternates: [],
    dns: [],
    namespace,
    mismatch: false,
    temporary: false,
  };

  if (declared.length > 0) {
    return { ...base, source: "declared", addresses: [declared] };
  }

  // A container that does not demonstrably share the host's namespace can only
  // enumerate its own interfaces, so its addresses say nothing about the host.
  if (namespace === "host") {
    const host = selectHostIpv6Address(input.candidates, dns);
    if (host.address !== undefined) {
      const mismatch = dns.length > 0 && !host.fromDns;
      return {
        ...base,
        source: "host",
        addresses: [host.address],
        alternates: host.alternates,
        dns: mismatch ? dns : [],
        mismatch,
        temporary: host.temporary,
        copy: host.address,
      };
    }
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
    state: namespace === "host" ? "no-host-address" : (input.reason ?? "unavailable"),
  };
}

// MARK: Network namespace

/**
 * Where the process's network namespace stands relative to the host's.
 *
 * `host` means the machine's addresses can be trusted; `isolated` means the
 * process has its own namespace and enumerates its own interfaces; `unknown`
 * means neither could be shown, which is reported instead of guessed at.
 */
export type HostNamespace = "host" | "isolated" | "unknown";

/** Everything {@link classifyNetworkNamespace} needs, so the rule is testable. */
export interface NetworkNamespaceProbe {
  platform: string;
  /** True when a container runtime marker was found. */
  containerized: boolean;
  /** Interfaces backed by a real device (`/sys/class/net/<name>/device`). */
  deviceBacked: readonly string[];
  /** Interfaces whose peer lives in another namespace (`iflink != ifindex`). */
  vethLike: readonly string[];
}

/**
 * Whether this process shares the host's network namespace.
 *
 * Only Linux isolates a process into a network namespace, so every other
 * platform is the host. In a container, the two shapes are unambiguous: a
 * container with its own namespace reaches the network through a veth (whose
 * `iflink` names a peer in another namespace) and never sees a device-backed
 * NIC, while `network_mode: host` shows the host's own NICs, which stay
 * device-backed even when they are virtio. Neither shape means "cannot tell",
 * and that is what gets reported rather than a guess.
 */
export function classifyNetworkNamespace(probe: NetworkNamespaceProbe): HostNamespace {
  if (probe.platform !== "linux") {
    return "host";
  }

  if (probe.containerized) {
    if (probe.vethLike.length > 0) {
      return "isolated";
    }

    return probe.deviceBacked.length > 0 ? "host" : "unknown";
  }

  // A host that merely runs containers keeps its own device-backed NIC as well,
  // which is what the first branch checks before a stray veth means anything.
  if (probe.deviceBacked.length > 0) {
    return "host";
  }

  return probe.vethLike.length > 0 ? "unknown" : "host";
}

/** What {@link loadHostIpv6Addresses} found on this machine. */
export interface HostIpv6Addresses {
  namespace: HostNamespace;
  candidates: HostIpv6Candidate[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readNumber(path: string): Promise<number | undefined> {
  try {
    const value = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
    return Number.isSafeInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A veth's `iflink` names its peer in another namespace, so `iflink` and
 * `ifindex` differ; for every other interface (including a bridge and a bond)
 * they are the same number.
 */
async function isVethLike(name: string): Promise<boolean> {
  const [iflink, ifindex] = await Promise.all([
    readNumber(`/sys/class/net/${name}/iflink`),
    readNumber(`/sys/class/net/${name}/ifindex`),
  ]);

  return iflink !== undefined && ifindex !== undefined && iflink !== ifindex;
}

/** Interface names are used as path segments, so anything odd is skipped. */
function isSafeInterfaceName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && name !== "." && name !== "..";
}

async function probeNamespace(interfaceNames: readonly string[]): Promise<HostNamespace> {
  if (process.platform !== "linux") {
    return "host";
  }

  const names = interfaceNames.filter(isSafeInterfaceName);
  const containerized = await isContainerized();
  const [deviceBacked, vethLike] = await Promise.all([
    Promise.all(
      names.map(async (name) =>
        (await pathExists(`/sys/class/net/${name}/device`)) ? name : undefined,
      ),
    ),
    Promise.all(names.map(async (name) => ((await isVethLike(name)) ? name : undefined))),
  ]);

  return classifyNetworkNamespace({
    platform: process.platform,
    containerized,
    deviceBacked: deviceBacked.filter((name): name is string => name !== undefined),
    vethLike: vethLike.filter((name): name is string => name !== undefined),
  });
}

/** Docker, Podman and Kubernetes each leave one of these behind. */
async function isContainerized(): Promise<boolean> {
  if ((await pathExists("/.dockerenv")) || (await pathExists("/run/.containerenv"))) {
    return true;
  }

  try {
    const cgroup = await readFile("/proc/1/cgroup", "utf8");
    return CONTAINER_MARKERS.some((marker) => marker.test(cgroup));
  } catch {
    return false;
  }
}

/**
 * The temporary (privacy) flag per address, read from `/proc/net/if_inet6`,
 * whose fifth column is the kernel's `ifa_flags`. That is the only place the
 * distinction is visible: `os.networkInterfaces()` reports the address without
 * it, which is why the ranking falls back to the `ff:fe` shape elsewhere.
 */
async function readTemporaryFlags(): Promise<Map<string, boolean>> {
  const flagsByAddress = new Map<string, boolean>();

  let contents: string;
  try {
    contents = await readFile("/proc/net/if_inet6", "utf8");
  } catch {
    return flagsByAddress;
  }

  for (const line of contents.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !/^[0-9a-f]{32}$/i.test(parts[0])) {
      continue;
    }

    const groups: number[] = [];
    for (let index = 0; index < 32; index += 4) {
      groups.push(Number.parseInt(parts[0].slice(index, index + 4), 16));
    }

    const flags = Number.parseInt(parts[4], 16);
    if (!Number.isSafeInteger(flags)) {
      continue;
    }

    const temporary =
      (flags & IFA_F_SECONDARY) !== 0 || (flags & IFA_F_DEPRECATED) !== 0;
    flagsByAddress.set(canonicalGroups(groups), temporary);
  }

  return flagsByAddress;
}

/**
 * The machine's global unicast IPv6 addresses and whether this process can see
 * the host at all. Never throws: an interface list that cannot be read comes
 * back as "cannot tell" with no candidates, which the relay card renders as a
 * DNS answer labelled unverified.
 */
export async function loadHostIpv6Addresses(): Promise<HostIpv6Addresses> {
  let interfaces: ReturnType<typeof networkInterfaces>;
  try {
    interfaces = networkInterfaces();
  } catch (error) {
    log.warn("server", "Unable to read the host network interfaces: %s", String(error));
    return { namespace: "unknown", candidates: [] };
  }

  const [namespace, temporaryFlags] = await Promise.all([
    probeNamespace(Object.keys(interfaces)),
    readTemporaryFlags(),
  ]);

  const candidates: HostIpv6Candidate[] = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv6" || entry.internal) {
        continue;
      }

      const parsed = parseHostAddress(entry.address);
      if (parsed === undefined || classifyIpv6Address(entry.address) !== "global") {
        continue;
      }

      const temporary = temporaryFlags.get(parsed.canonical);
      candidates.push({
        address: parsed.display,
        interfaceName,
        ...(temporary === undefined ? {} : { temporary }),
      });
    }
  }

  log.debug(
    "server",
    `Host IPv6 namespace: ${namespace} (${candidates.length} global address(es))`,
  );

  return { namespace, candidates };
}
