import { redirect } from "react-router";

import { isLocale, setLocale } from "~/utils/locale";
import log from "~/utils/log";

import type { Route } from "./+types/locale";

/**
 * Reads the requested locale from the query string (GET) or the form body
 * (POST). Some reverse proxies strip the body from POSTs, which used to make
 * `request.formData()` throw; we log that and fall back to the query string so
 * the switcher keeps working.
 */
async function readRequest(request: Request) {
  const url = new URL(request.url);
  let locale: unknown = url.searchParams.get("locale");
  let returnTo = safeRedirect(url.searchParams.get("returnTo"));

  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const formData = await request.formData();
      locale = formData.get("locale") ?? locale;
      returnTo = safeRedirect(formData.get("returnTo")) ?? returnTo;
    } catch (error) {
      log.warn(
        "server",
        "Locale switch arrived without a parsable body (method=%s content-type=%s content-length=%s): %s",
        request.method,
        request.headers.get("content-type") ?? "none",
        request.headers.get("content-length") ?? "none",
        String(error),
      );
    }
  }

  return { locale, returnTo };
}

async function applyLocale(locale: unknown, returnTo: string) {
  if (!isLocale(locale)) {
    log.warn("server", "Ignoring locale switch with unsupported value: %o", locale);
    // Always redirect instead of returning an error page: the browser ends up
    // on this URL when a proxy drops the POST body, and an error response would
    // leave the user staring at a JSON payload.
    return redirect(returnTo);
  }

  return redirect(returnTo, {
    headers: {
      "Set-Cookie": await setLocale(locale),
    },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const { locale, returnTo } = await readRequest(request);
  return applyLocale(locale, returnTo);
}

export async function action({ request }: Route.ActionArgs) {
  const { locale, returnTo } = await readRequest(request);
  return applyLocale(locale, returnTo);
}

// Stolen from react-router thanks!
function safeRedirect(to: unknown) {
  if (!to || typeof to !== "string") {
    return "/";
  }

  if (!to.startsWith("/") || to.startsWith("//")) {
    return "/";
  }

  return to;
}
