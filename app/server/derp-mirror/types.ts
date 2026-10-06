/**
 * Shapes shared by the official-region mirror, its JSON store and the settings
 * card that renders its last run.
 *
 * This module deliberately imports nothing: the browser bundle value-imports
 * {@link DERP_MIRROR_INTERVAL_HOURS} to build the interval picker, so anything
 * pulled in here would end up in the client build.
 */

/**
 * One node of an official DERP region, as the official map declares it.
 * Structurally the same shape `~/server/headscale/derp-map-nodes` reads, so the
 * cached remote reader's answer is passed straight through.
 */
export interface OfficialRegionNode {
  name: string;
  hostname: string;
  /** `derpport` as declared; absent means the format's default (443). */
  derpPort?: number;
  /** `stunport` as declared; 0 is the format's "this node does not answer STUN". */
  stunPort?: number;
  stunOnly: boolean;
  ipv4?: string;
  ipv6?: string;
}

/** One official DERP region with every node the official map lists under it. */
export interface OfficialRegion {
  /** The official region id, as the official map declares it. */
  regionId: number;
  /** The official region code, e.g. `hkg`; kept verbatim in the mirrored map. */
  code: string;
  /** The official (English) region name. */
  name: string;
  nodes: OfficialRegionNode[];
}

/** One node of the generated local map, in Headscale's `derp.paths` format. */
export interface LocalDerpNode {
  /** `<region number><letter>`, e.g. `901a`. */
  name: string;
  hostname: string;
  regionid: number;
  derpport?: number;
  stunport?: number;
  stunonly?: boolean;
  ipv4?: string;
  ipv6?: string;
}

/** One region of the generated local map, renumbered into the 900s. */
export interface LocalDerpRegion {
  regionid: number;
  regioncode: string;
  regionname: string;
  nodes: LocalDerpNode[];
}

/**
 * The local DERP map file's content: a `regions` mapping keyed by the mirrored
 * number, exactly what Headscale merges from `derp.paths`.
 */
export interface LocalDerpMap {
  regions: Record<string, LocalDerpRegion>;
}

/**
 * The intervals the operator may pick. A fixed set rather than a free number,
 * because the official addresses change slowly and Headplane must not be able
 * to schedule an aggressive loop that rewrites a file Headscale loads.
 */
export const DERP_MIRROR_INTERVAL_HOURS = [6, 12, 24] as const;

export type DerpMirrorIntervalHours = (typeof DERP_MIRROR_INTERVAL_HOURS)[number];

/**
 * How a run was started. A `check` fetches, filters, generates and compares and
 * writes nothing at all; a `run` writes what changed and then follows the reload
 * switch.
 */
export type DerpMirrorMode = "check" | "run";

/** What a run did to the target file. */
export type DerpMirrorOutcome = "changed" | "unchanged" | "skipped" | "failed";

/** What a write means for the running Headscale. */
export type DerpMirrorReload = "not-needed" | "manual" | "triggered" | "failed";

/**
 * Every way a run can stop without writing, as a stable code. The card localizes
 * it, so no message text crosses this boundary.
 */
export type DerpMirrorReason =
  | "selection-empty"
  | "fetch-unusable"
  | "no-regions"
  | "target-relative"
  | "target-unsafe"
  | "not-writable"
  | "validation-failed"
  | "reload-failed"
  | "unexpected";

/** One run, as the page shows it and as the store keeps it. */
export interface DerpMirrorRun {
  /** ISO timestamp of the run. */
  at: string;
  mode: DerpMirrorMode;
  outcome: DerpMirrorOutcome;
  /** The official region ids the settings selected, in their stored order. */
  selected: string[];
  /**
   * The official region ids that were actually mirrored (the selection
   * intersected with the fetched map).
   */
  mirrored: string[];
  /** Official region id -> mirrored number, as this run settled it. */
  assignment: Record<string, number>;
  /** The resolved target file the run read and, on a write, replaced. */
  targetPath: string;
  /** Whether the rendered map differed from what the file already held. */
  changed: boolean;
  /** Why the run did not write; absent on a changed or unchanged run. */
  reason?: DerpMirrorReason;
  /** A stable detail for `reason`: the first issue code, or a technical value. */
  detail?: string;
  /** The snapshot taken before the write, when one was taken. */
  snapshotId?: string;
  reload: DerpMirrorReload;
  /** A short, non-localized message for an unexpected failure. */
  error?: string;
}
