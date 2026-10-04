import { redirect } from "react-router";

import { isValidColorScheme, setColorScheme } from "~/utils/color-scheme";
import log from "~/utils/log";

import type { Route } from "./+types/color-scheme";

/**
 * Reads the requested color scheme from the query string (GET) or the form body
 * (POST). Reverse proxies that strip the body from POSTs would otherwise make
 * `request.formData()` throw and surface as a server error in the browser.
 */
async function readRequest(request: Request) {
  const url = new URL(request.url);
  let colorScheme: unknown = url.searchParams.get("colorScheme");
  let returnTo = safeRedirect(url.searchParams.get("returnTo"));

  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const formData = await request.formData();
      colorScheme = formData.get("colorScheme") ?? colorScheme;
      returnTo = safeRedirect(formData.get("returnTo")) ?? returnTo;
    } catch (error) {
      log.warn(
        "server",
        "Color scheme switch arrived without a parsable body (method=%s content-type=%s content-length=%s): %s",
        request.method,
        request.headers.get("content-type") ?? "none",
        request.headers.get("content-length") ?? "none",
        String(error),
      );
    }
  }

  return { colorScheme, returnTo };
}

async function applyColorScheme(colorScheme: unknown, returnTo: string) {
  if (!colorScheme || !isValidColorScheme(colorScheme)) {
    log.warn("server", "Ignoring color scheme switch with unsupported value: %o", colorScheme);
    // Redirect anyway so the browser never renders a JSON error on this URL.
    return redirect(returnTo);
  }

  return redirect(returnTo, {
    headers: {
      "Set-Cookie": await setColorScheme(colorScheme),
    },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const { colorScheme, returnTo } = await readRequest(request);
  return applyColorScheme(colorScheme, returnTo);
}

export async function action({ request }: Route.ActionArgs) {
  const { colorScheme, returnTo } = await readRequest(request);
  return applyColorScheme(colorScheme, returnTo);
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
