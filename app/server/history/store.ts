// MARK: Node history store
//
// The file half of the node history: reading and writing
// `<data_path>/node-history.json`. Following `alerts/store.ts` and
// `derp-region-names.ts`, reads are defensive (a missing, unreadable or corrupt
// document degrades to an empty one) and writes go through a temp file plus a
// rename, so a crash never leaves a half-written document behind.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import log from "~/utils/log";

import {
  emptyHistoryDocument,
  HISTORY_MAX_SAMPLES_PER_NODE,
  HISTORY_MAX_TICKS,
  HISTORY_VERSION,
  NODE_HISTORY_FILE,
  type NodeHistoryDocument,
  type NodeHistoryRecord,
  type NodeHistorySample,
} from "./types";

export function historyPath(dataPath: string): string {
  return resolve(dataPath, NODE_HISTORY_FILE);
}

export function defaultHistoryDocument(): NodeHistoryDocument {
  return emptyHistoryDocument();
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTimestamp(value: unknown): string | undefined {
  const text = readText(value);
  return text !== undefined && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function parseSample(value: unknown): NodeHistorySample | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const at = readTimestamp(source.at);
  if (at === undefined || typeof source.online !== "boolean") {
    return undefined;
  }

  return { at, online: source.online };
}

function parseRecord(value: unknown): NodeHistoryRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const id = readText(source.id);
  if (id === undefined) {
    return undefined;
  }

  const samples = Array.isArray(source.samples)
    ? source.samples
        .map(parseSample)
        .filter((sample): sample is NodeHistorySample => sample !== undefined)
        .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .slice(-HISTORY_MAX_SAMPLES_PER_NODE)
    : [];
  if (samples.length === 0) {
    return undefined;
  }

  const name = readText(source.name);
  return { id, ...(name === undefined ? {} : { name }), samples };
}

/** Parses the stored document, dropping anything that is not usable. */
export function parseHistoryDocument(raw: string | undefined | null): NodeHistoryDocument {
  const fallback = defaultHistoryDocument();
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
  if (source.version !== HISTORY_VERSION) {
    return fallback;
  }

  const ticks = Array.isArray(source.ticks)
    ? source.ticks
        .map(readTimestamp)
        .filter((tick): tick is string => tick !== undefined)
        .toSorted((a, b) => Date.parse(a) - Date.parse(b))
        .slice(-HISTORY_MAX_TICKS)
    : [];

  const nodes: NodeHistoryRecord[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.nodes)) {
    for (const entry of source.nodes) {
      const record = parseRecord(entry);
      if (record !== undefined && !seen.has(record.id)) {
        seen.add(record.id);
        nodes.push(record);
      }
    }
  }

  return { version: HISTORY_VERSION, ticks, nodes };
}

/** Stable, human-editable JSON with a trailing newline and the caps applied. */
export function serializeHistoryDocument(document: NodeHistoryDocument): string {
  return `${JSON.stringify(
    {
      version: HISTORY_VERSION,
      ticks: document.ticks.slice(-HISTORY_MAX_TICKS),
      nodes: document.nodes.map((record) => ({
        id: record.id,
        ...(record.name === undefined ? {} : { name: record.name }),
        samples: record.samples.slice(-HISTORY_MAX_SAMPLES_PER_NODE),
      })),
    },
    null,
    2,
  )}\n`;
}

/** Reads the document; a missing, unreadable or corrupt file reads as empty. */
export async function readHistoryDocument(dataPath: string): Promise<NodeHistoryDocument> {
  try {
    return parseHistoryDocument(await readFile(historyPath(dataPath), "utf8"));
  } catch {
    return defaultHistoryDocument();
  }
}

let tempCounter = 0;

/**
 * Writes the document atomically (temp file plus rename). Returns false instead
 * of throwing, because the sampler must survive a data directory it cannot
 * write to.
 */
export async function writeHistoryDocument(
  dataPath: string,
  document: NodeHistoryDocument,
): Promise<boolean> {
  const path = historyPath(dataPath);
  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeHistoryDocument(document), "utf8");
    await rename(temp, path);
    return true;
  } catch (error) {
    log.warn("config", "Unable to save the node history: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}
