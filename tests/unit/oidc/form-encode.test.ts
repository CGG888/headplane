import { describe, expect, test } from "vitest";

import { formEncode } from "~/server/oidc/provider";

// RFC 6749 §2.3.1 says the `client_secret_basic` username and password are
// encoded with the `application/x-www-form-urlencoded` algorithm, which is NOT
// `encodeURIComponent`: a space becomes `+` and `~` is escaped. These cases pin
// that encoding so a revert to `encodeURIComponent` fails loudly.
describe("client_secret_basic credential encoding", () => {
  test("encodes a space the way a form does", () => {
    expect(formEncode("a b")).toBe("a+b");
  });

  test("escapes the credential separators and reserved characters", () => {
    expect(formEncode("user:pass")).toBe("user%3Apass");
    expect(formEncode("a+b")).toBe("a%2Bb");
    expect(formEncode("a&b=c")).toBe("a%26b%3Dc");
    expect(formEncode("a/b?c")).toBe("a%2Fb%3Fc");
    expect(formEncode("a=b")).toBe("a%3Db");
  });

  test("escapes ~ but leaves the form-safe characters alone", () => {
    expect(formEncode("aZ0-._~")).toBe("aZ0-._%7E");
    expect(formEncode("*")).toBe("*");
  });

  test("leaves a plain client id untouched", () => {
    expect(formEncode("headplane")).toBe("headplane");
  });
});
