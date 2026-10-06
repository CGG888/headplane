// MARK: Console-login OIDC labels
//
// The stable ids the editing card renders are mapped onto translation keys
// here, in one dependency-free module, so the page and its form component share
// exactly one mapping and the catalogs stay honest about what is used.

import type { TranslationKey } from "~/i18n";

import {
  LOGIN_OIDC_ERROR_KEYS,
  type LoginLockoutReason,
  type LoginOidcActionErrorCode,
  type LoginOidcFieldGroupId,
  type LoginOidcFieldId,
  type LoginOidcSource,
} from "./login-oidc";

/**
 * Every rejection the card can render, including a missing permission. The
 * "confirmationRequired" code is deliberately absent: it is not an error
 * message but the confirmation panel itself.
 */
export const LOGIN_ACTION_ERROR_KEYS: Record<
  Exclude<LoginOidcActionErrorCode, "confirmationRequired"> | "forbidden",
  TranslationKey
> = {
  ...LOGIN_OIDC_ERROR_KEYS,
  forbidden: "errors.permission.modifyIam",
};

/** Why a change needed confirming, in the order the assessment reports them. */
export const LOGIN_LOCKOUT_REASON_KEYS: Record<LoginLockoutReason, TranslationKey> = {
  oidcDisabled: "settings.login.confirmOidcDisabled",
  oidcIncomplete: "settings.login.confirmOidcIncomplete",
  secretCleared: "settings.login.confirmSecretCleared",
  noWayIn: "settings.login.confirmNoWayIn",
};

/** Where the value in effect came from, as a short badge. */
export const LOGIN_SOURCE_KEYS: Record<LoginOidcSource, TranslationKey> = {
  env: "settings.login.sourceEnv",
  saved: "settings.login.sourceSaved",
  file: "settings.login.sourceFile",
  default: "settings.login.sourceDefault",
  unset: "settings.login.sourceUnset",
};

export const LOGIN_GROUP_LABELS: Record<LoginOidcFieldGroupId, TranslationKey> = {
  signIn: "settings.login.groupSignIn",
  claims: "settings.login.groupClaims",
  session: "settings.login.groupSession",
};

export const LOGIN_FIELD_LABELS: Record<LoginOidcFieldId, TranslationKey> = {
  enabled: "settings.login.fieldEnabledLabel",
  issuer: "settings.login.fieldIssuerLabel",
  client_id: "settings.login.fieldClientIdLabel",
  client_secret: "settings.login.fieldClientSecretLabel",
  scope: "settings.login.fieldScopeLabel",
  use_pkce: "settings.login.fieldPkceLabel",
  default_role: "settings.login.fieldDefaultRoleLabel",
  logout_idp: "settings.login.fieldLogoutIdpLabel",
  end_session_endpoint: "settings.login.fieldEndSessionLabel",
  post_logout_redirect_uri: "settings.login.fieldPostLogoutLabel",
};

export const LOGIN_FIELD_DESCRIPTIONS: Record<LoginOidcFieldId, TranslationKey> = {
  enabled: "settings.login.fieldEnabledDescription",
  issuer: "settings.login.fieldIssuerDescription",
  client_id: "settings.login.fieldClientIdDescription",
  client_secret: "settings.login.fieldClientSecretDescription",
  scope: "settings.login.fieldScopeDescription",
  use_pkce: "settings.login.fieldPkceDescription",
  default_role: "settings.login.fieldDefaultRoleDescription",
  logout_idp: "settings.login.fieldLogoutIdpDescription",
  end_session_endpoint: "settings.login.fieldEndSessionDescription",
  post_logout_redirect_uri: "settings.login.fieldPostLogoutDescription",
};

/** The role names the select offers, reusing the user-management wording. */
export const LOGIN_ROLE_KEYS: Record<string, TranslationKey> = {
  admin: "users.roles.admin",
  network_admin: "users.roles.networkAdmin",
  it_admin: "users.roles.itAdmin",
  auditor: "users.roles.auditor",
  viewer: "users.roles.viewer",
  member: "users.roles.member",
};

/** The ways in the confirmation panel can list as still available. */
export const LOGIN_PATH_KEYS: Record<"oidc" | "apiKey" | "proxy", TranslationKey> = {
  oidc: "settings.login.pathOidc",
  apiKey: "settings.login.pathApiKey",
  proxy: "settings.login.pathProxy",
};
