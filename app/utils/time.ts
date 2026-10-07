import type { Locale } from "~/utils/locale";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

type RelativeUnit = "minute" | "hour" | "day" | "month";

const UNITS: ReadonlyArray<readonly [RelativeUnit, number]> = [
  ["month", MONTH_MS],
  ["day", DAY_MS],
  ["hour", HOUR_MS],
  ["minute", MINUTE_MS],
];

/**
 * Formats the time delta since a given date into a human-readable string.
 *
 * The wording comes from `Intl.RelativeTimeFormat`, so nothing here is
 * hardcoded English. Only the largest unit is reported ("2 hours ago", not
 * "2 hours, 14 minutes ago"): the relative-time formatter cannot pluralize two
 * counts in one sentence, and the absolute timestamp is already in the tooltip
 * next to this text.
 *
 * A date that cannot be parsed reads as an empty string instead of throwing,
 * and a timestamp in the future (clock skew) reads as "in ..." rather than as
 * "0 minutes ago".
 */
export function formatTimeDelta(date: Date, locale: Locale): string {
  const elapsed = Date.now() - date.getTime();
  if (!Number.isFinite(elapsed)) {
    return "";
  }

  const absolute = Math.abs(elapsed);
  const [unit, unitMs] = UNITS.find(([, size]) => absolute >= size) ?? ["minute", MINUTE_MS];
  const count = Math.max(1, Math.floor(absolute / unitMs));

  return new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "long" }).format(
    elapsed < 0 ? count : -count,
    unit,
  );
}
