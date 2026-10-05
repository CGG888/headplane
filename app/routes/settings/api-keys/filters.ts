/**
 * Pure filtering and selection logic for the API keys page. Headscale keeps
 * expired keys in its list forever, so the page separates "still usable" from
 * "already dead" and only ever offers to expire the live ones.
 */

import type { Key } from "~/types";
import { isNoExpiry } from "~/utils/node-info";

export const API_KEY_STATUSES = ["all", "active", "expired"] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];

/** Query-string parameter the chosen filter is kept in. */
export const API_KEY_STATUS_PARAM = "status";

export function isApiKeyStatus(value: string | null | undefined): value is ApiKeyStatus {
  return value != null && (API_KEY_STATUSES as readonly string[]).includes(value);
}

/** Reads the filter from the URL; an unknown or missing value means "show all". */
export function parseApiKeyStatus(params: URLSearchParams): ApiKeyStatus {
  const value = params.get(API_KEY_STATUS_PARAM);
  return isApiKeyStatus(value) ? value : "all";
}

/** Applies a filter to a query string, dropping the default so URLs stay clean. */
export function withApiKeyStatus(params: URLSearchParams, status: ApiKeyStatus): URLSearchParams {
  const next = new URLSearchParams(params);
  if (status === "all") {
    next.delete(API_KEY_STATUS_PARAM);
  } else {
    next.set(API_KEY_STATUS_PARAM, status);
  }

  return next;
}

/**
 * Whether the key's expiration has passed. A key without an expiration has no
 * date to compare against, which is how the row already reads it.
 */
export function isApiKeyExpired(key: Key, now: Date = new Date()): boolean {
  return !isNoExpiry(key.expiration) && new Date(key.expiration).getTime() < now.getTime();
}

export function filterApiKeysByStatus(
  keys: Key[],
  status: ApiKeyStatus,
  now: Date = new Date(),
): Key[] {
  if (status === "all") {
    return keys;
  }

  const expired = status === "expired";
  return keys.filter((key) => isApiKeyExpired(key, now) === expired);
}

/** Drives the "N expired" hint, which stays visible whatever the filter is. */
export function countExpiredApiKeys(keys: Key[], now: Date = new Date()): number {
  return keys.reduce((count, key) => count + (isApiKeyExpired(key, now) ? 1 : 0), 0);
}

/**
 * The prefixes a bulk expire may submit: the selected keys that are still
 * expirable, in list order. Expiring an already-expired key is a no-op for
 * Headscale (the record stays either way), so those are filtered out.
 */
export function selectExpirableApiKeyPrefixes(
  keys: Key[],
  selected: Iterable<string>,
  now: Date = new Date(),
): string[] {
  const wanted = new Set(selected);
  const seen = new Set<string>();
  const prefixes: string[] = [];

  for (const key of keys) {
    if (!wanted.has(key.prefix) || seen.has(key.prefix) || isApiKeyExpired(key, now)) {
      continue;
    }

    seen.add(key.prefix);
    prefixes.push(key.prefix);
  }

  return prefixes;
}
