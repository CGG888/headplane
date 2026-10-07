import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createDbAuditStorage } from "~/server/audit/db-storage.server";
import { createAuditStore } from "~/server/audit/store";
import { AUDIT_ACTIONS, type AuditEntry } from "~/server/audit/types";

/**
 * Runs the real migration folder against an in-memory database: this is the
 * only place the additive `audit_log` migration and the SQL trimming are
 * exercised end to end.
 */
function createTestDb() {
  const db = drizzle(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

function entry(minute: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `audit-${minute.toString().padStart(6, "0")}`,
    at: new Date(Date.UTC(2026, 0, 1, 12, minute)),
    actor: "alice",
    actorType: "user",
    action: AUDIT_ACTIONS.apiKeyCreate,
    target: `target-${minute}`,
    detail: null,
    result: "success",
    ...overrides,
  };
}

describe("audit database storage", () => {
  test("the additive migration creates the audit table", () => {
    const db = createTestDb();
    const tables = db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'audit_log'`,
    );

    expect(tables.map((table) => table.name)).toEqual(["audit_log"]);
  });

  test("stores entries and returns the newest first with a total", async () => {
    const storage = createDbAuditStorage(createTestDb());
    await storage.insert(entry(0, { actor: "alice", target: "first" }));
    await storage.insert(entry(5, { actor: "bob", target: "second" }));

    const page = await storage.query({});
    expect(page.total).toBe(2);
    expect(page.entries.map((item) => item.target)).toEqual(["second", "first"]);
    expect(page.entries[0]?.at).toBeInstanceOf(Date);
    expect(page.entries[0]?.actorType).toBe("user");
  });

  test("filters by actor, action and time range", async () => {
    const storage = createDbAuditStorage(createTestDb());
    await storage.insert(entry(0, { actor: "Alice", action: AUDIT_ACTIONS.apiKeyCreate }));
    await storage.insert(
      entry(10, { actor: "bob", action: AUDIT_ACTIONS.apiKeyExpire, result: "failure" }),
    );

    expect((await storage.query({ actor: "ali" })).total).toBe(1);
    expect((await storage.query({ actor: "ALICE" })).total).toBe(1);
    expect((await storage.query({ action: AUDIT_ACTIONS.apiKeyExpire })).total).toBe(1);
    expect((await storage.query({ since: entry(5).at })).total).toBe(1);
    expect((await storage.query({ action: AUDIT_ACTIONS.apiKeyExpire })).entries[0]?.result).toBe(
      "failure",
    );
  });

  test("trims the table to the newest entries after every insert", async () => {
    const storage = createDbAuditStorage(createTestDb());
    const store = createAuditStore(storage, { maxEntries: 2 });

    for (let minute = 0; minute < 4; minute += 1) {
      await store.record(entry(minute));
    }

    const page = await store.list();
    expect(page.total).toBe(2);
    expect(page.entries.map((item) => item.target)).toEqual(["target-3", "target-2"]);
  });

  test("links every inserted row to the one before it", async () => {
    const storage = createDbAuditStorage(createTestDb());
    await storage.insert(entry(0, { target: "first" }));
    await storage.insert(entry(5, { target: "second" }));
    await storage.insert(entry(9, { target: "third" }));

    // The oldest row is the window's anchor, so two rows are checked.
    await expect(storage.verify()).resolves.toEqual({ checked: 2, broken: [] });
  });

  test("serialises concurrent inserts so the chain cannot fork", async () => {
    const storage = createDbAuditStorage(createTestDb());
    await Promise.all([0, 1, 2, 3, 4].map((minute) => storage.insert(entry(minute))));

    const report = await storage.verify();
    expect(report.checked).toBe(4);
    expect(report.broken).toEqual([]);
  });

  test("a requested page cannot exceed the storage's own bound", async () => {
    const storage = createDbAuditStorage(createTestDb());
    const total = 2005;
    for (let minute = 0; minute < total; minute += 1) {
      await storage.insert(entry(minute));
    }

    // A caller asking for the whole table still gets a bounded window: the
    // limit is clamped to MAX_LIMIT on the way in.
    const page = await storage.query({ limit: 1_000_000 });
    expect(page.total).toBe(total);
    expect(page.entries).toHaveLength(2000);
  }, 30_000);

  test("reports a row whose recorded contents were edited", async () => {
    const db = createTestDb();
    const storage = createDbAuditStorage(db);
    await storage.insert(entry(0, { target: "first" }));
    await storage.insert(entry(5, { target: "second" }));
    await storage.insert(entry(9, { target: "third" }));

    db.run(sql`update audit_log set target = 'rewritten' where id = ${entry(5).id}`);

    await expect(storage.verify()).resolves.toEqual({ checked: 2, broken: [entry(5).id] });
  });

  test("reports a row that was deleted from the middle of the log", async () => {
    const db = createTestDb();
    const storage = createDbAuditStorage(db);
    await storage.insert(entry(0, { target: "first" }));
    await storage.insert(entry(5, { target: "second" }));
    await storage.insert(entry(9, { target: "third" }));

    db.run(sql`delete from audit_log where id = ${entry(5).id}`);

    await expect(storage.verify()).resolves.toEqual({ checked: 1, broken: [entry(9).id] });
  });

  test("trims by insertion order, not by timestamp", async () => {
    const storage = createDbAuditStorage(createTestDb());
    const store = createAuditStore(storage, { maxEntries: 1 });

    // The entry recorded last carries the older timestamp, and the window has
    // to follow it: the chain is ordered by insertion.
    await store.record(entry(10, { target: "written-first" }));
    await store.record(entry(0, { target: "written-last" }));

    const page = await store.list();
    expect(page.entries.map((item) => item.target)).toEqual(["written-last"]);
    await expect(store.verify()).resolves.toEqual({ checked: 0, broken: [] });
  });

  test("reports how many rows the trim removed", async () => {
    const storage = createDbAuditStorage(createTestDb());
    await storage.insert(entry(0));
    await storage.insert(entry(5));

    await expect(storage.trim(1)).resolves.toBe(1);
    await expect(storage.trim(1)).resolves.toBe(0);
  });
});
