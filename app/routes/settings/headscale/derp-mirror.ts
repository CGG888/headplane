/**
 * Plain values and pure helpers for the official region mirror tab.
 *
 * The loader reads the cached official map, the mirror settings, the newest run
 * and the agent's per-region measurements, then reduces all of them to the
 * shapes below. Only types come from the server modules — the interval list is
 * repeated here so the component never value-imports anything under
 * `app/server`, which is what keeps a socket (and a scheduler) out of the
 * browser bundle.
 *
 * The numbering preview deliberately does not encode the assignment rule: the
 * loader hands over the order and the fixed anchors the server's
 * `assignRegionNumbers` produced, and {@link previewRegionNumbers} only walks
 * that order, skipping the regions that are not ticked. Ticking a different set
 * therefore previews exactly the numbers a fresh ranking of that set assigns.
 */

import type { TranslationKey } from "~/i18n";
import type {
  DerpMirrorOutcome,
  DerpMirrorReason,
  DerpMirrorReload,
  DerpMirrorRun,
} from "~/server/derp-mirror/types";

/**
 * Intervals the mirror can run on, in hours. The server accepts exactly these
 * (`DERP_MIRROR_INTERVAL_HOURS`) and validates every save against them, so the
 * two lists cannot drift silently.
 */
export const MIRROR_INTERVAL_HOURS = [6, 12, 24] as const;

export type MirrorIntervalHours = (typeof MIRROR_INTERVAL_HOURS)[number];

/** The dedicated file name the settings row recommends. */
export const MIRROR_FILE_HINT = "official-mirror.yaml";

/** How many regions the "fastest" preset picks. */
export const MIRROR_RECOMMENDED_COUNT = 3;

/** One official region, as the table renders it. */
export interface MirrorRegionRow {
  officialId: number;
  code: string;
  officialName: string;
  /** The Chinese name the mirrored file carries, exactly as the server prints it. */
  chineseName: string;
  nodeCount: number;
  /** Lowest latency the agent measured for this region, in milliseconds. */
  latencyMs: number | undefined;
  /** The mirrored number the settings already hold for this region. */
  storedNumber: number | undefined;
}

/**
 * The order and the fixed anchors the server's rule produced for the full set of
 * official regions: the two pinned regions (Hong Kong at 901, Singapore at 902)
 * and every region id in the order a fresh ranking numbers them.
 */
export interface MirrorNumbering {
  fixed: { officialId: number; number: number }[];
  /** The first number a freely assigned region would get (903 with both anchors). */
  firstFreeNumber: number;
  /** Official region ids in the server's ranking order. */
  order: number[];
}

/** How the table is ordered. The preview always follows the server's order. */
export type MirrorSortMode = "official" | "latency";

/** The settings row and the selection, as the loader hands them over. */
export interface MirrorSettingsView {
  enabled: boolean;
  targetPath: string;
  intervalHours: MirrorIntervalHours;
  autoReload: boolean;
  /** Official region ids the operator picked, as numbers for the checkboxes. */
  selectedIds: number[];
  /** ISO timestamp of the last fresh ranking, when the assignment has one. */
  rankedAt?: string;
}

/** Re-exported so the component reads one module for every mirror type. */
export type MirrorRun = DerpMirrorRun;

/**
 * The live numbering for a selection.
 *
 * The fixed anchors are the server's, and the free numbers follow the server's
 * ranking order, so this is the assignment a fresh ranking of the ticked regions
 * produces — the client only decides which rows are ticked.
 */
export function previewRegionNumbers(
  numbering: MirrorNumbering,
  selected: ReadonlySet<number>,
): Map<number, number> {
  const numbers = new Map<number, number>();
  const fixed = new Set<number>();

  for (const entry of numbering.fixed) {
    fixed.add(entry.officialId);
    numbers.set(entry.officialId, entry.number);
  }

  let next = numbering.firstFreeNumber;
  for (const officialId of numbering.order) {
    if (fixed.has(officialId) || !selected.has(officialId)) {
      continue;
    }

    numbers.set(officialId, next);
    next += 1;
  }

  return numbers;
}

/** Official ids that are always mirrored, whatever the selection says. */
export function fixedRegionIds(numbering: MirrorNumbering): number[] {
  return numbering.fixed.map((entry) => entry.officialId);
}

/**
 * Orders the rows for display. A region the agent never measured sorts after
 * every measured one, with official id and code breaking ties so the order is
 * stable either way.
 */
export function sortMirrorRegions(
  regions: MirrorRegionRow[],
  mode: MirrorSortMode,
): MirrorRegionRow[] {
  const rows = [...regions];
  if (mode === "official") {
    return rows.toSorted((a, b) => a.officialId - b.officialId);
  }

  return rows.toSorted((a, b) => {
    if (a.latencyMs === undefined || b.latencyMs === undefined) {
      if (a.latencyMs !== undefined) {
        return -1;
      }

      if (b.latencyMs !== undefined) {
        return 1;
      }
    } else if (a.latencyMs !== b.latencyMs) {
      return a.latencyMs - b.latencyMs;
    }

    return a.officialId - b.officialId || a.code.localeCompare(b.code);
  });
}

