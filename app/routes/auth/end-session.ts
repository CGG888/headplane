// MARK: Provider logout (RP-initiated logout)
//
// Everything `/logout` needs to end the *identity provider's* session as well
// as HeadplaneCN's own. The rules here are deliberately strict because the
// result is handed to `redirect()` and becomes a `Location` header:
//
//   * the target must be an absolute `https:` URL that came from the discovery
//     document or from `oidc.end_session_endpoint` — nothing user-supplied;
//   * the serialized target must be free of control characters, so no value can
//     smuggle a header break into the response;
//   * the whole path is fail-soft. A missing endpoint, a provider that is down
//     or slow, a rejected fetch, and a malformed URL all resolve to the local
//     logout target, which is what the route already did before.
//
// The module is pure and dependency-free on purpose: the unit tests exercise
// every branch with plain values and a fake provider, with no network.

/** How long the provider is given to answer before the local fallback wins. */
export const IDP_LOGOUT_TIMEOUT_MS = 3_000;

/**
 * C0/C1 control characters. The WHATWG URL parser strips tabs and newlines
 * before parsing, but anything else (and a pre-encoded `%0d%0a`) must never
 * reach the header, so the raw input is rejected before it is parsed.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return true;
    }
  }

  return false;
}

/** The subset of the OIDC service this module needs. */
export interface EndSessionProvider {
  status():
    | { state: "ready"; endpoints: { endSessionEndpoint?: string } }
    | { state: "pending" }
    | { state: "error"; error: unknown };

  discover(): Promise<
    { ok: true; value: { endSessionEndpoint?: string } } | { ok: false; error: unknown }
  >;
}

/** The `oidc:` keys that decide whether the provider is logged out too. */
export interface IdpLogoutConfig {
  logout_idp?: boolean;
  use_end_session?: boolean;
}

export interface EndSessionRedirectInput {
  endpoint: string | undefined;
  clientId: string;
  idToken?: string;
  postLogoutRedirectUri?: string;
}

export interface IdpLogoutInput {
  provider: EndSessionProvider;
  clientId: string;
  idToken?: string;
  postLogoutRedirectUri?: string;
  timeoutMs?: number;
}

export interface LogoutRedirectInput {
  /** What the route would redirect to if only the local session ended. */
  localRedirect: string;
  /** Absent when the provider logout is disabled or the session is not OIDC. */
  idpLogout?: IdpLogoutInput | null;
}

/**
 * `oidc.logout_idp` is the documented switch; `oidc.use_end_session` is the
 * older spelling and still enables the same behaviour.
 */
export function isIdpLogoutEnabled(config: IdpLogoutConfig | undefined): boolean {
  return config?.logout_idp === true || config?.use_end_session === true;
}

/**
 * An absolute URL with an allowed scheme, or `undefined`. `https:` is required
 * for anything that becomes the redirect target; the post-logout URI is only a
 * query parameter, so it may also be `http:` for a local development setup.
 */
export function safeAbsoluteUrl(
  value: string | undefined,
  protocols: readonly string[] = ["https:"],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || hasControlCharacters(trimmed)) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (!protocols.includes(url.protocol) || url.hostname.length === 0) {
    return undefined;
  }

  // Re-check the serialized form: `URL` may decode or normalize during parsing.
  if (hasControlCharacters(url.href)) {
    return undefined;
  }

  return url.href;
}

/**
 * The `end_session_endpoint` from the discovery document, or the configured
 * override, as a redirect target that is safe to hand to `redirect()`.
 */
export function safeEndSessionEndpoint(endpoint: string | undefined): string | undefined {
  return safeAbsoluteUrl(endpoint, ["https:"]);
}

/**
 * The RP-initiated logout URL: `client_id`, `post_logout_redirect_uri` and,
 * when the session has one, `id_token_hint`. Every parameter is set through
 * `URLSearchParams`, so provider values are percent-encoded and cannot break
 * out of the query string.
 */
export function buildEndSessionRedirect(input: EndSessionRedirectInput): string | undefined {
  const endpoint = safeEndSessionEndpoint(input.endpoint);
  if (endpoint === undefined) {
    return undefined;
  }

  const url = new URL(endpoint);

  const clientId = input.clientId.trim();
  if (clientId.length > 0) {
    url.searchParams.set("client_id", clientId);
  }

  const postLogoutRedirectUri = safeAbsoluteUrl(input.postLogoutRedirectUri, ["https:", "http:"]);
  if (postLogoutRedirectUri !== undefined) {
    url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  }

  const idToken = input.idToken?.trim();
  if (idToken !== undefined && idToken.length > 0) {
    url.searchParams.set("id_token_hint", idToken);
  }

  return safeEndSessionEndpoint(url.href);
}

/**
 * `base_url` plus the app's own login page, which is what the provider should
 * return the browser to after it ends its session. The `?s=logout` marker is
 * kept when API key sign-in is disabled, so the login page does not immediately
 * sign the user back in — the same target the local logout uses.
 */
export function defaultPostLogoutRedirectUri(
  baseUrl: string | undefined,
  disableApiKeyLogin: boolean,
  prefix: string = __PREFIX__,
): string | undefined {
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    return undefined;
  }

  const path = disableApiKeyLogin ? `${prefix}/login?s=logout` : `${prefix}/login`;
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * Resolves with the promise's value, or with `undefined` once `ms` elapse. The
 * losing promise keeps running (its refusal is already observed by the race),
 * so a slow provider cannot hold the logout navigation open.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T | undefined>([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * The provider's end-session endpoint, without a second discovery round trip
 * when the login flow already resolved it. Never throws: an unexpected failure
 * or a timeout becomes `undefined` and the caller falls back to local logout.
 */
export async function resolveIdpLogoutRedirect(input: IdpLogoutInput): Promise<string | undefined> {
  try {
    let endpoint: string | undefined;

    const status = input.provider.status();
    if (status.state === "ready") {
      // Already discovered for a login (or for an earlier logout) — no fetch.
      endpoint = status.endpoints.endSessionEndpoint;
    } else {
      const discovered = await withTimeout(
        input.provider.discover().catch(() => undefined),
        input.timeoutMs ?? IDP_LOGOUT_TIMEOUT_MS,
      );

      if (discovered?.ok === true) {
        endpoint = discovered.value.endSessionEndpoint;
      }
    }

    if (endpoint === undefined) {
      return undefined;
    }

    return buildEndSessionRedirect({
      endpoint,
      clientId: input.clientId,
      idToken: input.idToken,
      postLogoutRedirectUri: input.postLogoutRedirectUri,
    });
  } catch {
    return undefined;
  }
}

/**
 * The redirect `/logout` performs: the provider's end-session URL when one can
 * be built safely and quickly, and the local login page otherwise. With
 * `idpLogout` absent this returns `localRedirect` untouched, which is exactly
 * the behaviour an existing deployment has today.
 */
export async function resolveLogoutRedirect(input: LogoutRedirectInput): Promise<string> {
  if (input.idpLogout === undefined || input.idpLogout === null) {
    return input.localRedirect;
  }

  const target = await resolveIdpLogoutRedirect(input.idpLogout);
  return target ?? input.localRedirect;
}
