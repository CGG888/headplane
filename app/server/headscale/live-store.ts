import type { Machine, User } from "~/types";
import log from "~/utils/log";

import type { HeadscaleClient } from "./api";

/**
 * Defines a resource that can be fetched and polled by the live store.
 */
export interface ResourceDefinition<T> {
  /**
   * A unique key to identify the resource
   */
  readonly key: string;

  /**
   * How often to poll for changes (in milliseconds)
   */
  readonly pollInterval: number;

  /**
   * A callback to fire to get the latest data for this resource
   */
  readonly fetch: (client: HeadscaleClient) => Promise<T>;

  /**
   * A stable projection of the payload, used to decide whether something a user
   * can actually see changed. Headscale returns fields that move on their own
   * (last-seen timestamps, anything derived from "now"), so comparing the raw
   * payload made a completely idle tailnet look different on every poll and
   * fired a `changed` event at every open page every few seconds.
   *
   * The projection drops those self-updating fields and keeps identity, name,
   * online/offline, tags, expiry, owner and addresses. It must be pure: the same
   * state must always produce the same projection, and it must not read the
   * clock.
   *
   * Declared as a method (not a function property) so a typed resource stays
   * assignable to the store's `ResourceDefinition<unknown>` list.
   */
  project(data: T): unknown;
}

/**
 * Helper function to define a resource with proper typing to be used
 * as a keying input for the live store.
 * @param key A unique key to identify the resource
 * @param config The resource configuration
 */
export function defineResource<T>(
  key: string,
  config: Omit<ResourceDefinition<T>, "key" | "project"> & {
    project?: (data: T) => unknown;
  },
): ResourceDefinition<T> {
  return {
    key,
    pollInterval: config.pollInterval,
    fetch: config.fetch,
    // Without an explicit projection the payload itself is the projection; it
    // stays a stable serialization only if the resource has no volatile fields.
    project: config.project ?? ((data: T) => data),
  };
}

/**
 * The stable projection of the node list.
 *
 * Dropped on purpose:
 * - `lastSeen`: Headscale stamps it whenever a node checks in, so it moved on
 *   its own between polls while nothing else about the node changed. That was
 *   the root cause of the constant reloads.
 *
 * Kept: identity, owner, addresses, tags, routes, registration and expiry, plus
 * `online` — its flipping is the state change users care about.
 *
 * Nodes and their collections are sorted so a response that comes back in a
 * different order is not mistaken for a change.
 */
export function projectNodes(nodes: Machine[]): unknown[] {
  return [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      machineKey: node.machineKey,
      nodeKey: node.nodeKey,
      discoKey: node.discoKey,
      ipAddresses: [...node.ipAddresses].sort(),
      name: node.name,
      givenName: node.givenName,
      online: node.online,
      user: node.user ? { id: node.user.id, name: node.user.name } : null,
      tags: [...node.tags].sort(),
      approvedRoutes: [...node.approvedRoutes].sort(),
      availableRoutes: [...node.availableRoutes].sort(),
      subnetRoutes: [...node.subnetRoutes].sort(),
      expiry: node.expiry,
      createdAt: node.createdAt,
      registerMethod: node.registerMethod,
      preAuthKey: node.preAuthKey ?? null,
    }));
}

/**
 * The stable projection of the user list. Users carry no self-updating field;
 * the list is sorted by id so a reordered response stays silent, and the fields
 * a user can see (name, display name, email, provider, picture) are kept.
 */
export function projectUsers(users: User[]): unknown[] {
  return [...users]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((user) => ({
      id: user.id,
      name: user.name,
      displayName: user.displayName ?? null,
      email: user.email ?? null,
      provider: user.provider ?? null,
      providerId: user.providerId ?? null,
      profilePicUrl: user.profilePicUrl ?? null,
      createdAt: user.createdAt,
    }));
}

export const nodesResource = defineResource("nodes", {
  pollInterval: 5_000,
  fetch: (api) => api.nodes.list(),
  project: projectNodes,
});

