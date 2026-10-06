import { type } from "arktype";
import { describe, expect, test } from "vitest";

import { headplaneConfig, partialHeadplaneConfig } from "~/server/config/config-schema";

function base() {
  return {
    server: { cookie_secret: "x".repeat(32), base_url: "https://headplane.example.com" },
    headscale: { url: "https://headscale.example.com" },
  };
}

function oidc(extra: Record<string, unknown> = {}) {
  return {
    issuer: "https://idp.example.com",
    client_id: "headplane",
    client_secret: "secret",
    ...extra,
  };
}

/** Runs the full schema and narrows away `type.errors`, or fails the test. */
function full(input: Parameters<typeof headplaneConfig>[0]) {
  const config = headplaneConfig(input);
  if (config instanceof type.errors) {
    throw new Error(`config was rejected: ${config.summary}`);
  }

  return config;
}

describe("oidc logout configuration", () => {
  test("logout_idp defaults to false, keeping today's behaviour", () => {
    const config = full({ ...base(), oidc: oidc() });

    expect(config.oidc?.logout_idp).toBe(false);
    expect(config.oidc?.use_end_session).toBe(false);
  });

  test("accepts and types the new keys", () => {
    const config = full({
      ...base(),
      oidc: oidc({
        logout_idp: true,
        end_session_endpoint: "https://idp.example.com/logout",
        post_logout_redirect_uri: "https://headplane.example.com/admin/login?s=logout",
      }),
    });

    expect(config.oidc?.logout_idp).toBe(true);
    expect(config.oidc?.end_session_endpoint).toBe("https://idp.example.com/logout");
    expect(config.oidc?.post_logout_redirect_uri).toBe(
      "https://headplane.example.com/admin/login?s=logout",
    );
  });

  test("the legacy use_end_session flag still parses", () => {
    const config = full({ ...base(), oidc: oidc({ use_end_session: true }) });

    expect(config.oidc?.use_end_session).toBe(true);
    expect(config.oidc?.logout_idp).toBe(false);
  });

  test("the partial schema keeps the keys instead of deleting them", () => {
    // `headplaneConfig` deletes undeclared keys, so a key missing from the
    // schema would silently vanish between the file and the app.
    const partial = partialHeadplaneConfig({
      oidc: { logout_idp: true, end_session_endpoint: "https://idp.example.com/logout" },
    });

    expect(partial instanceof type.errors).toBe(false);
    if (partial instanceof type.errors) {
      throw new Error(`partial config was rejected: ${partial.summary}`);
    }

    expect(partial.oidc?.logout_idp).toBe(true);
    expect(partial.oidc?.end_session_endpoint).toBe("https://idp.example.com/logout");
  });

  test("rejects a boolean that is not a boolean", () => {
    const config = headplaneConfig({
      ...base(),
      oidc: oidc({ logout_idp: "yes" }),
    });

    expect(config instanceof type.errors).toBe(true);
  });
});
