const FORM_CONTENT_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);

/**
 * Reverse proxies (Lucky and friends) sometimes forward a form POST without its
 * `Content-Type`, or with one React Router cannot parse. `request.formData()`
 * then throws, which turns every save, key creation and policy edit into an
 * "Unexpected Server Error". Every action in Headplane reads its body as form
 * data, so restoring the header on the way in is safe.
 */
export function shouldDefaultToFormBody(method?: string, contentType?: string | null) {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") {
    return false;
  }

  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return !FORM_CONTENT_TYPES.has(type);
}
