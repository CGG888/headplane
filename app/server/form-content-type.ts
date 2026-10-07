const FORM_CONTENT_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);

/** Where the request says it came from, and what this deployment's own origin is. */
export interface FormContentTypeContext {
  origin?: string | null;
  baseUrl?: string;
}

/**
 * Reverse proxies (Lucky and friends) sometimes forward a form POST without its
 * `Content-Type`, or with one React Router cannot parse. `request.formData()`
 * then throws, which turns every save, key creation and policy edit into an
 * "Unexpected Server Error". Every action in Headplane reads its body as form
 * data, so restoring the header on the way in is safe — as long as the request is
 * one of our own pages.
 *
 * A *cross-site* `text/plain` or `application/octet-stream` POST is a CORS simple
 * request, so it reaches the server without a preflight; rewriting its header
 * would hand it a parsed body. Those requests keep their declared type (and fail
 * to parse) while same-origin ones, including the proxy-mangled case, are still
 * repaired.
 */
export function shouldDefaultToFormBody(
  method?: string,
  contentType?: string | null,
  context?: FormContentTypeContext,
) {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") {
    return false;
  }

  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (FORM_CONTENT_TYPES.has(type)) {
    return false;
  }

  // A header the proxy dropped is always restored: there is nothing to preserve.
  if (type.length === 0) {
    return true;
  }

  const origin = context?.origin;
  if (!origin) {
    // Not a browser navigation (curl, the proxy itself), so there is no victim
    // session to borrow and the proxy workaround has to keep working.
    return true;
  }

  return isSameOrigin(origin, context?.baseUrl);
}

function isSameOrigin(origin: string, baseUrl: string | undefined): boolean {
  if (!baseUrl) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
