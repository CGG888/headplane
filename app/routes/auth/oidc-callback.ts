import { data, redirect } from "react-router";

import {
  appConfigContext,
  authContext,
  headscaleApiKeyContext,
  headscaleContext,
  oidcContext,
} from "~/server/context";
import { logOidcError } from "~/server/oidc/provider";
import { findHeadscaleUserBySubject } from "~/server/web/headscale-identity";
import { isAssignableRole } from "~/server/web/roles";
import log from "~/utils/log";
import { createOidcStateCookie } from "~/utils/oidc-state";

import type { Route } from "./+types/oidc-callback";
import { isIdpLogoutEnabled } from "./end-session";

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const headscale = context.get(headscaleContext);
  const headscaleApiKey = context.get(headscaleApiKeyContext);
  const oidc = context.get(oidcContext);

  if (oidc.state !== "enabled") {
    throw data(`OIDC is unavailable: ${oidc.reason}`, { status: 501 });
  }
  const service = oidc.value;

  if (url.searchParams.toString().length === 0) {
    log.warn("auth", "Called OIDC callback without query parameters");
    return redirect("/login?s=error_no_query");
  }

  const cookie = createOidcStateCookie(config);
  // Every exit from this loader clears the state cookie. It carries the nonce,
  // the PKCE verifier and the redirect URI, all of which are single-use, so it
  // must not survive the callback — not even the failing ones.
  const clearStateCookie = await cookie.clear();
  const stateCookieHeader = { "Set-Cookie": clearStateCookie };

  if (url.searchParams.toString().length === 0) {
    log.warn("auth", "Called OIDC callback without query parameters");
    return redirect("/login?s=error_no_query", { headers: stateCookieHeader });
  }

  const oidcCookieState = await cookie.parse(request.headers.get("Cookie"));

  if (oidcCookieState == null) {
    log.warn("auth", "Called OIDC callback without session cookie");
    return redirect("/login?s=error_no_session", { headers: stateCookieHeader });
  }

  const { state, nonce, redirect_uri, verifier } = oidcCookieState;
  if (!state || !nonce || !redirect_uri || !verifier) {
    log.warn("auth", "OIDC session cookie is missing required fields");
    return redirect("/login?s=error_invalid_session", { headers: stateCookieHeader });
  }

  const flowState = {
    state,
    nonce,
    codeVerifier: verifier,
    redirectUri: redirect_uri,
  };

  const result = await service.handleCallback(url.searchParams, flowState);
  if (!result.ok) {
    logOidcError("OIDC callback failed", result.error);
    return redirect("/login?s=error_auth_failed", { headers: stateCookieHeader });
  }

  const identity = result.value;
  // `owner` is never taken from a claim (role ownership only changes inside
  // HeadplaneCN), and anything that is not a role at all is dropped here rather
  // than stored and looked up later.
  const claimedRole = identity.role && isAssignableRole(identity.role) ? identity.role : undefined;

  const userId = await auth.findOrCreateUser(
    identity.subject,
    {
      name: identity.name,
      email: identity.email,
      picture: identity.picture,
    },
    {
      initialRole: claimedRole ?? config.oidc?.default_role,
      syncRole: claimedRole,
    },
  );

  try {
    // Looks up the Headscale user that matches this OIDC identity. We use
    // the configured admin API key here — not a per-request one — because
    // there is no per-request key yet (the session is being created).
    const hsApi = headscale.client(headscaleApiKey!);
    const hsUsers = await hsApi.users.list();
    // The email fallback matches a Headscale user by address, so it is only safe
    // while the provider vouches for that address: an unverified email is one the
    // account holder typed in, which turns this convenience into a way to claim
    // someone else's Headscale row.
    const emailForMatching = identity.emailVerified === false ? undefined : identity.email;
    if (identity.email !== undefined && emailForMatching === undefined) {
      log.warn(
        "auth",
        "Not matching Headscale users by email: the provider reports it as unverified",
      );
    }

    const hsUser = findHeadscaleUserBySubject(hsUsers, identity.subject, emailForMatching);
    if (hsUser) {
      await auth.linkHeadscaleUser(userId, hsUser.id);
    }
  } catch (error) {
    log.warn("auth", "Failed to link Headscale user: %s", String(error));
  }

  // Only persist the id_token when RP-initiated logout is enabled — otherwise
  // we'd be storing a credential we never use. Both the documented
  // `logout_idp` switch and its older spelling enable it.
  const idToken = isIdpLogoutEnabled(config.oidc) ? identity.idToken : undefined;

  // Two cookies, two `Set-Cookie` headers: `Headers.append` keeps them separate
  // (a plain object or a tuple array would collapse them into one line and the
  // browser would drop one of the two).
  const headers = new Headers();
  headers.append("Set-Cookie", clearStateCookie);
  headers.append(
    "Set-Cookie",
    await auth.createOidcSession(
      userId,
      {
        name: identity.name,
        email: identity.email,
        username: identity.username,
      },
      { idToken },
    ),
  );

  return redirect("/", { headers });
}
