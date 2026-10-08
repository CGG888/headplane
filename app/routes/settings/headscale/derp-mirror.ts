/**
 * Plain values and pure helpers for the official region filter card.
 *
 * The loader reads the cached official map, the mirror settings, the newest run
 * and the agent's per-region measurements, then reduces all of them to the
 * shapes below. Only types come from the server modules — the interval list is
 * repeated here so the component never value-imports anything under
 * `app/server`, which is what keeps a socket (and a scheduler) out of the
 * browser bundle.
 *
 * The numbering preview mirrors the server's `assignRegionNumbers` instead of
 * inventing a rule of its own: the loader hands over the ranking order and the
 * numbers no region may take, and {@link previewRegionNumbers} numbers exactly
 * the regions that are ticked right now — first the numbers the stored
 * assignment already holds, then the rest in the loader's order starting at
 * 901. A number the stored assignment keeps for a region that is no longer
 * ticked is never shown, and a cleared selection previews no numbers at all.
 */

import type { TranslationKey } from "~/i18n";
import type {
  DerpMirrorOutcome,
  DerpMirrorProbeOutcome,
  DerpMirrorProbeStatus,
  DerpMirrorReason,
  DerpMirrorReload,
  DerpMirrorRun,
  DerpMirrorSourceFailure,
  DerpMirrorSourceKind,
} from "~/server/derp-mirror/types";

/**
 * Intervals the mirror can run on, in hours. The server accepts exactly these
 * (`DERP_MIRROR_INTERVAL_HOURS`) and validates every save against them, so the
 * two lists cannot drift silently.
 */
export const MIRROR_INTERVAL_HOURS = [6, 12, 24] as const;

export type MirrorIntervalHours = (typeof MIRROR_INTERVAL_HOURS)[number];

/**
 * How many source URLs the card lets the operator add. The server enforces the
 * same number (`DERP_MIRROR_MAX_SOURCES`) on every save, so the card cannot offer
 * a row the save would reject.
 */
export const MIRROR_MAX_SOURCES = 8;

/** The dedicated file name the settings row recommends. */
export const MIRROR_FILE_HINT = "official-mirror.yaml";

/** How many regions the "fastest" preset picks. */
export const MIRROR_RECOMMENDED_COUNT = 3;

/**
 * The mirrored range, repeated from the server so the preview needs no value
 * import: every number a mirrored region may carry lives in the 900s.
 */
export const MIRROR_NUMBER_MIN = 900;
export const MIRROR_NUMBER_MAX = 999;

/** One official region, as the table renders it. */
export interface MirrorRegionRow {
  officialId: number;
  code: string;
  officialName: string;
  /** The Chinese name the mirrored file carries, exactly as the server prints it. */
  chineseName: string;
  nodeCount: number;
  /** Lowest latency for this region, in milliseconds, from either source. */
  latencyMs: number | undefined;
  /**
   * Which source that latency came from: a measurement taken on this server, or
   * the value the machines reported. Absent when the region is unmeasured.
   */
  latencySource?: MirrorLatencySource;
  /** The mirrored number the settings already hold for this region. */
  storedNumber: number | undefined;
}

/**
 * Where one row's latency came from. The two are never mixed silently: a local
 * measurement reflects this server's network path, a reported one reflects the
 * path of whichever machine measured it, and the card labels each row.
 */
export type MirrorLatencySource = "measured" | "reported";

/** The label each latency row carries for its source. */
export const MIRROR_LATENCY_SOURCE_KEYS: Record<MirrorLatencySource, TranslationKey> = {
  measured: "settings.headscale.derp.mirror.latencySourceMeasured",
  reported: "settings.headscale.derp.mirror.latencySourceReported",
};

/** The value and source one region's latency has, from the two sample sets. */
export function mirrorRegionLatency(
  measured: Record<string, number>,
  reported: Record<string, number>,
  officialId: number,
): { latencyMs?: number; source?: MirrorLatencySource } {
  const id = String(officialId);
  const local = measured[id];
  if (local !== undefined) {
    return { latencyMs: local, source: "measured" };
  }

  const remote = reported[id];
  return remote === undefined ? {} : { latencyMs: remote, source: "reported" };
}

/**
 * The newest local probe, as the card reports it. Plain values only: when it
 * ran, and how it ended.
 */
export interface MirrorProbeView {
  /** ISO timestamp of the newest run; absent until the first probe finishes. */
  measuredAt?: string;
  /** How that run ended; absent until the first probe finishes. */
  outcome?: DerpMirrorProbeOutcome;
}

/** Re-exported so the component reads one module for every mirror type. */
export type MirrorProbeStatus = DerpMirrorProbeStatus;

