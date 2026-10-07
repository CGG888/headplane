import type { TranslationKey, Vars } from "~/i18n";

/** The translate function, narrowed to what these helpers need. */
type Translate = (key: TranslationKey, vars?: Vars) => string;

/** One machine a bulk run could not change, and why Headscale refused it. */
export interface BulkFailure {
  id: string;
  reason: string;
}

/**
 * Successful bulk runs report how many machines changed, how many failed, and
 * the reason for each failure so the dialog can name the machines involved.
 */
export interface BulkResult {
  success: true;
  updated: number;
  failed: number;
  failures: BulkFailure[];
}

/** A rejected bulk request carries a stable code the UI localizes. */
export interface BulkErrorResult {
  success: false;
  errorCode?: string;
  error?: string;
}

const ERROR_KEYS: Record<string, TranslationKey> = {
  noMachinesSelected: "machines.bulk.errors.noMachinesSelected",
  tooManyMachines: "machines.bulk.errors.tooManyMachines",
  missingTags: "machines.bulk.errors.missingTags",
  missingUserId: "machines.bulk.errors.missingUserId",
  ownerUnsupported: "machines.bulk.errors.ownerUnsupported",
  invalidExpiry: "machines.expire.errors.invalidDate",
  expiryInPast: "machines.expire.errors.pastDate",
};

/** Localized message for a failed bulk request. */
export function bulkErrorMessage(t: Translate, result: BulkErrorResult): string {
  if (result.errorCode !== undefined) {
    const key = ERROR_KEYS[result.errorCode];
    if (key !== undefined) {
      return t(key);
    }
  }

  return result.error ?? t("machines.bulk.errors.unknown");
}

/** Localized summary for a bulk run, spelling out partial failures. */
export function bulkSummary(t: Translate, result: BulkResult): string {
  if (result.failed === 0) {
    return t("machines.bulk.result.all", { count: result.updated });
  }

  return t("machines.bulk.result.partial", {
    updated: result.updated,
    failed: result.failed,
  });
}
