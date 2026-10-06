import { describe, expect, test, vi } from "vitest";

import {
  buildEndSessionRedirect,
  defaultPostLogoutRedirectUri,
  isIdpLogoutEnabled,
  resolveIdpLogoutRedirect,
  resolveLogoutRedirect,
  safeAbsoluteUrl,
  safeEndSessionEndpoint,
  withTimeout,
  type EndSessionProvider,
} from "~/routes/auth/end-session";

const ENDPOINT = "https://idp.example.com/oauth2/logout";
const POST_LOGOUT = "https://headplane.example.com/admin/login?s=logout";

function provider(options: {
  endpoint?: string;
  discover?: EndSessionProvider["discover"];
  ready?: boolean;
}): EndSessionProvider {
  return {
    status: () =>
      options.ready === false
        ? { state: "pending" }
        : { state: "ready", endpoints: { endSessionEndpoint: options.endpoint } },
    discover:
      options.discover ??
      vi.fn(async () => ({ ok: false as const, error: new Error("discovery must not run") })),
  };
}

describe("idp logout gating", () => {
  test("is off unless logout_idp or the legacy use_end_session is true", () => {
    expect(isIdpLogoutEnabled(undefined)).toBe(false);
    expect(isIdpLogoutEnabled({})).toBe(false);
    expect(isIdpLogoutEnabled({ logout_idp: false })).toBe(false);
    expect(isIdpLogoutEnabled({ use_end_session: false })).toBe(false);
    expect(isIdpLogoutEnabled({ logout_idp: true })).toBe(true);
    expect(isIdpLogoutEnabled({ use_end_session: true })).toBe(true);
  });

  test("a disabled provider keeps today's local redirect untouched", async () => {
    // This is the byte-for-byte compatible path: nothing is consulted, no
    // discovery is triggered, and the login page is returned unchanged.
    const discover = vi.fn(async () => ({ ok: false as const, error: new Error("never") }));

    await expect(resolveLogoutRedirect({ localRedirect: "/login", idpLogout: null })).resolves.toBe(
      "/login",
    );
    await expect(
      resolveLogoutRedirect({ localRedirect: "/login?s=logout", idpLogout: undefined }),
    ).resolves.toBe("/login?s=logout");
    expect(discover).not.toHaveBeenCalled();
  });
});

describe("end-session redirect builder", () => {
  test("carries client_id, post_logout_redirect_uri and the id token hint", () => {
    const target = buildEndSessionRedirect({
      endpoint: ENDPOINT,
      clientId: "headplane",
      idToken: "header.payload.signature",
      postLogoutRedirectUri: POST_LOGOUT,
    });

    expect(target).toBeDefined();
    const url = new URL(target!);
    expect(url.origin + url.pathname).toBe(ENDPOINT);
    expect(url.searchParams.get("client_id")).toBe("headplane");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(POST_LOGOUT);
    expect(url.searchParams.get("id_token_hint")).toBe("header.payload.signature");
  });

  test("omits id_token_hint when the session has no id token", () => {
    const target = buildEndSessionRedirect({
      endpoint: ENDPOINT,
      clientId: "headplane",
      postLogoutRedirectUri: POST_LOGOUT,
    });

    const url = new URL(target!);
    expect(url.searchParams.has("id_token_hint")).toBe(false);
    expect(url.searchParams.get("client_id")).toBe("headplane");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(POST_LOGOUT);
  });

  test("keeps an existing query string on the endpoint", () => {
    const target = buildEndSessionRedirect({
      endpoint: `${ENDPOINT}?tenant=acme`,
      clientId: "headplane",
    });

    const url = new URL(target!);
    expect(url.searchParams.get("tenant")).toBe("acme");
    expect(url.searchParams.get("client_id")).toBe("headplane");
  });

  test("drops a post_logout_redirect_uri that is not an http(s) URL", () => {
    const target = buildEndSessionRedirect({
      endpoint: ENDPOINT,
      clientId: "headplane",
      postLogoutRedirectUri: "javascript:alert(1)",
    });

    expect(new URL(target!).searchParams.has("post_logout_redirect_uri")).toBe(false);
  });

  test("rejects a missing, non-https, or malformed endpoint", () => {
    expect(buildEndSessionRedirect({ endpoint: undefined, clientId: "a" })).toBeUndefined();
    expect(buildEndSessionRedirect({ endpoint: "", clientId: "a" })).toBeUndefined();
    expect(
      buildEndSessionRedirect({ endpoint: "http://idp.example.com/logout", clientId: "a" }),
    ).toBeUndefined();
    expect(
      buildEndSessionRedirect({ endpoint: "javascript:alert(1)", clientId: "a" }),
    ).toBeUndefined();
    expect(buildEndSessionRedirect({ endpoint: "not a url", clientId: "a" })).toBeUndefined();
    expect(safeEndSessionEndpoint("http://idp.example.com/logout")).toBeUndefined();
  });

  test("refuses a target carrying header-breaking control characters", () => {
    const injected = `${ENDPOINT}\r\nSet-Cookie: hp=1`;

    expect(safeAbsoluteUrl(injected)).toBeUndefined();
    expect(buildEndSessionRedirect({ endpoint: injected, clientId: "headplane" })).toBeUndefined();
  });
});

