import type { TranslationKey } from "~/i18n";

/**
 * Stable error codes returned by the Headscale settings action, mapped onto the
 * localized message the page renders. Kept free of server imports so the page
 * can use it without pulling server-only modules into the browser bundle.
 */
export type HeadscaleSettingsErrorCode =
  | "invalidAction"
  | "invalidIssuer"
  | "invalidClientId"
  | "invalidScope"
  | "invalidPkceMethod"
  | "invalidCidr"
  | "unspecifiedCidr"
  | "duplicateProxy"
  | "proxyNotFound"
  | "invalidPolicyMode"
  | "invalidNodeExpiry"
  | "invalidEphemeralInactivity"
  | "invalidLogLevel"
  | "invalidLogFormat"
  | "invalidBooleanValue";

export const HEADSCALE_SETTINGS_ERROR_KEYS: Record<HeadscaleSettingsErrorCode, TranslationKey> = {
  invalidAction: "settings.headscale.errors.invalidAction",
  invalidIssuer: "settings.headscale.errors.invalidIssuer",
  invalidClientId: "settings.headscale.errors.invalidClientId",
  invalidScope: "settings.headscale.errors.invalidScope",
  invalidPkceMethod: "settings.headscale.errors.invalidPkceMethod",
  invalidCidr: "settings.headscale.errors.invalidCidr",
  unspecifiedCidr: "settings.headscale.errors.unspecifiedCidr",
  duplicateProxy: "settings.headscale.errors.duplicateProxy",
  proxyNotFound: "settings.headscale.errors.proxyNotFound",
  invalidPolicyMode: "settings.headscale.errors.invalidPolicyMode",
  invalidNodeExpiry: "settings.headscale.errors.invalidNodeExpiry",
  invalidEphemeralInactivity: "settings.headscale.errors.invalidEphemeralInactivity",
  invalidLogLevel: "settings.headscale.errors.invalidLogLevel",
  invalidLogFormat: "settings.headscale.errors.invalidLogFormat",
  invalidBooleanValue: "settings.headscale.errors.invalidBooleanValue",
};

export interface HeadscaleSettingsSuccess {
  success: true;
}

export interface HeadscaleSettingsFailure {
  success: false;
  errorCode: HeadscaleSettingsErrorCode;
}

export type HeadscaleSettingsResult = HeadscaleSettingsSuccess | HeadscaleSettingsFailure;
