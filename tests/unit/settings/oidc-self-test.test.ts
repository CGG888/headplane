import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildCallbackUrl,
  buildDiscoveryUrl,
  coerceScopeList,
  coerceString,
  coerceStringList,
  countSigningKeys,
  missingEndpoints,
  normalizeIssuer,
  runOidcSelfTest,
  summarizeChecks,
  type OidcSelfTestCheck,
  type OidcSelfTestCheckId,
  type OidcSelfTestConfig,
} from "~/routes/settings/headscale/oidc-self-test";
import { appConfigContext, authContext, headscaleConfigContext } from "~/server/context";

const DISCOVERY_URL = "https://idp.example.com/.well-known/openid-configuration";
const JWKS_URL = "https://idp.example.com/jwks";

const DISCOVERY = {
  issuer: "https://idp.example.com",
  authorization_endpoint: "https://idp.example.com/authorize",
  token_endpoint: "https://idp.example.com/token",
  jwks_uri: JWKS_URL,
  code_challenge_methods_supported: ["S256"],
};

const JWKS = { keys: [{ kty: "RSA", kid: "test" }] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function config(overrides: Partial<OidcSelfTestConfig> = {}): OidcSelfTestConfig {
  return {
    issuer: "https://idp.example.com",
    clientId: "headplane",
    hasInlineClientSecret: true,
    clientSecretPath: "",
    scope: ["openid", "profile", "email"],
    pkceEnabled: true,
    pkceMethod: "S256",
    allowedDomains: ["example.com"],
    allowedGroups: [],
    allowedUsers: [],
    baseUrl: "https://headplane.example.com",
    ...overrides,
  };
}

type Route = () => Response | Promise<Response>;

function mockFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const handler = routes[String(input)];
    if (!handler) {
      throw new Error(`unexpected request: ${String(input)}`);
    }

    return handler();
  });
}

function healthyFetch() {
  return mockFetch({
    [DISCOVERY_URL]: () => jsonResponse(DISCOVERY),
    [JWKS_URL]: () => jsonResponse(JWKS),
  });
}

