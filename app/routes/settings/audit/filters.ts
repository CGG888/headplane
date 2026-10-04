/**
 * Pure query-string parsing for the audit page, so the filter behaviour (range
 * windows, page clamping, load-more links) can be unit tested without a router.
 */

export const AUDIT_PAGE_SIZE = 25;

export const AUDIT_RANGES = ["1h", "24h", "7d", "30d", "all"] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

const RANGE_MS: Record<Exclude<AuditRange, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export interface AuditFilters {
  actor: string;
  action: string;
  range: AuditRange;
  page: number;
}

export function isAuditRange(value: string | null): value is AuditRange {
  return value !== null && (AUDIT_RANGES as readonly string[]).includes(value);
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const range = params.get("range");
  const rawPage = Number(params.get("page") ?? "1");

  return {
    actor: (params.get("actor") ?? "").trim().slice(0, 100),
    action: (params.get("action") ?? "").trim().slice(0, 100),
    range: isAuditRange(range) ? range : "all",
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

/** Oldest timestamp a range filter includes, or nothing for "all". */
export function auditRangeSince(range: AuditRange, now: Date = new Date()): Date | undefined {
  if (range === "all") {
    return undefined;
  }

  return new Date(now.getTime() - RANGE_MS[range]);
}

/** Rebuilds the query string for filter forms and the load-more link. */
export function auditQueryString(filters: Partial<AuditFilters>): string {
  const params = new URLSearchParams();
  if (filters.actor) {
    params.set("actor", filters.actor);
  }

  if (filters.action) {
    params.set("action", filters.action);
  }

  if (filters.range && filters.range !== "all") {
    params.set("range", filters.range);
  }

  if (filters.page && filters.page > 1) {
    params.set("page", String(filters.page));
  }

  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}
