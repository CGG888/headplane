/**
 * Validation shared by the Headscale settings action and the DERP form. Kept
 * free of server imports so the page can use it without pulling server-only
 * modules into the browser bundle.
 */

import { parseGoDurationSeconds } from "./advanced-settings";

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
