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
  | "invalidBooleanValue"
  | "invalidDerpUrl"
  | "duplicateDerpUrl"
  | "derpUrlNotFound"
  | "invalidDerpPath"
  | "duplicateDerpPath"
  | "derpPathNotFound"
  | "invalidDerpUpdateFrequency"
  | "invalidDerpRegionId"
  | "invalidDerpRegionCode"
  | "missingDerpStunAddr"
  | "invalidDerpStunAddr"
  | "invalidDerpPrivateKeyPath"
  | "invalidDerpRegionMapId"
  | "invalidDerpRegionMapName"
  | "derpRegionMapNotFound"
  | "derpRegionMapWriteFailed"
  | "derpPathsRequired";

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
  invalidDerpUrl: "settings.headscale.errors.invalidDerpUrl",
  duplicateDerpUrl: "settings.headscale.errors.duplicateDerpUrl",
  derpUrlNotFound: "settings.headscale.errors.derpUrlNotFound",
  invalidDerpPath: "settings.headscale.errors.invalidDerpPath",
  duplicateDerpPath: "settings.headscale.errors.duplicateDerpPath",
  derpPathNotFound: "settings.headscale.errors.derpPathNotFound",
  invalidDerpUpdateFrequency: "settings.headscale.errors.invalidDerpUpdateFrequency",
  invalidDerpRegionId: "settings.headscale.errors.invalidDerpRegionId",
  invalidDerpRegionCode: "settings.headscale.errors.invalidDerpRegionCode",
  missingDerpStunAddr: "settings.headscale.errors.missingDerpStunAddr",
  invalidDerpStunAddr: "settings.headscale.errors.invalidDerpStunAddr",
  invalidDerpPrivateKeyPath: "settings.headscale.errors.invalidDerpPrivateKeyPath",
  invalidDerpRegionMapId: "settings.headscale.errors.invalidDerpRegionMapId",
  invalidDerpRegionMapName: "settings.headscale.errors.invalidDerpRegionMapName",
  derpRegionMapNotFound: "settings.headscale.errors.derpRegionMapNotFound",
  derpRegionMapWriteFailed: "settings.headscale.errors.derpRegionMapWriteFailed",
  derpPathsRequired: "settings.headscale.errors.derpPathsRequired",
};

export interface HeadscaleSettingsSuccess {
  success: true;
}

export interface HeadscaleSettingsFailure {
  success: false;
  errorCode: HeadscaleSettingsErrorCode;
}

export type HeadscaleSettingsResult = HeadscaleSettingsSuccess | HeadscaleSettingsFailure;
