/**
 * Reads the pre-auth keys the page acts on. Shared by the loader and the bulk
 * delete so both see exactly the same set: the global list when Headscale
 * offers one (0.28+), otherwise one request per user.
 */

import type { HeadscaleClient } from "~/server/headscale/api";
import type { PreAuthKey } from "~/types";
import type { User } from "~/types/User";
import log from "~/utils/log";

import type { PreAuthKeyGroup } from "./filters";

export interface PreAuthKeyListing {
  keys: PreAuthKeyGroup[];
  /** Users whose keys could not be read, so the page can say so. */
  missing: { user: User; error: unknown }[];
}

/**
 * @param users the users whose keys are in scope. A self-service account passes
 *   only itself, which is what limits the page to its own keys.
 * @param selfServiceOnly excludes ownerless (tag-only) keys, which a
 *   self-service account could never have created.
 */
export async function loadPreAuthKeyGroups(
  api: HeadscaleClient,
  users: User[],
  selfServiceOnly: boolean,
): Promise<PreAuthKeyListing> {
  // Try fetching all keys at once (Headscale 0.28+), fall back to per-user
  let allKeys: PreAuthKey[] | null = null;
  if (api.preAuthKeys.listAll) {
    try {
      allKeys = await api.preAuthKeys.listAll();
    } catch {
      // Treat any failure as "no global list available" and fall through.
    }
  }

  if (allKeys !== null) {
    const keysByUser = new Map<string | null, PreAuthKey[]>();
    for (const key of allKeys) {
      const userId = key.user?.id ?? null;
      const existing = keysByUser.get(userId) ?? [];
      existing.push(key);
      keysByUser.set(userId, existing);
    }

    const keys: PreAuthKeyGroup[] = [];
    const tagOnly = selfServiceOnly ? undefined : keysByUser.get(null);
    if (tagOnly?.length) {
      keys.push({ preAuthKeys: tagOnly, user: null });
    }
    for (const user of users) {
      const userKeys = keysByUser.get(user.id);
      if (userKeys?.length) {
        keys.push({ preAuthKeys: userKeys, user });
      }
    }

    return { keys, missing: [] };
  }

  type FetchResult =
    | { success: true; user: User; preAuthKeys: PreAuthKey[] }
    | { success: false; user: User; error: unknown; preAuthKeys: [] };

  const results: FetchResult[] = await Promise.all(
    users
      .filter((u) => u.id?.length > 0)
      .map(async (user) => {
        try {
          const preAuthKeys = await api.preAuthKeys.listForUser(user.id);
          return { preAuthKeys, success: true as const, user };
        } catch (error) {
          log.error("api", "GET /v1/preauthkey for %s: %o", user.name, error);
          return { error, preAuthKeys: [] as const, success: false as const, user };
        }
      }),
  );

  return {
    keys: results
      .filter(({ success }) => success)
      .map(({ user, preAuthKeys }) => ({ preAuthKeys, user })),
    missing: results
      .filter((r): r is Extract<FetchResult, { success: false }> => !r.success)
      .map(({ user, error }) => ({ error, user })),
  };
}
