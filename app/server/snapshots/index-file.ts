import { isSafeFileName, isSafeSnapshotId } from "./paths";
import type { SnapshotFile, SnapshotMeta } from "./types";

/**
 * Pure helpers for the snapshot metadata index (`snapshots/index.json`). Every
 * parser is defensive: a hand-edited or truncated index degrades to "no
 * snapshots" instead of breaking the page.
 */

function parseFile(value: unknown): SnapshotFile | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const sourcePath = typeof record.sourcePath === "string" ? record.sourcePath : "";
  if (!isSafeFileName(name) || sourcePath.length === 0) {
    return undefined;
  }

  const size =
    typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
      ? record.size
      : 0;

  return { name, sourcePath, size };
}

export function parseSnapshotMeta(value: unknown): SnapshotMeta | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const at = typeof record.at === "string" ? record.at : "";
  if (!isSafeSnapshotId(id) || Number.isNaN(Date.parse(at))) {
    return undefined;
  }

  const files = Array.isArray(record.files)
    ? record.files.map(parseFile).filter((file): file is SnapshotFile => file !== undefined)
    : [];

  return {
    id,
    at,
    reason: typeof record.reason === "string" ? record.reason : "unknown",
    files,
    totalSize: files.reduce((total, file) => total + file.size, 0),
  };
}

export function parseSnapshotIndex(raw: string): SnapshotMeta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map(parseSnapshotMeta).filter((meta): meta is SnapshotMeta => meta !== undefined);
}

/** Newest first, with the id as a stable tie-breaker. */
export function sortSnapshots(entries: readonly SnapshotMeta[]): SnapshotMeta[] {
  return [...entries].sort((a, b) => {
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    if (byTime !== 0) {
      return byTime;
    }

    return b.id.localeCompare(a.id);
  });
}

/** Adds (or replaces) one snapshot in the index, newest first. */
export function upsertSnapshotIndex(
  entries: readonly SnapshotMeta[],
  meta: SnapshotMeta,
): SnapshotMeta[] {
  return sortSnapshots([meta, ...entries.filter((entry) => entry.id !== meta.id)]);
}

export function serializeSnapshotIndex(entries: readonly SnapshotMeta[]): string {
  return `${JSON.stringify(sortSnapshots(entries), null, 2)}\n`;
}
