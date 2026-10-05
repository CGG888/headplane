// MARK: Node history service
//
// The sampler behind the availability cards. It is constructed with the same
// singletons the rest of the app already keeps (the Headscale client and the
// live node store the UI already polls), so a tick reads a snapshot that is
// usually already in memory instead of starting a second poll of the tailnet.
//
// Lifecycle mirrors the other services on the app context: `start()` returns
// immediately, schedules nothing when there is no API key to read nodes with,
// and `dispose()` clears the timer on shutdown or HMR reload. Every tick is
// guarded against overlap and against throwing, so a Headscale outage leaves a
// gap in the record (which the timeline renders as unknown) rather than an
// unhandled rejection or a failed request.

import type { Headscale } from "~/server/headscale/api";
import { nodesResource, type LiveStore } from "~/server/headscale/live-store";
import log from "~/utils/log";

import { appendHistorySample } from "./sample";
import { readHistoryDocument, writeHistoryDocument } from "./store";
import { emptyHistoryDocument, type NodeHistoryDocument, type NodeHistoryInput } from "./types";

/** How often a sample is taken. A few minutes is cheap and proves continuity. */
export const NODE_HISTORY_INTERVAL_MS = 5 * 60 * 1000;

export interface NodeHistoryServiceOptions {
  /** Headplane's `server.data_path`; the JSON store lives directly inside it. */
  dataPath: string;
  headscale: Headscale;
  /** The server-wide API key; without it nothing can be read, so the service stays inert. */
  apiKey?: string;
  hsLive: LiveStore;
  intervalMs?: number;
  /** Injectable clock, for tests. */
  now?: () => Date;
}

export interface NodeHistoryService {
  /** Reads the store once, so loaders can render what is already recorded. */
  ready(): Promise<void>;
  /** The current in-memory document; empty until {@link NodeHistoryService.ready} resolves. */
  document(): NodeHistoryDocument;
  /** One sampling pass; a no-op while the node list cannot be read. */
  runOnce(): Promise<void>;
  start(): void;
  dispose(): void;
}

export function createNodeHistoryService(options: NodeHistoryServiceOptions): NodeHistoryService {
  let document: NodeHistoryDocument = emptyHistoryDocument();
  let loadPromise: Promise<void> | undefined;
  let writeChain: Promise<boolean> = Promise.resolve(true);
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  const now = () => options.now?.() ?? new Date();
  const intervalMs = options.intervalMs ?? NODE_HISTORY_INTERVAL_MS;

  function ensureLoaded(): Promise<void> {
    loadPromise ??= readHistoryDocument(options.dataPath)
      .then((loaded) => {
        document = loaded;
      })
      .catch(() => undefined);
    return loadPromise;
  }

  /** Serializes writes so two ticks (or a tick and a reload) cannot interleave. */
  function persist(): Promise<boolean> {
    const pending = document;
    writeChain = writeChain.then(() => writeHistoryDocument(options.dataPath, pending));
    return writeChain;
  }

  function clearTimer() {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function schedule() {
    clearTimer();
    if (!options.apiKey) {
      // Nothing can be read, so nothing is scheduled: this is the inert state.
      return;
    }

    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);

    // The HTTP server keeps the process alive; the sampler never should.
    timer.unref?.();
  }

  /**
   * The node list, or `undefined` when it cannot be read. A Headscale that is
   * down, unauthenticated or broken produces no sample at all, which leaves an
   * honest gap in the record instead of a fabricated "offline".
   */
  async function readNodes(): Promise<NodeHistoryInput[] | undefined> {
    if (!options.apiKey) {
      return undefined;
    }

    try {
      if (!(await options.headscale.health())) {
        return undefined;
      }
    } catch (error) {
      log.debug("server", "Node history: Headscale health probe failed: %s", String(error));
      return undefined;
    }

    try {
      const client = options.headscale.client(options.apiKey);
      // The live store already polls nodes for the UI; reusing it keeps the
      // sampler from adding a second, parallel node poll.
      const snapshot = await options.hsLive.get(nodesResource, client);
      return snapshot.data.map((node) => ({
        id: node.id,
        name: node.givenName || node.name || node.id,
        online: node.online,
      }));
    } catch (error) {
      log.debug("server", "Node history: unable to read nodes: %s", String(error));
      return undefined;
    }
  }

  async function runOnce(): Promise<void> {
    if (ticking) {
      return;
    }

    ticking = true;
    try {
      await ensureLoaded();
      const nodes = await readNodes();
      if (nodes === undefined) {
        return;
      }

      // A tick is recorded even when no node changed state: it is what proves
      // the sampler was running, which is how a gap is told from "offline".
      const next = appendHistorySample(document, nodes, now().getTime());
      if (next === document) {
        return;
      }

      document = next;
      await persist();
    } catch (error) {
      // Belt and braces: a tick must never surface as an unhandled rejection.
      log.error("server", "Node history: sample failed: %s", String(error));
    } finally {
      ticking = false;
    }
  }

  return {
    async ready() {
      await ensureLoaded();
    },

    document() {
      return document;
    },

    runOnce,

    start() {
      // Lazy: startup must not wait on the store, and a Headplane without an
      // API key must not schedule anything at all.
      void ensureLoaded()
        .then(() => schedule())
        .catch(() => undefined);
    },

    dispose() {
      clearTimer();
    },
  };
}
