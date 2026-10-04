/**
 * Dependency-free CIDR checks for `trusted_proxies`.
 *
 * Headscale parses every entry with Go's `netip.ParsePrefix`, so an entry has
 * to be a real CIDR: a bare address or a prefix length outside the range is a
 * configuration error. The unspecified ranges are rejected explicitly because
 * Headscale treats `0.0.0.0/0` and `::/0` as an error as well, and trusting
 * every address would defeat the purpose of the setting.
 */

export type TrustedProxyProblem = "invalid" | "unspecified";

/** Parses a dotted-quad IPv4 address into its four octets. */
export function parseIpv4(address: string): number[] | undefined {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return undefined;
  }

  const values: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      return undefined;
    }

    const value = Number(octet);
    if (value > 255) {
      return undefined;
    }

    values.push(value);
  }

  return values;
}

/** Parses one half of an IPv6 address into 16-bit groups. */
function parseIpv6Groups(segment: string): number[] | undefined {
  if (segment === "") {
    return [];
  }

  const parts = segment.split(":");
  const groups: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (part === "") {
      return undefined;
    }

    // A trailing dotted-quad is the IPv4-mapped form, for example `::ffff:1.2.3.4`.
    if (index === parts.length - 1 && part.includes(".")) {
      const octets = parseIpv4(part);
      if (!octets) {
        return undefined;
      }

      groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    groups.push(Number.parseInt(part, 16));
  }

  return groups;
}

/** Parses an IPv6 address into exactly eight 16-bit groups. */
export function parseIpv6(address: string): number[] | undefined {
  if (!address.includes(":")) {
    return undefined;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const head = parseIpv6Groups(halves[0]);
  if (!head) {
    return undefined;
  }

  if (halves.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  const tail = parseIpv6Groups(halves[1]);
  if (!tail || head.length + tail.length > 7) {
    return undefined;
  }

  const zeros = Array.from({ length: 8 - head.length - tail.length }, () => 0);
  return [...head, ...zeros, ...tail];
}

export function validateTrustedProxyCidr(input: string): TrustedProxyProblem | undefined {
  const value = input.trim();
  const slash = value.indexOf("/");
  if (slash === -1) {
    return "invalid";
  }

  const address = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) {
    return "invalid";
  }

  const prefixLength = Number(prefix);
  const ipv6 = parseIpv6(address);
  if (ipv6) {
    if (prefixLength > 128) {
      return "invalid";
    }

    return prefixLength === 0 && ipv6.every((group) => group === 0) ? "unspecified" : undefined;
  }

  const ipv4 = parseIpv4(address);
  if (!ipv4) {
    return "invalid";
  }

  if (prefixLength > 32) {
    return "invalid";
  }

  return prefixLength === 0 && ipv4.every((octet) => octet === 0) ? "unspecified" : undefined;
}

export function isValidTrustedProxyCidr(input: string): boolean {
  return validateTrustedProxyCidr(input) === undefined;
}
