import { data, redirect } from "react-router";

import { isLocale, setLocale } from "~/utils/locale";

import type { Route } from "./+types/locale";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const locale = formData.get("locale");
  const returnTo = safeRedirect(formData.get("returnTo"));

  if (!isLocale(locale)) {
    throw data("Bad Request", { status: 400 });
  }

  return redirect(returnTo, {
    headers: {
      "Set-Cookie": await setLocale(locale),
    },
  });
}

// Stolen from react-router thanks!
function safeRedirect(to: FormDataEntryValue | null) {
  if (!to || typeof to !== "string") {
    return "/";
  }

  if (!to.startsWith("/") || to.startsWith("//")) {
    return "/";
  }

  return to;
}
