// MARK: DERP address sync store
//
// The sync settings and its last run are Headplane state, not Headscale
// configuration, so they live in a JSON document under Headplane's `data_path`
// instead of the database: no schema change and no migration.
//
// Following `alerts/store.ts`, reads are defensive (a missing or corrupt
// document degrades to the defaults) and writes go through a temp file plus
// rename so a crash never leaves a half-written document behind.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import log from "~/utils/log";

import { normalizeDerpSyncSettings } from "./settings";
import type {
  DerpSyncCandidate,
  DerpSyncCandidateReason,
  DerpSyncChange,
  DerpSyncDocument,
  DerpSyncFailureReason,
  DerpSyncFamily,
  DerpSyncMode,
  DerpSyncOutcome,
  DerpSyncReload,
  DerpSyncRun,
  DerpSyncSkip,
  DerpSyncSkipReason,
  DerpSyncSource,
  DerpSyncValue,
} from "./types";

/** File under Headplane's `server.data_path`. */
export const DERP_SYNC_FILE = "derp-sync.json";

export function derpSyncPath(dataPath: string): string {
  return resolve(dataPath, DERP_SYNC_FILE);
}

export function defaultDerpSyncDocument(): DerpSyncDocument {
  return { settings: normalizeDerpSyncSettings(undefined) };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const FAMILIES: readonly DerpSyncFamily[] = ["ipv4", "ipv6"];
const SOURCES: readonly DerpSyncSource[] = ["dns", "host", "literal", "echo"];
const OUTCOMES: readonly DerpSyncOutcome[] = ["changed", "unchanged", "skipped", "failed"];
const RELOADS: readonly DerpSyncReload[] = ["not-needed", "manual", "triggered", "failed"];
const MODES: readonly DerpSyncMode[] = ["check", "run"];
const FAILURES: readonly DerpSyncFailureReason[] = [
  "detection-unusable",
  "not-writable",
  "reload-failed",
  "unexpected",
];
const CANDIDATE_REASONS: readonly DerpSyncCandidateReason[] = [
  "selected",
  "ranked-lower",
  "temporary",
  "not-public",
  "echo-wins",
  "excluded",
];
const SKIP_REASONS: readonly DerpSyncSkipReason[] = [
  "family-disabled",
  "host-missing",
  "invalid-host",
  "lookup-failed",
  "no-records",
  "not-public",
  "no-host-address",
  "namespace-unavailable",
  "config-not-writable",
];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function parseValue(value: unknown): DerpSyncValue | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const address = readText(source.address);
  if (address === undefined) {
    return undefined;
  }

  return { address, source: isOneOf(SOURCES, source.source) ? source.source : "dns" };
}

function parseChange(value: unknown): DerpSyncChange | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const to = readText(source.to);
  if (!isOneOf(FAMILIES, source.family) || to === undefined) {
    return undefined;
  }

  const from = readText(source.from);
  return { family: source.family, ...(from === undefined ? {} : { from }), to };
}

function parseSkip(value: unknown): DerpSyncSkip | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  if (!isOneOf(FAMILIES, source.family) || !isOneOf(SKIP_REASONS, source.reason)) {
    return undefined;
  }

  const detail = readText(source.detail);
  return {
    family: source.family,
    reason: source.reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

function parseCandidate(value: unknown): DerpSyncCandidate | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const address = readText(source.address);
  if (
    !isOneOf(FAMILIES, source.family) ||
    !isOneOf(SOURCES, source.source) ||
    !isOneOf(CANDIDATE_REASONS, source.reason) ||
    address === undefined
  ) {
    return undefined;
  }

  const interfaceName = readText(source.interfaceName);
  const detail = readText(source.detail);

  return {
    family: source.family,
    address,
    source: source.source,
    chosen: source.chosen === true,
    reason: source.reason,
    ...(source.temporary === true ? { temporary: true } : {}),
    ...(interfaceName === undefined ? {} : { interfaceName }),
    ...(detail === undefined ? {} : { detail }),
  };
}

function parseRun(value: unknown): DerpSyncRun | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const at = readText(source.at);
  if (at === undefined) {
    return undefined;
  }

  const detected: Partial<Record<DerpSyncFamily, DerpSyncValue>> = {};
  const rawDetected = source.detected;
  if (rawDetected !== null && typeof rawDetected === "object" && !Array.isArray(rawDetected)) {
    for (const family of FAMILIES) {
      const parsed = parseValue((rawDetected as Record<string, unknown>)[family]);
      if (parsed !== undefined) {
        detected[family] = parsed;
      }
    }
  }

  const list = <T>(input: unknown, parse: (entry: unknown) => T | undefined): T[] =>
    Array.isArray(input) ? input.map(parse).filter((entry): entry is T => entry !== undefined) : [];

  const snapshotId = readText(source.snapshotId);
  const error = readText(source.error);

  return {
    at,
    // A document written before the two buttons existed recorded a run, so an
    // unknown mode reads as the writing one.
    mode: isOneOf(MODES, source.mode) ? source.mode : "run",
    outcome: isOneOf(OUTCOMES, source.outcome) ? source.outcome : "failed",
    detected,
    candidates: list(source.candidates, parseCandidate),
    changes: list(source.changes, parseChange),
    skipped: list(source.skipped, parseSkip),
    unchanged: Array.isArray(source.unchanged)
      ? [...new Set(source.unchanged.filter((entry) => isOneOf(FAMILIES, entry)))]
      : [],
    ...(snapshotId === undefined ? {} : { snapshotId }),
    reload: isOneOf(RELOADS, source.reload) ? source.reload : "manual",
    ...(isOneOf(FAILURES, source.failure) ? { failure: source.failure } : {}),
    ...(error === undefined ? {} : { error }),
  };
}

/** Parses the stored document, dropping anything that is not usable. */
export function parseDerpSyncDocument(raw: string | undefined | null): DerpSyncDocument {
  const fallback = defaultDerpSyncDocument();
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
    settings: normalizeDerpSyncSettings(source.settings),
    ...(last === undefined ? {} : { last }),
  };
}

/** Stable, human-editable JSON with a trailing newline. */
export function serializeDerpSyncDocument(document: DerpSyncDocument): string {
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
export async function readDerpSyncDocument(dataPath: string): Promise<DerpSyncDocument> {
  try {
    return parseDerpSyncDocument(await readFile(derpSyncPath(dataPath), "utf8"));
  } catch {
    return defaultDerpSyncDocument();
  }
}

/**
 * Writes the document atomically (temp file plus rename). Returns false instead
 * of throwing, because the settings action surfaces the failure as a localized
 * form error and the scheduler must survive it.
 */
export async function writeDerpSyncDocument(
  dataPath: string,
  document: DerpSyncDocument,
): Promise<boolean> {
  const path = derpSyncPath(dataPath);
  const temp = `${path}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeDerpSyncDocument(document), {
      encoding: "utf8",
      // `wx` refuses a pre-existing path, so a planted symlink cannot make this
      // write reach the target.
      flag: "wx",
    });
    await rename(temp, path);
    return true;
  } catch (error) {
    log.warn("config", "Unable to save the DERP address sync settings: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}
