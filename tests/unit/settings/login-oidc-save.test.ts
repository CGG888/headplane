import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dump } from "js-yaml";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  readLoginOidcSnapshot,
  saveLoginOidcSettings,
  type LoginOidcEdit,
} from "~/routes/settings/login/overrides.server";
import {
  LOGIN_OIDC_FILE,
  loginOidcPath,
  readLoginOidcDocument,
  readLoginOidcSettings,
} from "~/server/headplane-store/login-oidc";

import { clearFakeFiles, createFakeFile } from "../setup/overlay-fs";

const CONFIG_PATH = "/config/login-oidc-save.yaml";

const FILE_OIDC = {
  enabled: true,
  issuer: "https://file.example.com",
  client_id: "file-client",
  client_secret: "file-secret",
  scope: "openid profile email",
};

const OPEN = { disableApiKeyLogin: false, proxyAuthEnabled: false };
const ONLY_OIDC = { disableApiKeyLogin: true, proxyAuthEnabled: false };

const ENV_KEYS = [
  "HEADPLANE_CONFIG_PATH",
  "HEADPLANE_OIDC__ISSUER",
  "HEADPLANE_OIDC__SCOPE",
  "HEADPLANE_OIDC__CLIENT_SECRET",
];

function writeConfig(oidc: Record<string, unknown> | undefined) {
  createFakeFile(
    CONFIG_PATH,
    dump({
      headscale: { url: "http://headscale:8080" },
      server: { cookie_secret: "thirtytwo-character-cookiesecret" },
      ...(oidc === undefined ? {} : { oidc }),
    }),
  );
}

function edit(overrides: Partial<LoginOidcEdit> = {}): LoginOidcEdit {
  return {
    posted: [],
    values: {},
    secret: { kind: "keep" },
    confirm: false,
    ...overrides,
  };
}

