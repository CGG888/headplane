import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { findFatalOidcKeys } from "~/routes/settings/headscale/config-warnings";

describe("Headscale config warnings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-config-warnings-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reports the OIDC keys Headscale 0.29 refuses to start with", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      [
        "oidc:",
        "  issuer: https://accounts.example.com",
        "  expiry: 24h",
        "  map_legacy_users: true",
        "node:",
        "  expiry: 180d",
      ].join("\n"),
    );

    expect(await findFatalOidcKeys(path)).toEqual(["oidc.expiry", "oidc.map_legacy_users"]);
  });

  test("reports nothing for a supported configuration", async () => {
    const path = join(dir, "config.yaml");
    await writeFile(
      path,
      ["oidc:", "  issuer: https://accounts.example.com", "node:", "  expiry: 180d"].join("\n"),
    );

    expect(await findFatalOidcKeys(path)).toEqual([]);
  });

  test("degrades to no warning when the file cannot be inspected", async () => {
    expect(await findFatalOidcKeys(undefined)).toEqual([]);
    expect(await findFatalOidcKeys(join(dir, "missing.yaml"))).toEqual([]);
  });
});
