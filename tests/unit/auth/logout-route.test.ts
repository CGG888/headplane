import { describe, expect, test } from "vitest";

import { isSameSiteLogout } from "~/routes/auth/logout";

function request(headers: Record<string, string>) {
  return new Request("http://localhost:3000/admin/logout", { headers });
}

describe("logout route", () => {
  test("allows a same-origin navigation", () => {
    expect(isSameSiteLogout(request({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameSiteLogout(request({ "sec-fetch-site": "none" }))).toBe(true);
  });

  test("refuses a cross-site navigation", () => {
    expect(isSameSiteLogout(request({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameSiteLogout(request({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  test("allows requests when the header is missing", () => {
    // Older browsers and proxies that strip `Sec-Fetch-*` must still be able to
    // log out.
    expect(isSameSiteLogout(request({}))).toBe(true);
  });
});
