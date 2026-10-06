// MARK: HeadplaneCN console-login OIDC overrides
//
// The console's *own* `oidc:` block is read once, at startup, from a config
// file that is commonly mounted read-only, so it cannot be edited in place.
// This module holds the part of the editing feature that is pure: the field
// list, the defensive readers, the documented precedence, the validation
// rules, the lockout assessment and the restart comparison.
//
// It imports nothing but an erased type, the same way `server/audit/actions.ts`
// does, so the settings page, the route action, the config loader and the unit
// tests all share one definition without pulling `node:*` into the browser
// bundle.
//
// Precedence, highest first:
//
//   1. environment variable (`HEADPLANE_OIDC__<FIELD>`) — always wins, and the
//      UI renders the field as read-only with the variable named;
//   2. a value saved on /settings/login (HeadplaneCN's data directory);
//   3. the config file's `oidc:` block;
//   4. the schema default (`enabled: true`, `scope: "openid email profile"`,
//      `default_role: "member"`, `use_pkce: false`, `logout_idp: false`).
//
// `logout_idp` also accepts the older `use_end_session` spelling as a source in
// the environment and the config file, under the same precedence.

import type { TranslationKey } from "~/i18n";

/** Roles `oidc.default_role` accepts; the config schema rejects anything else. */
export const LOGIN_OIDC_ROLES = [
  "admin",
  "network_admin",
  "it_admin",
  "auditor",
  "viewer",
  "member",
] as const;

export type LoginOidcRole = (typeof LOGIN_OIDC_ROLES)[number];

/**
 * The editable subset of HeadplaneCN's own `oidc:` block. Every key is
 * optional on purpose: a layer only carries the fields it actually supplies,
 * which is what makes "where did this value come from" answerable.
 */
export interface LoginOidcSettings {
  enabled?: boolean;
  issuer?: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
  use_pkce?: boolean;
  default_role?: LoginOidcRole;
  logout_idp?: boolean;
  end_session_endpoint?: string;
  post_logout_redirect_uri?: string;
}

export const LOGIN_OIDC_FIELD_IDS = [
  "enabled",
  "issuer",
  "client_id",
  "client_secret",
  "scope",
  "use_pkce",
  "default_role",
  "logout_idp",
  "end_session_endpoint",
  "post_logout_redirect_uri",
] as const satisfies readonly (keyof LoginOidcSettings)[];

export type LoginOidcFieldId = (typeof LOGIN_OIDC_FIELD_IDS)[number];

/** The `oidc.<key>` each editable field maps onto. */
export const LOGIN_OIDC_CONFIG_KEYS: Record<LoginOidcFieldId, string> = {
  enabled: "enabled",
  issuer: "issuer",
  client_id: "client_id",
  client_secret: "client_secret",
  scope: "scope",
  use_pkce: "use_pkce",
  default_role: "default_role",
  logout_idp: "logout_idp",
  end_session_endpoint: "end_session_endpoint",
  post_logout_redirect_uri: "post_logout_redirect_uri",
};

/** The environment variable that pins a field, named verbatim in the UI. */
export const LOGIN_OIDC_ENV_VARS: Record<LoginOidcFieldId, string> = {
  enabled: "HEADPLANE_OIDC__ENABLED",
  issuer: "HEADPLANE_OIDC__ISSUER",
  client_id: "HEADPLANE_OIDC__CLIENT_ID",
  client_secret: "HEADPLANE_OIDC__CLIENT_SECRET",
  scope: "HEADPLANE_OIDC__SCOPE",
  use_pkce: "HEADPLANE_OIDC__USE_PKCE",
  default_role: "HEADPLANE_OIDC__DEFAULT_ROLE",
  logout_idp: "HEADPLANE_OIDC__LOGOUT_IDP",
  end_session_endpoint: "HEADPLANE_OIDC__END_SESSION_ENDPOINT",
  post_logout_redirect_uri: "HEADPLANE_OIDC__POST_LOGOUT_REDIRECT_URI",
};

/** The schema defaults, mirroring `partialOidcConfig`. */
export const LOGIN_OIDC_DEFAULTS = {
  enabled: true,
  scope: "openid email profile",
  use_pkce: false,
  default_role: "member",
  logout_idp: false,
} as const satisfies LoginOidcSettings;

