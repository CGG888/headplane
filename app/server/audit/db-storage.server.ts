import { and, desc, gte, lte, sql, type SQL } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { auditLog, type AuditLogRecord } from "~/server/db/schema";

import { auditChainHash, verifyAuditChain, type AuditChainReport } from "./chain";
import type { AuditStorage } from "./store";
import type { AuditEntry, AuditPage, AuditQuery } from "./types";

/** Default page size when a caller does not ask for a specific window. */
const DEFAULT_LIMIT = 50;

/**
 * The largest page a caller may ask for. The audit table is only bounded by the
 * retention window, so an accidental `limit: Infinity` would otherwise pull the
 * whole log into memory.
 */
const MAX_LIMIT = 2000;

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
  /**
   * `node:sqlite` runs statements synchronously, but drizzle's API is async, so
   * two inserts can read the same chain tip between awaits and fork the log.
   * Every read-then-write pair waits for the previous one instead.
   */
  let chainTail: Promise<unknown> = Promise.resolve();

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = chainTail.then(work, work);
    chainTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    insert(entry) {
      return serialize(async () => {
        const rows = await db
          .select({ hash: auditLog.hash })
          .from(auditLog)
          .orderBy(desc(sql`rowid`))
          .limit(1);

        await db.insert(auditLog).values({
          id: entry.id,
          at: entry.at,
          actor: entry.actor,
          actor_type: entry.actorType,
          action: entry.action,
          target: entry.target,
          detail: entry.detail,
          result: entry.result,
          hash: auditChainHash(rows[0]?.hash ?? null, entry),
        });
      });
    },

    async query(query: AuditQuery): Promise<AuditPage> {
      const filters = buildFilters(query);
      const where = filters.length > 0 ? and(...filters) : undefined;
      const limit =
        query.limit === undefined ? DEFAULT_LIMIT : Math.min(Math.max(query.limit, 0), MAX_LIMIT);
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
      // The window is cut by `rowid` rather than by timestamp: the chain is
      // ordered by insertion, so the surviving rows have to be too. The count
      // of removed rows is what every other backend reports as well.
      const result = await db.run(
        sql`delete from audit_log where rowid not in (select rowid from audit_log order by rowid desc limit ${keep})`,
      );
      return Number(result.changes ?? 0);
    },

    async verify(): Promise<AuditChainReport> {
      // Oldest first: the chain is only meaningful in insertion order.
      const rows = await db
        .select()
        .from(auditLog)
        .orderBy(sql`rowid`);

      return verifyAuditChain(rows.map((row) => ({ entry: toEntry(row), hash: row.hash ?? null })));
    },
  };
}
