/**
 * Reasons a snapshot is taken. Stored verbatim in the snapshot metadata, so the
 * values must stay stable; the UI resolves labels from these codes. No imports
 * here so client components can use them safely.
 */

export const SNAPSHOT_REASONS = {
  manual: "manual",
  restrictionChange: "restriction-change",
  /**
   * A local DERP map file is snapshotted before Headplane edits it. The editor
   * appends the file's own name to the reason, so the snapshots page lists one
   * entry per edited map file; this constant is the shared prefix the editor
   * searches for when it looks up the copy to roll back to.
   */
  derpMap: "DERP map file",
} as const;

export type SnapshotReason = (typeof SNAPSHOT_REASONS)[keyof typeof SNAPSHOT_REASONS];
