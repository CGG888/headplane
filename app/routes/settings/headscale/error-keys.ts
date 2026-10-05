import type { TranslationKey } from "~/i18n";

import type { DerpMapIssue, DerpMapIssueCode } from "./derp-map-schema";
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
  | "invalidDerpSyncInterval"
  | "invalidDerpSyncFamilies"
  | "derpSyncSaveFailed"
  | "invalidHostEchoUrl"
  | "hostEchoSaveFailed"
  | "invalidOidcExtraParams"
  | "duplicateOidcExtraParam"
  | "invalidHaProbeInterval"
  | "invalidHaProbeTimeout"
  | "invalidHaProbeCombination"
  | "invalidDerpMapPath"
  | "derpMapPathNotConfigured"
  | "derpMapTooLarge"
  | "derpMapInvalid"
  | "derpMapUnavailable"
  | "derpMapNotWritable"
  | "derpMapWriteFailed"
  | "derpMapNoSnapshot";

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
  invalidDerpSyncInterval: "settings.headscale.errors.invalidDerpSyncInterval",
  invalidDerpSyncFamilies: "settings.headscale.errors.invalidDerpSyncFamilies",
  derpSyncSaveFailed: "settings.headscale.errors.derpSyncSaveFailed",
  invalidHostEchoUrl: "settings.headscale.errors.invalidHostEchoUrl",
  hostEchoSaveFailed: "settings.headscale.errors.hostEchoSaveFailed",
  invalidOidcExtraParams: "settings.headscale.errors.invalidOidcExtraParams",
  duplicateOidcExtraParam: "settings.headscale.errors.duplicateOidcExtraParam",
  invalidHaProbeInterval: "settings.headscale.errors.invalidHaProbeInterval",
  invalidHaProbeTimeout: "settings.headscale.errors.invalidHaProbeTimeout",
  invalidHaProbeCombination: "settings.headscale.errors.invalidHaProbeCombination",
  invalidDerpMapPath: "settings.headscale.errors.invalidDerpMapPath",
  derpMapPathNotConfigured: "settings.headscale.errors.derpMapPathNotConfigured",
  derpMapTooLarge: "settings.headscale.errors.derpMapTooLarge",
  derpMapInvalid: "settings.headscale.errors.derpMapInvalid",
  derpMapUnavailable: "settings.headscale.errors.derpMapUnavailable",
  derpMapNotWritable: "settings.headscale.errors.derpMapNotWritable",
  derpMapWriteFailed: "settings.headscale.errors.derpMapWriteFailed",
  derpMapNoSnapshot: "settings.headscale.errors.derpMapNoSnapshot",
};

export interface HeadscaleSettingsSuccess {
  success: true;
  /** Present only for the read-only `test_oidc` action. */
  selfTest?: OidcSelfTestReport;
  /** Present after a DERP map save: the snapshot taken before the write. */
  snapshotId?: string;
  /** Whether a snapshot of the previous content was taken at all. */
  snapshotTaken?: boolean;
}

export interface HeadscaleSettingsFailure {
  success: false;
  errorCode: HeadscaleSettingsErrorCode;
  /**
   * Structural problems of a rejected DERP map file. The server never sends
   * prose: each entry is a stable code plus the position the parser reported,
   * and the browser localizes it.
   */
  issues?: DerpMapIssue[];
}

export type HeadscaleSettingsResult = HeadscaleSettingsSuccess | HeadscaleSettingsFailure;

/**
 * Every structural problem a DERP map file can have, mapped onto the localized
 * sentence the editor shows. The server only ever sends the code and the
 * position, so the wording lives in the catalogs.
 */
export const DERP_MAP_ISSUE_KEYS: Record<DerpMapIssueCode, TranslationKey> = {
  yamlSyntax: "settings.headscale.derp.mapIssues.yamlSyntax",
  derpMapTooLarge: "settings.headscale.derp.mapIssues.derpMapTooLarge",
  derpMapInvalidRoot: "settings.headscale.derp.mapIssues.derpMapInvalidRoot",
  derpMapMissingRegions: "settings.headscale.derp.mapIssues.derpMapMissingRegions",
  derpMapInvalidRegions: "settings.headscale.derp.mapIssues.derpMapInvalidRegions",
  derpRegionInvalid: "settings.headscale.derp.mapIssues.derpRegionInvalid",
  derpRegionMissingId: "settings.headscale.derp.mapIssues.derpRegionMissingId",
  derpRegionInvalidId: "settings.headscale.derp.mapIssues.derpRegionInvalidId",
  derpRegionMissingCode: "settings.headscale.derp.mapIssues.derpRegionMissingCode",
  derpRegionMissingName: "settings.headscale.derp.mapIssues.derpRegionMissingName",
  derpRegionMissingNodes: "settings.headscale.derp.mapIssues.derpRegionMissingNodes",
  derpRegionInvalidNodes: "settings.headscale.derp.mapIssues.derpRegionInvalidNodes",
  derpRegionDuplicateId: "settings.headscale.derp.mapIssues.derpRegionDuplicateId",
  derpRegionDuplicateCode: "settings.headscale.derp.mapIssues.derpRegionDuplicateCode",
  derpNodeInvalid: "settings.headscale.derp.mapIssues.derpNodeInvalid",
  derpNodeMissingName: "settings.headscale.derp.mapIssues.derpNodeMissingName",
  derpNodeMissingHostname: "settings.headscale.derp.mapIssues.derpNodeMissingHostname",
  derpNodeMissingRegionId: "settings.headscale.derp.mapIssues.derpNodeMissingRegionId",
  derpNodeInvalidRegionId: "settings.headscale.derp.mapIssues.derpNodeInvalidRegionId",
  derpNodeRegionMismatch: "settings.headscale.derp.mapIssues.derpNodeRegionMismatch",
  derpNodeInvalidDerpPort: "settings.headscale.derp.mapIssues.derpNodeInvalidDerpPort",
  derpNodeInvalidStunPort: "settings.headscale.derp.mapIssues.derpNodeInvalidStunPort",
  derpNodeInvalidIpv4: "settings.headscale.derp.mapIssues.derpNodeInvalidIpv4",
  derpNodeInvalidIpv6: "settings.headscale.derp.mapIssues.derpNodeInvalidIpv6",
  derpNodeInvalidStunOnly: "settings.headscale.derp.mapIssues.derpNodeInvalidStunOnly",
};

export type { DerpMapIssue };
