import { describe, expect, test, vi } from "vitest";

import { action as colorSchemeAction } from "~/routes/util/color-scheme";
import { action as localeAction, loader as localeLoader } from "~/routes/util/locale";

const BASE = "http://localhost:3000/admin/api/locale";

function call(handler: unknown, request: Request) {
  return (handler as (args: { request: Request }) => Promise<Response>)({ request });
}

describe("locale route", () => {
  test("reads the locale from the query string", async () => {
    const request = new Request(`${BASE}?locale=zh-Hans&returnTo=/machines`);
    const response = await call(localeLoader, request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/machines");
    expect(response.headers.get("Set-Cookie")).toContain("locale=");
  });

  test("reads the locale from a form body", async () => {
    const request = new Request(BASE, {
      method: "POST",
      body: new URLSearchParams({ locale: "zh-Hant", returnTo: "/users" }),
    });
    const response = await call(localeAction, request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/users");
    expect(response.headers.get("Set-Cookie")).toContain("locale=");
  });

  test("a POST without a body redirects instead of throwing", async () => {
    // Reverse proxies have been observed to drop the body, which used to make
    // `request.formData()` throw a 500 and strand the browser on this URL.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new Request(BASE, { method: "POST" });

    const response = await call(localeAction, request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    warn.mockRestore();
  });

  test("an unsupported locale falls back to the current page", async () => {
    const request = new Request(`${BASE}?locale=xx&returnTo=/machines`);
    const response = await call(localeLoader, request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/machines");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  test("an off-site returnTo is ignored", async () => {
    const request = new Request(`${BASE}?locale=zh-Hans&returnTo=https://evil.test`);
    const response = await call(localeLoader, request);

    expect(response.headers.get("Location")).toBe("/");
  });
});

describe("color scheme route", () => {
  test("reads the color scheme from the query string", async () => {
    const request = new Request("http://localhost:3000/admin/api/color-scheme?colorScheme=dark");
    const response = await call(colorSchemeAction, request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Set-Cookie")).toContain("color_scheme=");
  });

  test("a POST without a body redirects instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new Request("http://localhost:3000/admin/api/color-scheme", {
      method: "POST",
    });

    const response = await call(colorSchemeAction, request);

    expect(response.status).toBe(302);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    warn.mockRestore();
  });
});
