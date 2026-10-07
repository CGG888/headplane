import { describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { AuditStorage } from "~/server/audit/store";
import { createAuditStore, createMemoryAuditStorage } from "~/server/audit/store";
import {
  apiKeyPrefix,
  auditActorOf,
  AUDIT_ACTIONS,
  MAX_AUDIT_ENTRIES,
  matchesAuditQuery,
  normalizeAuditInput,
  trimAuditEntries,
  type AuditEntry,
} from "~/server/audit/types";

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 12, minute));
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "01J0000000000000000000000",
    at: at(0),
    actor: "alice",
    actorType: "user",
    action: AUDIT_ACTIONS.apiKeyCreate,
    target: "hskey-api-abcdefghijkl",
    detail: null,
    result: "success",
    ...overrides,
  };
}

describe("audit record shape", () => {
  test("fills in an id, a timestamp and nullable defaults", () => {
    const record = normalizeAuditInput({
      actor: "alice",
      actorType: "user",
      action: AUDIT_ACTIONS.apiKeyCreate,
      result: "success",
    });

    expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(record.at).toBeInstanceOf(Date);
    expect(record.target).toBe("");
    expect(record.detail).toBeNull();
    expect(record.result).toBe("success");
  });

  test("bounds every stored field so a payload cannot bloat a row", () => {
    const record = normalizeAuditInput({
      actor: "a".repeat(500),
      actorType: "user",
      action: "b".repeat(500),
      target: "c".repeat(5000),
      detail: "d".repeat(5000),
      result: "failure",
    });

    expect(record.actor).toHaveLength(200);
    expect(record.action).toHaveLength(100);
    expect(record.target).toHaveLength(500);
    expect(record.detail).toHaveLength(1000);
  });

  test("never stores an empty actor or action", () => {
    const record = normalizeAuditInput({
      actor: "   ",
      actorType: "system",
      action: "",
      result: "success",
    });

    expect(record.actor).toBe("system");
    expect(record.action).toBe("unknown");
  });
});

