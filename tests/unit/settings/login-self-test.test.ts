import { describe, expect, test, vi } from "vitest";

import {
  buildDiscoveryUrl,
  coerceScopeList,
  evaluateLoginSelfTest,
  probeIssuer,
  summarizeChecks,
  type LoginSelfTestCheck,
  type LoginSelfTestCheckId,
  type LoginSelfTestConfig,
  type LoginSelfTestProbe,
  type LoginSelfTestReport,
} from "~/routes/settings/login/self-test";

const ISSUER = "https://idp.example.com";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

function config(overrides: Partial<LoginSelfTestConfig> = {}): LoginSelfTestConfig {
  return {
    issuer: ISSUER,
    scope: "openid profile email",
    idpLogoutEnabled: true,
    baseUrl: "https://headplane.example.com",
    ...overrides,
  };
}

function probe(document: Record<string, unknown> | undefined): LoginSelfTestProbe {
  return { url: DISCOVERY_URL, ok: true, status: 200, document };
}

function happyDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    end_session_endpoint: `${ISSUER}/logout`,
    scopes_supported: ["openid", "profile", "email"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    ...overrides,
  };
}

function evaluate(
  document: Record<string, unknown> | undefined,
  options: {
    config?: Partial<LoginSelfTestConfig>;
    es384?: boolean;
    probe?: LoginSelfTestProbe;
  } = {},
): LoginSelfTestReport {
  return evaluateLoginSelfTest({
    config: config(options.config),
    probe: options.probe ?? probe(document),
    runtime: { es384: options.es384 ?? true },
  });
}

