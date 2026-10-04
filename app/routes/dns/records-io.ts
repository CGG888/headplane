/**
 * Pure import/export logic for the DNS page's extra records.
 *
 * Kept free of React and server imports so both the browser (validation and
 * preview) and the DNS action (the authoritative check) can share it, and so it
 * can be unit tested on its own.
 */

/** A record as it appears in `dns.extra_records` and in exported files. */
export interface DNSRecordInput {
  name: string;
  type: string;
  value: string;
}

/**
 * The record types the DNS page can create (see the add-record dialog), and
 * therefore the only ones an imported file may contain.
 */
export const IMPORT_RECORD_TYPES = ["A", "AAAA"] as const;

export type ImportRecordType = (typeof IMPORT_RECORD_TYPES)[number];

/** Upper bound for a single import, so a bad file cannot fill the config. */
export const MAX_IMPORT_RECORDS = 1000;

export type ImportMode = "append" | "replace";

export type ImportErrorCode =
  /** No input at all, or a file with no records. */
  | "empty"
  | "invalidJson"
  | "notArray"
  | "notObject"
  | "invalidName"
  /** `type` is missing or not a string. */
  | "invalidType"
  /** `type` is a string but not one the DNS page offers. */
  | "unsupportedType"
  | "invalidValue"
  | "tooManyRecords"
  /**
   * Two entries share a name and type but disagree on the value. Headscale's
   * config helpers keep one record per name+type, so importing this file would
   * silently drop a value; the operator has to edit the config file instead.
   */
  | "conflictingRecord";

export interface ImportError {
  code: ImportErrorCode;
  /** Zero-based position of the offending entry in the parsed array. */
  index?: number;
  /** The rejected type, for `unsupportedType`. */
  type?: string;
  /** How many records the file contained, for `tooManyRecords`. */
  count?: number;
}

export interface ImportPlan {
  mode: ImportMode;
  /** The complete record list to write to the configuration. */
  records: DNSRecordInput[];
  /** Records that do not exist yet and will be created. */
  added: DNSRecordInput[];
  /** Existing records that will be deleted (replace mode only). */
  removed: DNSRecordInput[];
  /** How many imported records are written. */
  imported: number;
  /** How many duplicate entries were dropped. */
  skipped: number;
}

export type ParseResult =
  | { ok: true; records: DNSRecordInput[] }
  | { ok: false; error: ImportError };

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; error: ImportError };

/** The shape the DNS import action returns to the dialog. */
export type ImportActionData =
  | { success: true; imported: number; skipped: number }
  | { success: false; error: ImportError };

export function isImportRecordType(value: string): value is ImportRecordType {
  return (IMPORT_RECORD_TYPES as readonly string[]).includes(value);
}

/** Reads the import mode of a form field, defaulting to the safe append mode. */
export function parseImportMode(value: string | null | undefined): ImportMode {
  return value === "replace" ? "replace" : "append";
}

/**
 * Parses and strictly validates the JSON a user pasted or picked. Every
 * rejection names the offending entry so the UI can point at it.
 */
export function parseRecordsJson(text: string): ParseResult {
  if (text.trim().length === 0) {
    return { ok: false, error: { code: "empty" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalidJson" } };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: { code: "notArray" } };
  }

  if (parsed.length === 0) {
    return { ok: false, error: { code: "empty" } };
  }

  if (parsed.length > MAX_IMPORT_RECORDS) {
    return { ok: false, error: { code: "tooManyRecords", count: parsed.length } };
  }

  const records: DNSRecordInput[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const entry: unknown = parsed[index];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: { code: "notObject", index } };
    }

    const candidate = entry as Record<string, unknown>;
    const name = candidate.name;
    const recordType = candidate.type;
    const value = candidate.value;

    if (typeof name !== "string" || name.trim().length === 0) {
      return { ok: false, error: { code: "invalidName", index } };
    }

    if (typeof recordType !== "string") {
      return { ok: false, error: { code: "invalidType", index } };
    }

    if (!isImportRecordType(recordType)) {
      return { ok: false, error: { code: "unsupportedType", index, type: recordType } };
    }

    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, error: { code: "invalidValue", index } };
    }

    records.push({ name: name.trim(), type: recordType, value: value.trim() });
  }

  // Exact duplicates are harmless (the plan skips them), but two values for one
  // name and type cannot both be stored, so reject instead of losing one.
  const seen = new Map<string, string>();
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const key = `${record.name}\u0000${record.type}`;
    const previous = seen.get(key);
    if (previous !== undefined && previous !== record.value) {
      return { ok: false, error: { code: "conflictingRecord", index } };
    }
    seen.set(key, record.value);
  }

  return { ok: true, records };
}

/**
 * Merges a validated record list with what is already configured.
 *
 * Duplicates are exact `name` + `type` + `value` matches. In append mode a
 * record that is already configured (or repeated earlier in the file) is
 * skipped; in replace mode repeated entries in the file are deduped and the
 * current records are dropped.
 */
export function planImport(
  imported: readonly DNSRecordInput[],
  existing: readonly DNSRecordInput[],
  mode: ImportMode,
): ImportPlan {
  const existingKeys = new Set(existing.map(recordKey));
  const seen = new Set<string>();
  const accepted: DNSRecordInput[] = [];
  let skipped = 0;

  for (const record of imported) {
    const key = recordKey(record);
    if (seen.has(key) || (mode === "append" && existingKeys.has(key))) {
      skipped++;
      continue;
    }

    seen.add(key);
    accepted.push(record);
  }

  const acceptedKeys = new Set(accepted.map(recordKey));
  const added = accepted.filter((record) => !existingKeys.has(recordKey(record)));

  return {
    mode,
    records: mode === "append" ? [...existing, ...accepted] : accepted,
    added,
    removed: mode === "append" ? [] : existing.filter((r) => !acceptedKeys.has(recordKey(r))),
    imported: accepted.length,
    skipped,
  };
}

/** Validates the input and plans the resulting change in one step. */
export function importRecords(
  text: string,
  existing: readonly DNSRecordInput[],
  mode: ImportMode,
): ImportResult {
  const parsed = parseRecordsJson(text);
  if (!parsed.ok) {
    return parsed;
  }

  return { ok: true, plan: planImport(parsed.records, existing, mode) };
}

/** Stable, re-importable export shape: pretty JSON with only the three fields. */
export function serializeRecords(records: readonly DNSRecordInput[]): string {
  const payload = records.map(({ name, type, value }) => ({ name, type, value }));
  return JSON.stringify(payload, null, 2);
}

/** Timestamped download name, with characters Windows file names reject removed. */
export function exportFileName(date: Date): string {
  return `headplane-dns-records-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

function recordKey(record: DNSRecordInput): string {
  // NUL cannot appear in any of the three fields, so it is a safe separator.
  return `${record.name}\u0000${record.type}\u0000${record.value}`;
}
