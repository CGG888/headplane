/**
 * Serialization for the audit export: one stable column order, an RFC 4180
 * escaped CSV and a JSON array of the same records. Kept free of router and
 * storage imports so the formats can be unit tested on their own.
 */

import { translate } from "~/i18n";
import type { TranslationKey } from "~/i18n";
import type { AuditEntry } from "~/server/audit/types";
import type { Locale } from "~/utils/locale";

export const AUDIT_EXPORT_FORMATS = ["csv", "json"] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

export function isAuditExportFormat(value: string | null): value is AuditExportFormat {
  return value !== null && (AUDIT_EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Single source of the column order, shared by the header row and the rows. */
export const AUDIT_EXPORT_COLUMNS = [
  "time",
  "actor",
  "actorType",
  "action",
  "result",
  "target",
  "detail",
] as const;
export type AuditExportColumn = (typeof AUDIT_EXPORT_COLUMNS)[number];

const COLUMN_LABEL_KEYS: Record<AuditExportColumn, TranslationKey> = {
  time: "settings.audit.exportColumns.time",
  actor: "settings.audit.exportColumns.actor",
  actorType: "settings.audit.exportColumns.actorType",
  action: "settings.audit.exportColumns.action",
  result: "settings.audit.exportColumns.result",
  target: "settings.audit.exportColumns.target",
  detail: "settings.audit.exportColumns.detail",
};

/** The localized header row, in column order. */
export function auditExportHeader(locale: Locale): string[] {
  return AUDIT_EXPORT_COLUMNS.map((column) => translate(locale, COLUMN_LABEL_KEYS[column]));
}

function columnValue(entry: AuditEntry, column: AuditExportColumn): string {
  switch (column) {
    case "time":
      return entry.at.toISOString();
    case "actor":
      return entry.actor;
    case "actorType":
      return entry.actorType;
    case "action":
      return entry.action;
    case "result":
      return entry.result;
    case "target":
      return entry.target;
    case "detail":
      return entry.detail ?? "";
  }
}

/**
 * Quotes a field that contains a quote, a comma or a line break (RFC 4180) and
 * neutralizes spreadsheet formulas: Excel and LibreOffice evaluate a cell that
 * starts with `=`, `+`, `-` or `@` (or a tab/CR), so a value such as a node name
 * like `=cmd|'/c calc'!A1` written into the audit log would run when an
 * administrator opens the export. A leading apostrophe is the usual mitigation.
 */
export function escapeCsvField(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  if (
    !neutralized.includes('"') &&
    !neutralized.includes(",") &&
    !neutralized.includes("\n") &&
    !neutralized.includes("\r")
  ) {
    return neutralized;
  }

  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function toAuditCsv(entries: readonly AuditEntry[], header: readonly string[]): string {
  const rows: string[][] = [Array.from(header)];
  for (const entry of entries) {
    rows.push(AUDIT_EXPORT_COLUMNS.map((column) => columnValue(entry, column)));
  }

  return `${rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n")}\r\n`;
}

/** One record of the JSON export; `at` is an ISO 8601 timestamp. */
export function auditExportRecord(entry: AuditEntry) {
  return {
    id: entry.id,
    at: entry.at.toISOString(),
    actor: entry.actor,
    actorType: entry.actorType,
    action: entry.action,
    result: entry.result,
    target: entry.target,
    detail: entry.detail,
  };
}

export function toAuditJson(entries: readonly AuditEntry[]): string {
  return `${JSON.stringify(
    entries.map((entry) => auditExportRecord(entry)),
    null,
    2,
  )}\n`;
}

export function auditExportContentType(format: AuditExportFormat): string {
  return format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
}

/** `headplane-audit-20261005-145219.csv`, stamped in UTC so names stay unique. */
export function auditExportFilename(format: AuditExportFormat, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");
  return `headplane-audit-${stamp}.${format}`;
}
