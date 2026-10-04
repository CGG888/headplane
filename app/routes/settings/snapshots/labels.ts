import type { TranslationKey } from "~/i18n";
import { SNAPSHOT_REASONS } from "~/server/snapshots/reasons";

/** Localized labels for the snapshot reasons Headplane generates. */
export const REASON_KEYS: Record<string, TranslationKey> = {
  [SNAPSHOT_REASONS.manual]: "settings.snapshots.reasons.manual",
  [SNAPSHOT_REASONS.restrictionChange]: "settings.snapshots.reasons.restrictionChange",
};

/** Sizes are shown as a human-readable string; snapshots are small. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
