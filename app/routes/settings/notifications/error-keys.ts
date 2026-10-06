import type { TranslationKey } from "~/i18n";

/**
 * Stable error codes returned by the notification action, mapped onto the
 * localized message the page renders. Nothing here is English prose, and the
 * module stays free of server imports so the form can use it in the browser.
 */
export type AlertActionErrorCode =
  | "invalidAction"
  | "invalidUrl"
  | "invalidInterval"
  | "invalidCooldown"
  | "invalidExpiry"
  | "invalidLanguage"
  | "noEvents"
  | "notConfigured"
  | "writeFailed";

export const ALERT_ERROR_KEYS: Record<AlertActionErrorCode, TranslationKey> = {
  invalidAction: "settings.notifications.errors.invalidAction",
  invalidUrl: "settings.notifications.errors.invalidUrl",
  invalidInterval: "settings.notifications.errors.invalidInterval",
  invalidCooldown: "settings.notifications.errors.invalidCooldown",
  invalidExpiry: "settings.notifications.errors.invalidExpiry",
  invalidLanguage: "settings.notifications.errors.invalidLanguage",
  noEvents: "settings.notifications.errors.noEvents",
  notConfigured: "settings.notifications.errors.notConfigured",
  writeFailed: "settings.notifications.errors.writeFailed",
};
