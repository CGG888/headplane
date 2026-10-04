import { describe, expect, test } from "vitest";

import {
  isValidTrustedProxyCidr,
  validateTrustedProxyCidr,
} from "~/routes/settings/headscale/trusted-proxies";

describe("validateTrustedProxyCidr", () => {
  test("accepts IPv4 CIDRs", () => {
    expect(isValidTrustedProxyCidr("10.0.0.0/8")).toBe(true);
    expect(isValidTrustedProxyCidr("192.168.1.0/24")).toBe(true);
    expect(isValidTrustedProxyCidr("172.16.5.4/32")).toBe(true);
    expect(isValidTrustedProxyCidr("  203.0.113.0/24  ")).toBe(true);
  });

  test("accepts IPv6 CIDRs", () => {
    expect(isValidTrustedProxyCidr("::1/128")).toBe(true);
    expect(isValidTrustedProxyCidr("fd00::/8")).toBe(true);
    expect(isValidTrustedProxyCidr("2001:db8::/32")).toBe(true);
    expect(isValidTrustedProxyCidr("2001:0db8:0000:0000:0000:0000:0000:0001/128")).toBe(true);
    expect(isValidTrustedProxyCidr("::ffff:192.168.1.0/120")).toBe(true);
  });

  test("rejects the unspecified ranges Headscale refuses to start with", () => {
    expect(validateTrustedProxyCidr("0.0.0.0/0")).toBe("unspecified");
    expect(validateTrustedProxyCidr("::/0")).toBe("unspecified");
    expect(validateTrustedProxyCidr("0:0:0:0:0:0:0:0/0")).toBe("unspecified");
    expect(validateTrustedProxyCidr("0000::/0")).toBe("unspecified");
  });

  test("rejects values without a prefix length", () => {
    expect(validateTrustedProxyCidr("10.0.0.1")).toBe("invalid");
    expect(validateTrustedProxyCidr("fd00::1")).toBe("invalid");
    expect(validateTrustedProxyCidr("")).toBe("invalid");
  });

  test("rejects malformed addresses and prefixes", () => {
    expect(validateTrustedProxyCidr("10.0.0.256/8")).toBe("invalid");
    expect(validateTrustedProxyCidr("10.0.0/8")).toBe("invalid");
    expect(validateTrustedProxyCidr("10.0.0.0/33")).toBe("invalid");
    expect(validateTrustedProxyCidr("10.0.0.0/abc")).toBe("invalid");
    expect(validateTrustedProxyCidr("2001:db8::/129")).toBe("invalid");
    expect(validateTrustedProxyCidr("2001:db8:::1/64")).toBe("invalid");
    expect(validateTrustedProxyCidr("2001:db8::1::2/64")).toBe("invalid");
    expect(validateTrustedProxyCidr("12345::/64")).toBe("invalid");
    expect(validateTrustedProxyCidr("10.0.0.0/8/8")).toBe("invalid");
  });
});
