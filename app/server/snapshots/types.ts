/** Shared snapshot types and the error codes the UI localizes. */

export type SnapshotTargetKind = "headscale_config" | "policy";

/** A file Headplane is allowed to snapshot and restore. */
export interface SnapshotTarget {
  path: string;
  kind: SnapshotTargetKind;
}

export interface SnapshotFile {
  /** File name inside the snapshot directory. */
  name: string;
  /** Absolute path the file was copied from and may be restored to. */
  sourcePath: string;
  size: number;
}

export interface SnapshotMeta {
  id: string;
  at: string;
  reason: string;
  files: SnapshotFile[];
  totalSize: number;
}

export type SnapshotErrorCode =
  | "notFound"
  | "unexpectedPath"
  | "noTargets"
  | "unavailable"
  | "copyFailed";

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode;

  constructor(code: SnapshotErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SnapshotError";
    this.code = code;
  }
}

export function isSnapshotError(error: unknown): error is SnapshotError {
  return error instanceof SnapshotError;
}

export const SNAPSHOT_META_FILE = "meta.json";
export const SNAPSHOT_INDEX_FILE = "index.json";