function check(report: LoginSelfTestReport, id: LoginSelfTestCheckId): LoginSelfTestCheck {
  const found = report.checks.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing check ${id}`);
  }

  return found;
}

describe("login self-test evaluator", () => {
  test("reports every pass for a healthy provider", () => {
    const report = evaluate(happyDocument(), { config: { scope: "openid" } });

    expect(report.checks.map((entry) => entry.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(report.verdict).toBe("good");
    expect(report.passed).toBe(6);
    expect(report.total).toBe(6);
    expect(report.skipped).toBe(0);
    // The startup note always travels with the report.
    expect(report.notes.map((note) => note.messageKey)).toEqual([
      "settings.login.restartNotice",
      "settings.login.selfTestSecretNote",
    ]);
  });

  test("fails an issuer that differs character for character", () => {
    const report = evaluate(happyDocument({ issuer: `${ISSUER}/` }));
    const issuer = check(report, "issuer");

    expect(issuer.status).toBe("fail");
    expect(issuer.messageKey).toBe("settings.login.selfTestIssuerMismatch");
    expect(issuer.params).toEqual({ actual: `${ISSUER}/`, expected: ISSUER });
    expect(issuer.fix).toBe(`issuer: ${ISSUER}/`);
    expect(report.verdict).toBe("fail");
  });

  test("accepts an issuer that matches exactly", () => {
    const issuer = check(evaluate(happyDocument()), "issuer");

    expect(issuer.status).toBe("pass");
    expect(issuer.messageKey).toBe("settings.login.selfTestIssuerOk");
  });

  test("flags a configured scope the provider does not advertise", () => {
    const report = evaluate(happyDocument({ scopes_supported: ["openid", "email"] }), {
      config: { scope: "openid profile email" },
    });
    const scopes = check(report, "scopes");

    expect(scopes.status).toBe("fail");
    expect(scopes.messageKey).toBe("settings.login.selfTestScopesMissing");
    expect(scopes.params).toEqual({ missing: "profile", advertised: "openid email" });
    expect(scopes.fix).toBe('scope: "openid profile email"');
  });

  test("warns when profile and email are listed but must still be granted", () => {
    const report = evaluate(happyDocument());
    const scopes = check(report, "scopes");

    // The provider advertises both scopes, which is not the same as granting
    // them: Logto only returns the claims once the application has them.
    expect(scopes.status).toBe("warn");
    expect(scopes.messageKey).toBe("settings.login.selfTestScopesClaimGrant");
    expect(scopes.params).toEqual({ scopes: "profile email" });
    expect(report.verdict).toBe("warn");
  });

  test("does not warn about claim scopes the config never asks for", () => {
    const scopes = check(evaluate(happyDocument(), { config: { scope: "openid" } }), "scopes");

    expect(scopes.status).toBe("pass");
    expect(scopes.messageKey).toBe("settings.login.selfTestScopesOk");
  });

  test("states plainly that an ES384-only provider works on this runtime", () => {
    const report = evaluate(happyDocument({ id_token_signing_alg_values_supported: ["ES384"] }), {
      es384: true,
      config: { scope: "openid" },
    });
    const alg = check(report, "signingAlg");

    expect(alg.status).toBe("pass");
    expect(alg.messageKey).toBe("settings.login.selfTestSigningAlgOkEs384");
    expect(alg.params).toEqual({ algos: "ES384" });
    expect(alg.detail).toBe("id_token_signing_alg_values_supported: ES384");
  });

  test("fails an ES384-only provider when the runtime cannot verify P-384", () => {
    const report = evaluate(happyDocument({ id_token_signing_alg_values_supported: ["ES384"] }), {
      es384: false,
      config: { scope: "openid" },
    });
    const alg = check(report, "signingAlg");

    expect(alg.status).toBe("fail");
    expect(alg.messageKey).toBe("settings.login.selfTestSigningAlgEs384Unsupported");
    expect(alg.params).toEqual({ algos: "ES384" });
    expect(report.verdict).toBe("fail");
  });

  test("passes a non-ES384 provider without claiming ES384 support", () => {
    const alg = check(
      evaluate(happyDocument({ id_token_signing_alg_values_supported: ["RS256", "ES256"] }), {
        es384: false,
      }),
      "signingAlg",
    );

    expect(alg.status).toBe("pass");
    expect(alg.messageKey).toBe("settings.login.selfTestSigningAlgOk");
    expect(alg.params).toEqual({ algos: "RS256 ES256" });
  });

  test("fails when no advertised algorithm can be verified", () => {
    const alg = check(
      evaluate(happyDocument({ id_token_signing_alg_values_supported: ["HS256"] })),
      "signingAlg",
    );

    expect(alg.status).toBe("fail");
    expect(alg.messageKey).toBe("settings.login.selfTestSigningAlgUnverifiable");
    expect(alg.params).toEqual({ algos: "HS256" });
  });

  test("warns when the signing algorithms are not advertised", () => {
    const document = happyDocument();
    delete document.id_token_signing_alg_values_supported;

    const alg = check(evaluate(document), "signingAlg");
    expect(alg.status).toBe("warn");
    expect(alg.messageKey).toBe("settings.login.selfTestSigningAlgUnknown");
  });

  test("fails a provider with no end-session endpoint and says how to add one", () => {
    const document = happyDocument();
    delete document.end_session_endpoint;

    const endSession = check(evaluate(document), "endSession");
    expect(endSession.status).toBe("fail");
    expect(endSession.messageKey).toBe("settings.login.selfTestEndSessionMissing");
    expect(endSession.fix).toContain("end_session_endpoint:");
  });

  test("warns when the endpoint exists but logout_idp is off", () => {
    const report = evaluate(happyDocument(), { config: { idpLogoutEnabled: false } });
    const endSession = check(report, "endSession");

    expect(endSession.status).toBe("warn");
    expect(endSession.messageKey).toBe("settings.login.selfTestEndSessionDisabled");
    expect(endSession.params).toMatchObject({
      endpoint: `${ISSUER}/logout`,
      source: "end_session_endpoint",
      postLogout: "https://headplane.example.com/admin/login",
    });
    expect(endSession.fix).toBe("logout_idp: true");
    expect(report.verdict).toBe("warn");
  });

  test("prefers the configured end-session override and reports its source", () => {
    const endSession = check(
      evaluate(happyDocument({ end_session_endpoint: "https://other.example.com/logout" }), {
        config: { endSessionEndpoint: "https://idp.example.com/custom-logout" },
      }),
      "endSession",
    );

    expect(endSession.status).toBe("pass");
    expect(endSession.messageKey).toBe("settings.login.selfTestEndSessionOk");
    expect(endSession.params).toMatchObject({
      endpoint: "https://idp.example.com/custom-logout",
      source: "oidc.end_session_endpoint",
    });
  });

  test("fails an end-session endpoint that is not https", () => {
    const endSession = check(
      evaluate(happyDocument(), {
        config: { endSessionEndpoint: "http://idp.example.com/logout" },
      }),
      "endSession",
    );

    expect(endSession.status).toBe("fail");
    expect(endSession.messageKey).toBe("settings.login.selfTestEndSessionInsecure");
    expect(endSession.params).toMatchObject({ endpoint: "http://idp.example.com/logout" });
  });

  test("compares the advertised token auth methods with the one the app uses", () => {
    const pass = check(
      evaluate(happyDocument({ token_endpoint_auth_methods_supported: ["client_secret_basic"] }), {
        config: { tokenEndpointAuthMethod: "client_secret_basic" },
      }),
      "tokenAuth",
    );
    expect(pass.status).toBe("pass");
    expect(pass.params).toEqual({
      used: "client_secret_basic",
      advertised: "client_secret_basic",
    });

    const mismatch = check(
      evaluate(happyDocument({ token_endpoint_auth_methods_supported: ["client_secret_basic"] }), {
        config: { tokenEndpointAuthMethod: "client_secret_post" },
      }),
      "tokenAuth",
    );
    expect(mismatch.status).toBe("fail");
    expect(mismatch.messageKey).toBe("settings.login.selfTestTokenAuthMismatch");
    expect(mismatch.fix).toBe('token_endpoint_auth_method: "client_secret_basic"');
  });

  test("warns when the provider does not advertise its token auth methods", () => {
    const document = happyDocument();
    delete document.token_endpoint_auth_methods_supported;

    const tokenAuth = check(evaluate(document), "tokenAuth");
    expect(tokenAuth.status).toBe("warn");
    expect(tokenAuth.messageKey).toBe("settings.login.selfTestTokenAuthUnknown");
    expect(tokenAuth.params).toEqual({ used: "client_secret_post" });
  });

  test("reports a fetch failure and skips everything that needs the document", () => {
    const report = evaluate(undefined, {
      probe: { url: DISCOVERY_URL, ok: false, status: 502, error: "HTTP 502" },
    });
    const discovery = check(report, "discovery");

    expect(discovery.status).toBe("fail");
    expect(discovery.messageKey).toBe("settings.login.selfTestDiscoveryFailed");
    expect(discovery.params).toEqual({ url: DISCOVERY_URL, status: 502, error: "HTTP 502" });

    for (const id of ["issuer", "scopes", "signingAlg", "tokenAuth"] as const) {
      expect(check(report, id).status).toBe("skip");
    }

    // Without a document the end-session endpoint cannot be judged either,
    // unless the config pins one.
    expect(check(report, "endSession").status).toBe("skip");
    expect(report.verdict).toBe("fail");
  });

  test("reports a certificate error with the URL that was tried", () => {
    const probe: LoginSelfTestProbe = {
      url: DISCOVERY_URL,
      ok: false,
      error: "unable to verify the first certificate",
    };

    const discovery = check(
      evaluate(undefined, { probe, config: { endSessionEndpoint: `${ISSUER}/logout` } }),
      "discovery",
    );
    expect(discovery.status).toBe("fail");
    expect(discovery.detail).toBe(DISCOVERY_URL);
    expect(discovery.params).toMatchObject({ error: "unable to verify the first certificate" });
  });

  test("skips discovery when no issuer is configured", () => {
    const report = evaluate(undefined, {
      config: { issuer: undefined, endSessionEndpoint: `${ISSUER}/logout` },
      probe: { ok: false, error: "not fetched" },
    });

    expect(check(report, "discovery").status).toBe("skip");
    expect(check(report, "discovery").messageKey).toBe("settings.login.selfTestDiscoverySkipped");
    // The end-session check still reads the configured override.
    expect(check(report, "endSession").status).toBe("pass");
  });

  test("counts skipped checks out of the summary", () => {
    const checks: LoginSelfTestCheck[] = [
      { id: "discovery", status: "pass", messageKey: "settings.login.selfTestDiscoveryOk" },
      { id: "issuer", status: "skip", messageKey: "settings.login.selfTestSkippedPrerequisite" },
      { id: "scopes", status: "warn", messageKey: "settings.login.selfTestScopesUnknown" },
    ];

    expect(summarizeChecks(checks)).toEqual({
      passed: 1,
      total: 2,
      skipped: 1,
      verdict: "warn",
    });
  });
});

describe("discovery url", () => {
  test("keeps the issuer path as a prefix, like the login flow", () => {
    expect(buildDiscoveryUrl("https://idp.example.com")).toBe(DISCOVERY_URL);
    expect(buildDiscoveryUrl("https://idp.example.com/")).toBe(DISCOVERY_URL);
    expect(buildDiscoveryUrl("https://idp.example.com/tenant/")).toBe(
      "https://idp.example.com/tenant/.well-known/openid-configuration",
    );
  });

  test("is unknown for anything that is not an absolute http(s) URL", () => {
    expect(buildDiscoveryUrl(undefined)).toBeUndefined();
    expect(buildDiscoveryUrl("idp.example.com")).toBeUndefined();
    expect(buildDiscoveryUrl("ftp://idp.example.com")).toBeUndefined();
  });
});

describe("probeIssuer", () => {
  test("returns the document with its HTTP status", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ issuer: ISSUER }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const result = await probeIssuer(ISSUER, { fetchImpl });
    expect(result).toEqual({
      url: DISCOVERY_URL,
      ok: true,
      status: 200,
      document: { issuer: ISSUER },
    });
  });

  test("keeps the status of an error response separate from the error text", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 503 }),
    ) as unknown as typeof fetch;

    const result = await probeIssuer(ISSUER, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toBe("HTTP 503");
  });

  test("turns a rejected fetch into an error result", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND idp.example.com");
    }) as unknown as typeof fetch;

    const result = await probeIssuer(ISSUER, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOTFOUND");
  });

  test("rejects a JSON body that is not an object", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(["not", "an", "object"]), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await probeIssuer(ISSUER, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("the response is not a JSON object");
  });

  test("does not fetch without an absolute issuer", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await probeIssuer("not-a-url", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("scope coercion", () => {
  test("splits the space separated oidc.scope value", () => {
    expect(coerceScopeList("openid profile  email")).toEqual(["openid", "profile", "email"]);
    expect(coerceScopeList(undefined)).toEqual([]);
  });
});
