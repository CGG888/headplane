// MARK: Alert service
//
// The background notifier. It is constructed with the same singletons the rest
// of the app already keeps (the Headscale client, the live node store, the
// configuration-check helper) so a tick costs one health probe plus whatever
// those caches already hold, rather than re-fetching the whole tailnet.
//
// Lifecycle mirrors the other services on the app context: `start()` returns
// immediately and schedules nothing when notifications are disabled, and
// `dispose()` clears the timer on shutdown or HMR reload. Every tick is guarded
// against overlap and against throwing, so a bad webhook can never take the
// server — or the request that triggered it — down with it.

import { loadConfigChecks } from "~/routes/settings/system/config-probe";
import type { Headscale } from "~/server/headscale/api";
import { nodesResource, type LiveStore } from "~/server/headscale/live-store";
import log from "~/utils/log";

import { alertSeverity, detectAlertEvents, emitAlertEvent, sameAlertState } from "./events";
import {
  createAlertDelivery,
  notifyAlert,
  postAlertPayload,
  type AlertDeliveryOutcome,
} from "./notifier";
import { buildAlertPayload, buildTestAlertPayload } from "./payload";
import { isValidAlertWebhookUrl, normalizeAlertSettings } from "./settings";
import {
  appendDelivery,
  defaultAlertsDocument,
  readAlertsDocument,
  writeAlertsDocument,
  type AlertsDocument,
} from "./store";
import type {
  AlertApiKeySnapshot,
  AlertConfigChecksSnapshot,
  AlertDelivery,
  AlertNodeSnapshot,
  AlertSettings,
  AlertSnapshot,
} from "./types";

export interface AlertServiceOptions {
  /** Headplane's `server.data_path`; the JSON store lives directly inside it. */
  dataPath: string;
  /** Headscale's configuration file, for the configuration checks. */
  configPath?: string;
  headscale: Headscale;
  /** The server-wide API key; without it node and key events cannot be detected. */
  apiKey?: string;
  hsLive: LiveStore;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injectable clock, for tests. */
  now?: () => Date;
}

export interface AlertUpdateResult {
  success: boolean;
  settings: AlertSettings;
}

export interface AlertService {
  /** Reads the store once, so loaders can show the persisted settings. */
  ready(): Promise<void>;
  settings(): AlertSettings;
  history(): AlertDelivery[];
  update(patch: Partial<AlertSettings>): Promise<AlertUpdateResult>;
  /** Posts a sample payload with the given (possibly unsaved) channel config. */
  test(
    override?: Pick<AlertSettings, "webhookUrl" | "secret" | "notificationLanguage">,
  ): Promise<AlertDeliveryOutcome>;
  /** One detection pass; a no-op while notifications are disabled. */
  runOnce(): Promise<void>;
  /**
   * Reports the newest DERP address sync result. A run that starts failing
   * alerts once, through the same rules and history as every other event; a
   * successful run only clears the remembered failure.
   */
  reportDerpSync(input: { failed: boolean; reason?: string }): Promise<void>;
  start(): void;
  dispose(): void;
}

