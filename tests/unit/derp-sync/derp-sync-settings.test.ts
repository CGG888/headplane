import { describe, expect, test } from "vitest";

import {
  DEFAULT_DERP_SYNC_SETTINGS,
  derpSyncIntervalMs,
  isDerpSyncFamilies,
  isDerpSyncIntervalHours,
  isDerpSyncIpv6Preference,
  normalizeDerpSyncSettings,
  parseDerpSyncIntervalHours,
  selectedFamilies,
} from "~/server/derp-sync/settings";

describe("sync interval validation", () => {
  test("accepts only 6, 12 and 24 hours", () => {
    expect(isDerpSyncIntervalHours(6)).toBe(true);
    expect(isDerpSyncIntervalHours(12)).toBe(true);
    expect(isDerpSyncIntervalHours(24)).toBe(true);
  });

  test("rejects every other number, including the near misses", () => {
    for (const value of [
      0,
      1,
      5,
      7,
      11,
      13,
      23,
      25,
      48,
      -6,
      6.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(isDerpSyncIntervalHours(value), String(value)).toBe(false);
    }
  });

  test("rejects non-numbers", () => {
    for (const value of ["6", null, undefined, {}, [], true]) {
      expect(isDerpSyncIntervalHours(value), String(value)).toBe(false);
    }
  });

  test("parses the form spelling of an allowed interval", () => {
    expect(parseDerpSyncIntervalHours("6")).toBe(6);
    expect(parseDerpSyncIntervalHours(" 24 ")).toBe(24);
    expect(parseDerpSyncIntervalHours(12)).toBe(12);
    expect(parseDerpSyncIntervalHours("8")).toBeUndefined();
    expect(parseDerpSyncIntervalHours("")).toBeUndefined();
    expect(parseDerpSyncIntervalHours("every day")).toBeUndefined();
    expect(parseDerpSyncIntervalHours(undefined)).toBeUndefined();
  });

  test("converts an interval to milliseconds", () => {
    expect(derpSyncIntervalMs(6)).toBe(6 * 60 * 60 * 1000);
    expect(derpSyncIntervalMs(24)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("family selection", () => {
  test("accepts the three selections and nothing else", () => {
    expect(isDerpSyncFamilies("both")).toBe(true);
    expect(isDerpSyncFamilies("ipv4")).toBe(true);
    expect(isDerpSyncFamilies("ipv6")).toBe(true);
    expect(isDerpSyncFamilies("all")).toBe(false);
    expect(isDerpSyncFamilies("")).toBe(false);
    expect(isDerpSyncFamilies(undefined)).toBe(false);
  });

  test("expands a selection into the families a run evaluates", () => {
    expect(selectedFamilies("both")).toEqual(["ipv4", "ipv6"]);
    expect(selectedFamilies("ipv4")).toEqual(["ipv4"]);
    expect(selectedFamilies("ipv6")).toEqual(["ipv6"]);
  });
});

describe("settings normalization", () => {
  test("defaults to off, twice a day, both families and reload on", () => {
    expect(normalizeDerpSyncSettings(undefined)).toEqual(DEFAULT_DERP_SYNC_SETTINGS);
    expect(DEFAULT_DERP_SYNC_SETTINGS.enabled).toBe(false);
    // A written address only reaches clients after a reload, so the default is
    // on and the switch exists to turn it off.
    expect(DEFAULT_DERP_SYNC_SETTINGS.autoReload).toBe(true);
    expect(normalizeDerpSyncSettings("[1,2]")).toEqual(DEFAULT_DERP_SYNC_SETTINGS);
  });

  test("keeps a valid hand-edited document", () => {
    expect(
      normalizeDerpSyncSettings({
        enabled: true,
        intervalHours: 24,
        families: "ipv6",
        ipv6Preference: "dns",
        autoReload: true,
      }),
    ).toEqual({
      enabled: true,
      intervalHours: 24,
      families: "ipv6",
      ipv6Preference: "dns",
      autoReload: true,
    });
  });

  test("accepts the two IPv6 sources and nothing else", () => {
    expect(isDerpSyncIpv6Preference("host")).toBe(true);
    expect(isDerpSyncIpv6Preference("dns")).toBe(true);
    expect(isDerpSyncIpv6Preference("interface")).toBe(false);
    expect(isDerpSyncIpv6Preference("")).toBe(false);
    expect(isDerpSyncIpv6Preference(undefined)).toBe(false);
  });

  test("defaults the IPv6 source to the host, so upgrades keep today's behaviour", () => {
    expect(DEFAULT_DERP_SYNC_SETTINGS.ipv6Preference).toBe("host");
    // A document written before the setting existed has no key at all.
    expect(normalizeDerpSyncSettings({ families: "ipv6" }).ipv6Preference).toBe("host");
    expect(normalizeDerpSyncSettings({ ipv6Preference: "interface" }).ipv6Preference).toBe("host");
  });

  test("only an explicit false turns the automatic reload off", () => {
    expect(normalizeDerpSyncSettings({ autoReload: false }).autoReload).toBe(false);
    expect(normalizeDerpSyncSettings({}).autoReload).toBe(true);
    // A hand-edited document that says something else falls back to the default
    // rather than to "off".
    expect(normalizeDerpSyncSettings({ autoReload: "no" }).autoReload).toBe(true);
    expect(normalizeDerpSyncSettings({ autoReload: 1 }).autoReload).toBe(true);
  });

  test("falls back per field instead of rejecting the document", () => {
    expect(
      normalizeDerpSyncSettings({
        enabled: "yes",
        intervalHours: 7,
        families: "everything",
        autoReload: 1,
      }),
    ).toEqual(DEFAULT_DERP_SYNC_SETTINGS);
  });
});
