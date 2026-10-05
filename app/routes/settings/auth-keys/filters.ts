/**
 * Pure filtering and selection logic for the pre-auth keys page. The page
 * already had a status filter and a user filter inline; they live here so the
 * expired-key count and the bulk-expire selection can be unit tested without a
 * router, and so the bulk action can drop no-op keys before submitting.
 */

import type { PreAuthKey } from "~/types";
import type { User } from "~/types/User";

export interface PreAuthKeyGroup {
  user: User | null;
  preAuthKeys: PreAuthKey[];
}

export const AUTH_KEY_STATUSES = ["all", "active", "expired", "reusable", "ephemeral"] as const;
export type AuthKeyStatus = (typeof AUTH_KEY_STATUSES)[number];

/** Sentinel values for the user filter, which has no user id to point at. */
export const ALL_USERS = "__headplane_all";
export const TAG_ONLY = "__headplane_tag_only";

/**
 * A single-use key is spent once it has authenticated a machine; a reusable one
 * stays valid until its date. Either way the record stays in Headscale's list.
 */
export function isPreAuthKeyExpired(key: PreAuthKey, now: Date = new Date()): boolean {
  return (key.used && !key.reusable) || new Date(key.expiration).getTime() < now.getTime();
}

export function filterPreAuthKeyGroups(
  groups: PreAuthKeyGroup[],
  selectedUser: string,
): PreAuthKeyGroup[] {
  if (selectedUser === ALL_USERS) {
    return groups;
  }

  if (selectedUser === TAG_ONLY) {
    return groups.filter(({ user }) => user === null);
  }

  return groups.filter(({ user }) => user?.id === selectedUser);
}

export function filterPreAuthKeysByStatus(
  keys: PreAuthKey[],
  status: AuthKeyStatus,
  now: Date = new Date(),
): PreAuthKey[] {
  switch (status) {
    case "all": {
      return keys;
    }

    case "ephemeral": {
      return keys.filter((key) => key.ephemeral);
    }

    case "reusable": {
      return keys.filter((key) => key.reusable);
    }

    case "expired": {
      return keys.filter((key) => isPreAuthKeyExpired(key, now));
    }

    case "active": {
      return keys.filter((key) => !isPreAuthKeyExpired(key, now));
    }
  }
}

/** Drives the "N expired" hint, which stays visible whatever the filter is. */
export function countExpiredPreAuthKeys(keys: PreAuthKey[], now: Date = new Date()): number {
  return keys.reduce((count, key) => count + (isPreAuthKeyExpired(key, now) ? 1 : 0), 0);
}

/** The fields the expire action needs, already resolved to a Headscale user. */
export interface ExpirableAuthKey {
  id: string;
  key: string;
  userId: string;
}

/**
 * The keys a bulk expire may submit: the selected ones that are still
 * expirable and whose owner was resolved. Expiring a key that is already
 * expired (or used) is a no-op for Headscale, and tag-only keys have no user
 * for the expire endpoint, so both are filtered out.
 */
export function selectExpirableAuthKeys(
  keys: PreAuthKey[],
  selectedIds: Iterable<string>,
  resolveUserId: (key: PreAuthKey) => string | undefined,
  now: Date = new Date(),
): ExpirableAuthKey[] {
  const wanted = new Set(selectedIds);
  const selected: ExpirableAuthKey[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    if (!wanted.has(key.id) || seen.has(key.id) || isPreAuthKeyExpired(key, now)) {
      continue;
    }

    const userId = resolveUserId(key);
    if (!userId || key.key.length === 0) {
      continue;
    }

    seen.add(key.id);
    selected.push({ id: key.id, key: key.key, userId });
  }

  return selected;
}
