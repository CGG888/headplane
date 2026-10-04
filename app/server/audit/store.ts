import log from "~/utils/log";

import {
  MAX_AUDIT_ENTRIES,
  matchesAuditQuery,
  normalizeAuditInput,
  sortAuditEntries,
  trimAuditEntries,
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
}

export interface AuditStore {
  /** Newest number of entries the store keeps. */
  readonly maxEntries: number;
  record(input: AuditInput): Promise<AuditEntry | undefined>;
  list(query?: AuditQuery): Promise<AuditPage>;
  count(): Promise<number>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An append-only store in front of `storage`. Every method swallows storage
 * failures so a broken audit log can never take down the mutation it is
 * describing; the failure is logged instead.
 */
export function createAuditStore(
  storage: AuditStorage,
  options: { maxEntries?: number } = {},
): AuditStore {
  const maxEntries = options.maxEntries ?? MAX_AUDIT_ENTRIES;

  return {
    maxEntries,

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
        log.warn(
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
  };
}

/**
 * In-memory backend, used by tests and as a deterministic fallback. Entries are
 * kept in memory only, so it never touches the filesystem.
 */
export function createMemoryAuditStorage(initial: readonly AuditEntry[] = []): AuditStorage {
  const entries = [...initial];

  return {
    insert(entry) {
      entries.push(entry);
      return Promise.resolve();
    },

    query(query = {}) {
      const matched = sortAuditEntries(entries.filter((entry) => matchesAuditQuery(entry, query)));
      const offset = Math.max(query.offset ?? 0, 0);
      const limit = query.limit === undefined ? matched.length : Math.max(query.limit, 0);
      return Promise.resolve({
        entries: matched.slice(offset, offset + limit),
        total: matched.length,
      });
    },

    trim(keep) {
      const kept = trimAuditEntries(entries, keep);
      const removed = entries.length - kept.length;
      entries.length = 0;
      entries.push(...kept);
      return Promise.resolve(removed);
    },
  };
}
