import { describe, expect, test } from "vitest";

import {
  isHeadscaleDuration,
  isLogFormat,
  isLogLevel,
  MIN_EPHEMERAL_INACTIVITY_SECONDS,
  MIN_HA_PROBE_INTERVAL_SECONDS,
  MIN_HA_PROBE_TIMEOUT_SECONDS,
  parseGoDurationSeconds,
  validateHaProbeSettings,
} from "~/routes/settings/headscale/advanced-settings";

describe("Headscale advanced setting validation", () => {
  test("accepts the duration syntax Headscale parses for node.expiry", () => {
    for (const value of ["0", "0s", "720h", "30d", "1y2w3d4h5m6s", "90m", "500ms"]) {
      expect(isHeadscaleDuration(value), value).toBe(true);
    }

    for (const value of ["", "never", "-1h", "30 m", "1h30", "d", "180"]) {
      expect(isHeadscaleDuration(value), value).toBe(false);
    }
  });

  test("parses Go durations into seconds for the ephemeral timeout", () => {
    expect(parseGoDurationSeconds("30m")).toBe(1800);
    expect(parseGoDurationSeconds("120s")).toBe(120);
    expect(parseGoDurationSeconds("1h30m")).toBe(5400);
    expect(parseGoDurationSeconds("1500ms")).toBe(1.5);
    expect(parseGoDurationSeconds("66s")).toBeGreaterThan(MIN_EPHEMERAL_INACTIVITY_SECONDS);
    // Go's time.ParseDuration has no day unit, unlike node.expiry.
    expect(parseGoDurationSeconds("2d")).toBeUndefined();
    expect(parseGoDurationSeconds("")).toBeUndefined();
    expect(parseGoDurationSeconds("soon")).toBeUndefined();
  });

  test("whitelists the log level and format values the page can write", () => {
    expect(isLogLevel("debug")).toBe(true);
    expect(isLogLevel("error")).toBe(true);
    expect(isLogLevel("trace")).toBe(false);
    expect(isLogLevel("INFO")).toBe(false);
    expect(isLogFormat("text")).toBe(true);
    expect(isLogFormat("json")).toBe(true);
    expect(isLogFormat("yaml")).toBe(false);
  });

  test("enforces Headscale's HA subnet router probe rules", () => {
    expect(MIN_HA_PROBE_INTERVAL_SECONDS).toBe(2);
    expect(MIN_HA_PROBE_TIMEOUT_SECONDS).toBe(1);

    expect(validateHaProbeSettings("10s", "5s")).toBeUndefined();
    expect(validateHaProbeSettings("2s", "1s")).toBeUndefined();
    // 0 disables probing, so there is no interval left to fit the timeout into.
    expect(validateHaProbeSettings("0", "5s")).toBeUndefined();

    expect(validateHaProbeSettings("1500ms", "1s")).toBe("invalidInterval");
    expect(validateHaProbeSettings("soon", "1s")).toBe("invalidInterval");
    expect(validateHaProbeSettings("10s", "500ms")).toBe("invalidTimeout");
    expect(validateHaProbeSettings("10s", "soon")).toBe("invalidTimeout");
    expect(validateHaProbeSettings("10s", "10s")).toBe("timeoutNotBelowInterval");
    expect(validateHaProbeSettings("10s", "30s")).toBe("timeoutNotBelowInterval");
  });
});
