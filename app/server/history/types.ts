// MARK: Node history
//
// Node online/offline history is Headplane state, not Headscale configuration,
// so it lives in a JSON document under Headplane's `data_path` instead of the
// database: no schema change and no migration.
//
// The document is deliberately sparse and compact. Every sampler tick appends
// one timestamp to the fleet-wide `ticks` list — a tick with no state change
// still proves the sampler was running, which is what lets the timeline tell a
// gap in the record (Headplane was down) apart from "the node was offline". A
// node only gains a sample when its state actually changes, so a node that
// stayed online all week costs one sample instead of two thousand.

/** File under Headplane's `server.data_path`. */
export const NODE_HISTORY_FILE = "node-history.json";

/** How long records are kept; older ticks and samples are pruned away. */
export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound on the fleet-wide tick list (seven days at the default interval). */
export const HISTORY_MAX_TICKS = 2016;

/** Upper bound per node, so a flapping node cannot grow the document forever. */
export const HISTORY_MAX_SAMPLES_PER_NODE = 512;

/** Document format version; a document written by another shape is discarded. */
export const HISTORY_VERSION = 1;

/** One observed change of a node's online state. */
export interface NodeHistorySample {
  /** ISO timestamp of the observation. */
  at: string;
  online: boolean;
}

export interface NodeHistoryRecord {
  /** Headscale node id: the identity the machine pages look a node up by. */
  id: string;
  /** Last name reported for the node, so a removed node can still be labelled. */
  name?: string;
  /** Oldest first. */
  samples: NodeHistorySample[];
}

export interface NodeHistoryDocument {
  version: number;
  /** One timestamp per sample tick, oldest first. This is the continuity record. */
  ticks: string[];
  nodes: NodeHistoryRecord[];
}

/** The node fields one sample needs. */
export interface NodeHistoryInput {
  id: string;
  name?: string;
  online: boolean;
}

/** A document with no history in it, which is what a fresh install reads. */
export function emptyHistoryDocument(): NodeHistoryDocument {
  return { version: HISTORY_VERSION, ticks: [], nodes: [] };
}
