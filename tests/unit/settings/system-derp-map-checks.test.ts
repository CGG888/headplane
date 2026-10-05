import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { DerpMapCheckInput } from "~/routes/settings/headscale/derp-map-checks";
import {
  computeConfigChecks,
  configDerpMapPaths,
  type ConfigCheck,
  type ConfigCheckId,
} from "~/routes/settings/system/config-checks";
import { loadConfigChecks } from "~/routes/settings/system/config-probe";

// The DERP card has always shown one set of verdicts per configured
// `derp.paths` entry. The system page's configuration list now shows the same
// checks, computed by the same engine, and the card is untouched.

const EXISTING_IDS: ConfigCheckId[] = [
  "configOidcKeys",
  "configTrustedProxies",
  "configTls",
  "configDatabase",
  "configPolicy",
  "configDnsRecords",
  "configOidc",
  "configNoiseKey",
  "configDerpIpv4Resolvable",
  "configDerpIpv6Resolvable",
];

const DERP_IDS = ["exists", "readable", "writable", "size", "parses", "schema", "unique"] as const;

const VALID_MAP = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes:
      - name: "901a"
        regionid: 901
        hostname: derp-ams.example.com
        derpport: 443
        stunport: 3478
        ipv4: 198.51.100.10
`;

const MAP_PATH = "/etc/headscale/derp/ams.yaml";

/** The inspection results a healthy, readable map produces. */
function inspected(overrides: Partial<DerpMapCheckInput> = {}): DerpMapCheckInput {
  return {
    path: MAP_PATH,
    exists: true,
    isFile: true,
    readable: true,
    writable: true,
    tooLarge: false,
    unavailable: false,
    issues: [],
    ...overrides,
  };
}

function run(derpMaps?: readonly DerpMapCheckInput[]): ConfigCheck[] {
  return computeConfigChecks({ config: {}, probes: {}, derpMaps });
}

function derpRows(checks: readonly ConfigCheck[]): ConfigCheck[] {
  return checks.filter((entry) => (DERP_IDS as readonly string[]).includes(entry.id));
}

function byId(checks: readonly ConfigCheck[], id: ConfigCheckId): ConfigCheck {
  const found = checks.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Missing config check: ${id}`);
  }

  return found;
}

describe("DERP map checks in the configuration list", () => {
  test("appends one row per verdict, with the card's ids and statuses", () => {
    const checks = run([inspected()]);
    const rows = derpRows(checks);

    expect(rows.map((entry) => entry.id)).toEqual([...DERP_IDS]);
    expect(rows.every((entry) => entry.status === "pass")).toBe(true);

    // The bodies are the card's own; only the titles belong to this list, and
    // every one of them names the file it is about.
    for (const row of rows) {
      expect(row.bodyKey.startsWith("settings.headscale.derp.mapChecks.")).toBe(true);
      expect(row.titleKey.startsWith("settings.system.configChecks.derpMap.")).toBe(true);
      expect(row.vars).toMatchObject({ path: MAP_PATH });
    }
  });

  test("keeps every existing check first, in order, and appends the DERP rows", () => {
    const checks = run([inspected()]);

    expect(checks.slice(0, EXISTING_IDS.length).map((entry) => entry.id)).toEqual(EXISTING_IDS);
    expect(checks).toHaveLength(EXISTING_IDS.length + DERP_IDS.length);
  });

  test("carries the card's verdicts through for a broken map", () => {
    const checks = run([inspected({ issues: [{ code: "derpNodeMissingHostname", line: 4 }] })]);

    expect(byId(checks, "schema")).toMatchObject({
      status: "fail",
      bodyKey: "settings.headscale.derp.mapChecks.schema.fail",
      vars: { path: MAP_PATH, line: 4, column: 1 },
    });
    expect(byId(checks, "parses").status).toBe("pass");
  });

  test("reports a missing map as a warning, exactly like the card", () => {
    const checks = run([
      inspected({ exists: false, isFile: false, readable: false, writable: false }),
    ]);

    expect(byId(checks, "exists")).toMatchObject({
      status: "warning",
      bodyKey: "settings.headscale.derp.mapChecks.exists.missing",
    });
    expect(byId(checks, "readable").status).toBe("warning");
  });

  test("downgrades an invisible path to the cannot-check wording", () => {
    const checks = run([
      inspected({
        exists: false,
        isFile: false,
        readable: false,
        writable: false,
        unavailable: true,
      }),
    ]);

    const problems = derpRows(checks).filter((entry) => entry.status !== "pass");
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.status).toBe("warning");
      expect(problem.bodyKey).toBe("settings.system.configChecks.pathUnavailable");
      expect(problem.vars).toMatchObject({ path: MAP_PATH });
    }
  });

  test("adds nothing when no map path is configured", () => {
    expect(run()).toHaveLength(EXISTING_IDS.length);
    expect(run([])).toHaveLength(EXISTING_IDS.length);
    expect(derpRows(computeConfigChecks({ config: { derp: { paths: [] } }, probes: {} }))).toEqual(
      [],
    );
  });

  test("keeps one row per configured path", () => {
    const checks = run([inspected(), inspected({ path: "/etc/headscale/derp/fra.yaml" })]);

    expect(checks).toHaveLength(EXISTING_IDS.length + DERP_IDS.length * 2);
    expect(checks.filter((entry) => entry.id === "exists")).toHaveLength(2);
  });
});

