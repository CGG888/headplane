import type { TranslationKey } from "~/i18n";

import type { AuthKeyBulkDeleteErrorCode, AuthKeyDeleteErrorCode } from "./result";

/**
 * Stable error codes returned by the pre-auth key delete action, mapped onto
 * the localized message the confirmation dialog renders. Kept free of server
 * imports so client dialogs can use it without pulling server-only modules
 * into the browser bundle.
 */
export const AUTH_KEY_ERROR_KEYS: Record<AuthKeyDeleteErrorCode, TranslationKey> = {
  invalidKeyId: "errors.generic.requestFailed",
  notFound: "settings.authKeys.errors.notFound",
  unsupported: "settings.authKeys.errors.unsupported",
};

/** The same mapping for the one-click cleanup, which may also lack an owner. */
export const AUTH_KEY_BULK_ERROR_KEYS: Record<AuthKeyBulkDeleteErrorCode, TranslationKey> = {
  ...AUTH_KEY_ERROR_KEYS,
  forbidden: "errors.permission.manageUserPreAuthKeys",
};