/** How a stored secret is shown back. The value itself never leaves the server. */
export const LOGIN_OIDC_SECRET_MASK = "••••••••••••";

export type LoginOidcSource = "env" | "saved" | "file" | "default" | "unset";

export type LoginOidcBooleanFieldId = "enabled" | "use_pkce" | "logout_idp";

export type LoginOidcTextFieldId = Exclude<LoginOidcFieldId, LoginOidcBooleanFieldId>;

export function isLoginOidcBooleanField(id: LoginOidcFieldId): id is LoginOidcBooleanFieldId {
  return id === "enabled" || id === "use_pkce" || id === "logout_idp";
}

export function isLoginOidcRole(value: string): value is LoginOidcRole {
  return (LOGIN_OIDC_ROLES as readonly string[]).includes(value);
}

/** The three groups the form is laid out in, in order. */
export const LOGIN_OIDC_FIELD_GROUPS = [
  { id: "signIn", fields: ["enabled", "issuer", "client_id", "client_secret"] },
  { id: "claims", fields: ["scope", "default_role"] },
  {
    id: "session",
    fields: ["use_pkce", "logout_idp", "end_session_endpoint", "post_logout_redirect_uri"],
  },
] as const satisfies readonly { id: string; fields: readonly LoginOidcFieldId[] }[];

export type LoginOidcFieldGroupId = (typeof LOGIN_OIDC_FIELD_GROUPS)[number]["id"];

// MARK: readers

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  // An empty string is "not supplied", never a value: that is what makes an
  // emptied form field clear a saved override instead of storing "".
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Writes one field onto `target` when the value has the type the field needs.
 * Returns whether it was accepted, so a malformed layer silently drops the
 * field instead of poisoning the merged configuration.
 */
export function setLoginOidcField(
  target: LoginOidcSettings,
  id: LoginOidcFieldId,
  value: unknown,
): boolean {
  if (isLoginOidcBooleanField(id)) {
    const boolean = readBoolean(value);
    if (boolean === undefined) {
      return false;
    }

    target[id] = boolean;
    return true;
  }

  if (id === "default_role") {
    const text = readText(value);
    if (text === undefined || !isLoginOidcRole(text)) {
      return false;
    }

    target.default_role = text;
    return true;
  }

  const text = readText(value);
  if (text === undefined) {
    return false;
  }

  target[id] = text;
  return true;
}

/** One layer — the config file's `oidc:` block, or the parsed env overrides. */
export function readLoginOidcLayer(raw: unknown): LoginOidcSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const settings: LoginOidcSettings = {};

  for (const id of LOGIN_OIDC_FIELD_IDS) {
    if (id === "logout_idp") {
      // `use_end_session` is the older spelling of the same switch, and either
      // flag enables the provider logout — the same rule `isIdpLogoutEnabled`
      // applies, so the merged value matches what the login flow would do.
      const direct = readBoolean(source.logout_idp);
      const legacy = readBoolean(source.use_end_session);
      const value = direct === true || legacy === true ? true : (direct ?? legacy);
      if (value !== undefined) {
        settings.logout_idp = value;
      }

      continue;
    }

    setLoginOidcField(settings, id, source[LOGIN_OIDC_CONFIG_KEYS[id]]);
  }

  return settings;
}

/** Defensive reader for the saved document: only the editable fields survive. */
export function normalizeLoginOidcSettings(raw: unknown): LoginOidcSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const source = raw as Record<string, unknown>;
  const settings: LoginOidcSettings = {};
  for (const id of LOGIN_OIDC_FIELD_IDS) {
    setLoginOidcField(settings, id, source[id]);
  }

  return settings;
}

/** Drops every field whose own value is not valid on its own. */
export function sanitizeLoginOidcSettings(settings: LoginOidcSettings): LoginOidcSettings {
  const sanitized: LoginOidcSettings = {};
  for (const id of LOGIN_OIDC_FIELD_IDS) {
    const value = settings[id];
    if (value === undefined || validateLoginOidcField(id, value) !== undefined) {
      continue;
    }

    setLoginOidcField(sanitized, id, value);
  }

  return sanitized;
}

