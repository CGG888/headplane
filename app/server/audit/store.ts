import log from "~/utils/log";

import {
  auditChainHash,
  verifyAuditChain,
  type AuditChainReport,
  type AuditChainRow,
} from "./chain";
import {
  MAX_AUDIT_ENTRIES,
  matchesAuditQuery,
  normalizeAuditInput,
  sortAuditEntries,
  type AuditEntry,
  type AuditInput,
  type AuditPage,
  type AuditQuery,
} from "./types";

/**
 * Persistence boundary for the audit log. Implementations only have to store
 * and return entries; the trimming and failure handling live in the store so
 * every backend behaves the same way.
 */
export interface AuditStorage {
  insert(entry: AuditEntry): Promise<void>;
  query(query: AuditQuery): Promise<AuditPage>;
  trim(keep: number): Promise<number>;
  /** Checks the stored hash chain over the surviving rows. */
  verify(): Promise<AuditChainReport>;
}

export interface AuditStore {
  /** Newest number of entries the store keeps. */
  readonly maxEntries: number;
  /**
   * How many entries this process failed to write since it started. A mutation
   * is never rolled back because its audit line could not be stored, so this is
   * the only place where a gap in the log becomes visible.
   */
  readonly dropped: number;
  record(input: AuditInput): Promise<AuditEntry | undefined>;
  list(query?: AuditQuery): Promise<AuditPage>;
  count(): Promise<number>;
  verify(): Promise<AuditChainReport>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An append-only store in front of `storage`. Every method swallows storage
 * failures so a broken audit log can never take down the mutation it is
 * describing; the failure is logged instead, and a write that never landed
 * counts towards `dropped` so the settings page can say so out loud.
 */
export function createAuditStore(
  storage: AuditStorage,
  options: { maxEntries?: number } = {},
): AuditStore {
  const maxEntries = options.maxEntries ?? MAX_AUDIT_ENTRIES;

  let dropped = 0;

  return {
    maxEntries,

    get dropped() {
      return dropped;
    },

    async record(input) {
      let entry: AuditEntry;
      try {
        entry = normalizeAuditInput(input);
      } catch (error) {
        log.warn("server", "Failed to build an audit entry: %s", errorMessage(error));
        return undefined;
      }

      try {
        await storage.insert(entry);
      } catch (error) {
        // The caller has already performed the action this entry describes, so
        // the write cannot be retried into existence. It is counted and logged
        // at error level: a silent gap is worse than a loud one.
        dropped += 1;
        log.error(
          "server",
          "Failed to record audit action %s: %s",
          entry.action,
          errorMessage(error),
        );
        return undefined;
      }

      try {
        await storage.trim(maxEntries);
      } catch (error) {
        log.warn("server", "Failed to trim the audit log: %s", errorMessage(error));
      }

      return entry;
    },

    async list(query = {}) {
      try {
        return await storage.query(query);
      } catch (error) {
        log.warn("server", "Failed to read the audit log: %s", errorMessage(error));
        return { entries: [], total: 0 };
      }
    },

    async count() {
      try {
        const page = await storage.query({ limit: 0 });
        return page.total;
      } catch (error) {
        log.warn("server", "Failed to count the audit log: %s", errorMessage(error));
        return 0;
      }
    },

    async verify() {
      try {
        return await storage.verify();
      } catch (error) {
        log.warn("server", "Failed to verify the audit chain: %s", errorMessage(error));
        return { checked: 0, broken: [], unavailable: true };
      }
    },
  };
}

/**
 * In-memory backend, used by tests and as a deterministic fallback. Entries are
 * kept in memory only, so it never touches the filesystem. It carries the same
 * hash chain as the database backend, oldest first, so both report identically.
 */
export function createMemoryAuditStorage(initial: readonly AuditEntry[] = []): AuditStorage {
  const rows: AuditChainRow[] = [];

  function append(entry: AuditEntry): void {
    rows.push({ entry, hash: auditChainHash(rows[rows.length - 1]?.hash ?? null, entry) });
  }

  initial.forEach(append);

  return {
    insert(entry) {
      append(entry);
      return Promise.resolve();
    },

    query(query = {}) {
      const matched = sortAuditEntries(
        rows.map((row) => row.entry).filter((entry) => matchesAuditQuery(entry, query)),
      );
      const offset = Math.max(query.offset ?? 0, 0);
      const limit = query.limit === undefined ? matched.length : Math.max(query.limit, 0);
      return Promise.resolve({
        entries: matched.slice(offset, offset + limit),
        total: matched.length,
      });
    },

    trim(keep) {
      // Insertion order is the chain order, and it is also what the database
      // backend trims by (`rowid`), so the two agree. Ranking by timestamp
      // instead would let one millisecond of records be dropped arbitrarily.
      const wanted = Math.max(keep, 0);
      const removed = Math.max(rows.length - wanted, 0);
      if (removed > 0) {
        rows.splice(0, removed);
      }

      return Promise.resolve(removed);
    },

    verify() {
      return Promise.resolve(verifyAuditChain(rows));
    },
  };
}
