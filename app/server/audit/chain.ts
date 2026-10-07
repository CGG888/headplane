import { createHash } from "node:crypto";

import type { AuditEntry } from "./types";

/**
 * The audit log is a hash chain: every row carries a digest over its own fields
 * and the digest of the row written before it. A row that was edited in place,
 * or one that was removed from the middle of the log, no longer lines up with
 * its neighbours, so `verifyAuditChain` can point at it.
 *
 * The digest is not keyed. It catches the case the retention window invites —
 * someone reaching into the database to rewrite or drop a record — but anyone
 * who can write rows can also recompute the chain from the row they changed
 * onwards. It is a tamper-evidence check, not a signature.
 */

/** One stored row, paired with the chain link it was written with. */
export interface AuditChainRow {
  entry: AuditEntry;
  hash: string | null;
}

export interface AuditChainReport {
  /** Rows that had a predecessor to check against. */
  checked: number;
  /** Ids of rows whose stored link does not match the row before them. */
  broken: string[];
  /** Set when the log could not be read, so nothing could be checked. */
  unavailable?: boolean;
}

/**
 * Length-prefixed so no combination of field contents can be rearranged into
 * the same string as a different entry.
 */
function field(value: string | null): string {
  const text = value ?? "";
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

const CHAIN_FIELDS = "|";

export function canonicalAuditEntry(entry: AuditEntry): string {
  return [
    field(entry.id),
    field(String(entry.at.getTime())),
    field(entry.actor),
    field(entry.actorType),
    field(entry.action),
    field(entry.target),
    field(entry.detail),
    field(entry.result),
  ].join(CHAIN_FIELDS);
}

/** The link stored on a row, given the link of the row before it. */
export function auditChainHash(previousHash: string | null, entry: AuditEntry): string {
  return createHash("sha256")
    .update(field(previousHash))
    .update(CHAIN_FIELDS)
    .update(canonicalAuditEntry(entry))
    .digest("hex");
}

/**
 * Walks `rows` oldest first. The oldest row that carries a link is the anchor
 * of the surviving window — its predecessor was trimmed away — so checking
 * starts with the row after it.
 */
export function verifyAuditChain(rows: readonly AuditChainRow[]): AuditChainReport {
  const anchor = rows.findIndex((row) => row.hash !== null);
  if (anchor < 0) {
    return { checked: 0, broken: [] };
  }

  const broken: string[] = [];
  let checked = 0;

  for (let index = anchor + 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    checked += 1;
    if (current.hash == null || current.hash !== auditChainHash(previous.hash, current.entry)) {
      broken.push(current.entry.id);
    }
  }

  return { checked, broken };
}