// MARK: merge

export interface LoginOidcLayers {
  /** The parsed environment overrides (`loadConfigEnv()`). */
  env?: unknown;
  /** The saved document's settings. */
  saved?: LoginOidcSettings;
  /** The config file's `oidc:` block. */
  file?: unknown;
}

export interface MergedLoginOidc {
  /** The effective value per field, after defaults; absent means "unset". */
  values: LoginOidcSettings;
  /** Which layer supplied the value that took effect. */
  sources: Record<LoginOidcFieldId, LoginOidcSource>;
  /** Fields an environment variable pins; the form renders these read-only. */
  pinned: LoginOidcFieldId[];
  /** Fields the saved document supplies, whether or not they took effect. */
  saved: LoginOidcFieldId[];
}

/**
 * Resolves every editable field through the documented precedence. A pinned
 * field still reports the environment's value, and its saved value stays in the
 * document but is dormant.
 */
export function mergeLoginOidcLayers(layers: LoginOidcLayers = {}): MergedLoginOidc {
  const env = readLoginOidcLayer(layers.env);
  const file = readLoginOidcLayer(layers.file);
  const saved = normalizeLoginOidcSettings(layers.saved);

  const values: LoginOidcSettings = {};
  const sources = {} as Record<LoginOidcFieldId, LoginOidcSource>;
  const pinned: LoginOidcFieldId[] = [];
  const savedFields: LoginOidcFieldId[] = [];

  for (const id of LOGIN_OIDC_FIELD_IDS) {
    if (saved[id] !== undefined) {
      savedFields.push(id);
    }

    if (env[id] !== undefined) {
      setLoginOidcField(values, id, env[id]);
      sources[id] = "env";
      pinned.push(id);
      continue;
    }

    if (saved[id] !== undefined) {
      setLoginOidcField(values, id, saved[id]);
      sources[id] = "saved";
      continue;
    }

    if (file[id] !== undefined) {
      setLoginOidcField(values, id, file[id]);
      sources[id] = "file";
      continue;
    }

    const fallback = LOGIN_OIDC_DEFAULTS[id as keyof typeof LOGIN_OIDC_DEFAULTS];
    if (fallback !== undefined) {
      setLoginOidcField(values, id, fallback);
      sources[id] = "default";
      continue;
    }

    sources[id] = "unset";
  }

  return { values, sources, pinned, saved: savedFields };
}

// MARK: validation

export type LoginOidcErrorCode =
  | "invalidType"
  | "invalidEmpty"
  | "invalidIssuer"
  | "invalidUrl"
  | "invalidRole"
  | "missingIssuer"
  | "missingClientId"
  | "missingScope"
  | "missingClientSecret";

/** An absolute `https:` URL with a host, or nothing. */
export function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** An absolute `http(s)` URL with a host, or nothing. */
export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * The rules that apply to one field on its own. Cross-field rules live in
 * {@link validateLoginOidcSettings}. Every value written here has to survive
 * `partialHeadplaneConfig`, otherwise the next start would refuse to boot.
 */
export function validateLoginOidcField(
  id: LoginOidcFieldId,
  value: unknown,
): LoginOidcErrorCode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (isLoginOidcBooleanField(id)) {
    return typeof value === "boolean" ? undefined : "invalidType";
  }

  if (typeof value !== "string") {
    return "invalidType";
  }

  const text = value.trim();
  if (text.length === 0) {
    return "invalidEmpty";
  }

  switch (id) {
    case "issuer": {
      return isAbsoluteHttpsUrl(text) ? undefined : "invalidIssuer";
    }

    case "end_session_endpoint":
    case "post_logout_redirect_uri": {
      return isAbsoluteHttpUrl(text) ? undefined : "invalidUrl";
    }

    case "default_role": {
      return isLoginOidcRole(text) ? undefined : "invalidRole";
    }

    default: {
      return undefined;
    }
  }
}

