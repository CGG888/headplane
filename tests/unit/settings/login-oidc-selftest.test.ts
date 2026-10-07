import { describe, expect, test } from "vitest";

import { mergeLoginOidcLayers } from "~/routes/settings/login/login-oidc";
import {
  evaluateLoginSelfTest,
  loginSelfTestConfigFrom,
  type LoginSelfTestProbe,
} from "~/routes/settings/login/self-test";

const ISSUER = "https://idp.example.com";

/** The self-test is pure, so every branch runs with plain values, no network. */
function probe(document: Record<string, unknown>): LoginSelfTestProbe {
  return { url: `${ISSUER}/.well-known/openid-configuration`, ok: true, status: 200, document };
}

describe("the self-test evaluates the merged configuration", () => {
  test("a value saved on the page is what the checks see", () => {
    const merged = mergeLoginOidcLayers({
      saved: {
        issuer: "https://saved.example.com",
        scope: "openid profile",
        end_session_endpoint: "https://saved.example.com/logout",
        post_logout_redirect_uri: "https://headplane.example.com/admin/login",
        logout_idp: true,
      },
      file: {
        issuer: "https://file.example.com",
        scope: "openid profile email",
        end_session_endpoint: "https://file.example.com/logout",
        logout_idp: false,
      },
    });

    const config = loginSelfTestConfigFrom({
      settings: merged.values,
      baseUrl: "https://headplane.example.com/admin",
    });

    expect(config.issuer).toBe("https://saved.example.com");
    expect(config.scope).toBe("openid profile");
    expect(config.endSessionEndpoint).toBe("https://saved.example.com/logout");
    expect(config.postLogoutRedirectUri).toBe("https://headplane.example.com/admin/login");
    expect(config.idpLogoutEnabled).toBe(true);
  });

  test("an environment variable still wins inside the self-test's input", () => {
    const merged = mergeLoginOidcLayers({
      env: { issuer: "https://env.example.com" },
      saved: { issuer: "https://saved.example.com" },
      file: { issuer: "https://file.example.com" },
    });

    expect(loginSelfTestConfigFrom({ settings: merged.values }).issuer).toBe(
      "https://env.example.com",
    );
  });

  test("the report reflects the merged issuer and scope, not the file's", () => {
    const merged = mergeLoginOidcLayers({
      saved: {
        issuer: "https://saved.example.com",
        scope: "openid",
        end_session_endpoint: "https://saved.example.com/logout",
        logout_idp: true,
      },
      file: {
        issuer: ISSUER,
        scope: "openid profile email",
        end_session_endpoint: "https://idp.example.com/logout",
      },
    });

    const report = evaluateLoginSelfTest({
      config: loginSelfTestConfigFrom({ settings: merged.values }),
      probe: probe({
        issuer: "https://saved.example.com",
        scopes_supported: ["openid"],
        end_session_endpoint: "https://saved.example.com/logout",
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      runtime: { es384: true },
    });

    expect(report.checks.find((check) => check.id === "issuer")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "scopes")?.status).toBe("pass");
    // The file's issuer and end-session endpoint would both have been reported
    // as mismatches; the merged values pass character for character.
    expect(report.verdict).toBe("good");
  });

  test("a secret in the merged configuration never reaches the report", () => {
    const merged = mergeLoginOidcLayers({
      saved: { issuer: ISSUER, client_secret: "top-secret-value" },
    });

    const report = evaluateLoginSelfTest({
      config: loginSelfTestConfigFrom({ settings: merged.values }),
      probe: probe({ issuer: ISSUER, scopes_supported: ["openid"] }),
      runtime: { es384: true },
    });

    expect(JSON.stringify(report)).not.toContain("top-secret-value");
  });

  test("a cleared logout_idp turns the end-session check into a warning", () => {
    const merged = mergeLoginOidcLayers({
      saved: { logout_idp: false },
      file: { use_end_session: true },
    });

    const report = evaluateLoginSelfTest({
      config: loginSelfTestConfigFrom({ settings: merged.values }),
      probe: probe({
        issuer: merged.values.issuer ?? "https://file.example.com",
        end_session_endpoint: "https://file.example.com/logout",
      }),
      runtime: { es384: true },
    });

    const endSession = report.checks.find((check) => check.id === "endSession");
    expect(merged.values.logout_idp).toBe(false);
    expect(endSession?.status).toBe("warn");
  });

  test("client_secret_jwt is judged as the fallback the runtime uses", () => {
    const merged = mergeLoginOidcLayers({ saved: { issuer: ISSUER } });

    // app/server/context.ts rewrites this method to `undefined`, so the flow
    // signs in with client_secret_post; the self-test must not fail a
    // configuration that works.
    const config = loginSelfTestConfigFrom({
      settings: merged.values,
      tokenEndpointAuthMethod: "client_secret_jwt",
    });
    expect(config.tokenEndpointAuthMethod).toBeUndefined();

    const report = evaluateLoginSelfTest({
      config,
      probe: probe({
        issuer: ISSUER,
        scopes_supported: ["openid"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      runtime: { es384: true },
    });

    expect(report.checks.find((check) => check.id === "tokenAuth")?.status).toBe("pass");
  });

  test("a method the runtime does support is still judged as configured", () => {
    const merged = mergeLoginOidcLayers({ saved: { issuer: ISSUER } });

    const report = evaluateLoginSelfTest({
      config: loginSelfTestConfigFrom({
        settings: merged.values,
        tokenEndpointAuthMethod: "client_secret_basic",
      }),
      probe: probe({
        issuer: ISSUER,
        scopes_supported: ["openid"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      }),
      runtime: { es384: true },
    });

    const tokenAuth = report.checks.find((check) => check.id === "tokenAuth");
    expect(tokenAuth?.status).toBe("fail");
    expect(tokenAuth?.params?.used).toBe("client_secret_basic");
  });
});
