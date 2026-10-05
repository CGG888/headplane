import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Headscale } from "~/server/headscale/api";
import type { LiveStore } from "~/server/headscale/live-store";
import { createNodeHistoryService } from "~/server/history/service.server";
import { readHistoryDocument } from "~/server/history/store";

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const iso = (at: number) => new Date(at).toISOString();

const NODES = [
  { id: "1", givenName: "alpha", name: "alpha", online: true },
  { id: "2", givenName: "", name: "beta", online: false },
] as never;

function fakeHeadscale(health: boolean | (() => Promise<boolean>)): Headscale {
  return {
    health: typeof health === "function" ? health : async () => health,
    client: () => ({}) as never,
  } as unknown as Headscale;
}

function fakeLiveStore(load: () => Promise<unknown>): { store: LiveStore; calls: () => number } {
  let calls = 0;
  const store = {
    // The sampler reads through the non-notifying path, so the fake exposes the
    // same method the service uses.
    read: async () => {
      calls += 1;
      return { data: await load(), version: "1", fetchedAt: BASE };
    },
  } as unknown as LiveStore;

  return { store, calls: () => calls };
}

describe("node history sampler", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-history-service-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("without an API key nothing is read and nothing is written", async () => {
    const live = fakeLiveStore(async () => NODES);
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    await service.runOnce();

    expect(live.calls()).toBe(0);
    expect(service.document().ticks).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  test("an unreachable Headscale leaves the store untouched", async () => {
    const live = fakeLiveStore(async () => NODES);
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(false),
      apiKey: "key",
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    await service.runOnce();

    expect(live.calls()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  test("a health probe that throws is swallowed", async () => {
    const live = fakeLiveStore(async () => NODES);
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(async () => {
        throw new Error("Headscale is down");
      }),
      apiKey: "key",
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    await expect(service.runOnce()).resolves.toBeUndefined();

    expect(live.calls()).toBe(0);
    expect(service.document()).toEqual({ version: 1, ticks: [], nodes: [] });
    expect(await readdir(dir)).toEqual([]);
  });

  test("a node list that cannot be read is swallowed", async () => {
    const live = fakeLiveStore(async () => {
      throw new Error("node list exploded");
    });
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      apiKey: "key",
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    await expect(service.runOnce()).resolves.toBeUndefined();

    expect(live.calls()).toBe(1);
    expect(service.document().ticks).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  test("samples the nodes it can read and persists them", async () => {
    const live = fakeLiveStore(async () => NODES);
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      apiKey: "key",
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    await service.runOnce();

    expect(service.document().ticks).toEqual([iso(BASE)]);
    expect(service.document().nodes).toEqual([
      { id: "1", name: "alpha", samples: [{ at: iso(BASE), online: true }] },
      { id: "2", name: "beta", samples: [{ at: iso(BASE), online: false }] },
    ]);

    const stored = await readHistoryDocument(dir);
    expect(stored.ticks).toEqual([iso(BASE)]);
    expect(stored.nodes).toHaveLength(2);
  });

  test("a second tick at the same instant writes nothing new", async () => {
    const live = fakeLiveStore(async () => NODES);
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      apiKey: "key",
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    await service.runOnce();
    const first = service.document();
    await service.runOnce();

    expect(service.document()).toBe(first);
    expect(service.document().ticks).toEqual([iso(BASE)]);
  });

  test("overlapping ticks are collapsed into one sample", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const live = fakeLiveStore(async () => {
      await gate;
      return NODES;
    });
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      apiKey: "key",
      hsLive: live.store,
      now: () => new Date(BASE),
    });

    const first = service.runOnce();
    const second = service.runOnce();
    release();
    await Promise.all([first, second]);

    expect(live.calls()).toBe(1);
    expect(service.document().ticks).toEqual([iso(BASE)]);
  });
});

describe("node history scheduling", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-history-schedule-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("start schedules a tick, and dispose stops it", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      apiKey: "key",
      hsLive: fakeLiveStore(async () => NODES).store,
      intervalMs: 60_000,
    });

    try {
      service.start();
      await service.ready();
      expect(interval).toHaveBeenCalledTimes(1);
      expect(interval.mock.calls[0][1]).toBe(60_000);

      service.dispose();
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      interval.mockRestore();
      clear.mockRestore();
      service.dispose();
    }
  });

  test("start schedules nothing without an API key", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const service = createNodeHistoryService({
      dataPath: dir,
      headscale: fakeHeadscale(true),
      hsLive: fakeLiveStore(async () => NODES).store,
      intervalMs: 60_000,
    });

    try {
      service.start();
      await service.ready();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      interval.mockRestore();
      service.dispose();
    }
  });
});
