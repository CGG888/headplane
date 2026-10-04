/**
 * Audit log limits. Kept free of imports so both server modules and client
 * components can use them.
 */

/** Newest number of entries Headplane keeps in the persistent store. */
export const MAX_AUDIT_ENTRIES = 5000;

/** Longest value stored per column, so a runaway payload cannot bloat a row. */
export const AUDIT_FIELD_LIMITS = {
  actor: 200,
  action: 100,
  target: 500,
  detail: 1000,
} as const;