export function createAlertService(options: AlertServiceOptions): AlertService {
  let document: AlertsDocument = defaultAlertsDocument();
  let loadPromise: Promise<void> | undefined;
  let writeChain: Promise<boolean> = Promise.resolve(true);
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  const now = () => options.now?.() ?? new Date();

  function ensureLoaded(): Promise<void> {
    loadPromise ??= readAlertsDocument(options.dataPath)
      .then((loaded) => {
        document = loaded;
      })
      .catch(() => undefined);
    return loadPromise;
  }

  /** Serializes writes so a settings save and a tick cannot clobber each other. */
  function persist(): Promise<boolean> {
    const pending = document;
    writeChain = writeChain.then(() => writeAlertsDocument(options.dataPath, pending));
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
    if (!document.settings.enabled || !isValidAlertWebhookUrl(document.settings.webhookUrl)) {
      return;
    }

    timer = setInterval(() => {
      void runOnce();
    }, document.settings.intervalSeconds * 1000);

    // The HTTP server keeps the process alive; the notifier never should.
    timer.unref?.();
  }

  async function checkReachable(): Promise<boolean> {
    try {
      return await options.headscale.health();
    } catch (error) {
      log.debug("server", "Alerts: Headscale health probe failed: %s", String(error));
      return false;
    }
  }

  /**
   * A configuration that cannot be read is not a failure: the checks simply did
   * not run, so the matching state is left untouched and nothing is reported.
   */
  async function readConfigCheckSnapshot(): Promise<AlertConfigChecksSnapshot> {
    try {
      const checks = await loadConfigChecks(options.configPath);
      if (checks.length === 0) {
        if (options.configPath) {
          log.warn("config", "Alerts: configuration checks could not run; skipping config alerts");
        }
        return { available: false, failing: [] };
      }

      return {
        available: true,
        failing: checks.filter((check) => check.status === "fail").map((check) => check.id),
      };
    } catch (error) {
      log.warn("config", "Alerts: configuration checks failed to run: %s", String(error));
      return { available: false, failing: [] };
    }
  }

  async function gatherSnapshot(): Promise<AlertSnapshot> {
    const reachable = await checkReachable();

    let nodes: AlertNodeSnapshot[] = [];
    let nodesAvailable = false;
    let apiKeys: AlertApiKeySnapshot[] = [];
    let apiKeysAvailable = false;

    if (reachable && options.apiKey) {
      const client = options.headscale.client(options.apiKey);

      try {
        // The live store already polls nodes for the UI; reusing it keeps the
        // notifier from adding a second, parallel node poll. `read` is the
        // non-notifying path: this timer must never wake the SSE stream.
        const snapshot = await options.hsLive.read(nodesResource, client);
        nodes = snapshot.data.map((node) => ({
          id: node.id,
          name: node.givenName || node.name || node.id,
          online: node.online,
        }));
        nodesAvailable = true;
      } catch (error) {
        log.debug("server", "Alerts: unable to read nodes: %s", String(error));
      }

      if (nodesAvailable) {
        try {
          apiKeys = (await client.apiKeys.list()).map((key) => ({
            id: key.id,
            prefix: key.prefix,
            expiration: key.expiration,
          }));
          apiKeysAvailable = true;
        } catch (error) {
          log.debug("server", "Alerts: unable to read API keys: %s", String(error));
        }
      }
    }

    return {
      reachable,
      nodesAvailable,
      nodes,
      apiKeysAvailable,
      apiKeys,
      configChecks: await readConfigCheckSnapshot(),
    };
  }

  async function runOnce(): Promise<void> {
    if (ticking) {
      return;
    }

    ticking = true;
    try {
      await ensureLoaded();
      if (!document.settings.enabled || !isValidAlertWebhookUrl(document.settings.webhookUrl)) {
        return;
      }

      const snapshot = await gatherSnapshot();
      const at = now();
      const { events, state } = detectAlertEvents(document.state, snapshot, document.settings, at);

      let history = document.history;
      for (const event of events) {
        const result = await notifyAlert({
          settings: document.settings,
          payload: buildAlertPayload(event, __VERSION__, document.settings.notificationLanguage),
          history,
          event: event.id,
          target: event.target,
          threshold: event.threshold,
          at: now(),
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        });

        history = result.history;
      }

      const changed = !sameAlertState(state, document.state);
      document = { settings: document.settings, history, state };
      if (changed || events.length > 0) {
        await persist();
      }
    } catch (error) {
      // Belt and braces: a tick must never surface as an unhandled rejection.
      log.error("server", "Alerts: notification tick failed: %s", String(error));
    } finally {
      ticking = false;
    }
  }

  /**
   * The DERP sync's out-of-band report. It goes through the same emitter (so the
   * enabled/selected filter and the cooldown apply) and the same notifier (so
   * the delivery lands in the history), but the transition it compares against
   * is the sync's own state flag rather than a snapshot section.
   */
  async function reportDerpSync(input: { failed: boolean; reason?: string }): Promise<void> {
    await ensureLoaded();
    if (!document.settings.enabled || !isValidAlertWebhookUrl(document.settings.webhookUrl)) {
      // The notifier is off, so nothing is recorded: turning it on later and
      // seeing another failure is a real transition worth reporting.
      return;
    }

    const previous = document.state;

    if (!input.failed) {
      // A run that succeeded clears the flag so the next failure is a new
      // transition; it never sends anything.
      if (previous.derpSyncFailed) {
        document = { ...document, state: { ...previous, derpSyncFailed: false } };
        await persist();
      }

      return;
    }

    if (previous.derpSyncFailed) {
      // Still failing: the transition already fired, so nothing is re-sent.
      return;
    }

    const at = now();
    const sent = { ...previous.sent };
    const event = emitAlertEvent(
      sent,
      {
        id: "derpSyncFailed",
        severity: alertSeverity("derpSyncFailed"),
        at: at.toISOString(),
        ...(input.reason === undefined ? {} : { target: input.reason }),
      },
      document.settings,
      at,
    );

    if (event === undefined) {
      // Suppressed (notifications off, the event deselected, or the cooldown):
      // remember the failure without delivering it, exactly like a change the
      // detector would have recorded but not sent.
      document = { ...document, state: { ...previous, derpSyncFailed: true, sent } };
      await persist();
      return;
    }

    const result = await notifyAlert({
      settings: document.settings,
      payload: buildAlertPayload(event, __VERSION__, document.settings.notificationLanguage),
      history: document.history,
      event: event.id,
      target: event.target,
      threshold: event.threshold,
      at: now(),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    document = {
      ...document,
      history: result.history,
      state: { ...previous, derpSyncFailed: true, sent },
    };
    await persist();
  }

  return {
    async ready() {
      await ensureLoaded();
    },

    settings() {
      return document.settings;
    },

    history() {
      return document.history;
    },

    async update(patch) {
      await ensureLoaded();
      const previous = document.settings;
      const settings = normalizeAlertSettings({ ...previous, ...patch });
      document = { ...document, settings };

      const written = await persist();
      if (!written) {
        document = { ...document, settings: previous };
        return { success: false, settings: previous };
      }

      schedule();
      return { success: true, settings };
    },

    async test(override) {
      await ensureLoaded();
      const settings = normalizeAlertSettings({ ...document.settings, ...override });
      const at = now();
      const payload = buildTestAlertPayload(__VERSION__, at, settings.notificationLanguage);

      const outcome = await postAlertPayload(settings, payload, {
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });

      // The Test button is part of the history the page shows, so the attempt
      // is recorded even though it is not a real event.
      document = {
        ...document,
        history: appendDelivery(
          document.history,
          createAlertDelivery({ event: "test", outcome, at }),
        ),
      };
      await persist();

      return outcome;
    },

    runOnce,

    reportDerpSync,

    start() {
      // Lazy: startup must not wait on the store, and a disabled configuration
      // must cost nothing at all.
      void ensureLoaded()
        .then(() => schedule())
        .catch(() => undefined);
    },

    dispose() {
      clearTimer();
    },
  };
}