/**
 * The `action_id` the card polls while a latency run is in flight. It is a read
 * of the run's state, never the probe itself, so it answers immediately however
 * many nodes the run is dialling. Kept here so the action, the card and the
 * page's revalidation policy cannot drift apart.
 */
export const MIRROR_PROBE_STATUS_ACTION_ID = "derp_latency_probe_status";

/**
 * How often the card reads that status while a run is in flight. One second is
 * fast enough to look live and slow enough that a run leaves a handful of tiny
 * requests behind it; a request is only sent once the previous one answered.
 */
export const MIRROR_PROBE_POLL_MS = 1000;

/**
 * The rows with a run's live measurements laid over them, so the table fills in
 * as the probes answer instead of appearing all at once at the end. A region the
 * run has already measured is this server's own number and is labelled as such,
 * exactly like the stored measurement it becomes; every other row is left as the
 * loader read it.
 */
export function withLiveMeasurements(
  regions: MirrorRegionRow[],
  measured: Record<string, number>,
): MirrorRegionRow[] {
  const ids = Object.keys(measured);
  if (ids.length === 0) {
    return regions;
  }

  return regions.map((region) => {
    const live = measured[String(region.officialId)];
    if (live === undefined || !Number.isFinite(live) || live < 0) {
      return region;
    }

    return { ...region, latencyMs: live, latencySource: "measured" };
  });
}

/**
 * How old a stored measurement may be before opening the card probes again. Ten
 * minutes keeps a reopened card from dialling the official relays on every
 * visit while still showing something current to an operator who is looking at
 * latency.
 */
export const MIRROR_PROBE_FRESH_MS = 10 * 60 * 1000;

/** Whether a probe should run on open: nothing measured yet, or a stale run. */
export function isMirrorProbeStale(probe: MirrorProbeView, now: number): boolean {
  if (probe.measuredAt === undefined) {
    return true;
  }

  const at = Date.parse(probe.measuredAt);
  return !Number.isFinite(at) || now - at >= MIRROR_PROBE_FRESH_MS;
}

/** The one sentence a finished probe leaves behind, when it has one to say. */
export const MIRROR_PROBE_OUTCOME_KEYS: Partial<Record<DerpMirrorProbeOutcome, TranslationKey>> = {
  partial: "settings.headscale.derp.mirror.probePartial",
  empty: "settings.headscale.derp.mirror.probeEmpty",
  cancelled: "settings.headscale.derp.mirror.probeCancelled",
};

/**
 * The order the server's rule produced for the full set of official regions:
 * every region id in the order a fresh ranking numbers them, so the first entry
 * is the one a fresh ranking makes 901.
 */
export interface MirrorNumbering {
  /** The first number a freely assigned region would get (901). */
  firstFreeNumber: number;
  /** Official region ids in the server's ranking order. */
  order: number[];
  /**
   * Numbers no ranked region may ever take: Headscale's embedded region id. The
   * server keeps it free, so a stored assignment that uses it cannot be kept
   * either.
   */
  reserved: number[];
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
  /** The source URLs the operator configured, in the order they are tried. */
  sourceUrls: string[];
  /**
   * The URL sources a run reads when no pasted map is stored: the configured
   * list, or the built-in chain when the list is empty. The card shows this
   * instead of resolving the order itself, so what it prints is what the next
   * run dials.
   */
  sources: MirrorSourceView[];
  /** The pasted map in the store, when the operator stored one. */
  paste?: MirrorPasteView;
}

/** Re-exported so the component reads one module for every mirror type. */
export type MirrorSourceFailure = DerpMirrorSourceFailure;

/** One source a run tried, and why it contributed nothing when it did not. */
export interface MirrorSourceAttemptView {
  /** The URL that was dialled, or the pasted map's marker. */
  url: string;
  /** Absent when the source answered with a usable map. */
  reason?: DerpMirrorSourceFailure;
}

/** One source a run may read the official map from, as the card lists it. */
export interface MirrorSourceView {
  url: string;
  kind: DerpMirrorSourceKind;
}

/** The pasted map as the card reports it: when, how big, how many regions. */
export interface MirrorPasteView {
  /** ISO timestamp of the save that stored it. */
  at: string;
  /** How many regions the body described when it was accepted. */
  regions: number;
  /** The stored body's size in bytes. */
  bytes: number;
}

/** The wording each kind of source carries, so a URL is never shown bare. */
export const MIRROR_SOURCE_KIND_KEYS: Record<DerpMirrorSourceKind, TranslationKey> = {
  custom: "settings.headscale.derp.mirror.sourceKindCustom",
  headscale: "settings.headscale.derp.mirror.sourceKindHeadscale",
  official: "settings.headscale.derp.mirror.sourceKindOfficial",
  paste: "settings.headscale.derp.mirror.sourceKindPaste",
};

