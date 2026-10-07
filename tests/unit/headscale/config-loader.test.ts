import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      hasInlineClientSecret: false,
      clientSecretPath: "/run/secrets/oidc",
      extraParams: {},
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
      haProbeInterval: "10s",
      haProbeTimeout: "5s",
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
      haProbeInterval: "10s",
      haProbeTimeout: "5s",
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
      haProbeInterval: "10s",
      haProbeTimeout: "5s",
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

  test("exposes the DERP settings with Headscale's defaults", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    expect(config.getDERPSettings()).toEqual({
      serverUrl: "http://localhost:8080",
      urls: [],
      paths: [],
      autoUpdateEnabled: false,
      updateFrequency: "3h",
      server: {
        enabled: false,
        regionId: 999,
        regionCode: "headscale",
        regionName: "Headscale Embedded DERP",
        stunListenAddr: "0.0.0.0:3478",
        privateKeyPath: "",
        hasPrivateKey: false,
        ipv4: "",
        ipv6: "",
        verifyClients: true,
        automaticallyAddEmbeddedDerpRegion: true,
      },
    });
  });

  test("reads hand-written DERP settings verbatim", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "derp:",
        "  urls:",
        "    - https://controlplane.tailscale.com/derpmap/default",
        "  paths:",
        "    - /etc/headscale/derp.yaml",
        "  auto_update_enabled: false",
        "  update_frequency: 30m",
        "  server:",
        "    enabled: true",
        "    region_id: 901",
        "    region_code: home",
        "    region_name: Home DERP",
        "    stun_listen_addr: 0.0.0.0:3478",
        "    ipv4: 198.51.100.1",
        "    ipv6: 2001:db8::1",
        "    private_key_path: /var/lib/headscale/derp_server_private.key",
        "    verify_clients: false",
        "    automatically_add_embedded_derp_region: false",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getDERPSettings()).toEqual({
      serverUrl: "http://localhost:8080",
      urls: ["https://controlplane.tailscale.com/derpmap/default"],
      paths: ["/etc/headscale/derp.yaml"],
      autoUpdateEnabled: false,
      updateFrequency: "30m",
      server: {
        enabled: true,
        regionId: 901,
        regionCode: "home",
        regionName: "Home DERP",
        stunListenAddr: "0.0.0.0:3478",
        privateKeyPath: "/var/lib/headscale/derp_server_private.key",
        hasPrivateKey: true,
        ipv4: "198.51.100.1",
        ipv6: "2001:db8::1",
        verifyClients: false,
        automaticallyAddEmbeddedDerpRegion: false,
      },
    });
  });

  test("falls back to DERP defaults for values with the wrong type", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "derp:",
        "  urls: 42",
        "  paths: 42",
        "  auto_update_enabled: enabled",
        "  update_frequency:",
        "    hours: 3",
        "  server: not-a-map",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getDERPSettings()).toEqual({
      serverUrl: "http://localhost:8080",
      urls: [],
      paths: [],
      autoUpdateEnabled: false,
      updateFrequency: "3h",
      server: {
        enabled: false,
        regionId: 999,
        regionCode: "headscale",
        regionName: "Headscale Embedded DERP",
        stunListenAddr: "0.0.0.0:3478",
        privateKeyPath: "",
        hasPrivateKey: false,
        ipv4: "",
        ipv6: "",
        verifyClients: true,
        automaticallyAddEmbeddedDerpRegion: true,
      },
    });
  });

  test("falls back to the default region ID when it is not a number", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "derp:",
        "  server:",
        "    region_id: nine-hundred",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getDERPSettings().server.regionId).toBe(999);
  });

  test("patches the DERP settings onto their top-level dotted paths", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["server_url: http://localhost:8080", "node:", "  expiry: 0"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    await config.patch([
      { path: "derp.urls", value: ["https://controlplane.tailscale.com/derpmap/default"] },
      { path: "derp.paths", value: ["/etc/headscale/derp.yaml"] },
      { path: "derp.auto_update_enabled", value: true },
      { path: "derp.update_frequency", value: "30m" },
      { path: "derp.server.enabled", value: true },
      { path: "derp.server.region_id", value: 901 },
      { path: "derp.server.region_code", value: "home" },
      { path: "derp.server.region_name", value: "Home DERP" },
      { path: "derp.server.stun_listen_addr", value: "0.0.0.0:3478" },
      { path: "derp.server.ipv4", value: "198.51.100.1" },
      { path: "derp.server.ipv6", value: "2001:db8::1" },
      { path: "derp.server.verify_clients", value: false },
      { path: "derp.server.automatically_add_embedded_derp_region", value: false },
    ]);

    const written = parse(await readFile(path, "utf8"));
    // DERP is a top-level block, so this must not land under `node`.
    expect(written.derp).toEqual({
      urls: ["https://controlplane.tailscale.com/derpmap/default"],
      paths: ["/etc/headscale/derp.yaml"],
      auto_update_enabled: true,
      update_frequency: "30m",
      server: {
        enabled: true,
        region_id: 901,
        region_code: "home",
        region_name: "Home DERP",
        stun_listen_addr: "0.0.0.0:3478",
        ipv4: "198.51.100.1",
        ipv6: "2001:db8::1",
        verify_clients: false,
        automatically_add_embedded_derp_region: false,
      },
    });
    expect(written.node).toEqual({ expiry: 0 });
  });

  test("falls back when the embedded server's public addresses are not strings", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "derp:",
        "  server:",
        "    ipv4: 198",
        "    ipv6:",
        "      - 2001:db8::1",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getDERPSettings().server.ipv4).toBe("");
    expect(config.getDERPSettings().server.ipv6).toBe("");
  });

  test("deletes the public address keys when they are patched with null", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "derp:",
        "  server:",
        "    ipv4: 198.51.100.1",
        "    ipv6: 2001:db8::1",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    await config.patch([
      { path: "derp.server.ipv4", value: null },
      { path: "derp.server.ipv6", value: null },
    ]);

    const written = parse(await readFile(path, "utf8"));
    expect(written.derp.server).toEqual({});
    expect(config.getDERPSettings().server.ipv4).toBe("");
    expect(config.getDERPSettings().server.ipv6).toBe("");
  });

  test("reads the extra authorization parameters and the secret file path", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "oidc:",
        "  issuer: https://issuer.example.com",
        "  client_id: headplane",
        "  client_secret: super-secret",
        "  client_secret_path: ${CREDENTIALS_DIRECTORY}/oidc_client_secret",
        "  extra_params:",
        "    domain_hint: example.com",
        "    prompt: consent",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    const settings = config.getOIDCSettings();

    expect(settings).toMatchObject({
      hasClientSecret: true,
      // The inline secret and the path are both present; the page warns about
      // exactly this combination instead of blocking the save.
      hasInlineClientSecret: true,
      clientSecretPath: "${CREDENTIALS_DIRECTORY}/oidc_client_secret",
      extraParams: { domain_hint: "example.com", prompt: "consent" },
    });
    expect(JSON.stringify(settings)).not.toContain("super-secret");
  });

  test("drops extra authorization parameters that are not strings", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "oidc:",
        "  issuer: https://issuer.example.com",
        "  extra_params:",
        "    domain_hint: example.com",
        "    attempts: 3",
        "    nested:",
        "      key: value",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getOIDCSettings()?.extraParams).toEqual({ domain_hint: "example.com" });
  });

  test("patches extra_params as a whole map and removes it with null", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      ["server_url: http://localhost:8080", "oidc:", "  issuer: https://issuer.example.com"].join(
        "\n",
      ),
    );

    const config = await loadHeadscaleConfig(path);
    await config.patch([
      { path: "oidc.extra_params", value: { domain_hint: "example.com", prompt: "consent" } },
      { path: "oidc.client_secret_path", value: "${CREDENTIALS_DIRECTORY}/secret" },
    ]);

    const written = parse(await readFile(path, "utf8"));
    expect(written.oidc.extra_params).toEqual({
      domain_hint: "example.com",
      prompt: "consent",
    });
    expect(written.oidc.client_secret_path).toBe("${CREDENTIALS_DIRECTORY}/secret");

    await config.patch([
      { path: "oidc.extra_params", value: null },
      { path: "oidc.client_secret_path", value: null },
    ]);

    const cleared = parse(await readFile(path, "utf8"));
    expect(cleared.oidc).toEqual({ issuer: "https://issuer.example.com" });
    expect(config.getOIDCSettings()?.extraParams).toEqual({});
  });

  test("reads the HA probe durations verbatim, including a bare zero", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "node:",
        "  routes:",
        "    ha:",
        "      probe_interval: 0",
        "      probe_timeout: 5s",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    // `probe_interval: 0` is a YAML number that disables probing; it must not
    // be mistaken for an unset key and shown as the 10s default.
    expect(config.getAdvancedSettings()).toMatchObject({
      haProbeInterval: "0",
      haProbeTimeout: "5s",
    });
  });

  test("falls back to the HA probe defaults for values with the wrong type", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "node:",
        "  routes:",
        "    ha:",
        "      probe_interval:",
        "        seconds: 10",
        "      probe_timeout: [5]",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getAdvancedSettings()).toMatchObject({
      haProbeInterval: "10s",
      haProbeTimeout: "5s",
    });
  });

  test("exposes the read-only overview from the configuration file", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: https://headscale.example.com",
        "listen_addr: 0.0.0.0:8080",
        "metrics_listen_addr: 127.0.0.1:9090",
        "grpc_listen_addr: 127.0.0.1:50443",
        "grpc_allow_insecure: true",
        "unix_socket: /var/run/headscale/headscale.sock",
        'unix_socket_permission: "0770"',
        "prefixes:",
        "  v4: 100.64.0.0/10",
        "  v6: fd7a:115c:a1e0::/48",
        "  allocation: random",
        "database:",
        "  type: postgres",
        "  sqlite:",
        "    path: /var/lib/headscale/db.sqlite",
        "    write_ahead_log: false",
        "noise:",
        "  private_key_path: /var/lib/headscale/noise_private.key",
        "tls_letsencrypt_hostname: headscale.example.com",
        "acme_email: ops@example.com",
        "tls_cert_path: /etc/headscale/tls.crt",
        "tls_key_path: /etc/headscale/tls.key",
        "tuning:",
        "  node_store_batch_size: 100",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getServerOverview()).toEqual({
      serverUrl: "https://headscale.example.com",
      listenAddr: "0.0.0.0:8080",
      prefixesV4: "100.64.0.0/10",
      prefixesV6: "fd7a:115c:a1e0::/48",
      prefixAllocation: "random",
      databaseType: "postgres",
      sqlitePath: "/var/lib/headscale/db.sqlite",
      sqliteWriteAheadLog: false,
      metricsListenAddr: "127.0.0.1:9090",
      grpcListenAddr: "127.0.0.1:50443",
      grpcAllowInsecure: true,
      unixSocket: "/var/run/headscale/headscale.sock",
      unixSocketPermission: "0770",
      noisePrivateKeyPath: "/var/lib/headscale/noise_private.key",
      tlsLetsencryptHostname: "headscale.example.com",
      acmeEmail: "ops@example.com",
      tlsCertPath: "/etc/headscale/tls.crt",
      tlsKeyPath: "/etc/headscale/tls.key",
      tuningConfigured: true,
    });
  });

  test("keeps Headscale's fallbacks when every overview key is missing", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(path, ["dns:", "  magic_dns: false"].join("\n"));

    const config = await loadHeadscaleConfig(path);
    expect(config.getServerOverview()).toEqual({
      serverUrl: "",
      listenAddr: "",
      prefixesV4: "",
      prefixesV6: "",
      // Headscale allocates sequentially and uses SQLite with WAL when the
      // corresponding keys are absent, so the page shows those, not blanks.
      prefixAllocation: "sequential",
      databaseType: "sqlite",
      sqlitePath: "",
      sqliteWriteAheadLog: true,
      metricsListenAddr: "",
      grpcListenAddr: "",
      grpcAllowInsecure: false,
      unixSocket: "",
      unixSocketPermission: "",
      noisePrivateKeyPath: "",
      tlsLetsencryptHostname: "",
      acmeEmail: "",
      tlsCertPath: "",
      tlsKeyPath: "",
      tuningConfigured: false,
    });
  });

  test("falls back for overview values with the wrong type", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "server_url: http://localhost:8080",
        "prefixes: 42",
        "database: not-a-map",
        "grpc_allow_insecure: yes",
        "unix_socket_permission: 770",
        "noise: []",
        "tuning: not-a-map",
      ].join("\n"),
    );

    const config = await loadHeadscaleConfig(path);
    expect(config.getServerOverview()).toMatchObject({
      serverUrl: "http://localhost:8080",
      prefixesV4: "",
      prefixAllocation: "sequential",
      databaseType: "sqlite",
      sqliteWriteAheadLog: true,
      grpcAllowInsecure: false,
      unixSocketPermission: "",
      noisePrivateKeyPath: "",
      tuningConfigured: false,
    });
  });

  test("a separate DNS file without extra_records_path is reported, not fatal", async () => {
    const path = join(dir, "config.yaml");
    const recordsPath = join(dir, "extra-records.json");
    await writeFile(path, "server_url: http://localhost:8080");
    await writeFile(recordsPath, JSON.stringify([{ name: "json", type: "A", value: "1.1.1.1" }]));

    // Headplane was pointed at a records file Headscale knows nothing about.
    // The loader hands that back to its caller instead of taking the process
    // down with it.
    await expect(loadHeadscaleConfig(path, recordsPath)).rejects.toThrow(/extra_records_path/);
  });

  test("a directory is refused where a config file is required", async () => {
    const path = join(dir, "config.yaml");
    await mkdir(path, { recursive: true });

    // Reading a directory would throw deep inside the parser; the loader
    // reports it as unreadable instead.
    const config = await loadHeadscaleConfig(path);
    expect(config.readable()).toBe(false);
  });

  test("a directory is refused where a DNS records file is required", async () => {
    const path = join(dir, "config.yaml");
    const recordsPath = join(dir, "extra-records.json");
    const recordsDir = join(dir, "records");
    await writeFile(recordsPath, JSON.stringify([{ name: "json", type: "A", value: "1.1.1.1" }]));
    await writeFile(
      path,
      ["server_url: http://localhost:8080", "dns:", `  extra_records_path: ${recordsPath}`].join(
        "\n",
      ),
    );
    await mkdir(recordsDir, { recursive: true });

    // Headplane was pointed at a directory: it has to be reported as no records
    // at all instead of reaching the JSON reader.
    const config = await loadHeadscaleConfig(path, recordsDir);
    expect(config.dnsRecords()).toEqual([]);
  });
});
