import { describe, expect, test } from "vitest";

import { formatTimeDelta } from "~/utils/time";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

describe("formatTimeDelta", () => {
  test("reports the largest unit that fits as localized text", () => {
    expect(formatTimeDelta(ago(2 * MINUTE), "en")).toBe("2 minutes ago");
    expect(formatTimeDelta(ago(90 * MINUTE), "en")).toBe("1 hour ago");
    expect(formatTimeDelta(ago(30 * HOUR), "en")).toBe("1 day ago");
    expect(formatTimeDelta(ago(45 * DAY), "en")).toBe("1 month ago");
  });

  test("does not report a zero-length delta", () => {
    expect(formatTimeDelta(new Date(), "en")).toBe("1 minute ago");
  });

  test("uses the locale instead of hardcoded English", () => {
    const zhHans = formatTimeDelta(ago(2 * HOUR), "zh-Hans");
    expect(zhHans).not.toContain("ago");
    expect(zhHans).toContain("小时");

    expect(formatTimeDelta(ago(30 * HOUR), "zh-Hant")).toContain("天");
  });

  test("reads a future timestamp as time in the future, not as ago", () => {
    expect(formatTimeDelta(new Date(Date.now() + 5 * MINUTE), "en")).toBe("in 5 minutes");
  });

  test("reads an unparsable date as an empty string instead of throwing", () => {
    expect(formatTimeDelta(new Date("not a date"), "en")).toBe("");
  });
});
