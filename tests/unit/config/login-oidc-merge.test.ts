import { resolve } from "node:path";

import { dump } from "js-yaml";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadConfig } from "~/server/config/load";
import { LOGIN_OIDC_FILE } from "~/server/headplane-store/login-oidc";

import { clearFakeFiles, createFakeFile } from "../setup/overlay-fs";

const CONFIG_PATH = "/config/login-oidc-merge.yaml";
const DATA_PATH = "/data/login-oidc";
const STORE_PATH = resolve(DATA_PATH, LOGIN_OIDC_FILE);

const ENV_KEYS = [
  "HEADPLANE_CONFIG_PATH",
  "HEADPLANE_OIDC__ISSUER",
  "HEADPLANE_OIDC__SCOPE",
  "HEADPLANE_OIDC__CLIENT_SECRET",
];

function writeConfig(oidc: Record<string, unknown>) {
  createFakeFile(
    CONFIG_PATH,
    dump({
      headscale: { url: "http://headscale:8080" },
      server: { cookie_secret: "thirtytwo-character-cookiesecret", data_path: DATA_PATH },
      oidc,
    }),
  );
}

function writeSaved(settings: Record<string, unknown>) {
  createFakeFile(STORE_PATH, JSON.stringify({ version: 1, settings }));
}

describe("the saved console-login layer inside loadConfig", () => {
  beforeEach(() => {
    clearFakeFiles();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    process.env.HEADPLANE_CONFIG_PATH = CONFIG_PATH;
    writeConfig({
      enabled: true,
      issuer: "https://file.example.com",
      client_id: "file-client",
      client_secret: "file-secret",
      scope: "openid profile email",
    });
  });

  afterEach(() => {
    clearFakeFiles();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  test("without a saved document the config file is used", async () => {
    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.issuer).toBe("https://file.example.com");
    expect(config.oidc?.scope).toBe("openid profile email");
  });

  test("a saved value overrides the config file", async () => {
    writeSaved({ issuer: "https://saved.example.com", scope: "openid" });

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.issuer).toBe("https://saved.example.com");
    expect(config.oidc?.scope).toBe("openid");
    expect(config.oidc?.client_id).toBe("file-client");
  });

  test("an environment variable overrides a saved value", async () => {
    writeSaved({ issuer: "https://saved.example.com" });
    process.env.HEADPLANE_OIDC__ISSUER = "https://env.example.com";

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.issuer).toBe("https://env.example.com");
  });

  test("a saved client secret replaces the file's secret-path indirection", async () => {
    createFakeFile("/run/secrets/oidc_client_secret", "from-a-file");
    writeConfig({
      enabled: true,
      issuer: "https://file.example.com",
      client_id: "file-client",
      client_secret_path: "/run/secrets/oidc_client_secret",
      scope: "openid profile email",
    });
    writeSaved({ client_secret: "saved-secret" });

    const config = await loadConfig(CONFIG_PATH);

    // Both keys at once is a hard startup error, so the newer one wins.
    expect(config.oidc?.client_secret).toBe("saved-secret");
  });

  test("a saved logout_idp replaces the file's legacy use_end_session", async () => {
    writeConfig({
      enabled: true,
      issuer: "https://file.example.com",
      client_id: "file-client",
      client_secret: "file-secret",
      scope: "openid profile email",
      use_end_session: true,
    });
    writeSaved({ logout_idp: false });

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.logout_idp).toBe(false);
    // The schema re-applies the legacy default, so the switch is off on both
    // spellings: the saved value is the one that survives.
    expect(config.oidc?.use_end_session).toBe(false);
  });

  test("the legacy use_end_session still works when nothing overrides it", async () => {
    writeConfig({
      enabled: true,
      issuer: "https://file.example.com",
      client_id: "file-client",
      client_secret: "file-secret",
      scope: "openid profile email",
      use_end_session: true,
    });

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.use_end_session).toBe(true);
  });

  test("a saved document that the schema rejects never stops a start", async () => {
    // Hand-edited garbage that no validation let through: the file is used.
    writeSaved({ default_role: "superuser" });

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.default_role).toBe("member");
    expect(config.oidc?.issuer).toBe("https://file.example.com");
  });

  test("a corrupt saved document is ignored", async () => {
    createFakeFile(STORE_PATH, "{ not json");

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc?.issuer).toBe("https://file.example.com");
  });

  test("a saved layer that cannot be valid at all is dropped, not fatal", async () => {
    // No `oidc:` block exists to complete it, so a saved `enabled` alone would
    // fail the schema's required issuer/client_id; the layer is dropped and the
    // start continues instead of the console refusing to boot.
    createFakeFile(
      CONFIG_PATH,
      dump({
        headscale: { url: "http://headscale:8080" },
        server: { cookie_secret: "thirtytwo-character-cookiesecret", data_path: DATA_PATH },
      }),
    );
    writeSaved({ enabled: false });

    const config = await loadConfig(CONFIG_PATH);

    expect(config.oidc).toBeUndefined();
  });
});
