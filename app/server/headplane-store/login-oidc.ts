// MARK: Console-login OIDC override store
//
// The console's own `oidc:` block lives in a config file that is commonly
// mounted read-only (`config.yaml:ro`), so it is never written from here.
// Edits made on /settings/login are persisted to a small JSON document in
// HeadplaneCN's own data directory instead, and the config loader merges it
// between the file and the environment (environment > saved > file).
//
// Following `relay-dns-store.ts` and `alerts/store.ts`, reads are defensive (a
// missing, unreadable or corrupt document degrades to "nothing saved") and
// writes go through a temp file plus rename, so a crash can never leave a
// half-written document behind. The document can hold a client secret, so it
// is created with mode 0600.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  LOGIN_OIDC_FIELD_IDS,
  normalizeLoginOidcSettings,
  setLoginOidcField,
  type LoginOidcSettings,
} from "~/routes/settings/login/login-oidc";
import log from "~/utils/log";

/** File under HeadplaneCN's `server.data_path`. */
export const LOGIN_OIDC_FILE = "login-oidc.json";

/** Only ever 0600: the document can carry a client secret. */
export const LOGIN_OIDC_FILE_MODE = 0o600;

/** The document format version, so a future shape can be recognized. */
export const LOGIN_OIDC_DOCUMENT_VERSION = 1;

export interface LoginOidcDocument {
  version: number;
  /** Only the fields that were explicitly saved, so a cleared field reverts. */
  settings: LoginOidcSettings;
  /** ISO timestamp of the last write; informational only. */
  updated_at?: string;
}

/** `<data_path>/login-oidc.json` — the file the editor reads and writes. */
export function loginOidcPath(dataPath: string): string {
  return resolve(dataPath, LOGIN_OIDC_FILE);
}

/** The default document: nothing saved, so every field falls back further up. */
export function emptyLoginOidcDocument(): LoginOidcDocument {
  return { version: LOGIN_OIDC_DOCUMENT_VERSION, settings: {} };
}

/**
 * Parses the stored document. Anything unusable — invalid JSON, a wrong shape,
 * a value of the wrong type — collapses to "nothing saved for that field", so a
 * hand-edited document cannot stop HeadplaneCN from starting.
 */
export function parseLoginOidcDocument(raw: string | undefined | null): LoginOidcDocument {
  if (!raw) {
    return emptyLoginOidcDocument();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyLoginOidcDocument();
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyLoginOidcDocument();
  }

  const source = parsed as Record<string, unknown>;
  const settings = normalizeLoginOidcSettings(source.settings ?? source);
  const updatedAt = typeof source.updated_at === "string" ? source.updated_at : undefined;

  return {
    version: LOGIN_OIDC_DOCUMENT_VERSION,
    settings,
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
  };
}

/** Stable, human-editable JSON with a trailing newline. */
export function serializeLoginOidcDocument(document: LoginOidcDocument): string {
  const settings: LoginOidcSettings = {};
  for (const id of LOGIN_OIDC_FIELD_IDS) {
    setLoginOidcField(settings, id, document.settings[id]);
  }

  return `${JSON.stringify(
    {
      version: LOGIN_OIDC_DOCUMENT_VERSION,
      settings,
      ...(document.updated_at === undefined ? {} : { updated_at: document.updated_at }),
    },
    null,
    2,
  )}\n`;
}

/** Reads the document; a missing, unreadable or corrupt file reads as empty. */
export async function readLoginOidcDocument(dataPath: string): Promise<LoginOidcDocument> {
  try {
    return parseLoginOidcDocument(await readFile(loginOidcPath(dataPath), "utf8"));
  } catch {
    return emptyLoginOidcDocument();
  }
}

/** The saved settings on their own, which is what the config loader merges. */
export async function readLoginOidcSettings(dataPath: string): Promise<LoginOidcSettings> {
  return (await readLoginOidcDocument(dataPath)).settings;
}

/**
 * Writes the document atomically (temp file plus rename, mode 0600). Returns
 * false instead of throwing, because the settings action surfaces the failure
 * as a localized form error and an unwritable data directory must not break the
 * page.
 */
export async function writeLoginOidcDocument(
  dataPath: string,
  document: LoginOidcDocument,
): Promise<boolean> {
  const path = loginOidcPath(dataPath);
  const temp = `${path}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeLoginOidcDocument(document), {
      encoding: "utf8",
      // `wx` refuses a pre-existing path, so a planted symlink cannot make this
      // write reach the target; the mode only applies when the file is created.
      flag: "wx",
      mode: LOGIN_OIDC_FILE_MODE,
    });
    await rename(temp, path);
    return true;
  } catch (error) {
    // The failure text is a path or an errno: it never carries a value.
    log.warn("config", "Unable to save the console login settings: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

/** Convenience wrapper that stamps `updated_at`. */
export async function writeLoginOidcSettings(
  dataPath: string,
  settings: LoginOidcSettings,
): Promise<boolean> {
  return writeLoginOidcDocument(dataPath, {
    version: LOGIN_OIDC_DOCUMENT_VERSION,
    settings,
    updated_at: new Date().toISOString(),
  });
}
