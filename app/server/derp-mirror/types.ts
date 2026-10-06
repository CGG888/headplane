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

/** One address family the latency probe measured on its own. */
export type ProbeFamily = "ipv4" | "ipv6";

/**
 * How one latency was measured: a UDP STUN binding round trip on the node's
 * `stunport` (the path DERP itself uses), or a TCP/TLS handshake on its
 * `derpport` when UDP gave nothing.
 */
export type ProbeMethod = "stun" | "tcp";

/**
 * Why one probe attempt produced no value. Every failure is a labelled result,
 * never an exception: `timeout` for a silent node, `unresolved` for an address
 * that family does not have, `no-stun` for a node with STUN switched off,
 * `cancelled` for a run the operator stopped, and `error` for everything else.
 */
export type ProbeFailure = "timeout" | "unresolved" | "error" | "no-stun" | "cancelled";

/**
 * How one whole probe run ended: every region with nodes answered (`complete`),
 * some did not (`partial`), nothing answered at all (`empty`, the honest
 * "could not probe from this server" case), or the operator stopped it
 * (`cancelled`).
 */
export type DerpMirrorProbeOutcome = "complete" | "partial" | "empty" | "cancelled";

/**
 * Where a stored latency came from. Only this server's own probe writes a
 * stored reading, so the only value is `measured`; the agent-reported values
 * are recomputed from the machines on every render and are never stored here.
 */
export type DerpLatencySource = "measured";

/** One node and family as the probe measured it, kept in the stored record. */
export interface DerpLatencyNodeReading {
  name: string;
  hostname: string;
  family: ProbeFamily;
  /** The declared address, or the hostname the family resolved, that was dialled. */
  target: string;
  latencyMs: number;
  method: ProbeMethod;
}

/**
 * One official region as this server measured it: the best value per family,
 * the per-node values behind those numbers, when they were taken and where they
 * came from.
 */
export interface DerpLatencyRegionReading {
  regionId: number;
  /** The official region code, so the record reads without the map at hand. */
  regionCode: string;
  /** The fastest IPv4 measurement, when any node answered on IPv4. */
  bestV4?: number;
  /** The fastest IPv6 measurement, when any node answered on IPv6. */
  bestV6?: number;
  nodes: DerpLatencyNodeReading[];
  /** ISO timestamp of the run that produced these values. */
  measuredAt: string;
  source: DerpLatencySource;
}

/**
 * Every latency this server measured itself, as the region-mirror store keeps
 * it alongside the other settings. A region nothing answered for simply has no
 * entry, so the numbering falls back to what the machines reported.
 */
export interface DerpMirrorLatency {
  /** ISO timestamp of the newest run, whatever it found. */
  measuredAt: string;
  outcome: DerpMirrorProbeOutcome;
  /** One entry per region that produced at least one measurement. */
  regions: DerpLatencyRegionReading[];
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
