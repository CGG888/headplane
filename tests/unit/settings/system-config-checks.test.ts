import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  computeConfigChecks,
  configProbeTargets,
  DEFAULT_SQLITE_PATH,
  isUnspecifiedTrustedProxy,
  type ConfigCheck,
  type ConfigCheckId,
  type ConfigProbe,
  type ConfigProbeResults,
} from "~/routes/settings/system/config-checks";
import { loadConfigChecks } from "~/routes/settings/system/config-probe";

function probe(path: string, overrides: Partial<ConfigProbe> = {}): ConfigProbe {
  return { path, exists: true, readable: true, isFile: true, size: 64, ...overrides };
}

function run(config: unknown, probes: ConfigProbeResults = {}): ConfigCheck[] {
  return computeConfigChecks({ config, probes });
}

function check(checks: ConfigCheck[], id: ConfigCheckId): ConfigCheck {
  const found = checks.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Missing config check: ${id}`);
  }

  return found;
}

const CHECK_IDS: ConfigCheckId[] = [
  "configOidcKeys",
  "configTrustedProxies",
  "configTls",
  "configDatabase",
  "configPolicy",
  "configDnsRecords",
  "configOidc",
  "configNoiseKey",
];

/** Every probe a fully healthy, first-start-free SQLite configuration needs. */
function readyProbes(): ConfigProbeResults {
  return {
    databaseDir: probe("/var/lib/headscale", { isFile: false, writable: true }),
    databaseFile: probe("/var/lib/headscale/db.sqlite"),
  };
}

describe("config file checks", () => {
  test("returns nothing when the config file could not be read", () => {
    // The page reports an unreadable file through the `configAccess`
    // diagnostic, so the config section degrades to empty instead.
    expect(run(undefined)).toEqual([]);
    expect(run(null)).toEqual([]);
    expect(run("not a mapping")).toEqual([]);
    expect(run([])).toEqual([]);
  });

  test("passes every check on a healthy configuration", () => {
    const checks = run(
      {
        server_url: "https://headscale.example.com",
        trusted_proxies: ["10.0.0.0/8"],
        policy: { mode: "database" },
        database: { type: "sqlite", sqlite: { path: "/var/lib/headscale/db.sqlite" } },
      },
      readyProbes(),
    );

    expect(checks.map((entry) => entry.id)).toEqual(CHECK_IDS);
    expect(checks.map((entry) => entry.status)).toEqual(Array.from({ length: 8 }, () => "pass"));
  });

  test("fails on the OIDC keys Headscale 0.29 refuses to start with", () => {
    const entry = check(
      run({ oidc: { issuer: "https://id.example.com", expiry: "24h", map_legacy_users: true } }),
      "configOidcKeys",
    );

    expect(entry.status).toBe("fail");
    expect(entry.vars).toEqual({ keys: "oidc.expiry, oidc.map_legacy_users" });
    expect(entry.link?.to).toBe("/settings/headscale");
  });

  test("passes the OIDC key check for a supported configuration", () => {
    const entry = check(run({ oidc: { issuer: "https://id.example.com" } }), "configOidcKeys");

    expect(entry.status).toBe("pass");
    expect(entry.link).toBeUndefined();
  });

  test("recognizes every spelling of an unspecified trusted proxy", () => {
    for (const value of ["0.0.0.0/0", "::/0", "::0/0", "0::/0", "0:0:0:0:0:0:0:0/0"]) {
      expect(isUnspecifiedTrustedProxy(value), value).toBe(true);
    }

    for (const value of [
      "10.0.0.0/8",
      "0.0.0.0/8",
      "172.16.0.0/12",
      "fd00::/8",
      "::1/0",
      "0.0.0.0",
      "::",
    ]) {
      expect(isUnspecifiedTrustedProxy(value), value).toBe(false);
    }
  });

  test("fails on trusted proxy entries Headscale rejects", () => {
    const entry = check(
      run({ trusted_proxies: ["10.0.0.0/8", "0.0.0.0/0", "::/0"] }),
      "configTrustedProxies",
    );

    expect(entry.status).toBe("fail");
    expect(entry.vars).toEqual({ proxies: "0.0.0.0/0, ::/0" });
    expect(entry.link?.to).toBe("/settings/headscale");
  });

  test("passes when every trusted proxy entry is usable", () => {
    const entry = check(run({ trusted_proxies: ["10.0.0.0/8"] }), "configTrustedProxies");
    expect(entry.status).toBe("pass");

    // A bare string is what a hand-written YAML file can produce.
    expect(check(run({ trusted_proxies: "10.0.0.0/8" }), "configTrustedProxies").status).toBe(
      "pass",
    );
  });

  test("treats a plain HTTP server without a certificate as a pass", () => {
    const entry = check(run({ server_url: "http://headscale.example.com" }), "configTls");

    expect(entry.status).toBe("pass");
    expect(entry.bodyKey).toBe("settings.system.configChecks.tls.none");
  });

  test("fails when a configured certificate or key cannot be read", () => {
    const missing = check(
      run(
        { tls_cert_path: "/etc/headscale/tls.crt", tls_key_path: "/etc/headscale/tls.key" },
        {
          tlsCert: probe("/etc/headscale/tls.crt", { exists: false, readable: false }),
          tlsKey: probe("/etc/headscale/tls.key"),
        },
      ),
      "configTls",
    );

    expect(missing.status).toBe("fail");
    expect(missing.bodyKey).toBe("settings.system.configChecks.tls.missingFile");
    expect(missing.vars).toEqual({ path: "/etc/headscale/tls.crt" });

    const unreadable = check(
      run(
        { tls_cert_path: "/etc/headscale/tls.crt" },
        { tlsCert: probe("/etc/headscale/tls.crt", { readable: false }) },
      ),
      "configTls",
    );
    expect(unreadable.status).toBe("fail");

    const directory = check(
      run(
        { tls_key_path: "/etc/headscale/tls.key" },
        { tlsKey: probe("/etc/headscale/tls.key", { isFile: false }) },
      ),
      "configTls",
    );
    expect(directory.status).toBe("fail");
  });

  test("warns when ACME and a static certificate are configured together", () => {
    const entry = check(
      run(
        {
          server_url: "https://headscale.example.com",
          tls_letsencrypt_hostname: "headscale.example.com",
          tls_cert_path: "/etc/headscale/tls.crt",
        },
        { tlsCert: probe("/etc/headscale/tls.crt") },
      ),
      "configTls",
    );

    expect(entry.status).toBe("warning");
    expect(entry.bodyKey).toBe("settings.system.configChecks.tls.conflict");
    expect(entry.vars).toEqual({
      hostname: "headscale.example.com",
      path: "/etc/headscale/tls.crt",
    });
  });

  test("warns when server_url is plain HTTP while a certificate is configured", () => {
    const entry = check(
      run({ server_url: "http://headscale.example.com", tls_letsencrypt_hostname: "hs.example" }),
      "configTls",
    );

    expect(entry.status).toBe("warning");
    expect(entry.bodyKey).toBe("settings.system.configChecks.tls.insecure");
    expect(entry.vars).toEqual({ url: "http://headscale.example.com" });
  });

  test("passes when the configured certificate files are readable", () => {
    const entry = check(
      run(
        {
          server_url: "https://headscale.example.com",
          tls_cert_path: "/etc/headscale/tls.crt",
          tls_key_path: "/etc/headscale/tls.key",
        },
        { tlsCert: probe("/etc/headscale/tls.crt"), tlsKey: probe("/etc/headscale/tls.key") },
      ),
      "configTls",
    );

    expect(entry.status).toBe("pass");
  });

  test("passes an external database without probing SQLite", () => {
    const entry = check(
      run({ database: { type: "postgres", postgres: { host: "db" } } }),
      "configDatabase",
    );

    expect(entry.status).toBe("pass");
    expect(entry.bodyKey).toBe("settings.system.configChecks.database.external");
    expect(entry.vars).toEqual({ type: "postgres" });
  });

  test("fails when the SQLite directory is missing or read-only", () => {
    const missing = check(
      run(
        { database: { type: "sqlite", sqlite: { path: "/var/lib/headscale/db.sqlite" } } },
        {
          databaseDir: probe("/var/lib/headscale", { exists: false, readable: false }),
          databaseFile: probe("/var/lib/headscale/db.sqlite", { exists: false, readable: false }),
        },
      ),
      "configDatabase",
    );

    expect(missing.status).toBe("fail");
    expect(missing.bodyKey).toBe("settings.system.configChecks.database.missingDir");
    expect(missing.vars).toEqual({ path: "/var/lib/headscale" });

    const readOnly = check(
      run(
        {},
        {
          databaseDir: probe("/var/lib/headscale", { isFile: false, writable: false }),
          databaseFile: probe("/var/lib/headscale/db.sqlite"),
        },
      ),
      "configDatabase",
    );
    expect(readOnly.status).toBe("fail");
    expect(readOnly.bodyKey).toBe("settings.system.configChecks.database.readOnlyDir");
  });

  test("warns about a missing SQLite file but passes once it exists", () => {
    const missing = check(
      run(
        { database: { sqlite: { path: "/data/db.sqlite" } } },
        {
          databaseDir: probe("/data", { isFile: false, writable: true }),
          databaseFile: probe("/data/db.sqlite", { exists: false, readable: false }),
        },
      ),
      "configDatabase",
    );

    expect(missing.status).toBe("warning");
    expect(missing.bodyKey).toBe("settings.system.configChecks.database.missingFile");
    expect(missing.vars).toEqual({ path: "/data/db.sqlite" });

    const ready = check(
      run(
        { database: { sqlite: { path: "/data/db.sqlite" } } },
        {
          databaseDir: probe("/data", { isFile: false, writable: true }),
          databaseFile: probe("/data/db.sqlite"),
        },
      ),
      "configDatabase",
    );
    expect(ready.status).toBe("pass");
    expect(ready.vars).toEqual({ path: "/data/db.sqlite" });
  });

  test("passes when the policy lives in the database", () => {
    const entry = check(run({ policy: { mode: "database" } }), "configPolicy");

    expect(entry.status).toBe("pass");
    expect(entry.bodyKey).toBe("settings.system.configChecks.policy.database");
  });

  test("warns when a file policy has no path or an empty file", () => {
    const withoutPath = check(run({ policy: { mode: "file" } }), "configPolicy");
    expect(withoutPath.status).toBe("warning");
    expect(withoutPath.bodyKey).toBe("settings.system.configChecks.policy.missingPath");
    expect(withoutPath.link?.to).toBe("/settings/headscale");

    const empty = check(
      run(
        { policy: { mode: "file", path: "/etc/headscale/policy.hujson" } },
        {
          policyFile: probe("/etc/headscale/policy.hujson", { size: 0 }),
        },
      ),
      "configPolicy",
    );
    expect(empty.status).toBe("warning");
    expect(empty.bodyKey).toBe("settings.system.configChecks.policy.empty");
    expect(empty.vars).toEqual({ path: "/etc/headscale/policy.hujson" });
  });

  test("fails when the policy file is missing or unreadable", () => {
    const missing = check(
      run(
        { policy: { mode: "file", path: "/etc/headscale/policy.hujson" } },
        {
          policyFile: probe("/etc/headscale/policy.hujson", { exists: false, readable: false }),
        },
      ),
      "configPolicy",
    );

    expect(missing.status).toBe("fail");
    expect(missing.bodyKey).toBe("settings.system.configChecks.policy.missingFile");

    const unreadable = check(
      run(
        { policy: { mode: "file", path: "/etc/headscale/policy.hujson" } },
        {
          policyFile: probe("/etc/headscale/policy.hujson", { readable: false }),
        },
      ),
      "configPolicy",
    );
    expect(unreadable.status).toBe("fail");
    expect(unreadable.bodyKey).toBe("settings.system.configChecks.policy.unreadable");
  });

  test("passes a readable, non-empty policy file", () => {
    const entry = check(
      run(
        { policy: { mode: "file", path: "/etc/headscale/policy.hujson" } },
        {
          policyFile: probe("/etc/headscale/policy.hujson"),
        },
      ),
      "configPolicy",
    );

    expect(entry.status).toBe("pass");
    expect(entry.vars).toEqual({ path: "/etc/headscale/policy.hujson" });
  });

  test("warns when inline DNS records are shadowed by a records file", () => {
    const entry = check(
      run({
        dns: {
          extra_records: [{ name: "example.com", type: "A", value: "10.0.0.1" }],
          extra_records_path: "/etc/headscale/dns.json",
        },
      }),
      "configDnsRecords",
    );

    expect(entry.status).toBe("warning");
    expect(entry.bodyKey).toBe("settings.system.configChecks.dns.conflict");
    expect(entry.vars).toEqual({ path: "/etc/headscale/dns.json" });
    expect(entry.link?.to).toBe("/dns");

    expect(
      check(
        run({
          dns: { extra_records: [{ name: "example.com", type: "A", value: "10.0.0.1" }] },
        }),
        "configDnsRecords",
      ).status,
    ).toBe("pass");
    expect(
      check(run({ dns: { extra_records_path: "/etc/headscale/dns.json" } }), "configDnsRecords")
        .status,
    ).toBe("pass");
  });

  test("fails an OIDC block that cannot work", () => {
    const issuerOnly = check(run({ oidc: { issuer: "https://id.example.com" } }), "configOidc");
    expect(issuerOnly.status).toBe("fail");
    expect(issuerOnly.bodyKey).toBe("settings.system.configChecks.oidc.missingClientId");
    expect(issuerOnly.vars).toEqual({ issuer: "https://id.example.com" });

    const clientOnly = check(run({ oidc: { client_id: "headplane" } }), "configOidc");
    expect(clientOnly.status).toBe("fail");
    expect(clientOnly.bodyKey).toBe("settings.system.configChecks.oidc.missingIssuer");
    expect(clientOnly.vars).toEqual({ clientId: "headplane" });

    const badPkce = check(
      run({
        oidc: { issuer: "https://id.example.com", client_id: "x", pkce: { method: "HS256" } },
      }),
      "configOidc",
    );
    expect(badPkce.status).toBe("fail");
    expect(badPkce.bodyKey).toBe("settings.system.configChecks.oidc.badPkce");
    expect(badPkce.vars).toEqual({ method: "HS256" });
  });

  test("warns when both OIDC client secret sources are set", () => {
    const entry = check(
      run({
        oidc: {
          issuer: "https://id.example.com",
          client_id: "x",
          client_secret: "secret",
          client_secret_path: "/etc/headscale/oidc.secret",
          pkce: { method: "S256" },
        },
      }),
      "configOidc",
    );

    expect(entry.status).toBe("warning");
    expect(entry.bodyKey).toBe("settings.system.configChecks.oidc.secrets");
    expect(entry.link?.to).toBe("/settings/headscale");
  });

  test("passes a coherent OIDC block and a missing one", () => {
    expect(
      check(
        run({
          oidc: { issuer: "https://id.example.com", client_id: "x", pkce: { method: "plain" } },
        }),
        "configOidc",
      ).status,
    ).toBe("pass");
    expect(check(run({}), "configOidc").status).toBe("pass");
  });

  test("warns about a missing Noise key on a first start and fails afterwards", () => {
    const config = { noise: { private_key_path: "/var/lib/headscale/noise_private.key" } };

    const firstStart = check(
      run(config, {
        databaseFile: probe("/var/lib/headscale/db.sqlite", { exists: false, readable: false }),
        noiseKey: probe("/var/lib/headscale/noise_private.key", { exists: false, readable: false }),
      }),
      "configNoiseKey",
    );
    expect(firstStart.status).toBe("warning");
    expect(firstStart.bodyKey).toBe("settings.system.configChecks.noise.firstStart");
    expect(firstStart.vars).toEqual({ path: "/var/lib/headscale/noise_private.key" });

    const existingDatabase = check(
      run(config, {
        databaseFile: probe("/var/lib/headscale/db.sqlite"),
        noiseKey: probe("/var/lib/headscale/noise_private.key", { exists: false, readable: false }),
      }),
      "configNoiseKey",
    );
    expect(existingDatabase.status).toBe("fail");
    expect(existingDatabase.bodyKey).toBe("settings.system.configChecks.noise.fail");
  });

  test("passes a Noise key that exists or one kept in the database", () => {
    expect(check(run({}), "configNoiseKey").bodyKey).toBe(
      "settings.system.configChecks.noise.database",
    );

    const entry = check(
      run(
        { noise: { private_key_path: "/var/lib/headscale/noise_private.key" } },
        {
          noiseKey: probe("/var/lib/headscale/noise_private.key"),
        },
      ),
      "configNoiseKey",
    );
    expect(entry.status).toBe("pass");
    expect(entry.vars).toEqual({ path: "/var/lib/headscale/noise_private.key" });
  });

  test("only asks the loader to probe the paths the config actually uses", () => {
    expect(configProbeTargets({})).toEqual({ databaseFile: DEFAULT_SQLITE_PATH });
    expect(configProbeTargets({ database: { type: "postgres" } })).toEqual({});
    expect(configProbeTargets({ policy: { mode: "database", path: "/tmp/policy" } })).toEqual({
      databaseFile: DEFAULT_SQLITE_PATH,
    });
    expect(
      configProbeTargets({
        tls_cert_path: "/tls.crt",
        tls_key_path: "/tls.key",
        trusted_proxies: ["10.0.0.0/8"],
        noise: { private_key_path: "/noise.key" },
        policy: { mode: "file", path: "/policy.hujson" },
        database: { sqlite: { path: "/data/db.sqlite" } },
      }),
    ).toEqual({
      tlsCert: "/tls.crt",
      tlsKey: "/tls.key",
      noiseKey: "/noise.key",
      policyFile: "/policy.hujson",
      databaseFile: "/data/db.sqlite",
    });
  });
});

describe("config file probes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-config-checks-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeConfig(lines: string[]): Promise<string> {
    const path = join(dir, "config.yaml");
    await writeFile(path, lines.join("\n"));
    return path;
  }

  test("degrades to no checks for a missing, unreadable, or unparsable file", async () => {
    expect(await loadConfigChecks(undefined)).toEqual([]);
    expect(await loadConfigChecks(join(dir, "missing.yaml"))).toEqual([]);

    const broken = join(dir, "broken.yaml");
    await writeFile(broken, "server_url: [unclosed\n");
    expect(await loadConfigChecks(broken)).toEqual([]);
  });

  test("passes against a real, healthy config file", async () => {
    const policyPath = join(dir, "policy.hujson");
    const noisePath = join(dir, "noise_private.key");
    const dataDir = join(dir, "data");
    await mkdir(dataDir);
    await writeFile(policyPath, '{"acls": []}');
    await writeFile(noisePath, "noise-key");

    const path = await writeConfig([
      "server_url: https://headscale.example.com",
      "trusted_proxies:",
      "  - 10.0.0.0/8",
      "policy:",
      "  mode: file",
      `  path: ${policyPath}`,
      "database:",
      "  type: sqlite",
      "  sqlite:",
      `    path: ${join(dataDir, "db.sqlite")}`,
      "noise:",
      `  private_key_path: ${noisePath}`,
    ]);

    const checks = await loadConfigChecks(path);
    expect(checks.map((entry) => entry.id)).toEqual(CHECK_IDS);
    // The SQLite file itself does not exist yet, which is a warning, not a
    // failure: Headscale creates it on first start.
    expect(checks.map((entry) => entry.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "warning",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(check(checks, "configDatabase").bodyKey).toBe(
      "settings.system.configChecks.database.missingFile",
    );
    expect(check(checks, "configPolicy").vars).toEqual({ path: policyPath });
    expect(check(checks, "configNoiseKey").vars).toEqual({ path: noisePath });
  });

  test("probes the real filesystem for missing and empty files", async () => {
    const emptyPolicy = join(dir, "policy.hujson");
    await writeFile(emptyPolicy, "");

    const path = await writeConfig([
      "policy:",
      "  mode: file",
      `  path: ${emptyPolicy}`,
      "database:",
      "  sqlite:",
      `    path: ${join(dir, "missing-dir", "db.sqlite")}`,
      "noise:",
      `  private_key_path: ${join(dir, "missing.key")}`,
      "oidc:",
      "  issuer: https://id.example.com",
    ]);

    const checks = await loadConfigChecks(path);

    expect(check(checks, "configPolicy").bodyKey).toBe("settings.system.configChecks.policy.empty");
    expect(check(checks, "configDatabase").bodyKey).toBe(
      "settings.system.configChecks.database.missingDir",
    );
    // The database directory is missing, so the missing Noise key is still a
    // failure only because the database file probe is "missing" too -- the
    // first-start warning needs a database that exists.
    expect(check(checks, "configNoiseKey").bodyKey).toBe(
      "settings.system.configChecks.noise.firstStart",
    );
    expect(check(checks, "configOidc").bodyKey).toBe(
      "settings.system.configChecks.oidc.missingClientId",
    );
  });

  test("never throws for a config that points at unreadable paths", async () => {
    const path = await writeConfig([
      `tls_cert_path: ${join(dir, "missing.crt")}`,
      `tls_key_path: ${join(dir, "missing.key")}`,
      "trusted_proxies:",
      "  - 0.0.0.0/0",
      "dns:",
      "  extra_records:",
      "    - name: example.com",
      "      type: A",
      "      value: 10.0.0.1",
      "  extra_records_path: /etc/headscale/dns.json",
    ]);

    const checks = await loadConfigChecks(path);

    expect(check(checks, "configTls").status).toBe("fail");
    expect(check(checks, "configTrustedProxies").vars).toEqual({ proxies: "0.0.0.0/0" });
    expect(check(checks, "configDnsRecords").status).toBe("warning");
  });
});