/** Re-exported so the component reads one module for every mirror type. */
export type MirrorRun = DerpMirrorRun;

/**
 * The live numbering for a selection.
 *
 * The rule is the server's, mirrored: a ticked region the stored assignment
 * already numbers keeps that number when the server would keep it, and every
 * remaining ticked region is ranked in the loader's order and numbered from 901
 * upward, past the numbers already in use. Nothing is numbered for a region that
 * is not ticked, so clearing the selection empties the preview immediately and a
 * stored number can never survive a change that dropped the region it belongs to.
 */
export function previewRegionNumbers(
  numbering: MirrorNumbering,
  selected: ReadonlySet<number>,
  stored?: ReadonlyMap<number, number>,
): Map<number, number> {
  const numbers = new Map<number, number>();
  const used = new Set<number>(numbering.reserved);

  // The regions the stored assignment cannot keep a number for, in the order a
  // fresh ranking puts them: the loader already ranked every region that way.
  const ranked: number[] = [];
  for (const officialId of numbering.order) {
    if (!selected.has(officialId)) {
      continue;
    }

    const kept = stored?.get(officialId);
    if (
      kept !== undefined &&
      !used.has(kept) &&
      kept >= MIRROR_NUMBER_MIN &&
      kept <= MIRROR_NUMBER_MAX
    ) {
      numbers.set(officialId, kept);
      used.add(kept);
      continue;
    }

    ranked.push(officialId);
  }

  let next = numbering.firstFreeNumber;
  for (const number of numbers.values()) {
    next = Math.max(next, number + 1);
  }

  for (const officialId of ranked) {
    const number = takeFreeMirrorNumber(next, used);
    if (number === undefined) {
      break;
    }

    numbers.set(officialId, number);
    used.add(number);
    next = number + 1;
  }

  return numbers;
}

/**
 * The first free number from `start` inside the mirrored range, wrapping below
 * it when the tail is full. This is the server's own scan, so a preview never
 * claims a number the rule would refuse or hand to another region.
 */
function takeFreeMirrorNumber(start: number, used: ReadonlySet<number>): number | undefined {
  const from = Math.max(start, MIRROR_NUMBER_MIN);
  for (let number = from; number <= MIRROR_NUMBER_MAX; number += 1) {
    if (!used.has(number)) {
      return number;
    }
  }

  for (let number = MIRROR_NUMBER_MIN; number < from; number += 1) {
    if (!used.has(number)) {
      return number;
    }
  }

  return undefined;
}

/** The numbers the settings already hold, keyed by official region id. */
export function storedRegionNumbers(regions: readonly MirrorRegionRow[]): Map<number, number> {
  const stored = new Map<number, number>();
  for (const region of regions) {
    if (region.storedNumber !== undefined) {
      stored.set(region.officialId, region.storedNumber);
    }
  }

  return stored;
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

/** Why the latency column has nothing to show, when it has nothing to show. */
export type MirrorLatencyNotice = "agent-unavailable" | "unmeasured";

/** The one line each empty-latency case prints, in place of a blank column. */
export const MIRROR_LATENCY_NOTICE_KEYS: Record<MirrorLatencyNotice, TranslationKey> = {
  "agent-unavailable": "settings.headscale.derp.mirror.agentRequired",
  unmeasured: "settings.headscale.derp.mirror.latencyNoMeasurements",
};

/**
 * The line the card prints when no region has a measurement, and why.
 *
 * The only latency Headplane has is the one the Headplane Agent collects from
 * each machine's own `NetInfo.DERPLatency`, so an empty column always has one of
 * two causes: the agent is not reporting at all (disabled, unapproved, or its
 * last sync failed — the operator has to fix that on the Agent settings page),
 * or it is reporting and simply no machine has measured these regions yet. With
 * at least one measurement the column explains itself and nothing is printed.
 */
export function mirrorLatencyNotice(
  regions: readonly MirrorRegionRow[],
  agentAvailable: boolean,
): MirrorLatencyNotice | undefined {
  if (regions.length === 0) {
    return undefined;
  }

  const measured = regions.some((region) => formatMirrorLatency(region.latencyMs) !== undefined);
  if (measured) {
    return undefined;
  }

  return agentAvailable ? "unmeasured" : "agent-unavailable";
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
  "numbering-exhausted": "settings.headscale.derp.mirror.reasonNumberingExhausted",
  "target-not-mirror": "settings.headscale.derp.mirror.reasonTargetNotMirror",
  "snapshot-failed": "settings.headscale.derp.mirror.reasonSnapshotFailed",
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
