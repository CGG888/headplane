// MARK: Alert store
//
// Notification state is Headplane state, not Headscale configuration, so it
// lives in a JSON document under Headplane's `data_path` instead of the
// database: no schema change and no migration. The document holds the settings,
// the last few deliveries and the state the detector compares against, so a
// restart neither forgets what it already reported nor re-reports it.
//
// Following `derp-region-names.ts`, reads are defensive (a missing or corrupt
// document degrades to defaults) and writes go through a temp file plus rename
// so a crash never leaves a half-written document behind.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import log from "~/utils/log";

import { emptyAlertState } from "./events";
import { DEFAULT_ALERT_SETTINGS, isAlertEventId, normalizeAlertSettings } from "./settings";
import type { AlertDelivery, AlertHistoryEventId, AlertSettings, AlertState } from "./types";

/** File under Headplane's `server.data_path`. */
export const ALERTS_FILE = "alerts.json";

/** How many deliveries the page can show; older entries are dropped. */
export const ALERT_HISTORY_LIMIT = 50;

export interface AlertsDocument {
  settings: AlertSettings;
  /** Newest delivery first. */
  history: AlertDelivery[];
  state: AlertState;
}

export function alertsPath(dataPath: string): string {
  return resolve(dataPath, ALERTS_FILE);
}

export function defaultAlertsDocument(): AlertsDocument {
  return { settings: { ...DEFAULT_ALERT_SETTINGS }, history: [], state: emptyAlertState() };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseDelivery(value: unknown): AlertDelivery | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const id = readText(source.id);
  const at = readText(source.at);
  const event =
    source.event === "test" ? "test" : isAlertEventId(source.event) ? source.event : undefined;
  if (id === undefined || at === undefined || event === undefined) {
    return undefined;
  }

  const status =
    typeof source.status === "number" && Number.isFinite(source.status) ? source.status : null;
  const error = readText(source.error) ?? null;
  const target = readText(source.target);
  const threshold =
    typeof source.threshold === "number" && Number.isFinite(source.threshold)
      ? source.threshold
      : undefined;

  return {
    id,
    at,
    event,
    ok: source.ok === true,
    status,
    error,
    ...(target === undefined ? {} : { target }),
    ...(threshold === undefined ? {} : { threshold }),
  };
}

function parseState(value: unknown): AlertState {
  const fallback = emptyAlertState();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const source = value as Record<string, unknown>;
  const list = (input: unknown): string[] =>
    Array.isArray(input)
      ? [...new Set(input.filter((v): v is string => typeof v === "string"))]
      : [];

  const sent: Record<string, string> = {};
  if (source.sent !== null && typeof source.sent === "object" && !Array.isArray(source.sent)) {
    for (const [key, at] of Object.entries(source.sent as Record<string, unknown>)) {
      if (typeof at === "string") {
        sent[key] = at;
      }
    }
  }

  return {
    // A document written before the first tick still knows nothing, so treat a
    // missing flag as "reachable" rather than as a recovery waiting to happen.
    reachable: source.reachable !== false,
    offlineNodes: list(source.offlineNodes),
    expiringKeys: list(source.expiringKeys),
    failingChecks: list(source.failingChecks),
    // A document written before the sync could alert has no flag, and an
    // unknown flag must not look like a failure waiting to be reported.
    derpSyncFailed: source.derpSyncFailed === true,
    sent,
  };
}

/**
 * Parses the stored document, dropping anything that is not usable.
 *
 * `onInvalid` reports why the stored document was ignored; the caller decides
 * whether that is worth a log line. Defaults are still returned either way, so
 * a corrupt file never takes the alerts service down with it.
 */
export function parseAlertsDocument(
  raw: string | undefined | null,
  onInvalid?: (reason: string) => void,
): AlertsDocument {
  const fallback = defaultAlertsDocument();
  if (raw === undefined || raw === null) {
    return fallback;
  }

  if (raw.trim().length === 0) {
    onInvalid?.("the file is empty");
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onInvalid?.("the file is not valid JSON");
    return fallback;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    onInvalid?.("the file does not hold a JSON object");
    return fallback;
  }

  const source = parsed as Record<string, unknown>;
  const history = Array.isArray(source.history)
    ? source.history
        .map(parseDelivery)
        .filter((entry): entry is AlertDelivery => entry !== undefined)
        .slice(0, ALERT_HISTORY_LIMIT)
    : [];

  return {
    settings: normalizeAlertSettings(source.settings),
    history,
    state: parseState(source.state),
  };
}

/** Stable, human-editable JSON with a trailing newline. */
export function serializeAlertsDocument(document: AlertsDocument): string {
  return `${JSON.stringify(
    {
      settings: document.settings,
      history: document.history.slice(0, ALERT_HISTORY_LIMIT),
      state: document.state,
    },
    null,
    2,
  )}\n`;
}

/** Prepends a delivery, keeping only the newest {@link ALERT_HISTORY_LIMIT}. */
export function appendDelivery(
  history: readonly AlertDelivery[],
  delivery: AlertDelivery,
): AlertDelivery[] {
  return [delivery, ...history].slice(0, ALERT_HISTORY_LIMIT);
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Node error codes are read defensively: a thrown value need not be an Error. */
function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

/**
 * Reads the document; a missing, unreadable or corrupt file reads as defaults.
 *
 * Every case except a missing file is logged. Falling back silently would show
 * up as alert settings that reverted to `enabled: false` on their own, with
 * nothing anywhere saying why.
 */
export async function readAlertsDocument(dataPath: string): Promise<AlertsDocument> {
  const path = alertsPath(dataPath);

  try {
    return parseAlertsDocument(await readFile(path, "utf8"), (reason) => {
      log.warn("server", "Ignoring the alerts stored in %s: %s", path, reason);
    });
  } catch (error) {
    if (errorCodeOf(error) !== "ENOENT") {
      log.warn("server", "Cannot read %s: %s", path, errorMessageOf(error));
    }

    return defaultAlertsDocument();
  }
}

/**
 * Writes the document atomically (temp file plus rename, mode 0600). Returns false instead
 * of throwing, because the settings action surfaces the failure as a localized
 * form error and the scheduler must survive it.
 */
export async function writeAlertsDocument(
  dataPath: string,
  document: AlertsDocument,
): Promise<boolean> {
  const path = alertsPath(dataPath);
  const temp = `${path}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeAlertsDocument(document), {
      encoding: "utf8",
      // `wx` refuses a pre-existing path, so a planted symlink cannot make this
      // write reach the target, and the mode is not masked by the umask.
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, path);
    return true;
  } catch (error) {
    log.warn("config", "Unable to save the alert notification settings: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

/** Type guard for the history event ids the document can hold. */
export function isAlertHistoryEventId(value: unknown): value is AlertHistoryEventId {
  return value === "test" || isAlertEventId(value);
}