describe("saving console login overrides", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-login-oidc-save-"));
    clearFakeFiles();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    process.env.HEADPLANE_CONFIG_PATH = CONFIG_PATH;
    writeConfig(FILE_OIDC);
  });

  afterEach(async () => {
    clearFakeFiles();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await rm(dir, { recursive: true, force: true });
  });

  test("a change is stored in HeadplaneCN's data directory, not the config file", async () => {
    const result = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["issuer"], values: { issuer: "https://saved.example.com" } }),
    });

    expect(result).toEqual({ state: "saved", changed: ["issuer"] });
    expect(await readLoginOidcSettings(dir)).toEqual({ issuer: "https://saved.example.com" });
    expect(loginOidcPath(dir).endsWith(LOGIN_OIDC_FILE)).toBe(true);
  });

  test("the saved value takes effect for the page's effective configuration", async () => {
    await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["issuer"], values: { issuer: "https://saved.example.com" } }),
    });

    const snapshot = await readLoginOidcSnapshot({
      dataPath: dir,
      // What a running process has: the validated configuration, defaults
      // included, which is what makes the comparison meaningful.
      runningOidc: {
        enabled: true,
        issuer: FILE_OIDC.issuer,
        client_id: FILE_OIDC.client_id,
        client_secret: FILE_OIDC.client_secret,
        scope: FILE_OIDC.scope,
        use_pkce: false,
        default_role: "member",
        logout_idp: false,
      },
      context: OPEN,
    });

    expect(snapshot.merged.issuer).toBe("https://saved.example.com");
    expect(snapshot.view.fields.find((field) => field.id === "issuer")?.source).toBe("saved");
    // The running process still has the file's value, so a restart is required.
    expect(snapshot.restartFields).toEqual(["issuer"]);
    expect(snapshot.view.restartRequired).toBe(true);
  });

  test("a field the environment pins is left alone", async () => {
    process.env.HEADPLANE_OIDC__ISSUER = "https://env.example.com";

    const result = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["issuer"], values: { issuer: "https://saved.example.com" } }),
    });

    expect(result).toEqual({ state: "saved", changed: [] });
    expect((await readLoginOidcDocument(dir)).settings).toEqual({});
  });

  test("a secret is stored, kept when the field is left empty, and replaced on request", async () => {
    const replaced = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ secret: { kind: "replace", value: "saved-secret" } }),
    });
    expect(replaced).toEqual({ state: "saved", changed: ["client_secret"] });
    expect((await readLoginOidcDocument(dir)).settings.client_secret).toBe("saved-secret");

    const kept = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["scope"], values: { scope: "openid" } }),
    });
    expect(kept).toEqual({ state: "saved", changed: ["scope"] });
    expect((await readLoginOidcDocument(dir)).settings.client_secret).toBe("saved-secret");

    const replacedAgain = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ secret: { kind: "replace", value: "second-secret" } }),
    });
    expect(replacedAgain).toEqual({ state: "saved", changed: ["client_secret"] });
    expect((await readLoginOidcDocument(dir)).settings.client_secret).toBe("second-secret");
  });

  test("the stored secret can be cleared, falling back to the config file", async () => {
    await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ secret: { kind: "replace", value: "saved-secret" } }),
    });

    const cleared = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ secret: { kind: "clear" } }),
    });

    expect(cleared).toEqual({ state: "saved", changed: ["client_secret"] });
    expect((await readLoginOidcDocument(dir)).settings.client_secret).toBeUndefined();

    // The file's secret is the effective one again, so nothing is broken.
    const snapshot = await readLoginOidcSnapshot({
      dataPath: dir,
      runningOidc: {},
      context: OPEN,
    });
    expect(snapshot.merged.client_secret).toBe("file-secret");
    expect(snapshot.view.fields.find((field) => field.id === "client_secret")?.secretSet).toBe(
      true,
    );
  });

  test("clearing the last available secret is rejected instead of bricking the next start", async () => {
    // The file has no secret of its own, so the saved one is the only one.
    writeConfig({
      enabled: FILE_OIDC.enabled,
      issuer: FILE_OIDC.issuer,
      client_id: FILE_OIDC.client_id,
      scope: FILE_OIDC.scope,
    });

    await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ secret: { kind: "replace", value: "saved-secret" } }),
    });

    const cleared = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ secret: { kind: "clear" } }),
    });

    expect(cleared).toEqual({ state: "invalid", errors: ["missingClientSecret"] });
    expect((await readLoginOidcDocument(dir)).settings.client_secret).toBe("saved-secret");
  });

  test("a rejected value writes nothing", async () => {
    const result = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["issuer"], values: { issuer: "http://insecure.example.com" } }),
    });

    expect(result).toEqual({ state: "invalid", errors: ["invalidIssuer"] });
    expect((await readLoginOidcDocument(dir)).settings).toEqual({});
  });

  test("emptying a field clears the saved override", async () => {
    await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["scope"], values: { scope: "openid" } }),
    });

    const cleared = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["scope"] }),
    });

    expect(cleared).toEqual({ state: "saved", changed: ["scope"] });
    expect((await readLoginOidcDocument(dir)).settings).toEqual({});
  });

  test("removing the last way in is refused, with or without a confirmation", async () => {
    for (const confirm of [false, true]) {
      const result = await saveLoginOidcSettings({
        dataPath: dir,
        context: ONLY_OIDC,
        edit: edit({ posted: ["enabled"], values: { enabled: false }, confirm }),
      });

      expect(result).toMatchObject({ state: "refused", reasons: ["noWayIn"] });
    }

    expect((await readLoginOidcDocument(dir)).settings).toEqual({});
  });

  test("removing one way in needs confirmation before anything is written", async () => {
    const asked = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["enabled"], values: { enabled: false } }),
    });

    expect(asked).toMatchObject({
      state: "confirm",
      reasons: ["oidcDisabled"],
      remaining: { oidc: false, apiKey: true, proxy: false },
    });
    expect((await readLoginOidcDocument(dir)).settings).toEqual({});

    const confirmed = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["enabled"], values: { enabled: false }, confirm: true }),
    });

    expect(confirmed).toEqual({ state: "saved", changed: ["enabled"] });
    expect((await readLoginOidcDocument(dir)).settings).toEqual({ enabled: false });
  });

  test("an unwritable data directory is reported, never thrown", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    const result = await saveLoginOidcSettings({
      dataPath: blocker,
      context: OPEN,
      edit: edit({ posted: ["scope"], values: { scope: "openid" } }),
    });

    expect(result).toEqual({ state: "writeFailed" });
  });

  test("a corrupt stored document degrades to nothing saved", async () => {
    await writeFile(loginOidcPath(dir), "{ not json", "utf8");

    const snapshot = await readLoginOidcSnapshot({
      dataPath: dir,
      runningOidc: {},
      context: OPEN,
    });

    expect(snapshot.view.savedCount).toBe(0);
    expect(snapshot.merged.issuer).toBe(FILE_OIDC.issuer);

    const result = await saveLoginOidcSettings({
      dataPath: dir,
      context: OPEN,
      edit: edit({ posted: ["scope"], values: { scope: "openid" } }),
    });

    expect(result).toEqual({ state: "saved", changed: ["scope"] });
  });
});
