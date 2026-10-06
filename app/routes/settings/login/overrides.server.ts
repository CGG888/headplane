// MARK: Console-login OIDC editing service
//
// The server half of the editing card on /settings/login. It reads the three
// configuration layers (the config file, the overrides saved on this page and
// the environment), merges them with the documented precedence, validates a
// proposed change, runs the lockout safety rail and writes the saved layer.
//
// Two properties matter more than anything else here:
//
//   * the config file itself is only ever read — a read-only mount is the
//     normal deployment, and the app must not assume it can be rewritten;
//   * the client secret never leaves this module in a value position. The view
//     reports whether one is set, the audit reports only field names, and the
//     action result carries no values at all.

import type { PartialHeadplaneConfig } from "~/server/config/config-schema";
import { loadConfigEnv, loadConfigFile, resolveConfigPath } from "~/server/config/load";
import { readLoginOidcDocument, writeLoginOidcSettings } from "~/server/headplane-store/login-oidc";

import {
  assessLoginLockout,
  buildLoginOidcFieldViews,
  diffLoginOidcSettings,
  loginOidcRestartFields,
  mergeLoginOidcLayers,
  readLoginOidcLayer,
  setLoginOidcField,
  validateLoginOidcField,
  validateLoginOidcSettings,
  type LoginLockoutReason,
  type LoginOidcErrorCode,
  type LoginOidcFieldId,
  type LoginOidcSettings,
  type LoginOidcView,
  type LoginSignInContext,
  type LoginSignInPaths,
} from "./login-oidc";

/** The config file and environment as they are right now, or nothing. */
interface LoginOidcLayersRead {
  file?: PartialHeadplaneConfig;
  env?: PartialHeadplaneConfig;
  saved: LoginOidcSettings;
  configUnreadable: boolean;
}

async function readLayers(dataPath: string): Promise<LoginOidcLayersRead> {
  const saved = (await readLoginOidcDocument(dataPath)).settings;

  let file: PartialHeadplaneConfig | undefined;
  let configUnreadable = false;
  try {
    file = await loadConfigFile(resolveConfigPath());
  } catch {
    // An unreadable or invalid config file is reported, not fatal: the saved
    // values and the environment are still worth showing and editing.
    configUnreadable = true;
  }

  let env: PartialHeadplaneConfig | undefined;
  try {
    env = await loadConfigEnv();
  } catch {
    env = undefined;
  }

  return { file, env, saved, configUnreadable };
}

export interface LoginOidcSnapshot {
  /** Effective values, as a restart would read them. */
  merged: LoginOidcSettings;
  /** Effective values the running process was started with. */
  running: LoginOidcSettings;
  restartFields: LoginOidcFieldId[];
  configUnreadable: boolean;
  saved: LoginOidcSettings;
  view: LoginOidcView;
}

/**
 * Everything the page renders. The client secret is reduced to a boolean here,
 * so nothing downstream can render or return it.
 */
export async function readLoginOidcSnapshot(input: {
  dataPath: string;
  runningOidc: unknown;
  context: LoginSignInContext;
}): Promise<LoginOidcSnapshot> {
  const layers = await readLayers(input.dataPath);
  const merged = mergeLoginOidcLayers({
    env: layers.env?.oidc,
    saved: layers.saved,
    file: layers.file?.oidc,
  });
  // The running configuration already had the file, the saved overrides and the
  // environment applied when the process started, so comparing the editable
  // fields detects both a page edit and a config file changed on disk. It is
  // read as a layer so the legacy `use_end_session` alias resolves the same way.
  const running = readLoginOidcLayer(input.runningOidc);

  const restartFields = loginOidcRestartFields(running, merged.values);
  const views = buildLoginOidcFieldViews(merged, input.context);

  return {
    merged: merged.values,
    running,
    restartFields,
    configUnreadable: layers.configUnreadable,
    saved: layers.saved,
    view: {
      ...views,
      restartRequired: restartFields.length > 0,
      restartFields,
      savedCount: merged.saved.length,
      configUnreadable: layers.configUnreadable,
    },
  };
}

