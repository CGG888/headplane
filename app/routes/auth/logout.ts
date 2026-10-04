import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router";

import { appConfigContext, authContext, oidcContext } from "~/server/context";
import log from "~/utils/log";

/**
 * Logout happens through a plain navigation (`GET /logout`) because submitting
 * to a resource route can degrade into a native form POST, which reverse
 * proxies are known to mangle (they may forward it without a body). The POST
 * action is kept for compatibility with older clients and forms.
 */
export async function loader(args: LoaderFunctionArgs) {
  return performLogout(args);
}

export async function action(args: ActionFunctionArgs) {
  return performLogout(args);
}

/**
 * A `GET` that ends a session must not be triggerable from another site, so we
 * refuse cross-site navigations. Browsers that do not send `Sec-Fetch-Site`
 * (older ones, or a proxy that strips it) are allowed through so logging out
 * never breaks.
 */
export function isSameSiteLogout(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === null) {
    return true;
  }

  return site === "same-origin" || site === "none";
}

async function performLogout({ request, context }: ActionFunctionArgs | LoaderFunctionArgs) {
  if (request.method === "GET" && !isSameSiteLogout(request)) {
    log.warn("auth", "Refusing cross-site logout request from %s", request.headers.get("referer"));
    return redirect("/machines");
  }

  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const oidc = context.get(oidcContext);

  let principal: Awaited<ReturnType<typeof auth.require>> | undefined;
  try {
    principal = await auth.require(request);
  } catch {
    return redirect("/login");
  }

  // When API key is disabled, we need to explicitly redirect
  // with a logout state to prevent auto login again.
  let url = config.oidc?.disable_api_key_login ? "/login?s=logout" : "/login";

  // For OIDC sessions, redirect to the provider's RP-initiated logout
  // endpoint when explicitly enabled, so the upstream IdP session is also
  // ended. Disabled by default because the post_logout_redirect_uri must be
  // pre-registered on the IdP — turning this on without registering it would
  // strand users on the IdP's error page.
  if (principal?.kind === "oidc" && oidc.state === "enabled" && config.oidc?.use_end_session) {
    // Never let an unreachable or misconfigured IdP block the local logout.
    try {
      const service = oidc.value;
      const status = service.status();
      if (status.state !== "ready") {
        // Trigger discovery if it hasn't happened yet so we can find the
        // end_session_endpoint without forcing a re-login.
        await service.discover();
      }

      const endSessionUrl = service.buildEndSessionUrl(principal.idToken);
      if (endSessionUrl) {
        url = endSessionUrl;
      }
    } catch (error) {
      log.warn("auth", "OIDC end-session logout failed, falling back to local logout: %s", error);
    }
  }

  return redirect(url, {
    headers: {
      "Set-Cookie": await auth.destroySession(request),
    },
  });
}
