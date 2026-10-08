/**
 * A `host:port` spelling, as it appears in a DERP node's `hostname`.
 *
 * Tailscale's map format keeps the port in `derpport` — 443 when it is absent —
 * and the `hostname` is only the name clients dial. A port glued onto the name
 * is therefore not a parse error: the name is used as written and the default
 * port is dialed, which is how a relay that answers STUN on its own port ends
 * up unreachable over DERP (a TLS failure on 443, not a missing relay). The map
 * validator and the mirror both read that spelling through this one function, so
 * they agree on what a port inside a hostname is.
 *
 * Import-free on purpose: the browser bundle validates and previews too.
 */

/** A host and the port a `hostname` carried; `host` keeps IPv6 brackets. */
export interface HostPort {
  host: string;
  port: number;
}

/**
 * The port a `hostname` carries, or `undefined` when it names a host only.
 *
 * `et.mtoo.vip:8443` and `[2001:db8::1]:8443` split. A bare IPv6 literal
 * (`2001:db8::1`), a host with nothing numeric after the colon, an empty host
 * and a port outside 1..65535 do not: those are not the spelling this exists to
 * catch, and flagging them would be guessing at what the author meant.
 */
export function splitHostPort(value: string): HostPort | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close < 0) {
      return undefined;
    }

    const rest = trimmed.slice(close + 1);
    if (!rest.startsWith(":")) {
      return undefined;
    }

    const port = readPort(rest.slice(1));
    return port === undefined ? undefined : { host: trimmed.slice(0, close + 1), port };
  }

  const colon = trimmed.indexOf(":");
  // A host with a port has exactly one colon; more than one is an IPv6 literal,
  // which the format expects in `ipv6` and without a port.
  if (colon < 0 || colon !== trimmed.lastIndexOf(":")) {
    return undefined;
  }

  const host = trimmed.slice(0, colon).trim();
  const port = readPort(trimmed.slice(colon + 1));
  return host.length === 0 || port === undefined ? undefined : { host, port };
}

function readPort(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const port = Number(value.trim());
  return port >= 1 && port <= 65_535 ? port : undefined;
}
