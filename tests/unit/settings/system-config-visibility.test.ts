import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  computeConfigChecks,
  type ConfigCheck,
  type ConfigProbe,
} from "~/routes/settings/system/config-checks";
import { loadConfigChecks } from "~/routes/settings/system/config-probe";

// A container running Headplane usually gets Headscale's config file but not the
// host directories that file points at, so every path inside it looks missing.
// Reporting that as a failure told operators of perfectly healthy servers that
// their database directory does not exist.

function probe(path: string, extra: Partial<ConfigProbe> = {}): ConfigProbe {
  return { path, exists: false, readable: false, ...extra };
}

function find(checks: ConfigCheck[], id: string): ConfigCheck {
  const check = checks.find((entry) => entry.id === id);
  if (!check) throw new Error(`No check with id ${id}`);
  return check;
}

const SQLITE_CONFIG = {
  database: { type: "sqlite", sqlite: { path: "/data/headscale/db.sqlite" } },
};

describe("unverifiable config paths", () => {
  test("an invisible database directory is unverifiable, not missing", () => {
    const checks = computeConfigChecks({
      config: SQLITE_CONFIG,
      probes: {
        databaseDir: probe("/data/headscale", { unavailable: true, writable: false }),
        databaseFile: probe("/data/headscale/db.sqlite", { unavailable: true }),
      },
    });

    const database = find(checks, "configDatabase");
    expect(database.status).toBe("warning");
    expect(database.bodyKey).toBe("settings.system.configChecks.pathUnavailable");
    expect(database.vars).toMatchObject({ path: "/data/headscale" });
  });

  test("a database directory that really is missing still fails", () => {
    const checks = computeConfigChecks({
      config: SQLITE_CONFIG,
      probes: {
        databaseDir: probe("/data/headscale", { writable: false }),
        databaseFile: probe("/data/headscale/db.sqlite"),
      },
    });

    const database = find(checks, "configDatabase");
    expect(database.status).toBe("fail");
    expect(database.bodyKey).toBe("settings.system.configChecks.database.missingDir");
  });

  test("other unverifiable paths degrade to warnings as well", () => {
    const checks = computeConfigChecks({
      config: {
        ...SQLITE_CONFIG,
        policy: { mode: "file", path: "/etc/headscale/policy.hujson" },
        tls_cert_path: "/etc/headscale/tls.crt",
        noise: { private_key_path: "/var/lib/headscale/noise_private.key" },
      },
      probes: {
        databaseDir: probe("/data/headscale", { exists: true, readable: true, writable: true }),
        databaseFile: probe("/data/headscale/db.sqlite", {
          exists: true,
          readable: true,
          isFile: true,
        }),
        policyFile: probe("/etc/headscale/policy.hujson", { unavailable: true }),
        tlsCert: probe("/etc/headscale/tls.crt", { unavailable: true }),
        noiseKey: probe("/var/lib/headscale/noise_private.key", { unavailable: true }),
      },
    });

    for (const id of ["configPolicy", "configTls", "configNoiseKey"]) {
      const check = find(checks, id);
      expect(check.status, id).toBe("warning");
      expect(check.bodyKey, id).toBe("settings.system.configChecks.pathUnavailable");
    }

    // The database itself is visible here, so it still passes.
    expect(find(checks, "configDatabase").status).toBe("pass");
  });

  test("a passing check is never rewritten by an unrelated invisible path", () => {
    const checks = computeConfigChecks({
      config: { ...SQLITE_CONFIG, policy: { mode: "database" } },
      probes: {
        databaseDir: probe("/data/headscale", { exists: true, readable: true, writable: true }),
        databaseFile: probe("/data/headscale/db.sqlite", { exists: true, readable: true }),
        policyFile: probe("/etc/headscale/policy.hujson", { unavailable: true }),
      },
    });

    expect(find(checks, "configPolicy").status).toBe("pass");
  });
});

describe("probing paths from inside a container", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-config-visibility-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("a path under a directory this process cannot see is unverifiable", async () => {
    const configPath = join(dir, "config.yaml");
    await writeFile(
      configPath,
      [
        "server_url: http://localhost:8080",
        // `missing-parent` is never created, which is what an unmounted host
        // directory looks like from inside the container.
        "database:",
        "  type: sqlite",
        "  sqlite:",
        `    path: ${join(dir, "missing-parent", "deeper", "db.sqlite")}`,
      ].join("\n"),
    );

    const checks = await loadConfigChecks(configPath);
    const database = find(checks, "configDatabase");

    expect(database.status).toBe("warning");
    expect(database.bodyKey).toBe("settings.system.configChecks.pathUnavailable");
  });

  test("a database file missing from a visible directory is still a first start", async () => {
    const configPath = join(dir, "config.yaml");
    await writeFile(
      configPath,
      [
        "server_url: http://localhost:8080",
        "database:",
        "  type: sqlite",
        "  sqlite:",
        `    path: ${join(dir, "db.sqlite")}`,
      ].join("\n"),
    );

    const checks = await loadConfigChecks(configPath);
    const database = find(checks, "configDatabase");

    expect(database.status).toBe("warning");
    expect(database.bodyKey).toBe("settings.system.configChecks.database.missingFile");
  });
});
