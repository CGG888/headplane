import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { HeadscaleClient } from "~/server/headscale/api";
import {
  createLiveStore,
  defineResource,
  projectNodes,
  projectUsers,
} from "~/server/headscale/live-store";
import type { Machine, User } from "~/types";

const API = {} as HeadscaleClient;

function node(overrides: Partial<Machine> = {}): Machine {
  return {
    id: "1",
    machineKey: "machine-key",
    nodeKey: "node-key",
    discoKey: "disco-key",
    ipAddresses: ["100.64.0.1"],
    name: "alpha",
    user: { id: "u1", name: "alice", createdAt: "2025-01-01T00:00:00Z" },
    lastSeen: "2026-01-01T00:00:00Z",
    expiry: "2030-01-01T00:00:00Z",
    createdAt: "2025-01-01T00:00:00Z",
    registerMethod: "REGISTER_METHOD_CLI",
    tags: ["tag:server"],
    givenName: "alpha",
    online: true,
    approvedRoutes: ["0.0.0.0/0"],
    availableRoutes: ["0.0.0.0/0"],
    subnetRoutes: [],
    ...overrides,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    name: "alice",
    createdAt: "2025-01-01T00:00:00Z",
    displayName: "Alice",
    email: "alice@example.com",
    ...overrides,
  };
}

describe("node projection", () => {
  test("ignores a lastSeen that moved on its own", () => {
    const before = projectNodes([node({ lastSeen: "2026-01-01T00:00:00Z" })]);
    const after = projectNodes([node({ lastSeen: "2026-01-01T00:04:59Z" })]);

    expect(after).toEqual(before);
  });

  test("still sees online, rename, tag, expiry, owner and address changes", () => {
    const base = projectNodes([node()]);

    expect(projectNodes([node({ online: false })])).not.toEqual(base);
    expect(projectNodes([node({ givenName: "beta" })])).not.toEqual(base);
    expect(projectNodes([node({ tags: ["tag:other"] })])).not.toEqual(base);
    expect(projectNodes([node({ expiry: null })])).not.toEqual(base);
    expect(projectNodes([node({ user: undefined })])).not.toEqual(base);
    expect(projectNodes([node({ ipAddresses: ["100.64.0.2"] })])).not.toEqual(base);
    expect(projectNodes([node({ approvedRoutes: [] })])).not.toEqual(base);
  });

  test("does not care how the server orders nodes or their collections", () => {
    const ordered = projectNodes([node({ id: "1", tags: ["tag:a", "tag:b"] }), node({ id: "2" })]);
    const shuffled = projectNodes([node({ id: "2" }), node({ id: "1", tags: ["tag:b", "tag:a"] })]);

    expect(shuffled).toEqual(ordered);
  });

  test("is pure: the same payload always projects the same way", () => {
    const payload = [node()];
    const first = projectNodes(payload);

    expect(projectNodes(payload)).toEqual(first);
    expect(JSON.stringify(projectNodes(payload))).toBe(JSON.stringify(first));
    // The projection never mutates the payload it was given.
    expect(payload[0].tags).toEqual(["tag:server"]);
  });
});

describe("user projection", () => {
  test("sees a rename, a display name change and a picture change", () => {
    const base = projectUsers([user()]);

    expect(projectUsers([user({ name: "bob" })])).not.toEqual(base);
    expect(projectUsers([user({ displayName: "Bob" })])).not.toEqual(base);
    expect(projectUsers([user({ email: "bob@example.com" })])).not.toEqual(base);
  });

  test("sorts the list so a reordered response stays silent", () => {
    expect(projectUsers([user({ id: "u2" }), user({ id: "u1" })])).toEqual(
      projectUsers([user({ id: "u1" }), user({ id: "u2" })]),
    );
  });
});

