import { type } from "arktype";
import { describe, expect, test } from "vitest";

import {
  assessLoginLockout,
  buildLoginOidcFieldViews,
  diffLoginOidcSettings,
  LOGIN_OIDC_ENV_VARS,
  loginOidcRestartFields,
  mergeLoginOidcLayers,
  normalizeLoginOidcSettings,
  sanitizeLoginOidcSettings,
  validateLoginOidcSettings,
  type LoginOidcSettings,
  type LoginSignInContext,
} from "~/routes/settings/login/login-oidc";
import { headplaneConfig } from "~/server/config/config-schema";

const CREDENTIALS = {
  issuer: "https://idp.example.com",
  client_id: "headplane-console",
  client_secret: "a-client-secret",
  scope: "openid profile email",
} satisfies LoginOidcSettings;

const OPEN: LoginSignInContext = { disableApiKeyLogin: false, proxyAuthEnabled: false };
const ONLY_OIDC: LoginSignInContext = { disableApiKeyLogin: true, proxyAuthEnabled: false };
const ONLY_PROXY: LoginSignInContext = { disableApiKeyLogin: true, proxyAuthEnabled: true };

describe("console login settings precedence", () => {
  test("an environment variable beats a saved value, which beats the config file", () => {
    const merged = mergeLoginOidcLayers({
      env: { issuer: "https://env.example.com", scope: "openid" },
      saved: { issuer: "https://saved.example.com", client_id: "saved-client" },
      file: {
        issuer: "https://file.example.com",
        client_id: "file-client",
        scope: "openid profile email",
        default_role: "viewer",
      },
    });

    expect(merged.values.issuer).toBe("https://env.example.com");
    expect(merged.values.client_id).toBe("saved-client");
    expect(merged.values.scope).toBe("openid");
    expect(merged.values.default_role).toBe("viewer");

    expect(merged.sources.issuer).toBe("env");
    expect(merged.sources.client_id).toBe("saved");
    expect(merged.sources.scope).toBe("env");
    expect(merged.sources.default_role).toBe("file");
  });

  test("schema defaults fill the fields no layer supplies", () => {
    const merged = mergeLoginOidcLayers({});

    expect(merged.values).toMatchObject({
      enabled: true,
      scope: "openid email profile",
      use_pkce: false,
      default_role: "member",
      logout_idp: false,
    });
    expect(merged.sources.enabled).toBe("default");
    expect(merged.sources.issuer).toBe("unset");
    expect(merged.values.issuer).toBeUndefined();
  });

  test("an environment variable pins the field it supplies", () => {
    const merged = mergeLoginOidcLayers({
      env: { issuer: "https://env.example.com" },
      saved: { issuer: "https://saved.example.com" },
    });

    expect(merged.pinned).toEqual(["issuer"]);
    expect(merged.saved).toEqual(["issuer"]);

    const views = buildLoginOidcFieldViews(merged, OPEN);
    const issuer = views.fields.find((field) => field.id === "issuer");

    expect(issuer?.pinned).toBe(true);
    expect(issuer?.value).toBe("https://env.example.com");
    expect(issuer?.source).toBe("env");
    expect(views.envVars.issuer).toBe(LOGIN_OIDC_ENV_VARS.issuer);
  });

  test("the legacy use_end_session spelling is read as logout_idp", () => {
    const fromFile = mergeLoginOidcLayers({ file: { use_end_session: true } });
    expect(fromFile.values.logout_idp).toBe(true);
    expect(fromFile.sources.logout_idp).toBe("file");

    // A value saved on the page supersedes the legacy file key.
    const saved = mergeLoginOidcLayers({
      saved: { logout_idp: false },
      file: { use_end_session: true },
    });
    expect(saved.values.logout_idp).toBe(false);
    expect(saved.sources.logout_idp).toBe("saved");
  });

  test("a secret is reported as presence, never as a value", () => {
    const secret = "super-secret-value";
    const merged = mergeLoginOidcLayers({ saved: { client_secret: secret } });
    const views = buildLoginOidcFieldViews(merged, OPEN);
    const field = views.fields.find((entry) => entry.id === "client_secret");

    expect(field?.value).toBeNull();
    expect(field?.secretSet).toBe(true);
    expect(JSON.stringify(views)).not.toContain(secret);
  });

  test("malformed layers and values are dropped instead of poisoning the merge", () => {
    expect(normalizeLoginOidcSettings({ issuer: 5, enabled: "yes", scope: "openid" })).toEqual({
      scope: "openid",
    });
    expect(normalizeLoginOidcSettings("nonsense")).toEqual({});
    expect(sanitizeLoginOidcSettings({ issuer: "http://insecure", scope: "openid" })).toEqual({
      scope: "openid",
    });
  });
});