describe("audit store", () => {
  test("appends entries and lists them newest first", async () => {
    const store = createAuditStore(createMemoryAuditStorage());

    await store.record(entry({ id: "a", at: at(0), actor: "alice", target: "first" }));
    await store.record(entry({ at: at(5), actor: "bob", target: "second" }));

    const page = await store.list();
    expect(page.total).toBe(2);
    expect(page.entries.map((item) => item.target)).toEqual(["second", "first"]);
    expect(page.entries[1]?.actor).toBe("alice");
  });

  test("trims to the newest entries so the table cannot grow without bound", async () => {
    const store = createAuditStore(createMemoryAuditStorage(), { maxEntries: 3 });

    for (let minute = 0; minute < 5; minute += 1) {
      await store.record(entry({ at: at(minute), target: `t${minute}` }));
    }

    const page = await store.list();
    expect(page.total).toBe(3);
    expect(page.entries.map((item) => item.target)).toEqual(["t4", "t3", "t2"]);
  });

  test("keeps the newest 5000 entries by default", async () => {
    expect(MAX_AUDIT_ENTRIES).toBe(5000);
    expect(createAuditStore(createMemoryAuditStorage()).maxEntries).toBe(MAX_AUDIT_ENTRIES);

    const entries = Array.from({ length: MAX_AUDIT_ENTRIES + 5 }, (_, index) =>
      entry({ id: `id-${index.toString().padStart(6, "0")}`, at: at(0) }),
    );
    const trimmed = trimAuditEntries(entries, MAX_AUDIT_ENTRIES);

    expect(trimmed).toHaveLength(MAX_AUDIT_ENTRIES);
    expect(trimmed[0]?.id).toBe("id-005004");
    expect(trimmed[trimmed.length - 1]?.id).toBe("id-000005");
  });

  test("filters by actor, action and time range", async () => {
    const store = createAuditStore(createMemoryAuditStorage());
    await store.record(entry({ at: at(0), actor: "Alice", action: AUDIT_ACTIONS.apiKeyCreate }));
    await store.record(entry({ at: at(10), actor: "bob", action: AUDIT_ACTIONS.apiKeyExpire }));

    const byActor = await store.list({ actor: "ali" });
    expect(byActor.total).toBe(1);

    const byAction = await store.list({ action: AUDIT_ACTIONS.apiKeyExpire });
    expect(byAction.total).toBe(1);
    expect(byAction.entries[0]?.actor).toBe("bob");

    const byRange = await store.list({ since: at(5) });
    expect(byRange.total).toBe(1);
    expect(byRange.entries[0]?.actor).toBe("bob");

    const paged = await store.list({ limit: 1, offset: 1 });
    expect(paged.total).toBe(2);
    expect(paged.entries).toHaveLength(1);
    expect(paged.entries[0]?.actor).toBe("Alice");
  });

  test("an audit failure never throws at the caller", async () => {
    const failing: AuditStorage = {
      insert: () => Promise.reject(new Error("insert failed")),
      query: () => Promise.reject(new Error("query failed")),
      trim: () => Promise.reject(new Error("trim failed")),
      verify: () => Promise.reject(new Error("verify failed")),
    };
    const store = createAuditStore(failing);

    await expect(
      store.record({
        actor: "alice",
        actorType: "user",
        action: AUDIT_ACTIONS.apiKeyCreate,
        result: "success",
      }),
    ).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual({ entries: [], total: 0 });
    await expect(store.count()).resolves.toBe(0);
    await expect(store.verify()).resolves.toEqual({ checked: 0, broken: [], unavailable: true });
  });

  test("a failed write is counted so the gap in the log is visible", async () => {
    let fail = true;
    const storage = createMemoryAuditStorage();
    const store = createAuditStore({
      insert: async (input) => {
        if (fail) {
          throw new Error("insert failed");
        }
        return storage.insert(input);
      },
      query: (query) => storage.query(query),
      trim: (keep) => storage.trim(keep),
      verify: () => storage.verify(),
    });

    expect(store.dropped).toBe(0);

    const input = {
      actor: "alice",
      actorType: "user" as const,
      action: AUDIT_ACTIONS.apiKeyCreate,
      result: "success" as const,
    };
    await expect(store.record(input)).resolves.toBeUndefined();
    await expect(store.record(input)).resolves.toBeUndefined();
    expect(store.dropped).toBe(2);

    // Once storage recovers the count stops moving, and the entry lands.
    fail = false;
    await expect(store.record(input)).resolves.toMatchObject({ actor: "alice" });
    expect(store.dropped).toBe(2);
    await expect(store.count()).resolves.toBe(1);
  });

  test("the in-memory backend builds and checks a hash chain", async () => {
    const store = createAuditStore(createMemoryAuditStorage());
    for (let minute = 0; minute < 3; minute += 1) {
      await store.record({
        actor: "alice",
        actorType: "user",
        action: AUDIT_ACTIONS.apiKeyCreate,
        target: `target-${minute}`,
        result: "success",
      });
    }

    await expect(store.verify()).resolves.toEqual({ checked: 2, broken: [] });
  });

  test("trimming in memory keeps the newest entries and drops the rest", async () => {
    const storage = createMemoryAuditStorage();
    const store = createAuditStore(storage, { maxEntries: 2 });
    for (let minute = 0; minute < 4; minute += 1) {
      await store.record({
        id: `id-${minute}`,
        at: at(minute),
        actor: "alice",
        actorType: "user",
        action: AUDIT_ACTIONS.apiKeyCreate,
        target: `target-${minute}`,
        result: "success",
      });
    }

    const page = await store.list();
    expect(page.total).toBe(2);
    expect(page.entries.map((item) => item.target)).toEqual(["target-3", "target-2"]);
    // The survivors still line up, and the window's anchor has no predecessor.
    await expect(store.verify()).resolves.toEqual({ checked: 1, broken: [] });
  });
});

describe("audit actors", () => {
  test("describes a user principal by profile name", () => {
    const actor = auditActorOf({
      kind: "oidc",
      sessionId: "session",
      user: { id: "u1", subject: "sub", role: "admin", headscaleUserId: undefined },
      profile: { name: "Alice", email: "alice@example.com" },
    });

    expect(actor).toEqual({ actor: "Alice", actorType: "user" });
  });

  test("describes an api key principal without storing the whole key", () => {
    expect(
      auditActorOf({
        kind: "api_key",
        sessionId: "session",
        displayName: "ci-bot",
        apiKey: "hskey-api-abcdefghijkl-secret",
      }),
    ).toEqual({ actor: "ci-bot", actorType: "api_key" });

    expect(
      auditActorOf({
        kind: "api_key",
        sessionId: "session",
        displayName: "  ",
        apiKey: "hskey-api-abcdefghijkl-secret",
      }),
    ).toEqual({ actor: "api_key:abcdefghijkl", actorType: "api_key" });

    expect(apiKeyPrefix("hskey-api-abcdefghijkl-secret")).toBe("abcdefghijkl");
  });

  test("falls back to the system actor when there is no principal", () => {
    expect(auditActorOf(undefined)).toEqual({ actor: "system", actorType: "system" });
  });
});

describe("audit query matching", () => {
  test("matches case-insensitive actor substrings and inclusive ranges", () => {
    expect(matchesAuditQuery(entry({ actor: "Alice" }), { actor: "ali" })).toBe(true);
    expect(matchesAuditQuery(entry({ actor: "Alice" }), { actor: "bob" })).toBe(false);
    expect(matchesAuditQuery(entry({ action: "x" }), { action: "y" })).toBe(false);
    expect(matchesAuditQuery(entry({ at: at(0) }), { since: at(0) })).toBe(true);
    expect(matchesAuditQuery(entry({ at: at(0) }), { until: at(1) })).toBe(true);
  });
});
