// MARK: Official DERP region mirror settings
//
// The setting itself is Headplane state, not Headscale configuration, so it
// lives in the JSON store under `data_path` (see `./store`). Every read assumes
// the file was hand-edited: an interval outside the offered set, a region id
// that is not a number, an assignment outside the 900s and a relative target
// path all fall back to the default instead of scheduling or writing something
// unexpected.

import { isAbsolute } from "node:path";

import {
  DERP_MIRROR_INTERVAL_HOURS,
  type DerpLatencyNodeReading,
  type DerpLatencyRegionReading,
  type DerpMirrorIntervalHours,
  type DerpMirrorLatency,
  type DerpMirrorProbeOutcome,
  type ProbeFamily,
  type ProbeMethod,
} from "./types";

/**
 * Where the mirrored map is written when the operator has not chosen a path.
 * The data directory of a common NAS deployment: the mirror is a file Headscale
 * loads through `derp.paths`, so it has to live where Headscale can read it.
 */
export const DEFAULT_DERP_MIRROR_TARGET_PATH =
  "/vol1/@appdata/headscale/derp-maps/official-mirror.yaml";

/** The official region mirrored to 901: Hong Kong. */
export const DEFAULT_DERP_MIRROR_REGION_IDS = ["20", "3"] as const;

/** The assignment a fresh install starts from: Hong Kong 901, Singapore 902. */
export const DEFAULT_DERP_MIRROR_ASSIGNMENT: Record<string, number> = {
  "20": 901,
  "3": 902,
};

/** The lowest and highest mirrored numbers; the matcher keeps everything here. */
export const DERP_MIRROR_NUMBER_MIN = 900;
export const DERP_MIRROR_NUMBER_MAX = 999;

export interface DerpMirrorSettings {
  /** When false the scheduled tick does nothing; a manual run still works. */
  enabled: boolean;
  /** The official region ids the operator picked, as decimal strings. */
  officialRegionIds: string[];
  /** Official region id -> the number it is mirrored as. */
  assignment: Record<string, number>;
  /** ISO timestamp of the last fresh ranking; absent while the assignment is kept. */
  assignmentRankedAt?: string;
  /** The absolute path of the local map file Headplane maintains. */
  targetPath: string;
  intervalHours: DerpMirrorIntervalHours;
  /**
   * Whether a write may trigger the configured reload/restart integration. On
   * by default, because a mirrored map only reaches clients after Headscale
   * reloads; the switch turns the automatic reload off.
   */
  autoReload: boolean;
  /**
   * The latencies this server measured itself, kept alongside the settings it
   * belongs to (Headplane's own JSON store, not Headscale's configuration). The
   * numbering prefers these over what the machines reported, which is what makes
   * the official regions rankable at all on a mirrored setup.
   */
  latency?: DerpMirrorLatency;
}

export const DEFAULT_DERP_MIRROR_SETTINGS: DerpMirrorSettings = {
  // Opt-in: enabling it lets Headplane rewrite a file Headscale loads on a
  // schedule, which an operator has to ask for explicitly.
  enabled: false,
  officialRegionIds: [...DEFAULT_DERP_MIRROR_REGION_IDS],
  assignment: { ...DEFAULT_DERP_MIRROR_ASSIGNMENT },
  targetPath: DEFAULT_DERP_MIRROR_TARGET_PATH,
  intervalHours: 24,
  autoReload: true,
};

/** Only the offered intervals are accepted; anything else is not schedulable. */
export function isDerpMirrorIntervalHours(value: unknown): value is DerpMirrorIntervalHours {
  return (
    typeof value === "number" && (DERP_MIRROR_INTERVAL_HOURS as readonly number[]).includes(value)
  );
}

/** Parses a form value or a stored value into an allowed interval. */
export function parseDerpMirrorIntervalHours(value: unknown): DerpMirrorIntervalHours | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;

  return isDerpMirrorIntervalHours(parsed) ? parsed : undefined;
}