export interface LoginOidcValidationOptions {
  /**
   * Whether any layer supplies a client secret once this change is applied.
   * The config schema requires `oidc.client_secret`, so a change that would
   * leave the console with an enabled block and no secret is rejected rather
   * than written and discovered at the next start.
   */
  hasEffectiveSecret: boolean;
}

/** Every reason the given settings could not be stored. */
export function validateLoginOidcSettings(
  settings: LoginOidcSettings,
  options: LoginOidcValidationOptions,
): LoginOidcErrorCode[] {
  const errors: LoginOidcErrorCode[] = [];
  const push = (code: LoginOidcErrorCode | undefined) => {
    if (code !== undefined && !errors.includes(code)) {
      errors.push(code);
    }
  };

  for (const id of LOGIN_OIDC_FIELD_IDS) {
    push(validateLoginOidcField(id, settings[id]));
  }

  if (settings.enabled === false) {
    return errors;
  }

  if (settings.issuer === undefined) {
    push("missingIssuer");
  }

  if (settings.client_id === undefined) {
    push("missingClientId");
  }

  if (settings.scope === undefined) {
    push("missingScope");
  }

  if (!options.hasEffectiveSecret) {
    push("missingClientSecret");
  }

  return errors;
}

// MARK: differences

function sameValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  if (typeof left === "string" && typeof right === "string") {
    return left.trim() === right.trim();
  }

  return left === right;
}

/**
 * The fields whose effective value differs. Secret *values* are compared here
 * but never returned — only the field id is — so the result is safe to audit
 * and to render.
 */
export function diffLoginOidcSettings(
  before: LoginOidcSettings,
  after: LoginOidcSettings,
): LoginOidcFieldId[] {
  const changed: LoginOidcFieldId[] = [];
  for (const id of LOGIN_OIDC_FIELD_IDS) {
    if (!sameValue(before[id], after[id])) {
      changed.push(id);
    }
  }

  return changed;
}

/**
 * Whether the running configuration still matches what would be read at the
 * next start: any difference is a "restart required" state.
 */
export function loginOidcRestartFields(
  running: LoginOidcSettings,
  merged: LoginOidcSettings,
): LoginOidcFieldId[] {
  return diffLoginOidcSettings(running, merged);
}

// MARK: lockout

export interface LoginSignInContext {
  /** `oidc.disable_api_key_login`: API-key sign-in is not available. */
  disableApiKeyLogin: boolean;
  /** `server.proxy_auth.enabled`: a trusted proxy authenticates people. */
  proxyAuthEnabled: boolean;
}

export interface LoginSignInPaths {
  oidc: boolean;
  apiKey: boolean;
  proxy: boolean;
}

/** Which ways in are actually usable with the given effective settings. */
export function loginSignInPaths(
  settings: LoginOidcSettings,
  context: LoginSignInContext,
): LoginSignInPaths {
  const oidc =
    settings.enabled !== false &&
    settings.issuer !== undefined &&
    settings.client_id !== undefined &&
    settings.client_secret !== undefined &&
    settings.scope !== undefined;

  return {
    oidc,
    apiKey: !context.disableApiKeyLogin,
    proxy: context.proxyAuthEnabled,
  };
}

export type LoginLockoutReason = "oidcDisabled" | "oidcIncomplete" | "secretCleared" | "noWayIn";

export type LoginLockoutAssessment =
  | { state: "safe" }
  | { state: "confirm"; reasons: LoginLockoutReason[]; remaining: LoginSignInPaths }
  | { state: "refuse"; reasons: LoginLockoutReason[]; remaining: LoginSignInPaths };

function countPaths(paths: LoginSignInPaths): number {
  return (paths.oidc ? 1 : 0) + (paths.apiKey ? 1 : 0) + (paths.proxy ? 1 : 0);
}

/**
 * The safety rail in front of a save. A change is refused only when nothing at
 * all would be left to sign in with, and otherwise asks for an explicit
 * confirmation whenever it removes a working way in — the confirmation names
 * what will happen and what remains.
 */
