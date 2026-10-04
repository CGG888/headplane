import type { TranslationKey } from "~/i18n";

/**
 * Stable error codes returned by the API key action, mapped onto the localized
 * message each dialog renders. Kept free of server imports so client dialogs
 * can use it without pulling server-only modules into the browser bundle.
 */
export type ApiKeyErrorCode = "invalidExpiration" | "invalidPrefix" | "notFound" | "invalidAction";

export const API_KEY_ERROR_KEYS: Record<ApiKeyErrorCode, TranslationKey> = {
  invalidExpiration: "settings.apiKeys.errors.invalidExpiration",
  invalidPrefix: "settings.apiKeys.errors.invalidPrefix",
  notFound: "settings.apiKeys.errors.notFound",
  invalidAction: "errors.generic.requestFailed",
};