/** How long one interval is, in milliseconds. */
export function derpMirrorIntervalMs(hours: DerpMirrorIntervalHours): number {
  return hours * 60 * 60 * 1000;
}

/** One official region id: a decimal string naming a positive integer. */
export function normalizeOfficialRegionId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return undefined;
  }

  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
}

/** The selected region ids, deduplicated and stripped of anything unusable. */
export function normalizeOfficialRegionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_DERP_MIRROR_SETTINGS.officialRegionIds];
  }

  const ids: string[] = [];
  for (const entry of value) {
    const id = normalizeOfficialRegionId(entry);
    if (id !== undefined && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/** One mirrored number: an integer inside the 900s, or nothing. */
export function normalizeMirrorNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  return parsed >= DERP_MIRROR_NUMBER_MIN && parsed <= DERP_MIRROR_NUMBER_MAX ? parsed : undefined;
}

/**
 * The stored assignment, keeping only entries that map a region id to an
 * in-range number. Two regions that would share a number keep the first (ids
 * ascending), because a duplicate would make the rendered map ambiguous.
 */
export function normalizeAssignment(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DERP_MIRROR_SETTINGS.assignment };
  }

  const entries: Array<[string, number]> = [];
  const used = new Set<number>();
  for (const key of Object.keys(value as Record<string, unknown>).toSorted(
    (a, b) => Number(a) - Number(b),
  )) {
    const id = normalizeOfficialRegionId(key);
    const number = normalizeMirrorNumber((value as Record<string, unknown>)[key]);
    if (id === undefined || number === undefined || used.has(number)) {
      continue;
    }

    used.add(number);
    entries.push([id, number]);
  }

  return Object.fromEntries(entries.toSorted((a, b) => a[1] - b[1] || Number(a[0]) - Number(b[0])));
}

/**
 * The stored assignment reduced to the regions the operator still mirrors.
 *
 * A selection that dropped a region has no number for it either: the server's
 * `assignRegionNumbers` returns only the selected regions and ranks the ones the
 * stored assignment does not cover, so a stale entry would never survive the
 * next run. Dropping it when the selection is saved keeps the stored numbering
 * honest about what the mirror is set up to write, and re-ticking a region later
 * ranks it like any other region the assignment does not cover.
 */
export function pruneAssignmentToSelection(
  assignment: Record<string, number>,
  selected: readonly string[],
): Record<string, number> {
  const wanted = new Set<string>();
  for (const entry of selected) {
    const id = normalizeOfficialRegionId(entry);
    if (id !== undefined) {
      wanted.add(id);
    }
  }

  const kept: Array<[string, number]> = [];
  for (const [id, number] of Object.entries(normalizeAssignment(assignment))) {
    if (wanted.has(id)) {
      kept.push([id, number]);
    }
  }

  return Object.fromEntries(kept);
}

/** An ISO timestamp worth keeping; anything unparseable is not one. */
function normalizeRankedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const text = value.trim();
  return Number.isFinite(Date.parse(text)) ? text : undefined;
}

/** Non-empty text of a stored value, or undefined. */
function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** One of a fixed set of literals, or undefined. */
function readOneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const PROBE_OUTCOMES: readonly DerpMirrorProbeOutcome[] = [
  "complete",
  "partial",
  "empty",
  "cancelled",
];
const PROBE_FAMILIES: readonly ProbeFamily[] = ["ipv4", "ipv6"];
const PROBE_METHODS: readonly ProbeMethod[] = ["stun", "tcp"];

/** A duration worth storing: a finite, non-negative number of milliseconds. */
function readLatencyMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** One stored node reading, or undefined when it is not one. */
function normalizeLatencyNode(value: unknown): DerpLatencyNodeReading | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const name = readText(source.name);
  const hostname = readText(source.hostname);
  const target = readText(source.target);
  const family = readOneOf(PROBE_FAMILIES, source.family);
  const method = readOneOf(PROBE_METHODS, source.method);
  const latencyMs = readLatencyMs(source.latencyMs);
  if (
    name === undefined ||
    hostname === undefined ||
    target === undefined ||
    family === undefined ||
    method === undefined ||
    latencyMs === undefined
  ) {
    return undefined;
  }

  return { name, hostname, family, target, latencyMs, method };
}

