/**
 * Validation shared by the Headscale settings action and the advanced settings
 * form. Kept free of server imports so the page can use it without pulling
 * server-only modules into the browser bundle.
 */

/** The log levels Headplane is willing to write to `log.level`. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The only two formats Headscale understands for `log.format`. */
export const LOG_FORMATS = ["text", "json"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

const LOG_LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS);
const LOG_FORMAT_SET: ReadonlySet<string> = new Set(LOG_FORMATS);

export function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVEL_SET.has(value);
}

export function isLogFormat(value: string): value is LogFormat {
  return LOG_FORMAT_SET.has(value);
}

/**
 * `node.expiry` is parsed by Headscale with prometheus' `model.ParseDuration`,
 * which accepts `y`, `w`, `d`, `h`, `m`, `s` and `ms` units in that order. The
 * string `0` is special-cased by Headscale as "no default expiry".
 */
const HEADSCALE_DURATION = /^(?:\d+y)?(?:\d+w)?(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?(?:\d+ms)?$/;

export function isHeadscaleDuration(value: string): boolean {
  if (value === "0") {
    return true;
  }

  return value.length > 0 && HEADSCALE_DURATION.test(value);
}

/**
 * `node.ephemeral.inactivity_timeout` goes through Go's `time.ParseDuration`,
 * which only knows up to `h`. Headscale refuses to start below 65s, so the
 * caller also has to compare the result against that floor.
 */
const GO_DURATION = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;
const GO_DURATION_PART = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/;
const GO_UNIT_SECONDS: Record<string, number> = {
  ns: 1e-9,
  us: 1e-6,
  µs: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
};

/** Headscale rejects an inactivity timeout of 65s or less when it starts. */
export const MIN_EPHEMERAL_INACTIVITY_SECONDS = 65;

export function parseGoDurationSeconds(value: string): number | undefined {
  if (value === "0") {
    return 0;
  }

  if (value.length === 0 || !GO_DURATION.test(value)) {
    return undefined;
  }

  let seconds = 0;
  for (const [, amount, unit] of value.matchAll(new RegExp(GO_DURATION_PART, "g"))) {
    seconds += Number(amount) * GO_UNIT_SECONDS[unit];
  }

  return seconds;
}

/**
 * HA subnet-router probing (`node.routes.ha`), added in Headscale 0.29. Its
 * config-example.yaml states the rules below: an interval of 0 disables
 * probing, otherwise it must be at least 2s, and the timeout must be at least
 * 1s and shorter than the interval.
 */
export const MIN_HA_PROBE_INTERVAL_SECONDS = 2;
export const MIN_HA_PROBE_TIMEOUT_SECONDS = 1;

export type HaProbeProblem = "invalidInterval" | "invalidTimeout" | "timeoutNotBelowInterval";

export function validateHaProbeSettings(
  interval: string,
  timeout: string,
): HaProbeProblem | undefined {
  const intervalSeconds = parseGoDurationSeconds(interval);
  if (
    intervalSeconds === undefined ||
    (intervalSeconds !== 0 && intervalSeconds < MIN_HA_PROBE_INTERVAL_SECONDS)
  ) {
    return "invalidInterval";
  }

  const timeoutSeconds = parseGoDurationSeconds(timeout);
  if (timeoutSeconds === undefined || timeoutSeconds < MIN_HA_PROBE_TIMEOUT_SECONDS) {
    return "invalidTimeout";
  }

  // A disabled interval has no window to fit into, so the comparison is only
  // meaningful while probing is on.
  if (intervalSeconds !== 0 && timeoutSeconds >= intervalSeconds) {
    return "timeoutNotBelowInterval";
  }

  return undefined;
}