export const usersResource = defineResource("users", {
  pollInterval: 15_000,
  fetch: (api) => api.users.list(),
  project: projectUsers,
});

/**
 * The minimum gap between two `changed` events for the same resource. A resource
 * that keeps changing (a node flapping, a burst of edits) is coalesced into one
 * event per window, so an open page revalidates at most once every twenty
 * seconds instead of on every poll.
 */
export const DEFAULT_NOTIFY_WINDOW_MS = 20_000;

interface Snapshot<T> {
  data: T;
  version: string;
  fetchedAt: number;
}

type ChangeListener = (resourceKey: string, version: string) => void;

export interface LiveStore {
  /**
   * The current snapshot, fetching it (and starting the poll) when the resource
   * has never been read. A poll that sees a real change notifies listeners.
   */
  get<T>(resource: ResourceDefinition<T>, apiClient: HeadscaleClient): Promise<Snapshot<T>>;

  /**
   * The current snapshot for a background reader. It only fetches when the
   * resource has never been read, and it never notifies a listener, so a service
   * on its own timer can neither wake the SSE stream nor bump a version.
   */
  read<T>(resource: ResourceDefinition<T>, apiClient: HeadscaleClient): Promise<Snapshot<T>>;

  refresh<T>(resource: ResourceDefinition<T>, apiClient: HeadscaleClient): Promise<void>;
  getVersions(): Record<string, string>;
  subscribe(listener: ChangeListener): () => void;
  dispose(): void;
}

export interface LiveStoreOptions {
  /** Overridable so tests can drive the coalescing window. */
  notifyWindowMs?: number;
}

