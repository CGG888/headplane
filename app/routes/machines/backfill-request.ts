/**
 * The machines list's backfill control: what it submits and how it reads the
 * answer back.
 *
 * This module has no imports so the client dialog can use it without pulling
 * server code into the browser bundle, and so the unit tests can cover the
 * request and the summary in a plain node environment.
 */

/** `action_id` the machines action switches on for a backfill. */
export const BACKFILL_ACTION = "backfill_ips";

/**
 * The request the dialog submits, or nothing at all.
 *
 * Backfilling writes to every node it touches, so the list's control only ever
 * opens a confirmation; `confirmed` is true only once the operator pressed that
 * dialog's confirm button. The request itself carries nothing else — the scope
 * is the whole server.
 */
export function confirmedBackfillRequest(confirmed: boolean): FormData | null {
  if (!confirmed) {
    return null;
  }

  const form = new FormData();
  form.set("action_id", BACKFILL_ACTION);
  return form;
}

/**
 * What one backfill run answers with: the lines Headscale reported, or a stable
 * error code plus the server's own message when it refused.
 */
export type BackfillResult =
  | { success: true; changes: string[] }
  | { success: false; errorCode?: string; error?: string };

/** What one backfill run changed, as the dialog reports it. */
export interface BackfillSummary {
  /** Lines Headscale reported, one per address assigned or removed. */
  changes: number;
  /** Distinct nodes named by those lines, counting each node once. */
  nodes: number;
  /** Those nodes' ids, in the order Headscale named them. */
  nodeIds: string[];
}

/**
 * Counts a backfill response.
 *
 * Headscale answers with one human-readable line per address, not per node —
 * `assigned IPv4 "100.64.0.1" to Node(3) "host"` — so a node missing both an
 * IPv4 and an IPv6 address appears twice. The node id is read back out of that
 * line so the dialog can say how many *nodes* were fixed; a line whose format
 * does not name a node still counts as a change.
 */
export function backfillSummary(changes: readonly string[]): BackfillSummary {
  const nodeIds = new Set<string>();
  for (const change of changes) {
    const match = /Node\((\d+)\)/.exec(change);
    if (match) {
      nodeIds.add(match[1]);
    }
  }

  return { changes: changes.length, nodeIds: [...nodeIds], nodes: nodeIds.size };
}
