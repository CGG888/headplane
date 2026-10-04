import { and, desc, gte, lte, sql, type SQL } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { auditLog, type AuditLogRecord } from "~/server/db/schema";

import type { AuditStorage } from "./store";
import type { AuditEntry, AuditPage, AuditQuery } from "./types";

/** Default page size when a caller does not ask for a specific window. */
const DEFAULT_LIMIT = 50;

function buildFilters(query: AuditQuery): SQL[] {
  const filters: SQL[] = [];

  if (query.action) {
    filters.push(sql`${auditLog.action} = ${query.action}`);
  }

  if (query.actor) {
    const needle = query.actor.trim().toLowerCase();
    if (needle) {
      // `instr` keeps % and _ out of the picture, unlike LIKE.
      filters.push(sql`instr(lower(${auditLog.actor}), ${needle}) > 0`);
    }
  }

  if (query.since) {
    filters.push(gte(auditLog.at, query.since));
  }

  if (query.until) {
    filters.push(lte(auditLog.at, query.until));
  }

  return filters;
}

function toEntry(row: AuditLogRecord): AuditEntry {
  return {
    id: row.id,
    at: row.at ?? new Date(0),
    actor: row.actor,
    actorType: row.actor_type,
    action: row.action,
    target: row.target,
    detail: row.detail ?? null,
    result: row.result,
  };
}

/**
 * Audit storage backed by the persistent Headplane database. The table is
 * created by an additive migration, so an existing database keeps working and a
 * missing one is simply created empty by the driver.
 */
export function createDbAuditStorage(db: NodeSQLiteDatabase): AuditStorage {
  return {
    async insert(entry) {
      await db.insert(auditLog).values({
        id: entry.id,
        at: entry.at,
        actor: entry.actor,
        actor_type: entry.actorType,
        action: entry.action,
        target: entry.target,
        detail: entry.detail,
        result: entry.result,
      });
    },

    async query(query: AuditQuery): Promise<AuditPage> {
      const filters = buildFilters(query);
      const where = filters.length > 0 ? and(...filters) : undefined;
      const limit = query.limit === undefined ? DEFAULT_LIMIT : Math.max(query.limit, 0);
      const offset = Math.max(query.offset ?? 0, 0);

      const rows = await db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(limit)
        .offset(offset);

      const totals = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .where(where);

      return {
        entries: rows.map((row) => toEntry(row)),
        total: Number(totals[0]?.count ?? 0),
      };
    },

    async trim(keep: number) {
      // One statement, so trimming stays cheap enough to run on every insert.
      // The newest-first subquery keeps the most recent `keep` rows by time and
      // falls back to the ULID ordering for identical timestamps.
      await db.run(
        sql`delete from audit_log where id not in (select id from audit_log order by at desc, id desc limit ${keep})`,
      );
      return 0;
    },
  };
}