describe("console login validation", () => {
  test("an enabled configuration needs an issuer, a client id, scopes and a secret", () => {
    expect(validateLoginOidcSettings({ enabled: true }, { hasEffectiveSecret: false })).toEqual([
      "missingIssuer",
      "missingClientId",
      "missingScope",
      "missingClientSecret",
    ]);

    expect(validateLoginOidcSettings(CREDENTIALS, { hasEffectiveSecret: true })).toEqual([]);
  });

  test("a disabled configuration is not required to be complete", () => {
    expect(validateLoginOidcSettings({ enabled: false }, { hasEffectiveSecret: false })).toEqual(
      [],
    );
  });

  test("the issuer must be an absolute https URL", () => {
    const base = { ...CREDENTIALS, enabled: true };
    const options = { hasEffectiveSecret: true };

    expect(
      validateLoginOidcSettings({ ...base, issuer: "http://idp.example.com" }, options),
    ).toEqual(["invalidIssuer"]);
    expect(validateLoginOidcSettings({ ...base, issuer: "idp.example.com" }, options)).toEqual([
      "invalidIssuer",
    ]);
    expect(validateLoginOidcSettings({ ...base, issuer: "https://" }, options)).toEqual([
      "invalidIssuer",
    ]);
  });

  test("URLs, roles and types are checked against the config schema", () => {
    const options = { hasEffectiveSecret: true };
    const base = { ...CREDENTIALS, enabled: true };

    expect(
      validateLoginOidcSettings({ ...base, end_session_endpoint: "not-a-url" }, options),
    ).toEqual(["invalidUrl"]);
    expect(
      validateLoginOidcSettings({ ...base, default_role: "superuser" as never }, options),
    ).toEqual(["invalidRole"]);
    expect(validateLoginOidcSettings({ ...base, issuer: 42 as never }, options)).toEqual([
      "invalidType",
    ]);
    expect(validateLoginOidcSettings({ ...base, scope: "   " }, options)).toEqual(["invalidEmpty"]);
  });

  test("everything the editor can store is accepted by the config schema", () => {
    const settings: LoginOidcSettings = {
      enabled: true,
      issuer: "https://idp.example.com/tenant",
      client_id: "headplane-console",
      client_secret: "a-client-secret",
      scope: "openid profile email",
      use_pkce: true,
      default_role: "viewer",
      logout_idp: true,
      end_session_endpoint: "https://idp.example.com/logout",
      post_logout_redirect_uri: "https://headplane.example.com/admin/login",
    };

    expect(validateLoginOidcSettings(settings, { hasEffectiveSecret: true })).toEqual([]);

    // The next start validates the same document, so a stored value that the
    // schema rejects would stop HeadplaneCN from booting.
    const parsed = headplaneConfig({
      headscale: { url: "http://headscale:8080" },
      server: { cookie_secret: "thirtytwo-character-cookiesecret" },
      oidc: settings,
    });

    expect(parsed instanceof type.errors).toBe(false);
  });
});

describe("console login lockout rail", () => {
  const working: LoginOidcSettings = { enabled: true, ...CREDENTIALS };

  test("disabling the only way in is refused", () => {
    const assessment = assessLoginLockout({
      before: working,
      after: { ...working, enabled: false },
      context: ONLY_OIDC,
    });

    expect(assessment).toMatchObject({ state: "refuse", reasons: ["noWayIn"] });
  });

  test("removing a way in while another remains asks for confirmation", () => {
    expect(
      assessLoginLockout({
        before: working,
        after: { ...working, enabled: false },
        context: OPEN,
      }),
    ).toMatchObject({ state: "confirm", reasons: ["oidcDisabled"] });

    // A trusted proxy is a real way in, so the change is not refused.
    expect(
      assessLoginLockout({
        before: working,
        after: { ...working, enabled: false },
        context: ONLY_PROXY,
      }),
    ).toMatchObject({ state: "confirm", remaining: { proxy: true } });
  });

  test("clearing the client secret is confirmed, an unrelated edit is not", () => {
    expect(
      assessLoginLockout({
        before: working,
        after: { ...working, client_secret: undefined },
        context: OPEN,
      }),
    ).toMatchObject({ state: "confirm", reasons: ["secretCleared"] });

    expect(
      assessLoginLockout({
        before: working,
        after: { ...working, scope: "openid email" },
        context: ONLY_OIDC,
      }),
    ).toEqual({ state: "safe" });
  });

  test("a configuration that was never usable does not need confirming", () => {
    expect(
      assessLoginLockout({
        before: { enabled: true, issuer: "https://idp.example.com" },
        after: { enabled: false },
        context: OPEN,
      }),
    ).toEqual({ state: "safe" });
  });
});

describe("console login restart detection", () => {
  test("no difference means no restart is needed", () => {
    expect(loginOidcRestartFields(CREDENTIALS, { ...CREDENTIALS })).toEqual([]);
  });

  test("a changed field is reported, and a replaced secret counts as changed", () => {
    expect(
      loginOidcRestartFields(CREDENTIALS, {
        ...CREDENTIALS,
        issuer: "https://other.example.com",
      }),
    ).toEqual(["issuer"]);

    expect(
      loginOidcRestartFields(
        { ...CREDENTIALS, client_secret: "old-secret" },
        { ...CREDENTIALS, client_secret: "new-secret" },
      ),
    ).toEqual(["client_secret"]);
  });

  test("a field added or cleared is detected", () => {
    expect(loginOidcRestartFields(CREDENTIALS, { ...CREDENTIALS, default_role: "member" })).toEqual(
      ["default_role"],
    );
    expect(loginOidcRestartFields({ ...CREDENTIALS, logout_idp: true }, CREDENTIALS)).toEqual([
      "logout_idp",
    ]);
    expect(diffLoginOidcSettings({}, {})).toEqual([]);
  });
});
