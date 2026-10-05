import { describe, expect, test } from "vitest";

import {
  ALL_USERS,
  countExpiredPreAuthKeys,
  filterPreAuthKeyGroups,
  filterPreAuthKeysByStatus,
  isPreAuthKeyExpired,
  selectExpirableAuthKeys,
  TAG_ONLY,
} from "~/routes/settings/auth-keys/filters";
import type { PreAuthKey } from "~/types";
import type { User } from "~/types/User";

const NOW = new Date("2026-06-01T00:00:00Z");

function user(id: string, name = id): User {
  return { id, name } as User;
}

function preAuthKey(id: string, overrides: Partial<PreAuthKey> = {}): PreAuthKey {
  return {
    id,
    key: `key-${id}`,
    user: { id: "1" } as User,
    reusable: false,
    ephemeral: false,
    used: false,
    expiration: "2026-07-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    aclTags: [],
    ...overrides,
  };
}

const fresh = preAuthKey("fresh");
const spent = preAuthKey("spent", { used: true });
const reused = preAuthKey("reused", { reusable: true, used: true });
const stale = preAuthKey("stale", { expiration: "2026-05-01T00:00:00Z" });
const ephemeral = preAuthKey("ephemeral", { ephemeral: true });
const keys = [fresh, spent, reused, stale, ephemeral];

describe("pre-auth key status filter", () => {
  test("a used single-use key and a past date both count as expired", () => {
    expect(isPreAuthKeyExpired(fresh, NOW)).toBe(false);
    expect(isPreAuthKeyExpired(spent, NOW)).toBe(true);
    expect(isPreAuthKeyExpired(reused, NOW)).toBe(false);
    expect(isPreAuthKeyExpired(stale, NOW)).toBe(true);
  });

  test("keeps the statuses the page already offered", () => {
    expect(filterPreAuthKeysByStatus(keys, "all", NOW)).toEqual(keys);
    expect(filterPreAuthKeysByStatus(keys, "active", NOW)).toEqual([fresh, reused, ephemeral]);
    expect(filterPreAuthKeysByStatus(keys, "expired", NOW)).toEqual([spent, stale]);
    expect(filterPreAuthKeysByStatus(keys, "reusable", NOW)).toEqual([reused]);
    expect(filterPreAuthKeysByStatus(keys, "ephemeral", NOW)).toEqual([ephemeral]);
  });

  test("counts the expired keys whatever the filter shows", () => {
    expect(countExpiredPreAuthKeys(keys, NOW)).toBe(2);
    expect(countExpiredPreAuthKeys([], NOW)).toBe(0);
  });
});

describe("pre-auth key user filter", () => {
  const groups = [
    { preAuthKeys: [preAuthKey("a")], user: user("1") },
    { preAuthKeys: [preAuthKey("b")], user: user("2") },
    { preAuthKeys: [preAuthKey("c", { user: null })], user: null },
  ];

  test("filters by user, tag-only keys and everything", () => {
    expect(filterPreAuthKeyGroups(groups, ALL_USERS)).toEqual(groups);
    expect(filterPreAuthKeyGroups(groups, "2")).toEqual([groups[1]]);
    expect(filterPreAuthKeyGroups(groups, TAG_ONLY)).toEqual([groups[2]]);
  });
});

describe("bulk expire selection", () => {
  const resolveUserId = (key: PreAuthKey) => key.user?.id;

  test("only returns selected keys that can still be expired", () => {
    expect(selectExpirableAuthKeys(keys, ["spent", "fresh"], resolveUserId, NOW)).toEqual([
      { id: "fresh", key: "key-fresh", userId: "1" },
    ]);
  });

  test("never queues a used or expired key, even when it is selected", () => {
    expect(selectExpirableAuthKeys([spent, stale], ["spent", "stale"], resolveUserId, NOW)).toEqual(
      [],
    );
  });

  test("drops tag-only keys, which have no user for the expire endpoint", () => {
    const tagOnly = preAuthKey("tag-only", { user: null });

    expect(selectExpirableAuthKeys([tagOnly], ["tag-only"], resolveUserId, NOW)).toEqual([]);
  });

  test("keeps the list order and de-duplicates", () => {
    expect(
      selectExpirableAuthKeys(
        [ephemeral, fresh, fresh],
        ["fresh", "ephemeral", "fresh"],
        resolveUserId,
        NOW,
      ),
    ).toEqual([
      { id: "ephemeral", key: "key-ephemeral", userId: "1" },
      { id: "fresh", key: "key-fresh", userId: "1" },
    ]);
  });
});
