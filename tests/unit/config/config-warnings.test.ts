import { dump } from "js-yaml";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { authConfigWarnings } from "~/server/config/config-warnings";
import { loadConfig } from "~/server/config/load";
import log from "~/utils/log";

import { clearFakeFiles, createFakeFile } from "../setup/overlay-fs";

describe("authConfigWarnings", () => {
  test("says nothing about a configuration that does not use these settings", () => {
    expect(authConfigWarnings({})).toEqual([]);
  });

  test("warns that a cookie domain is shared with every host under it", () => {
    const warnings = authConfigWarnings({ cookie_domain: "example.com" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cookie_domain");
    expect(warnings[0]).toContain("example.com");
  });

  test("ignores the CIDR lists while proxy auth is disabled", () => {
    expect(
      authConfigWarnings({
        proxy_auth: { enabled: false, allowed_cidrs: ["0.0.0.0/0"] },
      }),
    ).toEqual([]);
  });

  test("warns that an all-address range trusts everyone who can connect", () => {
    const warnings = authConfigWarnings({
      proxy_auth: { enabled: true, allowed_cidrs: ["0.0.0.0/0"] },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("every address");
    expect(warnings[0]).toContain("Remote-User");
  });

  test("warns about a container network and names the configured user header", () => {
    const warnings = authConfigWarnings({
      proxy_auth: {
        enabled: true,
        allowed_cidrs: ["172.18.0.0/16"],
        user_header: "X-Authentik-Username",
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("a whole network");
    expect(warnings[0]).toContain("X-Authentik-Username");
  });

  test("accepts single addresses, including the documented loopback list", () => {
    expect(
      authConfigWarnings({
        proxy_auth: {
          enabled: true,
          allowed_cidrs: ["127.0.0.1/32", "::1/128", "10.0.0.5"],
        },
      }),
    ).toEqual([]);
  });

  test("warns about a wide trusted proxy range and names the ip header", () => {
    const warnings = authConfigWarnings({
      proxy_auth: {
        enabled: true,
        trusted_proxy_cidrs: ["10.0.0.0/8"],
        ip_header: "X-Real-IP",
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("trusted_proxy_cidrs");
    expect(warnings[0]).toContain("X-Real-IP");
  });

  test("warns about entries that will never match a client", () => {
    const warnings = authConfigWarnings({
      proxy_auth: {
        enabled: true,
        allowed_cidrs: ["not-an-address", "10.0.0.0/33"],
      },
    });

    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      expect(warning).toContain("will never match");
    }
  });
});

describe("configuration warnings", () => {
  beforeAll(() => {
    clearFakeFiles();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("logs the warnings for a dangerous proxy auth configuration", async () => {
    const filePath = "/config/risky-config.yaml";
    createFakeFile(
      filePath,
      dump({
        headscale: { url: "http://localhost:8080" },
        server: {
          cookie_secret: "thirtytwo-character-cookiesecret",
          cookie_domain: "example.com",
          proxy_auth: { enabled: true, allowed_cidrs: ["0.0.0.0/0"] },
        },
      }),
    );

    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    await loadConfig(filePath);

    const messages = warn.mock.calls.map((call) => String(call[2]));
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.includes("cookie_domain"))).toBe(true);
    expect(messages.some((message) => message.includes("every address"))).toBe(true);
  });

  test("stays quiet for a configuration that keeps the defaults", async () => {
    const filePath = "/config/quiet-config.yaml";
    createFakeFile(
      filePath,
      dump({
        headscale: { url: "http://localhost:8080" },
        server: { cookie_secret: "thirtytwo-character-cookiesecret" },
      }),
    );

    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    await loadConfig(filePath);

    expect(warn).not.toHaveBeenCalled();
  });
});