describe("live store change events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function nodesStore() {
    let payload: Machine[] = [node()];
    const resource = defineResource("nodes", {
      pollInterval: 5_000,
      fetch: async () => payload,
      project: projectNodes,
    });

    return {
      resource,
      load: (next: Machine[]) => {
        payload = next;
      },
    };
  }

  test("a volatile-only change is silent and does not bump a version", async () => {
    const { resource, load } = nodesStore();
    const store = createLiveStore([resource]);
    const events: string[] = [];
    store.subscribe((key, version) => events.push(`${key}:${version}`));

    await store.get(resource, API);
    expect(events).toEqual([]);

    // The node checked in again: only lastSeen differs.
    load([node({ lastSeen: "2026-01-01T00:10:00Z" })]);
    await store.refresh(resource, API);

    expect(events).toEqual([]);
    expect(store.getVersions()).toEqual({ nodes: "1" });
    store.dispose();
  });

  test("a poll keeps the client its reader started it with", async () => {
    const seen: HeadscaleClient[] = [];
    const resource = defineResource("nodes", {
      pollInterval: 5_000,
      fetch: async (client: HeadscaleClient) => {
        seen.push(client);
        return [node()];
      },
      project: projectNodes,
    });
    const first = { name: "first" } as unknown as HeadscaleClient;
    const second = { name: "second" } as unknown as HeadscaleClient;
    const store = createLiveStore([resource]);

    await store.get(resource, first);
    // A later caller only reads through the store: the poll the first caller
    // started must keep using that first client.
    await store.read(resource, second);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seen).toEqual([first, first]);
    store.dispose();
  });

  test("a real state flip still notifies", async () => {
    const { resource, load } = nodesStore();
    const store = createLiveStore([resource]);
    const events: string[] = [];
    store.subscribe((key, version) => events.push(`${key}:${version}`));

    await store.get(resource, API);

    load([node({ online: false })]);
    await store.refresh(resource, API);
    expect(events).toEqual(["nodes:2"]);

    // Waits the coalescing window out so the rename is announced on its own.
    await vi.advanceTimersByTimeAsync(20_000);

    load([node({ givenName: "renamed", online: false })]);
    await store.refresh(resource, API);
    expect(events).toEqual(["nodes:2", "nodes:3"]);
    expect(store.getVersions()).toEqual({ nodes: "3" });
    store.dispose();
  });

  test("polling an idle tailnet whose lastSeen keeps moving stays silent", async () => {
    const { resource, load } = nodesStore();
    const store = createLiveStore([resource]);
    const events: string[] = [];
    store.subscribe((key, version) => events.push(`${key}:${version}`));

    await store.get(resource, API);

    for (let i = 0; i < 4; i++) {
      load([node({ lastSeen: `2026-01-01T00:0${i}:00Z` })]);
      await vi.advanceTimersByTimeAsync(5_000);
    }

    expect(events).toEqual([]);
    store.dispose();
  });

  test("coalesces a burst into one event per window", async () => {
    const { resource, load } = nodesStore();
    const store = createLiveStore([resource], { notifyWindowMs: 20_000 });
    const events: string[] = [];
    store.subscribe((key, version) => events.push(`${key}:${version}`));

    await store.get(resource, API);

    // The first change of the window goes out straight away.
    load([node({ online: false })]);
    await store.refresh(resource, API);
    expect(events).toEqual(["nodes:2"]);

    // Everything inside the window is held back...
    load([node({ online: true })]);
    await store.refresh(resource, API);
    load([node({ givenName: "renamed", online: true })]);
    await store.refresh(resource, API);
    expect(events).toEqual(["nodes:2"]);

    // ...and delivered once when it closes, with the newest version.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(events).toEqual(["nodes:2"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events).toEqual(["nodes:2", "nodes:4"]);
    store.dispose();
  });

  test("the background read path never notifies or bumps a version", async () => {
    const { resource, load } = nodesStore();
    const store = createLiveStore([resource]);
    const events: string[] = [];
    store.subscribe((key, version) => events.push(`${key}:${version}`));

    // Reading an unknown resource fills the cache silently (there is nothing to
    // compare against, so there is nothing to announce).
    const primed = await store.read(resource, API);
    expect(primed.version).toBe("1");
    expect(events).toEqual([]);

    // A poll that does see a real change still notifies...
    load([node({ online: false })]);
    await store.refresh(resource, API);
    expect(events).toEqual(["nodes:2"]);

    // ...while a background read afterwards hands back the same snapshot and
    // neither refreshes nor announces anything, even though the payload moved.
    load([node({ online: true }), node({ id: "2" })]);
    const again = await store.read(resource, API);

    expect(again.version).toBe("2");
    expect(again.data).toEqual([node({ online: false })]);
    expect(store.getVersions()).toEqual({ nodes: "2" });
    expect(events).toEqual(["nodes:2"]);
    store.dispose();
  });
});
