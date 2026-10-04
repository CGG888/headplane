import type { TranslationKey } from "~/i18n";

/**
 * Stable error codes returned by the system status action, mapped onto the
 * localized message the page renders. Kept free of server imports so the page
 * can use it without pulling server-only modules into the browser bundle.
 */
export type SystemErrorCode = "invalidAction" | "notAvailable" | "failed";

export const SYSTEM_ERROR_KEYS: Record<SystemErrorCode, TranslationKey> = {
  invalidAction: "settings.system.errors.invalidAction",
  notAvailable: "settings.system.errors.notAvailable",
  failed: "settings.system.errors.failed",
};

export interface SystemSuccess {
  success: true;
}

export interface SystemFailure {
  success: false;
  errorCode: SystemErrorCode;
}

export type SystemResult = SystemSuccess | SystemFailure;
