// MARK: DERP address sync settings
//
// The setting itself is Headplane state, not Headscale configuration, so it
// lives in the JSON store under `data_path`. Every read assumes the file was
// hand-edited: an interval outside the offered set and an unknown family value
// both fall back to the default rather than scheduling something unexpected.

import {
  DERP_SYNC_INTERVAL_HOURS,
  type DerpSyncFamilies,
  type DerpSyncIntervalHours,
  type DerpSyncSettings,
} from "./types";

export const DEFAULT_DERP_SYNC_SETTINGS: DerpSyncSettings = {
  // Opt-in: enabling it lets Headplane rewrite Headscale's configuration file
  // on a schedule, which an operator has to ask for explicitly.
  enabled: false,
  intervalHours: 12,
  families: "both",
  // A reload briefly interrupts clients, so it is never implied by "enabled".
  autoReload: false,
};

/** Only the offered intervals are accepted; anything else is not schedulable. */
export function isDerpSyncIntervalHours(value: unknown): value is DerpSyncIntervalHours {
  return (
    typeof value === "number" && (DERP_SYNC_INTERVAL_HOURS as readonly number[]).includes(value)
  );
}

/** Parses a form value or a stored value into an allowed interval. */
export function parseDerpSyncIntervalHours(value: unknown): DerpSyncIntervalHours | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;

  return isDerpSyncIntervalHours(parsed) ? parsed : undefined;
}

export function isDerpSyncFamilies(value: unknown): value is DerpSyncFamilies {
  return value === "both" || value === "ipv4" || value === "ipv6";
}

/** Turns an arbitrary value into usable settings, defaulting anything unknown. */
export function normalizeDerpSyncSettings(value: unknown): DerpSyncSettings {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    enabled: source.enabled === true,
    intervalHours:
      parseDerpSyncIntervalHours(source.intervalHours) ?? DEFAULT_DERP_SYNC_SETTINGS.intervalHours,
    families: isDerpSyncFamilies(source.families)
      ? source.families
      : DEFAULT_DERP_SYNC_SETTINGS.families,
    autoReload: source.autoReload === true,
  };
}

/** Which families a selection covers, in the order the service evaluates them. */
export function selectedFamilies(families: DerpSyncFamilies): readonly ("ipv4" | "ipv6")[] {
  if (families === "both") {
    return ["ipv4", "ipv6"];
  }

  return [families];
}

/** How long one interval is, in milliseconds. */
export function derpSyncIntervalMs(hours: DerpSyncIntervalHours): number {
  return hours * 60 * 60 * 1000;
}
