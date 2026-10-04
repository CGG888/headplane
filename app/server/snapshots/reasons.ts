/**
 * Reasons a snapshot is taken. Stored verbatim in the snapshot metadata, so the
 * values must stay stable; the UI resolves labels from these codes. No imports
 * here so client components can use them safely.
 */

export const SNAPSHOT_REASONS = {
  manual: "manual",
  restrictionChange: "restriction-change",
} as const;

export type SnapshotReason = (typeof SNAPSHOT_REASONS)[keyof typeof SNAPSHOT_REASONS];
