/**
 * Validation shared by the Headscale settings action and the DERP form. Kept
 * free of server imports so the page can use it without pulling server-only
 * modules into the browser bundle.
 */

import { parseGoDurationSeconds } from "./advanced-settings";
import { parseIpv4, parseIpv6 } from "./trusted-proxies";

/**
 * Headscale reserves the 900-999 range for embedded DERP regions so an embedded
 * server can never collide with a region from a public DERP map.
 */
export const DERP_REGION_ID_MIN = 900;
export const DERP_REGION_ID_MAX = 999;

export function isDerpRegionId(value: number): boolean {
  return Number.isInteger(value) && value >= DERP_REGION_ID_MIN && value <= DERP_REGION_ID_MAX;
}

/** DERP map sources and OIDC issuers both have to be real http(s) URLs. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Parses a form field into a region ID, or `undefined` when it is not allowed. */
export function parseDerpRegionId(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const id = Number(trimmed);
  return isDerpRegionId(id) ? id : undefined;
}

/**
 * `derp.update_frequency` goes through Go's `time.ParseDuration`. Headscale
 * treats a zero interval as "use its own default", so the form asks for a
 * positive duration and reports anything else as invalid.
 */
export function parseDerpUpdateFrequencySeconds(value: string): number | undefined {
  const seconds = parseGoDurationSeconds(value.trim());
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }

  return seconds;
}

/**
 * The manual region-name mapping is not limited to Headscale's embedded range:
 * external DERP regions use their own ids, so any positive integer is valid.
 */
export function parseDerpRegionMapId(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/**
 * `derp.server.stun_listen_addr` is a `host:port` pair Headscale binds for
 * STUN. IPv6 hosts are accepted in brackets, matching the format Headscale
 * itself documents.
 */
export function isDerpStunAddress(value: string): boolean {
  const match = /^(?:\[[0-9a-fA-F:]+\]|[^\s:]+):(\d{1,5})$/.exec(value.trim());
  if (!match) {
    return false;
  }

  const port = Number(match[1]);
  return port >= 1 && port <= 65_535;
}

/** POSIX (`/x`), Windows drive (`C:\x`) and UNC (`\\host\share`) paths. */
export function isAbsoluteFilePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim());
}

/**
 * `derp.server.ipv4` is a bare IPv4 literal Headscale hands to clients as the
 * region's public address; a CIDR or a `host:port` pair is not accepted. An
 * empty value is allowed and means "unset", which is how the form clears a
 * previously configured address.
 */
export function isDerpIpv4Address(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || parseIpv4(trimmed) !== undefined;
}

/**
 * `derp.server.ipv6` takes the same bare-literal form as the IPv4 field, only
 * for the other family; an IPv4 address or anything carrying a prefix length
 * or port is rejected. An empty value means "unset".
 */
export function isDerpIpv6Address(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || parseIpv6(trimmed) !== undefined;
}

/**
 * Where the DERP relays Headscale hands to its clients come from. Classified
 * from `derp.server.enabled` and `derp.urls`, the two settings that decide
 * whether the embedded server is turned on and whether a remote map is merged
 * into it. Local map files (`derp.paths`) describe regions themselves and are
 * listed separately in the DERP settings drawer.
 */
export type DerpRelaySource = "embedded-only" | "embedded-and-map" | "map-only" | "none";

export interface DerpRelaySourceInput {
  /** `derp.server.enabled`. */
  serverEnabled: boolean;
  /** `derp.urls`: the remote DERP map sources clients are handed. */
  urls: readonly string[];
}

/**
 * A missing `derp.urls` and an explicitly empty `[ ]` mean the same thing:
 * nothing but the embedded server is handed to clients.
 */
export function classifyDerpRelaySource({
  serverEnabled,
  urls,
}: DerpRelaySourceInput): DerpRelaySource {
  if (serverEnabled) {
    return urls.length > 0 ? "embedded-and-map" : "embedded-only";
  }

  return urls.length > 0 ? "map-only" : "none";
}

/** The file Headscale's `config-example.yaml` documents for the region key. */
export const DERP_PRIVATE_KEY_FILENAME = "derp_server_private.key";
export const DERP_EXAMPLE_PRIVATE_KEY_PATH = `/var/lib/headscale/${DERP_PRIVATE_KEY_FILENAME}`;

/**
 * Headscale's documented install layout keeps the embedded DERP signing key
 * next to its config file. Only the directory is taken from `configPath`; the
 * original separator is preserved so a Windows path stays a Windows path.
 */
export function defaultDerpPrivateKeyPath(configPath: string | undefined): string {
  const trimmed = (configPath ?? "").trim();
  if (trimmed.length === 0) {
    return DERP_EXAMPLE_PRIVATE_KEY_PATH;
  }

  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (separator < 0) {
    return `/${DERP_PRIVATE_KEY_FILENAME}`;
  }

  return `${trimmed.slice(0, separator)}${trimmed[separator]}${DERP_PRIVATE_KEY_FILENAME}`;
}
