// MARK: Official DERP region mirror store
//
// The mirror's settings and its last run are Headplane state, not Headscale
// configuration, so they live in a JSON document under Headplane's `data_path`
// instead of the database: no schema change and no migration.
//
// Following `derp-sync/store.ts`, reads are defensive (a missing or corrupt
// document degrades to the defaults) and writes go through a temp file plus
// rename so a crash never leaves a half-written document behind.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import log from "~/utils/log";

import { normalizeDerpMirrorSettings, type DerpMirrorSettings } from "./settings";
import type {
  DerpMirrorMode,
  DerpMirrorOutcome,
  DerpMirrorReason,
  DerpMirrorReload,
  DerpMirrorRun,
  DerpMirrorSourceAttempt,
  DerpMirrorSourceFailure,
  DerpMirrorSourceKind,
} from "./types";

/** File under Headplane's `server.data_path`. */
export const DERP_MIRROR_FILE = "derp-region-mirror.json";

const MODES: readonly DerpMirrorMode[] = ["check", "run"];
const OUTCOMES: readonly DerpMirrorOutcome[] = ["changed", "unchanged", "skipped", "failed"];
const RELOADS: readonly DerpMirrorReload[] = ["not-needed", "manual", "triggered", "failed"];
const REASONS: readonly DerpMirrorReason[] = [
  "selection-empty",
  "fetch-unusable",
  "no-regions",
  "target-relative",
  "target-unsafe",
  "not-writable",
  "validation-failed",
  "reload-failed",
  "unexpected",
];
const SOURCE_KINDS: readonly DerpMirrorSourceKind[] = ["custom", "headscale", "official", "paste"];
const SOURCE_FAILURES: readonly DerpMirrorSourceFailure[] = [
  "timeout",
  "network",
  "status",
  "too-large",
  "unreadable",
];

/** The document the JSON store holds. */
export interface DerpMirrorDocument {
  settings: DerpMirrorSettings;
  /** The newest run; absent until the first run finishes. */
  last?: DerpMirrorRun;
}

export function derpMirrorPath(dataPath: string): string {
  return resolve(dataPath, DERP_MIRROR_FILE);
}

export function defaultDerpMirrorDocument(): DerpMirrorDocument {
  return { settings: normalizeDerpMirrorSettings(undefined) };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** An id -> number mapping, keeping only entries that are usable as an id. */
function parseAssignment(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries: Array<[string, number]> = [];
  for (const [key, number] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key.trim()) || typeof number !== "number" || !Number.isSafeInteger(number)) {
      continue;
    }

    entries.push([key.trim(), number]);
  }

  return Object.fromEntries(entries);
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of value) {
    const id = typeof entry === "string" || typeof entry === "number" ? String(entry).trim() : "";
    if (/^\d+$/.test(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/** One entry of a run's source list: the URL, and why it failed when it did. */
function parseAttempts(value: unknown): DerpMirrorSourceAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attempts: DerpMirrorSourceAttempt[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const attempt = entry as Record<string, unknown>;
    const url = readText(attempt.url);
    if (url === undefined) {
      continue;
    }

    attempts.push({
      url,
      ...(isOneOf(SOURCE_FAILURES, attempt.reason) ? { reason: attempt.reason } : {}),
    });
  }

  return attempts;
}

function parseRun(value: unknown): DerpMirrorRun | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const at = readText(source.at);
  if (at === undefined) {
    return undefined;
  }

  const detail = readText(source.detail);
  const snapshotId = readText(source.snapshotId);
  const error = readText(source.error);
  const mapSource = readText(source.source);
  const pastedAt = readText(source.pastedAt);

  return {
    at,
    // A document written before the two buttons existed recorded a run, so an
    // unknown mode reads as the writing one.
    mode: isOneOf(MODES, source.mode) ? source.mode : "run",
    outcome: isOneOf(OUTCOMES, source.outcome) ? source.outcome : "failed",
    selected: parseIdList(source.selected),
    mirrored: parseIdList(source.mirrored),
    assignment: parseAssignment(source.assignment),
    targetPath: readText(source.targetPath) ?? "",
    changed: source.changed === true,
    ...(mapSource === undefined ? {} : { source: mapSource }),
    ...(isOneOf(SOURCE_KINDS, source.sourceKind) ? { sourceKind: source.sourceKind } : {}),
    ...(pastedAt === undefined ? {} : { pastedAt }),
    ...(Array.isArray(source.attempts) ? { attempts: parseAttempts(source.attempts) } : {}),
    ...(isOneOf(REASONS, source.reason) ? { reason: source.reason } : {}),
    ...(detail === undefined ? {} : { detail }),
    ...(snapshotId === undefined ? {} : { snapshotId }),
    reload: isOneOf(RELOADS, source.reload) ? source.reload : "manual",
    ...(error === undefined ? {} : { error }),
  };
}

/** Parses the stored document, dropping anything that is not usable. */
export function parseDerpMirrorDocument(raw: string | undefined | null): DerpMirrorDocument {
  const fallback = defaultDerpMirrorDocument();
  if (!raw) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback;
  }

  const source = parsed as Record<string, unknown>;
  const last = parseRun(source.last);

  return {
    settings: normalizeDerpMirrorSettings(source.settings),
    ...(last === undefined ? {} : { last }),
  };
}

/** Stable, human-editable JSON with a trailing newline. */
export function serializeDerpMirrorDocument(document: DerpMirrorDocument): string {
  return `${JSON.stringify(
    {
      settings: document.settings,
      ...(document.last === undefined ? {} : { last: document.last }),
    },
    null,
    2,
  )}\n`;
}

/** Reads the document; a missing, unreadable or corrupt file reads as defaults. */
export async function readDerpMirrorDocument(dataPath: string): Promise<DerpMirrorDocument> {
  try {
    return parseDerpMirrorDocument(await readFile(derpMirrorPath(dataPath), "utf8"));
  } catch {
    return defaultDerpMirrorDocument();
  }
}

/** Reads just the settings, which is what a loader or the service needs. */
export async function readDerpMirrorSettings(dataPath: string): Promise<DerpMirrorSettings> {
  return (await readDerpMirrorDocument(dataPath)).settings;
}

let tempCounter = 0;

/**
 * Writes the document atomically (temp file plus rename). Throws when the write
 * could not be made: the settings action surfaces that as a localized form
 * error, while the scheduler catches it so a tick never becomes an unhandled
 * rejection.
 */
export async function writeDerpMirrorDocument(
  dataPath: string,
  document: DerpMirrorDocument,
): Promise<void> {
  const path = derpMirrorPath(dataPath);
  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeDerpMirrorDocument(document), "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    log.warn("config", "Unable to save the DERP region mirror settings: %s", String(error));
    throw error;
  }
}

/**
 * Writes new settings, leaving the last run untouched: the settings card saves
 * far more often than a run happens, and a save must not erase what the page
 * shows about the newest one.
 */
export async function writeDerpMirrorSettings(
  dataPath: string,
  settings: DerpMirrorSettings,
): Promise<void> {
  const current = await readDerpMirrorDocument(dataPath);
  await writeDerpMirrorDocument(dataPath, {
    settings: normalizeDerpMirrorSettings(settings),
    ...(current.last === undefined ? {} : { last: current.last }),
  });
}
