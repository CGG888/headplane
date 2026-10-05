import type { TranslationKey } from "~/i18n";

import type { OidcSelfTestReport } from "./oidc-self-test";

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
  | "invalidDerpIpv4"
  | "invalidDerpIpv6"
  | "invalidDerpPrivateKeyPath"
  | "invalidDerpRegionMapId"
  | "invalidDerpRegionMapName"
  | "derpRegionMapNotFound"
  | "derpRegionMapWriteFailed"
  | "derpPathsRequired"
  | "invalidOidcExtraParams"
  | "duplicateOidcExtraParam"
  | "invalidHaProbeInterval"
  | "invalidHaProbeTimeout"
  | "invalidHaProbeCombination";

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
  invalidDerpIpv4: "settings.headscale.errors.invalidDerpIpv4",
  invalidDerpIpv6: "settings.headscale.errors.invalidDerpIpv6",
  invalidDerpPrivateKeyPath: "settings.headscale.errors.invalidDerpPrivateKeyPath",
  invalidDerpRegionMapId: "settings.headscale.errors.invalidDerpRegionMapId",
  invalidDerpRegionMapName: "settings.headscale.errors.invalidDerpRegionMapName",
  derpRegionMapNotFound: "settings.headscale.errors.derpRegionMapNotFound",
  derpRegionMapWriteFailed: "settings.headscale.errors.derpRegionMapWriteFailed",
  derpPathsRequired: "settings.headscale.errors.derpPathsRequired",
  invalidOidcExtraParams: "settings.headscale.errors.invalidOidcExtraParams",
  duplicateOidcExtraParam: "settings.headscale.errors.duplicateOidcExtraParam",
  invalidHaProbeInterval: "settings.headscale.errors.invalidHaProbeInterval",
  invalidHaProbeTimeout: "settings.headscale.errors.invalidHaProbeTimeout",
  invalidHaProbeCombination: "settings.headscale.errors.invalidHaProbeCombination",
};

export interface HeadscaleSettingsSuccess {
  success: true;
  /** Present only for the read-only `test_oidc` action. */
  selfTest?: OidcSelfTestReport;
}

export interface HeadscaleSettingsFailure {
  success: false;
  errorCode: HeadscaleSettingsErrorCode;
}

export type HeadscaleSettingsResult = HeadscaleSettingsSuccess | HeadscaleSettingsFailure;
