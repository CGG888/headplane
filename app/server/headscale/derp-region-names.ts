/**
 * Manual "region id -> name" mapping for DERP regions Headplane cannot resolve.
 *
 * Headscale only names its own embedded DERP region; every external region in
 * the merged DERP map reaches Headplane as a bare id (there is no public DERP
 * map endpoint). Operators can name those regions here. The mapping is
 * Headplane state, so it lives in Headplane's data directory instead of
 * Headscale's config file.
 *
 * Every read is defensive: a missing or corrupt file degrades to "no manual
 * names" instead of breaking a page render, and writes go through a temp file
 * plus rename so a crash never leaves a half-written mapping behind.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import log from "~/utils/log";

/** File under Headplane's `server.data_path`. */
export const DERP_REGION_NAMES_FILE = "derp-region-names.json";

/**
 * Why a snapshot is taken before a bulk insertion. Stored verbatim in the
 * snapshot metadata, so the value must stay stable.
 */
export const DERP_REGION_NAMES_SNAPSHOT_REASON = "derp-region-names";

/** Region id (as a decimal string) to operator-supplied display name. */
export type DerpRegionNames = Record<string, string>;

/** `<data_path>/derp-region-names.json` — the file the editor reads and writes. */
export function derpRegionNamesPath(dataPath: string): string {
  return resolve(dataPath, DERP_REGION_NAMES_FILE);
}

/** Region ids are positive safe integers; anything else is not a usable key. */
function normalizeRegionId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const id = Number(trimmed);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return undefined;
  }

  return String(id);
}

/**
 * Parses the stored JSON, keeping only entries that are a positive integer id
 * mapped to a non-blank string. A corrupt document parses as an empty map.
 */
export function parseDerpRegionNames(raw: string | undefined | null): DerpRegionNames {
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const names: DerpRegionNames = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = normalizeRegionId(key);
    if (id === undefined || typeof value !== "string") {
      continue;
    }

    const name = value.trim();
    if (name.length === 0) {
      continue;
    }

    names[id] = name;
  }

  return names;
}

/** Stable, human-editable JSON: ids ascending, one name per line. */
export function serializeDerpRegionNames(names: DerpRegionNames): string {
  const sorted: DerpRegionNames = {};
  for (const key of Object.keys(names).toSorted((a, b) => Number(a) - Number(b))) {
    sorted[key] = names[key];
  }

  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** Adds or replaces one id -> name pair, returning a new map. */
export function setDerpRegionName(
  names: DerpRegionNames,
  regionId: number | string,
  name: string,
): DerpRegionNames {
  const id = normalizeRegionId(String(regionId));
  const trimmed = name.trim();
  if (id === undefined || trimmed.length === 0) {
    return { ...names };
  }

  return { ...names, [id]: trimmed };
}

/** Removes one id -> name pair, returning a new map. */
export function removeDerpRegionName(
  names: DerpRegionNames,
  regionId: number | string,
): DerpRegionNames {
  const id = normalizeRegionId(String(regionId));
  if (id === undefined || !(id in names)) {
    return { ...names };
  }

  const next = { ...names };
  delete next[id];
  return next;
}

/** One id -> name pair a bulk insertion may add. */
export interface DerpRegionNameEntry {
  regionId: number | string;
  name: string;
}

/** How a bulk insertion changed the mapping. */
export interface DerpRegionNameMerge {
  names: DerpRegionNames;
  /** Entries that were missing and are part of `names` now. */
  added: number;
}

/**
 * Adds the entries the mapping does not already hold, and reports how many were
 * added.
 *
 * The mapping is the operator's own, so an id that already has a name is never
 * touched — the function only fills gaps, which makes it idempotent: running it
 * twice adds nothing the second time. Unusable entries (a non-numeric id, a
 * blank name) are skipped individually rather than failing the batch.
 */
export function mergeMissingDerpRegionNames(
  names: DerpRegionNames,
  entries: readonly DerpRegionNameEntry[],
): DerpRegionNameMerge {
  const merged: DerpRegionNames = { ...names };
  let added = 0;

  for (const entry of entries) {
    const id = normalizeRegionId(String(entry.regionId));
    const name = entry.name.trim();
    if (id === undefined || name.length === 0 || id in merged) {
      continue;
    }

    merged[id] = name;
    added += 1;
  }

  return { names: merged, added };
}

/** The manual name for a region id, or undefined when there is none. */
export function derpRegionNameFor(
  names: DerpRegionNames | undefined,
  regionId: number,
): string | undefined {
  if (!names) {
    return undefined;
  }

  const id = normalizeRegionId(String(regionId));
  return id === undefined ? undefined : names[id];
}

/** Reads the mapping; a missing, unreadable or corrupt file reads as empty. */
export async function readDerpRegionNames(dataPath: string): Promise<DerpRegionNames> {
  try {
    return parseDerpRegionNames(await readFile(derpRegionNamesPath(dataPath), "utf8"));
  } catch {
    return {};
  }
}

let tempCounter = 0;

/**
 * Writes the mapping atomically (temp file plus rename) so a failure never
 * leaves a truncated file behind. Returns false instead of throwing, because
 * callers surface the failure as a localized form error.
 */
export async function writeDerpRegionNames(
  dataPath: string,
  names: DerpRegionNames,
): Promise<boolean> {
  const path = derpRegionNamesPath(dataPath);
  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeDerpRegionNames(names), "utf8");
    await rename(temp, path);
    return true;
  } catch (error) {
    log.warn("config", "Unable to save the DERP region name mapping: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}
