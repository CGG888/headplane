import { describe, expect, test } from "vitest";

import {
  countExpiredApiKeys,
  filterApiKeysByStatus,
  isApiKeyExpired,
  isApiKeyStatus,
  parseApiKeyStatus,
  selectExpirableApiKeyPrefixes,
  withApiKeyStatus,
} from "~/routes/settings/api-keys/filters";
import type { Key } from "~/types";

const NOW = new Date("2026-06-01T00:00:00Z");

function key(prefix: string, expiration: string): Key {
  return {
    id: prefix,
    prefix,
    expiration,
    createdAt: "2026-01-01T00:00:00Z",
    lastSeen: "2026-01-02T00:00:00Z",
  };
}

const expired = key("expired00000", "2026-05-01T00:00:00Z");
const active = key("active000000", "2026-07-01T00:00:00Z");
const never = key("never0000000", "0001-01-01T00:00:00Z");
const keys = [expired, active, never];

describe("API key status filter", () => {
  test("defaults to showing every key", () => {
    expect(parseApiKeyStatus(new URLSearchParams())).toBe("all");
    expect(parseApiKeyStatus(new URLSearchParams("status=nonsense"))).toBe("all");
    expect(isApiKeyStatus("expired")).toBe(true);
    expect(isApiKeyStatus("deleted")).toBe(false);
  });

  test("keeps the active filter in the URL and drops the default", () => {
    expect(withApiKeyStatus(new URLSearchParams(), "expired").toString()).toBe("status=expired");
    expect(withApiKeyStatus(new URLSearchParams("status=expired"), "all").toString()).toBe("");
    expect(withApiKeyStatus(new URLSearchParams("page=2"), "active").toString()).toBe(
      "page=2&status=active",
    );
  });

  test("treats a past date as expired and an unset date as not expired", () => {
    expect(isApiKeyExpired(expired, NOW)).toBe(true);
    expect(isApiKeyExpired(active, NOW)).toBe(false);
    expect(isApiKeyExpired(never, NOW)).toBe(false);
  });

  test("filters by status", () => {
    expect(filterApiKeysByStatus(keys, "all", NOW)).toEqual(keys);
    expect(filterApiKeysByStatus(keys, "active", NOW)).toEqual([active, never]);
    expect(filterApiKeysByStatus(keys, "expired", NOW)).toEqual([expired]);
  });

  test("counts the expired keys whatever the filter shows", () => {
    expect(countExpiredApiKeys(keys, NOW)).toBe(1);
    expect(countExpiredApiKeys([], NOW)).toBe(0);
  });
});

describe("bulk expire selection", () => {
  test("only returns selected keys that can still be expired", () => {
    expect(selectExpirableApiKeyPrefixes(keys, [expired.prefix, active.prefix], NOW)).toEqual([
      active.prefix,
    ]);
  });

  test("never queues an already expired key, even when it is selected", () => {
    expect(selectExpirableApiKeyPrefixes([expired], [expired.prefix], NOW)).toEqual([]);
  });

  test("ignores prefixes that are not in the list and de-duplicates", () => {
    expect(selectExpirableApiKeyPrefixes(keys, ["missing00000", active.prefix], NOW)).toEqual([
      active.prefix,
    ]);
    expect(
      selectExpirableApiKeyPrefixes([active, active], [active.prefix, active.prefix], NOW),
    ).toEqual([active.prefix]);
  });

  test("keeps the list order so the queue is predictable", () => {
    expect(
      selectExpirableApiKeyPrefixes([active, never], [never.prefix, active.prefix], NOW),
    ).toEqual([active.prefix, never.prefix]);
  });
});
