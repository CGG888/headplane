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
