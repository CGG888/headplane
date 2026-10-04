import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { createDbAuditStorage } from "./db-storage.server";
import { createAuditStore } from "./store";

export type {
  AuditAction,
  AuditActorType,
  AuditEntry,
  AuditInput,
  AuditPage,
  AuditQuery,
  AuditResult,
} from "./types";
export { AUDIT_ACTIONS, AUDIT_ACTION_CODES } from "./actions";
export { MAX_AUDIT_ENTRIES, apiKeyPrefix, auditActorOf } from "./types";
export type { AuditStore } from "./store";
export { createMemoryAuditStorage } from "./store";

/**
 * The audit log used by the application: entries live in the persistent
 * Headplane database and are trimmed to the newest `MAX_AUDIT_ENTRIES`.
 */
export function createAuditService(db: NodeSQLiteDatabase) {
  return createAuditStore(createDbAuditStorage(db));
}

export type AuditService = ReturnType<typeof createAuditService>;
