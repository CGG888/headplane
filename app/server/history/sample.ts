// MARK: Appending samples
//
// The pure half of the node history store: given the document and what one tick
// observed, produce the next document. No I/O and no clock of its own, so the
// retention rules are unit testable, and the same function backs both the
// sampler and the tests that pin the pruning behaviour down.
//
// Retention is by time (a sample must fall inside the window) and by count (a
// last-resort bound for a node that flaps faster than the interval). A reported
// node's newest sample always survives the time prune even when it predates the
// window: it is the state carried into the window, and dropping it would make
// the first buckets of every timeline read "unknown". A node that is no longer
// reported has no such state to carry and ages out with its samples.

import {
  HISTORY_MAX_SAMPLES_PER_NODE,
  HISTORY_MAX_TICKS,
  HISTORY_RETENTION_MS,
  type NodeHistoryDocument,
  type NodeHistoryInput,
  type NodeHistoryRecord,
  type NodeHistorySample,
} from "./types";

export interface AppendHistoryOptions {
  /** How far back state is kept; defaults to {@link HISTORY_RETENTION_MS}. */
  retentionMs?: number;
  /** Fleet-wide tick cap; defaults to {@link HISTORY_MAX_TICKS}. */
  maxTicks?: number;
  /** Per-node sample cap; defaults to {@link HISTORY_MAX_SAMPLES_PER_NODE}. */
  maxSamplesPerNode?: number;
}

/**
 * Appends one sample and prunes everything the window no longer holds.
 *
 * The document reference is returned unchanged when the tick was already
 * recorded at `at`, which keeps an injected clock (and a retried tick)
 * idempotent instead of growing the document.
 */
export function appendHistorySample(
  document: NodeHistoryDocument,
  nodes: readonly NodeHistoryInput[],
  at: number,
  options: AppendHistoryOptions = {},
): NodeHistoryDocument {
  if (!Number.isFinite(at)) {
    return document;
  }

  const iso = new Date(at).toISOString();
  if (document.ticks.at(-1) === iso) {
    return document;
  }

  const retentionMs = options.retentionMs ?? HISTORY_RETENTION_MS;
  const maxTicks = options.maxTicks ?? HISTORY_MAX_TICKS;
  const maxSamplesPerNode = options.maxSamplesPerNode ?? HISTORY_MAX_SAMPLES_PER_NODE;
  const cutoff = at - retentionMs;

  const ticks = pruneTicks([...document.ticks, iso], cutoff, maxTicks);
  const pending = new Map(nodes.map((node) => [node.id, node]));
  const records: NodeHistoryRecord[] = [];

  for (const record of document.nodes) {
    const updated = updateRecord(record, pending.get(record.id), {
      iso,
      cutoff,
      maxSamplesPerNode,
    });
    pending.delete(record.id);
    if (updated !== undefined) {
      records.push(updated);
    }
  }

  for (const input of pending.values()) {
    const created = updateRecord({ id: input.id, samples: [] }, input, {
      iso,
      cutoff,
      maxSamplesPerNode,
    });
    if (created !== undefined) {
      records.push(created);
    }
  }

  return { ...document, ticks, nodes: records };
}

interface UpdateContext {
  iso: string;
  cutoff: number;
  maxSamplesPerNode: number;
}

/**
 * One record after a tick: the name is refreshed, a sample is appended only
 * when the state changed, and anything outside the window is pruned. A record
 * with no samples left and no node behind it (the node was removed from the
 * tailnet more than a window ago) is dropped.
 */
function updateRecord(
  record: NodeHistoryRecord,
  input: NodeHistoryInput | undefined,
  context: UpdateContext,
): NodeHistoryRecord | undefined {
  // A reported node keeps its newest sample even when it predates the window:
  // that sample is the state it carries into the window. A node nobody reports
  // any more has no such state to carry, so it ages out entirely.
  const samples = pruneSamples(
    record.samples,
    context.cutoff,
    context.maxSamplesPerNode,
    input !== undefined,
  );
  const last = samples.at(-1);
  const name = input?.name ?? record.name;

  if (input === undefined) {
    if (samples.length === 0) {
      return undefined;
    }

    return { id: record.id, ...(name === undefined ? {} : { name }), samples };
  }

  const next =
    last !== undefined && last.online === input.online
      ? samples
      : [...samples, { at: context.iso, online: input.online }];

  return {
    id: record.id,
    ...(name === undefined ? {} : { name }),
    samples: next.slice(-context.maxSamplesPerNode),
  };
}

/**
 * Samples inside the retention window, newest-last. With `carryIn` the newest
 * sample is kept even when it is older than the cutoff, because it is the state
 * the window starts from; without it every stale sample is dropped.
 */
export function pruneSamples(
  samples: readonly NodeHistorySample[],
  cutoff: number,
  limit: number,
  carryIn = true,
): NodeHistorySample[] {
  const kept = samples.filter((sample) => {
    const time = Date.parse(sample.at);
    return Number.isFinite(time) && time >= cutoff;
  });

  if (kept.length === 0 && carryIn && samples.length > 0) {
    kept.push(samples[samples.length - 1]);
  }

  return kept.slice(-limit);
}

/** Tick timestamps inside the retention window, newest-last, capped. */
function pruneTicks(ticks: readonly string[], cutoff: number, limit: number): string[] {
  return ticks
    .filter((tick) => {
      const time = Date.parse(tick);
      return Number.isFinite(time) && time >= cutoff;
    })
    .slice(-limit);
}
