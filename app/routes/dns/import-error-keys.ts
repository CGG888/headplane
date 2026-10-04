import type { TranslationKey } from "~/i18n";

import { IMPORT_RECORD_TYPES, MAX_IMPORT_RECORDS, type ImportError } from "./records-io";

/**
 * Stable error codes returned by the DNS import, mapped onto the localized
 * message the dialog renders. Kept free of server imports so the dialog can use
 * it without pulling server-only modules into the browser bundle.
 */
export type ImportErrorCode = ImportError["code"];

export const IMPORT_ERROR_KEYS: Record<ImportErrorCode, TranslationKey> = {
  empty: "dns.importExport.errors.empty",
  invalidJson: "dns.importExport.errors.invalidJson",
  notArray: "dns.importExport.errors.notArray",
  notObject: "dns.importExport.errors.notObject",
  invalidName: "dns.importExport.errors.invalidName",
  invalidType: "dns.importExport.errors.invalidType",
  unsupportedType: "dns.importExport.errors.unsupportedType",
  invalidValue: "dns.importExport.errors.invalidValue",
  tooManyRecords: "dns.importExport.errors.tooManyRecords",
  conflictingRecord: "dns.importExport.errors.conflictingRecord",
};

/**
 * Values for the placeholders in the messages above. The offending entry is
 * reported one-based because that is the position a user counts in their file.
 */
export function importErrorVars(error: ImportError): Record<string, string | number> {
  return {
    position: (error.index ?? 0) + 1,
    type: error.type ?? "",
    types: IMPORT_RECORD_TYPES.join(", "),
    count: error.count ?? 0,
    max: MAX_IMPORT_RECORDS,
  };
}
