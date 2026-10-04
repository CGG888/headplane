import { describe, expect, test } from "vitest";

import { shouldDefaultToFormBody } from "~/server/form-content-type";

describe("form content type normalization", () => {
  test("leaves reads alone", () => {
    expect(shouldDefaultToFormBody("GET", undefined)).toBe(false);
    expect(shouldDefaultToFormBody("HEAD", undefined)).toBe(false);
    expect(shouldDefaultToFormBody("OPTIONS", undefined)).toBe(false);
  });

  test("leaves usable form content types alone", () => {
    expect(shouldDefaultToFormBody("POST", "application/x-www-form-urlencoded")).toBe(false);
    expect(shouldDefaultToFormBody("POST", "application/x-www-form-urlencoded;charset=UTF-8")).toBe(
      false,
    );
    expect(shouldDefaultToFormBody("POST", "multipart/form-data; boundary=----x")).toBe(false);
  });

  test("defaults missing or unparsable content types", () => {
    // A proxy that drops the header used to make every save fail with a 500.
    expect(shouldDefaultToFormBody("POST", undefined)).toBe(true);
    expect(shouldDefaultToFormBody("POST", "")).toBe(true);
    expect(shouldDefaultToFormBody("PUT", "text/plain")).toBe(true);
    expect(shouldDefaultToFormBody("PATCH", "application/octet-stream")).toBe(true);
  });
});
