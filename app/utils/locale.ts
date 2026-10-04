import { createCookie } from "react-router";

export const LOCALES = ["en", "zh-Hans", "zh-Hant"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// Mirrors `color_scheme` in `~/utils/color-scheme`: a long lived, lax cookie so
// the choice survives across sessions and works before the user is logged in.
const cookie = createCookie("locale", {
  maxAge: 34560000,
  sameSite: "lax",
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Maps a single BCP-47 language tag onto one of our supported locales. Chinese
 * defaults to Simplified unless the script or region says otherwise.
 */
function matchLanguageTag(tag: string): Locale | undefined {
  const normalized = tag.trim().toLowerCase();
  if (normalized === "") {
    return undefined;
  }

  const [language, ...subtags] = normalized.split("-");
  if (language === "en") {
    return "en";
  }

  if (language === "zh") {
    return /(hant|tw|hk|mo)/.test(subtags.join("-")) ? "zh-Hant" : "zh-Hans";
  }

  return undefined;
}

/**
 * Picks the best supported locale from an `Accept-Language` header, honouring
 * the q-values and preserving the client's ordering for equal weights.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale | undefined {
  if (!acceptLanguage) {
    return undefined;
  }

  const entries = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [tag, ...params] = entry.trim().split(";");
      let quality = 1;
      for (const param of params) {
        const [key, value] = param.trim().split("=");
        if (key === "q") {
          const parsed = Number.parseFloat(value);
          if (!Number.isNaN(parsed)) {
            quality = parsed;
          }
        }
      }

      return { tag: tag.trim(), quality, index };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const entry of entries) {
    const matched = matchLanguageTag(entry.tag);
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

/**
 * Resolves the request locale: explicit cookie first, then `Accept-Language`,
 * then the default locale.
 */
export async function getLocale(request: Request): Promise<Locale> {
  const header = request.headers.get("Cookie");
  const parsed = await cookie.parse(header);
  if (isLocale(parsed?.locale)) {
    return parsed.locale;
  }

  return negotiateLocale(request.headers.get("Accept-Language")) ?? DEFAULT_LOCALE;
}

export function setLocale(locale: Locale) {
  return cookie.serialize({ locale });
}
