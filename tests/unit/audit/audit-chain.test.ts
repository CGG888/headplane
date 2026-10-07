import { describe, expect, test } from "vitest";

import { auditChainHash, canonicalAuditEntry, verifyAuditChain } from "~/server/audit/chain";
import type { AuditChainRow } from "~/server/audit/chain";
import { AUDIT_ACTIONS, type AuditEntry } from "~/server/audit/types";

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 12, minute));
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-000000",
    at: at(0),
    actor: "alice",
    actorType: "user",
    action: AUDIT_ACTIONS.apiKeyCreate,
    target: "hskey-api-abcdefghijkl",
    detail: null,
    result: "success",
    ...overrides,
  };
}

/** Builds the chain the store would have written for these entries. */
function chain(entries: readonly AuditEntry[]): AuditChainRow[] {
  const rows: AuditChainRow[] = [];
  for (const item of entries) {
    rows.push({ entry: item, hash: auditChainHash(rows[rows.length - 1]?.hash ?? null, item) });
  }

  return rows;
}

describe("audit chain", () => {
  test("separates fields that would otherwise run together", () => {
    // Without the length prefix "ab" + "c" and "a" + "bc" would hash the same.
    expect(canonicalAuditEntry(entry({ actor: "ab", action: "c" }))).not.toBe(
      canonicalAuditEntry(entry({ actor: "a", action: "bc" })),
    );
  });

  test("changes when any recorded field changes", () => {
    const base = canonicalAuditEntry(entry());
    expect(canonicalAuditEntry(entry({ target: "other" }))).not.toBe(base);
    expect(canonicalAuditEntry(entry({ result: "failure" }))).not.toBe(base);
    expect(canonicalAuditEntry(entry({ detail: "note" }))).not.toBe(base);
    expect(canonicalAuditEntry(entry({ at: at(1) }))).not.toBe(base);
  });

  test("verifies an untouched chain", () => {
    const rows = chain([entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    expect(verifyAuditChain(rows)).toEqual({ checked: 2, broken: [] });
  });

  test("reports the row whose contents were edited", () => {
    const rows = chain([entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    const edited = rows.map((row, index) =>
      index === 1 ? { ...row, entry: { ...row.entry, target: "edited" } } : row,
    );

    // Only the edited row is at fault: the row after it still matches the link
    // that was stored on it.
    expect(verifyAuditChain(edited)).toEqual({ checked: 2, broken: ["b"] });
  });

  test("reports a rewritten link and the row that follows it", () => {
    const rows = chain([entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    const rewritten = rows.map((row, index) =>
      index === 1 ? { ...row, hash: "0".repeat(64) } : row,
    );

    expect(verifyAuditChain(rewritten)).toEqual({ checked: 2, broken: ["b", "c"] });
  });

  test("reports a row that lost its link", () => {
    const rows = chain([entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    const withGap = rows.map((row, index) => (index === 2 ? { ...row, hash: null } : row));

    expect(verifyAuditChain(withGap)).toEqual({ checked: 2, broken: ["c"] });
  });

  test("skips the oldest link so a trimmed window still verifies", () => {
    // The oldest surviving row was chained to a predecessor that is gone, so
    // its own link cannot be recomputed and is not held against it.
    const rows = chain([entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    expect(verifyAuditChain(rows.slice(1))).toEqual({ checked: 1, broken: [] });
  });

  test("reports nothing when there is nothing to check", () => {
    expect(verifyAuditChain([])).toEqual({ checked: 0, broken: [] });
    expect(verifyAuditChain([{ entry: entry(), hash: null }])).toEqual({ checked: 0, broken: [] });
  });
});
