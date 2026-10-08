import { describe, expect, test } from "vitest";

import { splitHostPort } from "~/utils/derp-host-port";

describe("splitHostPort", () => {
  test("splits a host from the port it carries", () => {
    expect(splitHostPort("relay.example.com:8443")).toEqual({
      host: "relay.example.com",
      port: 8443,
    });
    expect(splitHostPort("  relay.example.com:443  ")).toEqual({
      host: "relay.example.com",
      port: 443,
    });
    expect(splitHostPort("10.0.0.7:3478")).toEqual({ host: "10.0.0.7", port: 3478 });
  });

  test("keeps the brackets of an IPv6 literal, and its port", () => {
    expect(splitHostPort("[2001:db8::1]:8443")).toEqual({
      host: "[2001:db8::1]",
      port: 8443,
    });
  });

  test("reads a value that is only a host as a host", () => {
    // A bare IPv6 literal is a host, not a host with a port: it has more than one
    // colon, which the format expects in `ipv6` and without a port.
    for (const value of [
      "relay.example.com",
      "2001:db8::1",
      "[2001:db8::1]",
      "relay.example.com:",
      "relay.example.com:https",
      ":8443",
      "relay.example.com:0",
      "relay.example.com:65536",
      "relay.example.com:84 43",
      "",
      "   ",
    ]) {
      expect(splitHostPort(value), value).toBeUndefined();
    }
  });

  test("accepts both ends of the port range", () => {
    expect(splitHostPort("relay.example.com:1")?.port).toBe(1);
    expect(splitHostPort("relay.example.com:65535")?.port).toBe(65_535);
  });
});