/** The regions a latency ceiling keeps. Unmeasured regions never match. */
export function regionsBelowLatency(
  regions: MirrorRegionRow[],
  maxMs: number | undefined,
): MirrorRegionRow[] {
  if (maxMs === undefined || !Number.isFinite(maxMs)) {
    return regions;
  }

  return regions.filter((region) => region.latencyMs !== undefined && region.latencyMs <= maxMs);
}

/** The fastest measured regions, the preset's one-click selection. */
export function recommendedRegionIds(
  regions: MirrorRegionRow[],
  count = MIRROR_RECOMMENDED_COUNT,
): number[] {
  const measured = regions
    .filter((region) => region.latencyMs !== undefined)
    .toSorted(
      (a, b) =>
        (a.latencyMs ?? 0) - (b.latencyMs ?? 0) ||
        a.officialId - b.officialId ||
        a.code.localeCompare(b.code),
    );

  return measured.slice(0, Math.max(0, count)).map((region) => region.officialId);
}

/** Milliseconds as the latency column prints them, or `undefined` when unknown. */
export function formatMirrorLatency(latencyMs: number | undefined): string | undefined {
  if (latencyMs === undefined || !Number.isFinite(latencyMs) || latencyMs < 0) {
    return undefined;
  }

  return `${Math.round(latencyMs)}ms`;
}

/** Nodes across every region the newest run mirrored. */
export function mirroredNodeCount(run: MirrorRun, regions: MirrorRegionRow[]): number {
  const counts = new Map(regions.map((region) => [String(region.officialId), region.nodeCount]));
  let total = 0;
  for (const id of run.mirrored) {
    total += counts.get(id) ?? 0;
  }

  return total;
}

/** The code and node count of a region id the run names, when the map is loaded. */
export function mirrorRegionLookup(
  regions: MirrorRegionRow[],
): (officialId: string) => MirrorRegionRow | undefined {
  const byId = new Map(regions.map((region) => [String(region.officialId), region]));
  return (officialId) => byId.get(officialId);
}

/** How a finished run reads at a glance. */
export const MIRROR_OUTCOME_KEYS: Record<DerpMirrorOutcome, TranslationKey> = {
  changed: "settings.headscale.derp.mirror.outcomeChanged",
  unchanged: "settings.headscale.derp.mirror.outcomeUnchanged",
  skipped: "settings.headscale.derp.mirror.outcomeSkipped",
  failed: "settings.headscale.derp.mirror.outcomeFailed",
};

/** The outcome pill, where a check that found work reads as "would be written". */
export function mirrorOutcomeKey(run: MirrorRun): TranslationKey {
  return run.mode === "check" && run.outcome === "changed"
    ? "settings.headscale.derp.mirror.outcomeWouldChange"
    : MIRROR_OUTCOME_KEYS[run.outcome];
}

/** Why a run stopped without writing, and what the operator can do about it. */
export const MIRROR_REASON_KEYS: Record<DerpMirrorReason, TranslationKey> = {
  "selection-empty": "settings.headscale.derp.mirror.reasonSelectionEmpty",
  "fetch-unusable": "settings.headscale.derp.mirror.reasonFetchUnusable",
  "no-regions": "settings.headscale.derp.mirror.reasonNoRegions",
  "target-relative": "settings.headscale.derp.mirror.reasonTargetRelative",
  "target-unsafe": "settings.headscale.derp.mirror.reasonTargetUnsafe",
  "not-writable": "settings.headscale.derp.mirror.reasonNotWritable",
  "validation-failed": "settings.headscale.derp.mirror.reasonValidationFailed",
  "reload-failed": "settings.headscale.derp.mirror.reasonReloadFailed",
  unexpected: "settings.headscale.derp.mirror.reasonUnexpected",
};

/** What the write means for the running Headscale. */
export const MIRROR_RELOAD_KEYS: Record<DerpMirrorReload, TranslationKey> = {
  "not-needed": "settings.headscale.derp.mirror.reloadNotNeeded",
  manual: "settings.headscale.derp.mirror.reloadManual",
  triggered: "settings.headscale.derp.mirror.reloadTriggered",
  failed: "settings.headscale.derp.mirror.reloadFailed",
};

/** The interval choices, worded per length. */
export const MIRROR_INTERVAL_KEYS: Record<MirrorIntervalHours, TranslationKey> = {
  6: "settings.headscale.derp.mirror.interval6",
  12: "settings.headscale.derp.mirror.interval12",
  24: "settings.headscale.derp.mirror.interval24",
};