describe("resolving the redirect", () => {
  test("uses the endpoints discovery already resolved, with no second fetch", async () => {
    const discover = vi.fn(async () => ({ ok: false as const, error: new Error("never") }));
    const target = await resolveIdpLogoutRedirect({
      provider: provider({ endpoint: ENDPOINT, discover }),
      clientId: "headplane",
      idToken: "token",
      postLogoutRedirectUri: POST_LOGOUT,
    });

    expect(new URL(target!).searchParams.get("id_token_hint")).toBe("token");
    expect(discover).not.toHaveBeenCalled();
  });

  test("discovers once when the login flow has not resolved endpoints yet", async () => {
    const discover = vi.fn(async () => ({
      ok: true as const,
      value: { endSessionEndpoint: ENDPOINT },
    }));

    const target = await resolveIdpLogoutRedirect({
      provider: provider({ ready: false, discover }),
      clientId: "headplane",
      postLogoutRedirectUri: POST_LOGOUT,
    });

    expect(new URL(target!).searchParams.get("client_id")).toBe("headplane");
    expect(discover).toHaveBeenCalledTimes(1);
  });

  test("falls back to the local redirect when the endpoint is unknown", async () => {
    await expect(
      resolveLogoutRedirect({
        localRedirect: "/login",
        idpLogout: { provider: provider({ endpoint: undefined }), clientId: "headplane" },
      }),
    ).resolves.toBe("/login");
  });

  test("falls back when discovery reports an HTTP or provider failure", async () => {
    await expect(
      resolveLogoutRedirect({
        localRedirect: "/login",
        idpLogout: {
          provider: provider({
            ready: false,
            discover: vi.fn(async () => ({ ok: false as const, error: new Error("HTTP 500") })),
          }),
          clientId: "headplane",
        },
      }),
    ).resolves.toBe("/login");
  });

  test("falls back when discovery throws instead of returning a result", async () => {
    await expect(
      resolveLogoutRedirect({
        localRedirect: "/login",
        idpLogout: {
          provider: provider({
            ready: false,
            discover: vi.fn(async () => {
              throw new Error("certificate has expired");
            }),
          }),
          clientId: "headplane",
        },
      }),
    ).resolves.toBe("/login");
  });

  test("falls back once the short timeout expires", async () => {
    const never = new Promise<never>(() => {});
    const target = await resolveLogoutRedirect({
      localRedirect: "/login?s=logout",
      idpLogout: {
        provider: provider({ ready: false, discover: () => never }),
        clientId: "headplane",
        timeoutMs: 10,
      },
    });

    expect(target).toBe("/login?s=logout");
  });

  test("a slow discovery cannot resolve after the timeout won", async () => {
    let resolveDiscover:
      | ((value: { ok: true; value: { endSessionEndpoint: string } }) => void)
      | undefined;
    const pending = new Promise<{ ok: true; value: { endSessionEndpoint: string } }>((resolve) => {
      resolveDiscover = resolve;
    });

    const result = await resolveLogoutRedirect({
      localRedirect: "/login",
      idpLogout: {
        provider: provider({ ready: false, discover: () => pending }),
        clientId: "headplane",
        timeoutMs: 5,
      },
    });

    expect(result).toBe("/login");
    resolveDiscover?.({ ok: true, value: { endSessionEndpoint: ENDPOINT } });
  });
});

describe("post-logout redirect target", () => {
  test("defaults to the app's own login page on its base URL", () => {
    expect(defaultPostLogoutRedirectUri("https://headplane.example.com", false)).toBe(
      "https://headplane.example.com/admin/login",
    );
    expect(defaultPostLogoutRedirectUri("https://headplane.example.com", true)).toBe(
      "https://headplane.example.com/admin/login?s=logout",
    );
  });

  test("is unknown without a base URL", () => {
    expect(defaultPostLogoutRedirectUri(undefined, false)).toBeUndefined();
    expect(defaultPostLogoutRedirectUri("", false)).toBeUndefined();
  });
});

describe("withTimeout", () => {
  test("passes a fast value through", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  test("resolves undefined when the value never arrives", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 5)).resolves.toBeUndefined();
  });
});