describe("configDerpMapPaths", () => {
  test("reads derp.paths and nothing else", () => {
    expect(configDerpMapPaths({})).toEqual([]);
    expect(configDerpMapPaths({ derp: {} })).toEqual([]);
    expect(configDerpMapPaths({ derp: { paths: "/etc/headscale/derp/a.yaml" } })).toEqual([
      "/etc/headscale/derp/a.yaml",
    ]);
    expect(
      configDerpMapPaths({ derp: { paths: [" /a.yaml ", "", "b.yaml"], urls: ["https://x"] } }),
    ).toEqual(["/a.yaml", "b.yaml"]);
  });
});

describe("inspecting derp.paths from a config file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-system-derp-checks-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeConfig(paths: string[]): Promise<string> {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      ["derp:", "  paths:", ...paths.map((entry) => `    - ${entry}`)].join("\n"),
    );
    return path;
  }

  test("reports the real map file the configuration points at", async () => {
    const mapPath = join(dir, "ams.yaml");
    await writeFile(mapPath, VALID_MAP);
    const configPath = await writeConfig([mapPath]);

    const checks = await loadConfigChecks(configPath, { includeDerpMaps: true });
    const rows = derpRows(checks);

    expect(rows.map((entry) => entry.id)).toEqual([...DERP_IDS]);
    expect(rows.every((entry) => entry.status === "pass")).toBe(true);
    expect(byId(checks, "exists").vars).toMatchObject({ path: mapPath });
  });

  test("a map path this process cannot see reads as cannot-check", async () => {
    // Nothing under this tree exists all the way up to the root, which is what
    // an unmounted host directory looks like from inside a container.
    const invisible = "/vol1/@appdata/headscale/derp-maps/ams.yaml";
    const configPath = await writeConfig([invisible]);

    const checks = await loadConfigChecks(configPath, { includeDerpMaps: true });
    const problems = derpRows(checks).filter((entry) => entry.status !== "pass");

    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.status).toBe("warning");
      expect(problem.bodyKey).toBe("settings.system.configChecks.pathUnavailable");
      expect(problem.vars).toMatchObject({ path: invisible });
    }
  });

  test("other readers of the list are not handed the DERP map checks", async () => {
    const mapPath = join(dir, "ams.yaml");
    await writeFile(mapPath, VALID_MAP);
    const configPath = await writeConfig([mapPath]);

    const checks = await loadConfigChecks(configPath);
    expect(checks.map((entry) => entry.id)).toEqual(EXISTING_IDS);
  });

  test("an unreadable configuration file still yields nothing, DERP maps or not", async () => {
    expect(await loadConfigChecks(join(dir, "missing.yaml"), { includeDerpMaps: true })).toEqual(
      [],
    );
    expect(await loadConfigChecks(undefined, { includeDerpMaps: true })).toEqual([]);
  });
});
