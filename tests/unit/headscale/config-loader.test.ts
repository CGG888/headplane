import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parse } from "yaml";

import { loadHeadscaleConfig } from "~/server/headscale/config-loader";

describe("Headscale config loader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-config-loader-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("tolerates unknown Headscale keys while reading known defaults", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "future_headscale_key:",
        "  nested: true",
        "randomize_client_port: false",
        "auto_update:",
        "  enabled: true",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.readable()).toBe(true);
    expect(config.getDNSConfig()).toMatchObject({
      magicDns: true,
      baseDomain: "",
      nameservers: [],
      splitDns: {},
      searchDomains: [],
      overrideDns: true,
    });
  });

  test("falls back for invalid consumed values without rejecting the whole config", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "dns:",
        "  magic_dns: maybe",
        "  base_domain: 1234",
        "  override_local_dns: nope",
        "  nameservers:",
        "    global: 1.1.1.1",
        "    split:",
        "      example.com: 1.1.1.1",
        "  search_domains: example.com",
        "oidc:",
        "  issuer: https://issuer.example.com",
        "  allowed_domains: example.com",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.readable()).toBe(true);
    expect(config.getDNSConfig()).toMatchObject({
      magicDns: true,
      baseDomain: "",
      nameservers: [],
      splitDns: {},
      searchDomains: [],
      overrideDns: true,
    });
    expect(config.getOIDCConfig()).toMatchObject({
      allowedDomains: [],
    });
  });

  test("patches only requested paths and does not write effective defaults", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "future_headscale_key: keep-me",
        "dns:",
        "  base_domain: example.com",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    await config.patch([{ path: "dns.magic_dns", value: false }]);

    const written = parse(await readFile(path, "utf8"));
    expect(written.future_headscale_key).toBe("keep-me");
    expect(written.dns).toEqual({
      base_domain: "example.com",
      magic_dns: false,
    });
  });

  test("patches quoted split DNS domains", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      ["server_url: http://localhost:8080", "dns:", "  nameservers:", "    split: {}"].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    await config.patch([{ path: 'dns.nameservers.split."corp.example.com"', value: ["1.1.1.1"] }]);

    const written = parse(await readFile(path, "utf8"));
    expect(written.dns.nameservers.split).toEqual({
      "corp.example.com": ["1.1.1.1"],
    });
  });

  test("prefers extra records JSON over inline YAML records", async () => {
    const path = join(dir, "config.yaml");
    const recordsPath = join(dir, "extra-records.json");
    await writeFile(recordsPath, JSON.stringify([{ name: "json", type: "A", value: "1.1.1.1" }]));
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "dns:",
        "  extra_records_path: " + recordsPath,
        "  extra_records:",
        "    - name: yaml",
        "      type: A",
        "      value: 2.2.2.2",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.dnsRecords()).toEqual([{ name: "json", type: "A", value: "1.1.1.1" }]);

    await config.addDNS({ name: "new", type: "A", value: "3.3.3.3" });

    expect(JSON.parse(await readFile(recordsPath, "utf8"))).toEqual([
      { name: "json", type: "A", value: "1.1.1.1" },
      { name: "new", type: "A", value: "3.3.3.3" },
    ]);
    expect(parse(await readFile(path, "utf8")).dns.extra_records).toEqual([
      { name: "yaml", type: "A", value: "2.2.2.2" },
    ]);
  });

  test("reads OIDC restrictions as empty arrays when unset", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      ["server_url: http://localhost:8080", "oidc:", "  issuer: https://issuer.example.com"].join(
        "\n",
      ),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getOIDCConfig()).toEqual({
      issuer: "https://issuer.example.com",
      allowedDomains: [],
      allowedGroups: [],
      allowedUsers: [],
    });
  });

  test("does not treat an empty OIDC block as configured", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080", "oidc: {}"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    expect(config.getOIDCConfig()).toBeUndefined();
    expect(config.hasOIDCConfig()).toBe(false);
  });

  test("exposes the full OIDC block with Headscale's defaults", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "oidc:",
        "  issuer: https://issuer.example.com",
        "  client_id: headplane",
        "  client_secret_path: /run/secrets/oidc",
        "  use_expiry_from_token: true",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getOIDCSettings()).toEqual({
      issuer: "https://issuer.example.com",
      clientId: "headplane",
      // A secret file counts as "configured"; the value itself is never read.
      hasClientSecret: true,
      scope: ["openid", "profile", "email"],
      emailVerifiedRequired: true,
      useExpiryFromToken: true,
      onlyStartIfOIDCIsAvailable: true,
      pkceEnabled: false,
      pkceMethod: "S256",
      allowedDomains: [],
      allowedGroups: [],
      allowedUsers: [],
    });
  });

  test("reads hand-written OIDC values verbatim", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "oidc:",
        "  issuer: https://issuer.example.com",
        "  client_id: headplane",
        "  client_secret: super-secret",
        "  scope: [openid, email]",
        "  email_verified_required: false",
        "  only_start_if_oidc_is_available: false",
        "  pkce:",
        "    enabled: true",
        "    method: plain",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    const settings = config.getOIDCSettings();

    expect(settings).toMatchObject({
      clientId: "headplane",
      hasClientSecret: true,
      scope: ["openid", "email"],
      emailVerifiedRequired: false,
      onlyStartIfOIDCIsAvailable: false,
      pkceEnabled: true,
      pkceMethod: "plain",
    });
    // The secret is never handed to the UI.
    expect(JSON.stringify(settings)).not.toContain("super-secret");
  });

  test("reports no OIDC settings when the block is missing", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    expect(config.getOIDCSettings()).toBeUndefined();
  });

  test("reads the tailnet settings Headplane can now edit", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "policy:",
        "  mode: database",
        "  path: /etc/headscale/policy.hujson",
        "trusted_proxies:",
        "  - 10.0.0.0/8",
        "  - 127.0.0.1/32",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getTailnetSettings()).toEqual({
      policyMode: "database",
      policyPath: "/etc/headscale/policy.hujson",
      trustedProxies: ["10.0.0.0/8", "127.0.0.1/32"],
    });
  });

  test("defaults to file policy mode and no trusted proxies", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    expect(config.getTailnetSettings()).toEqual({
      policyMode: "file",
      policyPath: "",
      trustedProxies: [],
    });
  });

  test("exposes the advanced settings with Headscale's defaults", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    expect(config.getAdvancedSettings()).toEqual({
      nodeExpiry: "0",
      // Headscale's config-example.yaml ships 30m, but its viper default (what
      // an absent key actually resolves to) is 120s.
      ephemeralInactivityTimeout: "120s",
      logLevel: "info",
      logFormat: "text",
      taildropEnabled: true,
      autoUpdateEnabled: false,
      logtailEnabled: false,
      disableCheckUpdates: false,
    });
  });

  test("reads hand-written advanced settings verbatim", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "disable_check_updates: true",
        "node:",
        "  expiry: 720h",
        "  ephemeral:",
        "    inactivity_timeout: 30m",
        "log:",
        "  level: warn",
        "  format: json",
        "taildrop:",
        "  enabled: false",
        "auto_update:",
        "  enabled: true",
        "logtail:",
        "  enabled: true",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getAdvancedSettings()).toEqual({
      nodeExpiry: "720h",
      ephemeralInactivityTimeout: "30m",
      logLevel: "warn",
      logFormat: "json",
      taildropEnabled: false,
      autoUpdateEnabled: true,
      logtailEnabled: true,
      disableCheckUpdates: true,
    });
  });

  test("falls back to defaults for advanced settings with the wrong type", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "disable_check_updates: 1",
        "node:",
        "  expiry: 720",
        "  ephemeral: wrong",
        "log: not-a-map",
        "taildrop:",
        "  enabled: true",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getAdvancedSettings()).toEqual({
      nodeExpiry: "0",
      ephemeralInactivityTimeout: "120s",
      logLevel: "info",
      logFormat: "text",
      taildropEnabled: true,
      autoUpdateEnabled: false,
      logtailEnabled: false,
      disableCheckUpdates: false,
    });
  });

  test("patches the advanced settings onto their dotted paths", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080", "node:", "  expiry: 0"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    await config.patch([
      { path: "node.expiry", value: "720h" },
      { path: "node.ephemeral.inactivity_timeout", value: "30m" },
      { path: "log.level", value: "warn" },
      { path: "log.format", value: "json" },
      { path: "taildrop.enabled", value: false },
      { path: "auto_update.enabled", value: true },
      { path: "logtail.enabled", value: true },
      { path: "disable_check_updates", value: true },
    ]);

    const written = parse(await readFile(path, "utf8"));
    expect(written.node).toEqual({
      expiry: "720h",
      ephemeral: { inactivity_timeout: "30m" },
    });
    expect(written.log).toEqual({ level: "warn", format: "json" });
    expect(written.taildrop).toEqual({ enabled: false });
    expect(written.auto_update).toEqual({ enabled: true });
    expect(written.logtail).toEqual({ enabled: true });
    expect(written.disable_check_updates).toBe(true);
  });
});