export function createLiveStore(
  resources: ResourceDefinition<unknown>[],
  options: LiveStoreOptions = {},
): LiveStore {
  const notifyWindowMs = options.notifyWindowMs ?? DEFAULT_NOTIFY_WINDOW_MS;
  const snapshots = new Map<string, Snapshot<unknown>>();
  const serializedCache = new Map<string, string>();
  const listeners = new Set<ChangeListener>();
  const intervals = new Map<string, ReturnType<typeof setInterval>>();
  const lastNotifiedAt = new Map<string, number>();
  const pendingNotifyTimer = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingNotifyVersion = new Map<string, string>();
  let storedApiClient: HeadscaleClient | undefined;
  let versionCounter = 0;

  function notifyListeners(resourceKey: string, version: string) {
    for (const listener of listeners) {
      listener(resourceKey, version);
    }
  }

  function deliverNotify(resourceKey: string, version: string) {
    const timer = pendingNotifyTimer.get(resourceKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingNotifyTimer.delete(resourceKey);
    }

    pendingNotifyVersion.delete(resourceKey);
    lastNotifiedAt.set(resourceKey, Date.now());
    notifyListeners(resourceKey, version);
  }

  /**
   * Notifies at most once per resource per window. The first change of a window
   * goes out immediately; changes inside the window are held and delivered
   * together when it closes, carrying the newest version, so a burst collapses
   * into one event without dropping the last change.
   */
  function scheduleNotify(resourceKey: string, version: string) {
    pendingNotifyVersion.set(resourceKey, version);
    if (pendingNotifyTimer.has(resourceKey)) {
      return;
    }

    const last = lastNotifiedAt.get(resourceKey);
    const wait = last === undefined ? 0 : Math.max(0, notifyWindowMs - (Date.now() - last));
    if (wait === 0) {
      deliverNotify(resourceKey, version);
      return;
    }

    const timer = setTimeout(() => {
      pendingNotifyTimer.delete(resourceKey);
      const latest = pendingNotifyVersion.get(resourceKey);
      if (latest !== undefined) {
        deliverNotify(resourceKey, latest);
      }
    }, wait);

    // The HTTP server keeps the process alive; a pending notification never should.
    timer.unref?.();
    pendingNotifyTimer.set(resourceKey, timer);
  }

  /**
   * Fetches a resource and, when the stable projection actually differs from the
   * last one, stores a new snapshot. `silent` suppresses the change event, which
   * is what background readers use.
   */
  async function fetchResource(
    resource: ResourceDefinition<unknown>,
    apiClient: HeadscaleClient,
    opts: { silent?: boolean } = {},
  ): Promise<void> {
    const data = await resource.fetch(apiClient);
    const json = JSON.stringify(resource.project(data));
    const previousJson = serializedCache.get(resource.key);

    if (previousJson === json) {
      log.debug("api", "Live store: %s unchanged", resource.key);
      return;
    }

    const version = String(++versionCounter);
    serializedCache.set(resource.key, json);

    const snapshot: Snapshot<unknown> = {
      data,
      version,
      fetchedAt: Date.now(),
    };

    snapshots.set(resource.key, snapshot);
    log.debug("api", "Live store: %s updated (v%s)", resource.key, version);

    // The first payload has nothing to compare against, so it can only ever
    // prime the cache; nothing is notified for it.
    if (previousJson !== undefined && !opts.silent) {
      scheduleNotify(resource.key, version);
    }
  }

  function ensurePolling(resource: ResourceDefinition<unknown>) {
    if (intervals.has(resource.key)) {
      return;
    }

    const interval = setInterval(async () => {
      if (!storedApiClient) {
        return;
      }

      try {
        await fetchResource(resource, storedApiClient);
      } catch (error) {
        log.error("api", "Live store: failed to poll %s", resource.key, error);
      }
    }, resource.pollInterval);

    intervals.set(resource.key, interval);
    log.debug(
      "api",
      "Live store: started polling %s every %dms",
      resource.key,
      resource.pollInterval,
    );
  }

  function findResource(key: string): ResourceDefinition<unknown> | undefined {
    return resources.find((r) => r.key === key);
  }

  function snapshotFor<T>(resource: ResourceDefinition<T>): Snapshot<T> {
    return snapshots.get(resource.key) as Snapshot<T>;
  }

  return {
    async get<T>(
      resource: ResourceDefinition<T>,
      apiClient: HeadscaleClient,
    ): Promise<Snapshot<T>> {
      storedApiClient = apiClient;
      const def = findResource(resource.key);
      if (!def) {
        throw new Error(`LiveStore: unknown resource "${resource.key}"`);
      }

      if (!snapshots.has(resource.key)) {
        await fetchResource(def, apiClient);
      }

      ensurePolling(def);
      return snapshotFor(resource);
    },

    async read<T>(
      resource: ResourceDefinition<T>,
      apiClient: HeadscaleClient,
    ): Promise<Snapshot<T>> {
      storedApiClient = apiClient;
      const def = findResource(resource.key);
      if (!def) {
        throw new Error(`LiveStore: unknown resource "${resource.key}"`);
      }

      // A background reader reuses the snapshot the UI's poll already keeps. It
      // only fills an empty cache — silently — and never forces a refresh, so its
      // timer cannot push a version or a change event at the SSE stream.
      if (!snapshots.has(resource.key)) {
        await fetchResource(def, apiClient, { silent: true });
      }

      ensurePolling(def);
      return snapshotFor(resource);
    },

    async refresh<T>(resource: ResourceDefinition<T>, apiClient: HeadscaleClient): Promise<void> {
      storedApiClient = apiClient;
      const def = findResource(resource.key);
      if (!def) {
        throw new Error(`LiveStore: unknown resource "${resource.key}"`);
      }

      await fetchResource(def, apiClient);
    },

    getVersions(): Record<string, string> {
      const versions: Record<string, string> = {};
      for (const [key, snapshot] of snapshots) {
        versions[key] = snapshot.version;
      }
      return versions;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      for (const interval of intervals.values()) {
        clearInterval(interval);
      }
      intervals.clear();

      for (const timer of pendingNotifyTimer.values()) {
        clearTimeout(timer);
      }
      pendingNotifyTimer.clear();
      pendingNotifyVersion.clear();
      lastNotifiedAt.clear();

      snapshots.clear();
      serializedCache.clear();
      listeners.clear();
      storedApiClient = undefined;
    },
  };
}
