import { describe, expect, test } from "vitest";

import {
  isHeadscaleDuration,
  isLogFormat,
  isLogLevel,
  MIN_EPHEMERAL_INACTIVITY_SECONDS,
  parseGoDurationSeconds,
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
});