/** What the form posted: which fields, their new values, and the secret verb. */
export interface LoginOidcEdit {
  /** Every editable field the form rendered; `client_secret` is left out. */
  posted: LoginOidcFieldId[];
  /** A missing value means "clear this field and fall back". */
  values: Partial<Record<LoginOidcFieldId, string | boolean>>;
  secret: { kind: "keep" } | { kind: "replace"; value: string } | { kind: "clear" };
  /** The operator accepted the lockout warning. */
  confirm: boolean;
}

export type LoginOidcSaveResult =
  | { state: "saved"; changed: LoginOidcFieldId[] }
  | { state: "invalid"; errors: LoginOidcErrorCode[] }
  | { state: "confirm"; reasons: LoginLockoutReason[]; remaining: LoginSignInPaths }
  | { state: "refused"; reasons: LoginLockoutReason[]; remaining: LoginSignInPaths }
  | { state: "writeFailed" };

/**
 * Applies one submitted change, in order: merge, validate, check the lockout
 * rail, then write. Nothing is written unless every check passes, so a rejected
 * change leaves the stored document exactly as it was.
 */
export async function saveLoginOidcSettings(input: {
  dataPath: string;
  context: LoginSignInContext;
  edit: LoginOidcEdit;
}): Promise<LoginOidcSaveResult> {
  const layers = await readLayers(input.dataPath);

  // A field the environment pins cannot be changed from the page: the posted
  // value is ignored and the existing saved value (dormant as it is) survives.
  const pinned = new Set(
    mergeLoginOidcLayers({ env: layers.env?.oidc, saved: layers.saved, file: layers.file?.oidc })
      .pinned,
  );

  const nextSaved: LoginOidcSettings = { ...layers.saved };
  for (const id of input.edit.posted) {
    if (id === "client_secret" || pinned.has(id)) {
      continue;
    }

    const value = input.edit.values[id];
    if (value === undefined) {
      // An emptied text field clears the saved override, so the field falls
      // back to the config file, the environment or the schema default.
      delete nextSaved[id];
      continue;
    }

    const error = validateLoginOidcField(id, value);
    if (error !== undefined) {
      return { state: "invalid", errors: [error] };
    }

    if (!setLoginOidcField(nextSaved, id, value)) {
      return { state: "invalid", errors: ["invalidType"] };
    }
  }

  if (input.edit.secret.kind === "replace" && !pinned.has("client_secret")) {
    const value = input.edit.secret.value;
    const error = validateLoginOidcField("client_secret", value);
    if (error !== undefined) {
      return { state: "invalid", errors: [error] };
    }

    if (!setLoginOidcField(nextSaved, "client_secret", value)) {
      return { state: "invalid", errors: ["invalidEmpty"] };
    }
  } else if (input.edit.secret.kind === "clear" && !pinned.has("client_secret")) {
    delete nextSaved.client_secret;
  }

  const requested = mergeLoginOidcLayers({
    env: layers.env?.oidc,
    saved: nextSaved,
    file: layers.file?.oidc,
  });

  const errors = validateLoginOidcSettings(requested.values, {
    hasEffectiveSecret: requested.values.client_secret !== undefined,
  });

  if (errors.length > 0) {
    return { state: "invalid", errors };
  }

  const stored = mergeLoginOidcLayers({
    env: layers.env?.oidc,
    saved: layers.saved,
    file: layers.file?.oidc,
  });
  const lockout = assessLoginLockout({
    before: stored.values,
    after: requested.values,
    context: input.context,
  });

  if (lockout.state === "refuse") {
    return { state: "refused", reasons: lockout.reasons, remaining: lockout.remaining };
  }

  if (lockout.state === "confirm" && !input.edit.confirm) {
    return { state: "confirm", reasons: lockout.reasons, remaining: lockout.remaining };
  }

  // Only the stored document is compared, because that is what a save changes;
  // the audit then names exactly the fields that moved.
  const changed = diffLoginOidcSettings(layers.saved, nextSaved);
  if (changed.length === 0) {
    return { state: "saved", changed: [] };
  }

  if (!(await writeLoginOidcSettings(input.dataPath, nextSaved))) {
    return { state: "writeFailed" };
  }

  return { state: "saved", changed };
}
