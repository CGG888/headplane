import type { TranslationKey } from "~/i18n";
import type { DataBackupErrorCode } from "~/server/snapshots/data-backup.server";
import type { SnapshotErrorCode } from "~/server/snapshots/types";

/**
 * Stable error codes returned by the snapshot action, mapped onto the localized
 * message each control renders. Free of server imports so client components can
 * use it without pulling server modules into the browser bundle.
 */
export type SnapshotActionErrorCode = SnapshotErrorCode | "invalidAction";

export const SNAPSHOT_ERROR_KEYS: Record<SnapshotActionErrorCode, TranslationKey> = {
  notFound: "settings.snapshots.errors.notFound",
  unexpectedPath: "settings.snapshots.errors.unexpectedPath",
  noTargets: "settings.snapshots.errors.noTargets",
  unavailable: "settings.snapshots.errors.unavailable",
  copyFailed: "settings.snapshots.errors.copyFailed",
  invalidAction: "errors.generic.requestFailed",
};

/** Failure codes of the Headplane data backup, mapped like the action codes. */
export const DATA_BACKUP_ERROR_KEYS: Record<DataBackupErrorCode, TranslationKey> = {
  copyFailed: "settings.snapshots.dataBackup.errors.copyFailed",
  unavailable: "settings.snapshots.dataBackup.errors.unavailable",
};
