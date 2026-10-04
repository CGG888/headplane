import { ulid } from "ulidx";

import type { Principal } from "~/server/web/auth";

import { AUDIT_FIELD_LIMITS } from "./constants";

/**
 * Operation audit log primitives. This module stays free of `node:*` and
 * database imports so the record shape, the trimming rules and the query
 * matching can be unit tested on their own.
 */

export type AuditActorType = "user" | "api_key" | "system";
export type AuditResult = "success" | "failure";

export interface AuditEntry {
  id: string;
  at: Date;
  actor: string;
  actorType: AuditActorType;
  action: string;
  target: string;
  detail: string | null;
  result: AuditResult;
}

/** What a caller supplies; `id` and `at` are filled in when omitted. */
export interface AuditInput {
  id?: string;
  at?: Date;
  actor: string;
  actorType: AuditActorType;
  action: string;
  target?: string;
  detail?: string | null;
  result: AuditResult;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
}

/**
 * Every action Headplane can record. The value is stored verbatim, so it must
 * stay stable: the audit page and its filters resolve labels from these codes.
 */
export { AUDIT_ACTIONS, AUDIT_ACTION_CODES, type AuditAction } from "./actions";
export { AUDIT_FIELD_LIMITS, MAX_AUDIT_ENTRIES } from "./constants";

/** The partial prefix of an API key that is safe to store and display. */
export function apiKeyPrefix(apiKey: string): string {
  const raw = apiKey.replace(/^hskey-api-/, "");
  return raw.slice(0, 12);
}

/**
 * Describes the acting principal for the log. API keys are never stored whole;
 * only the prefix Headscale itself masks is kept.
 */
export function auditActorOf(principal: Principal | undefined): {
  actor: string;
  actorType: AuditActorType;
} {
  if (!principal) {
    return { actor: "system", actorType: "system" };
  }

  if (principal.kind === "api_key") {
    const name = principal.displayName?.trim();
    if (name) {
      return { actor: name, actorType: "api_key" };
    }

    const prefix = apiKeyPrefix(principal.apiKey);
    return { actor: prefix ? `api_key:${prefix}` : "api_key", actorType: "api_key" };
  }

  const profile = principal.profile;
  const name = profile.name?.trim() || profile.email?.trim() || profile.username?.trim();
  return { actor: name || principal.user.id, actorType: "user" };
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/** Fills in the generated fields and bounds every stored string. */
export function normalizeAuditInput(input: AuditInput): AuditEntry {
  return {
    id: input.id ?? ulid(),
    at: input.at ?? new Date(),
    actor: truncate(input.actor, AUDIT_FIELD_LIMITS.actor) || "system",
    actorType: input.actorType,
    action: truncate(input.action, AUDIT_FIELD_LIMITS.action) || "unknown",
    target: truncate(input.target ?? "", AUDIT_FIELD_LIMITS.target),
    detail: input.detail ? truncate(input.detail, AUDIT_FIELD_LIMITS.detail) || null : null,
    result: input.result,
  };
}

/** Newest first, falling back to the (time-sortable) id for equal timestamps. */
export function sortAuditEntries(entries: readonly AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => {
    const byTime = b.at.getTime() - a.at.getTime();
    if (byTime !== 0) {
      return byTime;
    }

    return b.id.localeCompare(a.id);
  });
}

/** Keeps the newest `keep` entries, in newest-first order. */
export function trimAuditEntries(entries: readonly AuditEntry[], keep: number): AuditEntry[] {
  if (keep <= 0) {
    return [];
  }

  return sortAuditEntries(entries).slice(0, keep);
}

/** Whether an entry passes the filters the audit page exposes. */
export function matchesAuditQuery(entry: AuditEntry, query: AuditQuery): boolean {
  if (query.action && entry.action !== query.action) {
    return false;
  }

  if (query.actor) {
    const needle = query.actor.trim().toLowerCase();
    if (needle && !entry.actor.toLowerCase().includes(needle)) {
      return false;
    }
  }

  if (query.since && entry.at.getTime() < query.since.getTime()) {
    return false;
  }

  if (query.until && entry.at.getTime() > query.until.getTime()) {
    return false;
  }

  return true;
}
