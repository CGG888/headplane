// MARK: Alert settings
//
// Defaults, bounds and the defensive normalizer for the notification settings.
// The settings live in a JSON document under Headplane's data directory, so
// every read has to assume the file was hand-edited: out-of-range numbers are
// clamped, unknown event ids are dropped, and a missing document yields the
// defaults instead of an error.

import { ALERT_EVENT_IDS, type AlertEventId, type AlertSettings } from "./types";

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: false,
  webhookUrl: "",
  secret: "",
  events: [...ALERT_EVENT_IDS],
  intervalSeconds: 60,
  cooldownSeconds: 300,
  apiKeyExpiryDays: 7,
};

/** Bounds the settings action validates against and the store clamps to. */
export const ALERT_INTERVAL_MIN_SECONDS = 15;
export const ALERT_INTERVAL_MAX_SECONDS = 3_600;
export const ALERT_COOLDOWN_MIN_SECONDS = 30;
export const ALERT_COOLDOWN_MAX_SECONDS = 86_400;
export const ALERT_EXPIRY_WINDOW_MIN_DAYS = 1;
export const ALERT_EXPIRY_WINDOW_MAX_DAYS = 90;

export function isAlertEventId(value: unknown): value is AlertEventId {
  return typeof value === "string" && (ALERT_EVENT_IDS as readonly string[]).includes(value);
}

/** Clamps a number into a range, falling back to the default for non-numbers. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function clampAlertInterval(value: unknown): number {
  return clampNumber(
    value,
    ALERT_INTERVAL_MIN_SECONDS,
    ALERT_INTERVAL_MAX_SECONDS,
    DEFAULT_ALERT_SETTINGS.intervalSeconds,
  );
}

export function clampAlertCooldown(value: unknown): number {
  return clampNumber(
    value,
    ALERT_COOLDOWN_MIN_SECONDS,
    ALERT_COOLDOWN_MAX_SECONDS,
    DEFAULT_ALERT_SETTINGS.cooldownSeconds,
  );
}

export function clampAlertExpiryDays(value: unknown): number {
  return clampNumber(
    value,
    ALERT_EXPIRY_WINDOW_MIN_DAYS,
    ALERT_EXPIRY_WINDOW_MAX_DAYS,
    DEFAULT_ALERT_SETTINGS.apiKeyExpiryDays,
  );
}

/** A webhook endpoint must be an absolute http(s) URL. */
export function isValidAlertWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Turns an arbitrary value into usable settings: unknown event ids disappear,
 * numbers are clamped, and anything missing falls back to the defaults. An
 * empty event list is kept — "report nothing" is a legitimate configuration.
 */
export function normalizeAlertSettings(value: unknown): AlertSettings {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const events = Array.isArray(source.events)
    ? [...new Set(source.events.filter(isAlertEventId))]
    : [...DEFAULT_ALERT_SETTINGS.events];

  return {
    enabled: source.enabled === true,
    webhookUrl: readText(source.webhookUrl),
    secret: typeof source.secret === "string" ? source.secret : "",
    events,
    intervalSeconds: clampAlertInterval(source.intervalSeconds),
    cooldownSeconds: clampAlertCooldown(source.cooldownSeconds),
    apiKeyExpiryDays: clampAlertExpiryDays(source.apiKeyExpiryDays),
  };
}