export function assessLoginLockout(input: {
  before: LoginOidcSettings;
  after: LoginOidcSettings;
  context: LoginSignInContext;
}): LoginLockoutAssessment {
  const before = loginSignInPaths(input.before, input.context);
  const after = loginSignInPaths(input.after, input.context);

  if (countPaths(after) === 0) {
    return { state: "refuse", reasons: ["noWayIn"], remaining: after };
  }

  const reasons: LoginLockoutReason[] = [];
  if (before.oidc && !after.oidc) {
    if (input.after.enabled === false) {
      reasons.push("oidcDisabled");
    } else if (
      input.before.client_secret !== undefined &&
      input.after.client_secret === undefined
    ) {
      reasons.push("secretCleared");
    } else {
      reasons.push("oidcIncomplete");
    }
  }

  if (reasons.length > 0 && countPaths(after) < countPaths(before)) {
    return { state: "confirm", reasons, remaining: after };
  }

  return { state: "safe" };
}

// MARK: action result

export type LoginOidcActionErrorCode =
  | LoginOidcErrorCode
  | "confirmationRequired"
  | "noWayIn"
  | "invalidAction"
  | "configUnreadable"
  | "writeFailed";

/** Localized message for every rejection the save action can report. */
export const LOGIN_OIDC_ERROR_KEYS: Record<
  Exclude<LoginOidcActionErrorCode, "confirmationRequired">,
  TranslationKey
> = {
  invalidType: "settings.login.errorInvalidType",
  invalidEmpty: "settings.login.errorInvalidEmpty",
  invalidIssuer: "settings.login.errorInvalidIssuer",
  invalidUrl: "settings.login.errorInvalidUrl",
  invalidRole: "settings.login.errorInvalidRole",
  missingIssuer: "settings.login.errorMissingIssuer",
  missingClientId: "settings.login.errorMissingClientId",
  missingScope: "settings.login.errorMissingScope",
  missingClientSecret: "settings.login.errorMissingClientSecret",
  noWayIn: "settings.login.errorNoWayIn",
  invalidAction: "settings.login.errorInvalidAction",
  configUnreadable: "settings.login.errorConfigUnreadable",
  writeFailed: "settings.login.errorWriteFailed",
};

/** The saved document as the page renders it: values never, presence only. */
export interface LoginOidcFieldView {
  id: LoginOidcFieldId;
  source: LoginOidcSource;
  /** The effective value; `client_secret` is always reported as `null`. */
  value: string | boolean | null;
  /** Whether a secret is set anywhere for `client_secret`. */
  secretSet: boolean;
  pinned: boolean;
}

export interface LoginOidcView {
  fields: LoginOidcFieldView[];
  /** The environment variables that pin a field, by field id. */
  envVars: Partial<Record<LoginOidcFieldId, string>>;
  /** The running configuration no longer matches what a restart would read. */
  restartRequired: boolean;
  restartFields: LoginOidcFieldId[];
  /** How many fields the saved document supplies. */
  savedCount: number;
  /** The config file could not be read, so the effective values are partial. */
  configUnreadable: boolean;
  /** OIDC would be usable after a restart. */
  oidcUsable: boolean;
  /** Ways in after the change that is stored right now. */
  remaining: LoginSignInPaths;
}

/**
 * Renders the merged configuration for the browser. The client secret is
 * reduced to a boolean here, once, so no code path below can leak it.
 */
export function buildLoginOidcFieldViews(
  merged: MergedLoginOidc,
  context: LoginSignInContext,
): Pick<LoginOidcView, "fields" | "envVars" | "oidcUsable" | "remaining"> {
  const envVars: Partial<Record<LoginOidcFieldId, string>> = {};
  for (const id of merged.pinned) {
    envVars[id] = LOGIN_OIDC_ENV_VARS[id];
  }

  const fields = LOGIN_OIDC_FIELD_IDS.map<LoginOidcFieldView>((id) => {
    const value = merged.values[id];
    const pinned = merged.pinned.includes(id);

    if (id === "client_secret") {
      return {
        id,
        source: merged.sources[id],
        value: null,
        secretSet: value !== undefined,
        pinned,
      };
    }

    return {
      id,
      source: merged.sources[id],
      value: value ?? null,
      secretSet: false,
      pinned,
    };
  });

  const paths = loginSignInPaths(merged.values, context);

  return { fields, envVars, oidcUsable: paths.oidc, remaining: paths };
}