function checkOf(checks: OidcSelfTestCheck[], id: OidcSelfTestCheckId): OidcSelfTestCheck {
  const found = checks.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Missing check: ${id}`);
  }

  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OIDC self-test coercion helpers", () => {
  test("coerceString keeps only non-empty strings", () => {
    expect(coerceString("  https://idp.example.com ")).toBe("https://idp.example.com");
    expect(coerceString("")).toBeUndefined();
    expect(coerceString("   ")).toBeUndefined();
    expect(coerceString(42)).toBeUndefined();
    expect(coerceString(undefined)).toBeUndefined();
  });

  test("coerceStringList drops every non-string entry", () => {
    expect(coerceStringList(["openid", " email ", 7, null, ""])).toEqual(["openid", "email"]);
    expect(coerceStringList("openid")).toEqual([]);
    expect(coerceStringList(undefined)).toEqual([]);
  });

  test("coerceScopeList accepts a string or an array", () => {
    expect(coerceScopeList("openid profile,email")).toEqual(["openid", "profile", "email"]);
    expect(coerceScopeList(["openid", "email"])).toEqual(["openid", "email"]);
    expect(coerceScopeList(null)).toEqual([]);
  });

  test("countSigningKeys counts array entries and rejects other shapes", () => {
    expect(countSigningKeys([{ kty: "RSA" }, { kty: "EC" }])).toBe(2);
    expect(countSigningKeys([])).toBe(0);
    expect(countSigningKeys("RSA")).toBe(0);
    expect(countSigningKeys(undefined)).toBe(0);
  });

  test("normalizeIssuer trims the trailing slash Headscale ignores", () => {
    expect(normalizeIssuer(" https://idp.example.com/ ")).toBe("https://idp.example.com");
    expect(normalizeIssuer("https://idp.example.com/tenant//")).toBe(
      "https://idp.example.com/tenant",
    );
  });

  test("buildDiscoveryUrl keeps an issuer path as the prefix", () => {
    expect(buildDiscoveryUrl("https://idp.example.com")).toBe(DISCOVERY_URL);
    expect(buildDiscoveryUrl("https://idp.example.com/")).toBe(DISCOVERY_URL);
    expect(buildDiscoveryUrl("https://idp.example.com/tenant/")).toBe(
      "https://idp.example.com/tenant/.well-known/openid-configuration",
    );
    expect(buildDiscoveryUrl("idp.example.com")).toBeUndefined();
    expect(buildDiscoveryUrl("ftp://idp.example.com")).toBeUndefined();
  });

  test("buildCallbackUrl prefixes Headplane's base URL", () => {
    expect(buildCallbackUrl("https://headplane.example.com", "/admin")).toBe(
      "https://headplane.example.com/admin/oidc/callback",
    );
    expect(buildCallbackUrl("not a url", "/admin")).toBeUndefined();
  });

  test("missingEndpoints lists what the document does not advertise", () => {
    expect(missingEndpoints(DISCOVERY)).toEqual([]);
    expect(missingEndpoints({ ...DISCOVERY, token_endpoint: undefined })).toEqual([
      "token_endpoint",
    ]);
    expect(missingEndpoints(undefined)).toEqual([
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ]);
  });

  test("summarizeChecks never counts a skipped check", () => {
    const checks = [
      { id: "issuer", status: "pass" },
      { id: "discovery", status: "fail" },
      { id: "endpoints", status: "warn" },
      { id: "jwks", status: "skip" },
    ] as OidcSelfTestCheck[];

    expect(summarizeChecks(checks)).toEqual({ passed: 1, total: 3, skipped: 1 });
  });
});

describe("runOidcSelfTest", () => {
  test("passes every check for a healthy provider", async () => {
    const fetchImpl = healthyFetch();
    const report = await runOidcSelfTest(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.checks.map((entry) => entry.status)).toEqual(
      Array.from({ length: 9 }, () => "pass"),
    );
    expect(report).toMatchObject({ passed: 9, total: 9, skipped: 0 });
    expect(checkOf(report.checks, "callback").params).toEqual({
      url: "https://headplane.example.com/admin/oidc/callback",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("turns an unreachable provider into results instead of throwing", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    const report = await runOidcSelfTest(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "discovery")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestDiscoveryUnreachable",
      params: { error: "connect ECONNREFUSED" },
    });
    expect(checkOf(report.checks, "endpoints").status).toBe("skip");
    expect(checkOf(report.checks, "jwks").status).toBe("skip");
    // The summary counts only the checks that could actually run.
    expect(report).toMatchObject({ passed: 5, total: 6, skipped: 3 });
  });

  test("reports a discovery response that is not a JSON object", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => new Response("not json", { status: 200 }),
    });

    const report = await runOidcSelfTest(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "discovery").status).toBe("fail");
    expect(checkOf(report.checks, "discovery").detail).toBe(DISCOVERY_URL);
  });

  test("reports an HTTP error status as a failed discovery check", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => new Response("", { status: 502 }),
    });

    const report = await runOidcSelfTest(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "discovery")).toMatchObject({
      status: "fail",
      params: { error: "HTTP 502" },
    });
  });

  test("fails discovery when the document issuer does not match", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => jsonResponse({ ...DISCOVERY, issuer: "https://other.example.com" }),
      [JWKS_URL]: () => jsonResponse(JWKS),
    });

    const report = await runOidcSelfTest(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "discovery")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestDiscoveryMismatch",
      params: { actual: "https://other.example.com", expected: "https://idp.example.com" },
    });
  });

  test("accepts the trailing slash Headscale trims", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => jsonResponse({ ...DISCOVERY, issuer: "https://idp.example.com/" }),
      [JWKS_URL]: () => jsonResponse(JWKS),
    });

    const report = await runOidcSelfTest(config({ issuer: "https://idp.example.com/" }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "discovery").status).toBe("pass");
  });

  test("warns about a plain http issuer and never calls an unusable one", async () => {
    const fetchImpl = healthyFetch();
    const httpReport = await runOidcSelfTest(config({ issuer: "http://idp.internal" }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(checkOf(httpReport.checks, "issuer")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestIssuerInsecure",
      params: { scheme: "http" },
    });

    const relativeFetch = healthyFetch();
    const relativeReport = await runOidcSelfTest(config({ issuer: "idp.example.com" }), {
      fetchImpl: relativeFetch as unknown as typeof fetch,
    });
    expect(checkOf(relativeReport.checks, "issuer")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestIssuerNotAbsolute",
    });
    expect(checkOf(relativeReport.checks, "discovery").status).toBe("skip");
    expect(relativeFetch).not.toHaveBeenCalled();
  });

  test("fails a non-http scheme with its own message", async () => {
    const report = await runOidcSelfTest(config({ issuer: "ftp://idp.example.com" }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "issuer")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestIssuerUnsupportedScheme",
      params: { scheme: "ftp" },
    });
  });

  test("fails without openid and warns about the missing claim scopes", async () => {
    const report = await runOidcSelfTest(config({ scope: "profile email" }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(checkOf(report.checks, "scopes")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestScopesMissingOpenid",
    });

    const partial = await runOidcSelfTest(config({ scope: ["openid"] }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(checkOf(partial.checks, "scopes")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestScopesMissingClaims",
      params: { scopes: "email, profile" },
    });
  });

  test("checks the client credentials and warns when both secrets are set", async () => {
    const missing = await runOidcSelfTest(config({ clientId: "", hasInlineClientSecret: false }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(checkOf(missing.checks, "credentials").messageKey).toBe(
      "settings.headscale.selfTestCredentialsMissingClientId",
    );

    const noSecret = await runOidcSelfTest(
      config({ hasInlineClientSecret: false, clientSecretPath: "" }),
      { fetchImpl: healthyFetch() as unknown as typeof fetch },
    );
    expect(checkOf(noSecret.checks, "credentials")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestCredentialsMissingSecret",
    });

    const both = await runOidcSelfTest(config({ clientSecretPath: "/run/secrets/oidc" }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(checkOf(both.checks, "credentials")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestCredentialsBoth",
    });

    const pathOnly = await runOidcSelfTest(
      config({ hasInlineClientSecret: false, clientSecretPath: "/run/secrets/oidc" }),
      { fetchImpl: healthyFetch() as unknown as typeof fetch },
    );
    expect(checkOf(pathOnly.checks, "credentials").status).toBe("pass");
  });

  test("warns when no sign-in restriction is configured", async () => {
    const openReport = await runOidcSelfTest(
      config({ allowedDomains: [], allowedGroups: [], allowedUsers: [] }),
      { fetchImpl: healthyFetch() as unknown as typeof fetch },
    );
    expect(checkOf(openReport.checks, "access")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestAccessMissing",
    });

    const restricted = await runOidcSelfTest(
      config({ allowedDomains: [], allowedGroups: [], allowedUsers: ["owner@example.com"] }),
      { fetchImpl: healthyFetch() as unknown as typeof fetch },
    );
    expect(checkOf(restricted.checks, "access")).toMatchObject({
      status: "pass",
      params: { lists: "allowed_users" },
    });
  });

  test("checks PKCE against what the document advertises", async () => {
    const disabled = await runOidcSelfTest(config({ pkceEnabled: false }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(checkOf(disabled.checks, "pkce")).toMatchObject({
      status: "skip",
      messageKey: "settings.headscale.selfTestPkceDisabled",
    });

    const mismatch = await runOidcSelfTest(config({ pkceMethod: "plain" }), {
      fetchImpl: healthyFetch() as unknown as typeof fetch,
    });
    expect(checkOf(mismatch.checks, "pkce")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestPkceMismatch",
      params: { advertised: "S256", method: "plain" },
    });

    const silent = mockFetch({
      [DISCOVERY_URL]: () =>
        jsonResponse({ ...DISCOVERY, code_challenge_methods_supported: undefined }),
      [JWKS_URL]: () => jsonResponse(JWKS),
    });
    const unknown = await runOidcSelfTest(config(), {
      fetchImpl: silent as unknown as typeof fetch,
    });
    expect(checkOf(unknown.checks, "pkce")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestPkceUnknown",
      params: { method: "S256" },
    });
  });

  test("fails an empty JWKS and warns when base_url is unknown", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => jsonResponse(DISCOVERY),
      [JWKS_URL]: () => jsonResponse({ keys: [] }),
    });
    const report = await runOidcSelfTest(config({ baseUrl: "" }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "jwks")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestJwksEmpty",
    });
    expect(checkOf(report.checks, "callback")).toMatchObject({
      status: "warn",
      messageKey: "settings.headscale.selfTestCallbackUnknown",
    });
  });

  test("fails when the document is missing an endpoint it advertises", async () => {
    const fetchImpl = mockFetch({
      [DISCOVERY_URL]: () => jsonResponse({ ...DISCOVERY, jwks_uri: undefined }),
    });
    const report = await runOidcSelfTest(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(checkOf(report.checks, "endpoints")).toMatchObject({
      status: "fail",
      messageKey: "settings.headscale.selfTestEndpointsMissing",
      params: { endpoints: "jwks_uri" },
    });
    expect(checkOf(report.checks, "jwks").status).toBe("skip");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("headscale settings action: test_oidc", () => {
  const oidcView = {
    issuer: "https://idp.example.com",
    clientId: "headplane",
    hasInlineClientSecret: true,
    clientSecretPath: "",
    scope: ["openid", "profile", "email"],
    pkceEnabled: true,
    pkceMethod: "S256",
    allowedDomains: ["example.com"],
    allowedGroups: [],
    allowedUsers: [],
  };

  function context(options: { writable: boolean; oidc?: typeof oidcView | undefined }) {
    return {
      get: (key: unknown) => {
        if (key === authContext) {
          return { require: () => Promise.resolve({ id: 1 }), can: () => true };
        }

        if (key === headscaleConfigContext) {
          return {
            writable: () => options.writable,
            getOIDCSettings: () => options.oidc,
            patch: vi.fn(),
          };
        }

        if (key === appConfigContext) {
          return { server: { base_url: "https://headplane.example.com" } };
        }

        return undefined;
      },
    };
  }

  test("returns the per-check report without writing anything", async () => {
    vi.stubGlobal("fetch", healthyFetch() as unknown as typeof fetch);

    const { headscaleSettingsAction } = await import("~/routes/settings/headscale/actions");
    const formData = new FormData();
    formData.set("action_id", "test_oidc");

    const result = (await headscaleSettingsAction({
      request: { formData: () => Promise.resolve(formData) } as unknown as Request,
      context: context({ writable: true, oidc: oidcView }),
      params: {},
    } as never)) as { data: { success: boolean; selfTest?: { passed: number; total: number } } };

    expect(result.data.success).toBe(true);
    expect(result.data.selfTest).toMatchObject({ passed: 9, total: 9 });
  });

  test("still runs when the config file is read-only", async () => {
    vi.stubGlobal("fetch", healthyFetch() as unknown as typeof fetch);

    const { headscaleSettingsAction } = await import("~/routes/settings/headscale/actions");
    const formData = new FormData();
    formData.set("action_id", "test_oidc");

    const result = (await headscaleSettingsAction({
      request: { formData: () => Promise.resolve(formData) } as unknown as Request,
      context: context({ writable: false, oidc: oidcView }),
      params: {},
    } as never)) as { data: { success: boolean } };

    expect(result.data.success).toBe(true);
  });
});
