import { describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { AuditFilters } from "~/routes/settings/audit/filters";
import { appendAuditPage } from "~/routes/settings/audit/overview";
import type { AuditEntry } from "~/server/audit/types";

// "Load more" used to be a <Link> to page n+1, which replaced the rows on
// screen. It now fetches the next page and appends it here, so the arithmetic
// that decides what the list contains is worth pinning down.

function filters(page: number): AuditFilters {
  return { actor: "", action: "", range: "all", page };
}

function entry(id: string): AuditEntry {
  return {
    id,
    at: new Date(0),
    actor: "owner",
    actorType: "user",
    action: "login_success",
    target: "",
    detail: null,
    result: "success",
  };
}

function fetched(page: number, ids: string[], hasMore: boolean) {
  return { filters: filters(page), entries: ids.map(entry), hasMore };
}

/** The state right after the loader's own page, with nothing appended yet. */
function start(hasMore = true) {
  return { key: "", page: 1, entries: [] as AuditEntry[], hasMore };
}

describe("audit list paging", () => {
  test("a fetched page is appended below the loader's rows", () => {
    const next = appendAuditPage(start(), fetched(2, ["c", "d"], true));

    expect(next.page).toBe(2);
    expect(next.entries.map((row) => row.id)).toEqual(["c", "d"]);
    expect(next.hasMore).toBe(true);
  });

  test("a second page accumulates instead of replacing the first", () => {
    const second = appendAuditPage(start(), fetched(2, ["c", "d"], true));
    const third = appendAuditPage(second, fetched(3, ["e"], false));

    expect(third.page).toBe(3);
    expect(third.entries.map((row) => row.id)).toEqual(["c", "d", "e"]);
    expect(third.hasMore).toBe(false);
  });

  test("the same page delivered twice is ignored", () => {
    const second = appendAuditPage(start(), fetched(2, ["c"], true));
    const again = appendAuditPage(second, fetched(2, ["c"], true));

    expect(again).toBe(second);
  });

  test("a response that skips a page is ignored", () => {
    const second = appendAuditPage(start(), fetched(2, ["c"], true));

    expect(appendAuditPage(second, fetched(4, ["g"], true))).toBe(second);
    expect(appendAuditPage(second, fetched(1, ["a"], true))).toBe(second);
  });
});
