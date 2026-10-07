import { describe, expect, test } from "vitest";

import { shouldDefaultToFormBody } from "~/server/form-content-type";

const BASE_URL = "https://headplane.example.com";

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

  test("restores a header the proxy dropped", () => {
    // A proxy that drops the header used to make every save fail with a 500.
    expect(shouldDefaultToFormBody("POST", undefined)).toBe(true);
    expect(shouldDefaultToFormBody("POST", "")).toBe(true);
    expect(shouldDefaultToFormBody("POST", undefined, { origin: "https://evil.example" })).toBe(
      true,
    );
  });

  test("restores a type the proxy mangled for our own pages", () => {
    expect(
      shouldDefaultToFormBody("PUT", "text/plain", { origin: BASE_URL, baseUrl: BASE_URL }),
    ).toBe(true);
    expect(
      shouldDefaultToFormBody("PATCH", "application/octet-stream", {
        origin: BASE_URL,
        baseUrl: `${BASE_URL}/admin`,
      }),
    ).toBe(true);
  });

  test("leaves a cross-site body alone", () => {
    // `text/plain` is a CORS simple request, so it arrives without a preflight:
    // parsing it as a form would hand the sender a body the browser never meant
    // to make parseable.
    expect(
      shouldDefaultToFormBody("POST", "text/plain", {
        origin: "https://evil.example",
        baseUrl: BASE_URL,
      }),
    ).toBe(false);
    expect(
      shouldDefaultToFormBody("POST", "application/json", {
        origin: "https://evil.example",
        baseUrl: BASE_URL,
      }),
    ).toBe(false);
  });

  test("restores a mangled type when no origin is sent", () => {
    // Not a browser (curl, the proxy itself), so there is no session to borrow.
    expect(shouldDefaultToFormBody("PUT", "text/plain")).toBe(true);
    expect(shouldDefaultToFormBody("PUT", "text/plain", { origin: null })).toBe(true);
  });

  test("refuses a mangled type when the deployment origin is unknown", () => {
    expect(shouldDefaultToFormBody("POST", "text/plain", { origin: BASE_URL })).toBe(false);
    expect(
      shouldDefaultToFormBody("POST", "text/plain", { origin: "not a url", baseUrl: BASE_URL }),
    ).toBe(false);
    expect(
      shouldDefaultToFormBody("POST", "text/plain", { origin: BASE_URL, baseUrl: "not a url" }),
    ).toBe(false);
  });
});