/**
 * One stored region reading, or undefined when it is not one. The source is
 * forced to `measured`: this store only ever holds what this server probed, and
 * a hand-edited file must not be able to pass a client-reported value off as
 * one measured here.
 */
function normalizeLatencyRegion(
  value: unknown,
  fallbackAt: string,
): DerpLatencyRegionReading | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const id = normalizeOfficialRegionId(source.regionId);
  if (id === undefined) {
    return undefined;
  }

  const nodes: DerpLatencyNodeReading[] = [];
  if (Array.isArray(source.nodes)) {
    for (const entry of source.nodes) {
      const node = normalizeLatencyNode(entry);
      if (node !== undefined) {
        nodes.push(node);
      }
    }
  }

  const bestV4 = readLatencyMs(source.bestV4);
  const bestV6 = readLatencyMs(source.bestV6);
  if (nodes.length === 0 && bestV4 === undefined && bestV6 === undefined) {
    return undefined;
  }

  const measuredAt = normalizeRankedAt(source.measuredAt) ?? fallbackAt;

  return {
    regionId: Number(id),
    regionCode: readText(source.regionCode) ?? "",
    ...(bestV4 === undefined ? {} : { bestV4 }),
    ...(bestV6 === undefined ? {} : { bestV6 }),
    nodes,
    measuredAt,
    source: "measured",
  };
}

/**
 * The stored local measurements, or undefined when there is nothing usable.
 * The run timestamp is the anchor: a record without a readable one is not a
 * measurement this build can trust or date, so it is dropped entirely and the
 * numbering falls back to what the machines reported.
 */
export function normalizeDerpMirrorLatency(value: unknown): DerpMirrorLatency | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const measuredAt = normalizeRankedAt(source.measuredAt);
  if (measuredAt === undefined) {
    return undefined;
  }

  const regions: DerpLatencyRegionReading[] = [];
  if (Array.isArray(source.regions)) {
    for (const entry of source.regions) {
      const region = normalizeLatencyRegion(entry, measuredAt);
      if (region !== undefined) {
        regions.push(region);
      }
    }
  }

  const outcome =
    readOneOf(PROBE_OUTCOMES, source.outcome) ?? (regions.length > 0 ? "partial" : "empty");

  return { measuredAt, outcome, regions };
}

/**
 * The target file, kept only when it is absolute. A relative path would resolve
 * against the process working directory — somewhere the operator did not mount —
 * so it falls back to the default instead of writing to an unknown place.
 */
function normalizeTargetPath(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_DERP_MIRROR_SETTINGS.targetPath;
  }

  const text = value.trim();
  return text.length > 0 && isAbsolute(text) ? text : DEFAULT_DERP_MIRROR_SETTINGS.targetPath;
}

/** Turns an arbitrary value into usable settings, defaulting anything unknown. */
export function normalizeDerpMirrorSettings(raw: unknown): DerpMirrorSettings {
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const rankedAt = normalizeRankedAt(source.assignmentRankedAt);
  const latency = normalizeDerpMirrorLatency(source.latency);

  return {
    enabled: source.enabled === true,
    officialRegionIds: normalizeOfficialRegionIds(source.officialRegionIds),
    assignment: normalizeAssignment(source.assignment),
    ...(rankedAt === undefined ? {} : { assignmentRankedAt: rankedAt }),
    targetPath: normalizeTargetPath(source.targetPath),
    intervalHours:
      parseDerpMirrorIntervalHours(source.intervalHours) ??
      DEFAULT_DERP_MIRROR_SETTINGS.intervalHours,
    // Only an explicit "false" turns the reload off; a document written before
    // the default changed, or one missing the key, gets the default (on).
    autoReload: source.autoReload !== false,
    ...(latency === undefined ? {} : { latency }),
  };
}
