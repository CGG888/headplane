// MARK: DERP address sync service
//
// The background job that keeps `derp.server.ipv4`/`derp.server.ipv6` pointing
// at addresses clients can actually reach. The operator's public IPv4 is
// dynamic (a DDNS client keeps the relay hostname's A record current) and their
// IPv6 comes from the host, so neither value can be written once and forgotten.
//
// IPv4 is read from the A record of `server_url` because a machine behind NAT
// cannot know its own public address; a lookup that fails leaves the configured
// value exactly as it is. IPv6 is read from the host's own global unicast
// address through `loadHostIpv6Addresses`, the same probe the relay card uses.
//
// Lifecycle mirrors the other services on the app context: `start()` returns
// immediately and schedules nothing while the sync is disabled, and `dispose()`
// clears the timer on shutdown or HMR reload. A tick is guarded against overlap
// and against throwing, and it writes only when a detected address differs from
// the configuration — after taking a snapshot, and with an audit entry behind
// it. The configured reload/restart integration is only ever triggered by a
// change, never by a check that found nothing to do.

import { AUDIT_ACTIONS } from "~/server/audit/actions";
import type { Headscale } from "~/server/headscale/api";
import { loadHostIpv6Addresses, selectHostIpv6Address } from "~/server/host-addresses";
import { loadSharedRelayResolution, type RelayResolution } from "~/server/relay-dns";
import type { SnapshotService } from "~/server/snapshots/service.server";
import type { SnapshotTarget } from "~/server/snapshots/types";
import log from "~/utils/log";

import {
  isPublicSyncIpv4,
  isPublicSyncIpv6,
  literalSyncIpv4,
  pickPublicSyncIpv4,
  planDerpSync,
  relayHostnameFromServerUrl,
  type DerpSyncPlan,
} from "./addresses";
import { derpSyncIntervalMs, normalizeDerpSyncSettings, selectedFamilies } from "./settings";
import { readDerpSyncDocument, writeDerpSyncDocument } from "./store";
import type {
  DerpSyncDocument,
  DerpSyncFamily,
  DerpSyncOutcome,
  DerpSyncReload,
  DerpSyncRun,
  DerpSyncSettings,
  DerpSyncSkip,
  DerpSyncValue,
} from "./types";

/** The snapshot reason recorded before a sync write. */
export const DERP_SYNC_SNAPSHOT_REASON = "derp-address-sync";

/** The Headscale configuration surface the service reads and patches. */
export interface DerpSyncConfigPort {
  writable(): boolean;
  getDERPSettings(): {
    serverUrl: string;
    server: { ipv4: string; ipv6: string };
  };
  patch(patches: Array<{ path: string; value: unknown }>): Promise<void>;
}

/** The reload/restart integration, as the service needs it. */
export interface DerpSyncReloadPort {
  onConfigChange(headscale: Headscale): Promise<void> | void;
}

/** The audit sink, as the service needs it. */
export interface DerpSyncAuditPort {
  record(input: {
    actor: string;
    actorType: "system";
    action: string;
    target?: string;
    detail?: string | null;
    result: "success" | "failure";
  }): Promise<unknown>;
}

export interface DerpSyncServiceOptions {
  /** Headplane's `server.data_path`; the JSON store lives directly inside it. */
  dataPath: string;
  config: DerpSyncConfigPort;
  /** The exact files a write may snapshot; the Headscale configuration file. */
  getSnapshotTargets: () => SnapshotTarget[];
  snapshots?: SnapshotService;
  audit?: DerpSyncAuditPort;
  headscale: Headscale;
  integration?: DerpSyncReloadPort;
  /** Resolves the relay hostname; defaults to the shared, cached resolver. */
  resolveRelay?: (host: string) => Promise<RelayResolution | undefined>;
  /** Enumerates the host's own global unicast IPv6 addresses. */
  loadHostIpv6?: () => Promise<Awaited<ReturnType<typeof loadHostIpv6Addresses>>>;
  /** Injectable clock, for tests. */
  now?: () => Date;
  /** Test hook: overrides the interval the settings would schedule. */
  intervalMs?: number;
}

export interface DerpSyncUpdateResult {
  success: boolean;
  settings: DerpSyncSettings;
}

export interface DerpSyncService {
  /** Reads the store once, so loaders can render the persisted settings. */
  ready(): Promise<void>;
  settings(): DerpSyncSettings;
  /** The newest run, as the store holds it; `undefined` before the first run. */
  last(): DerpSyncRun | undefined;
  update(patch: Partial<DerpSyncSettings>): Promise<DerpSyncUpdateResult>;
  /** One run from the settings card; works even while the schedule is off. */
  runNow(): Promise<DerpSyncRun | undefined>;
  /** One scheduled tick; a no-op while the sync is disabled. */
  runOnce(): Promise<DerpSyncRun | undefined>;
  start(): void;
  dispose(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One family's detection outcome: either a value, or the reason it was skipped. */
interface FamilyDetection {
  value?: DerpSyncValue;
  skip?: DerpSyncSkip;
}

export function createDerpSyncService(options: DerpSyncServiceOptions): DerpSyncService {
  let document: DerpSyncDocument = { settings: normalizeDerpSyncSettings(undefined) };
  let loadPromise: Promise<void> | undefined;
  let writeChain: Promise<boolean> = Promise.resolve(true);
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  const now = () => options.now?.() ?? new Date();
  const resolveRelay = options.resolveRelay ?? ((host: string) => loadSharedRelayResolution(host));
  const loadHostIpv6 = options.loadHostIpv6 ?? (() => loadHostIpv6Addresses());

  function ensureLoaded(): Promise<void> {
    loadPromise ??= readDerpSyncDocument(options.dataPath)
      .then((loaded) => {
        document = loaded;
      })
      .catch(() => undefined);
    return loadPromise;
  }

  /** Serializes writes so a settings save and a run cannot clobber each other. */
  function persist(): Promise<boolean> {
    const pending = document;
    writeChain = writeChain.then(() => writeDerpSyncDocument(options.dataPath, pending));
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
    if (!document.settings.enabled) {
      // The inert state: nothing is scheduled, and no probe runs on its own.
      return;
    }

    timer = setInterval(
      () => {
        void execute(false);
      },
      options.intervalMs ?? derpSyncIntervalMs(document.settings.intervalHours),
    );

    // The HTTP server keeps the process alive; the sync never should.
    timer.unref?.();
  }

  /**
   * The public IPv4 of the relay hostname, from its A record. A literal address
   * in `server_url` is its own answer and needs no lookup; anything that fails
   * or is not a public address is reported so the previous value is kept.
   */
  async function detectIpv4(serverUrl: string): Promise<FamilyDetection> {
    const host = relayHostnameFromServerUrl(serverUrl);
    if (host === undefined) {
      return {
        skip: {
          family: "ipv4",
          reason: serverUrl.trim().length === 0 ? "host-missing" : "invalid-host",
          ...(serverUrl.trim().length > 0 ? { detail: serverUrl.trim() } : {}),
        },
      };
    }

    const literal = literalSyncIpv4(host);
    if (literal !== undefined) {
      return isPublicSyncIpv4(literal)
        ? { value: { address: literal, source: "literal" } }
        : { skip: { family: "ipv4", reason: "not-public", detail: literal } };
    }

    const resolution = await resolveRelay(host);
    if (resolution === undefined) {
      return { skip: { family: "ipv4", reason: "lookup-failed", detail: host } };
    }

    if (resolution.ipv4.length === 0) {
      const reason =
        resolution.reason === "timeout" || resolution.reason === "resolver-error"
          ? "lookup-failed"
          : "no-records";
      return { skip: { family: "ipv4", reason, detail: host } };
    }

    const accepted = pickPublicSyncIpv4(resolution.ipv4);
    if (accepted === undefined) {
      return {
        skip: { family: "ipv4", reason: "not-public", detail: resolution.ipv4.join(", ") },
      };
    }

    return { value: { address: accepted, source: "dns" } };
  }

  /**
   * The host's own global unicast IPv6 address. A process that does not share
   * the host's network namespace can only see its own interfaces, so it reports
   * that instead of advertising an address the host does not have.
   */
  async function detectIpv6(): Promise<FamilyDetection> {
    const host = await loadHostIpv6();
    if (host.namespace !== "host") {
      return { skip: { family: "ipv6", reason: "namespace-unavailable" } };
    }

    const selection = selectHostIpv6Address(host.candidates);
    if (selection.address === undefined) {
      return { skip: { family: "ipv6", reason: "no-host-address" } };
    }

    return isPublicSyncIpv6(selection.address)
      ? { value: { address: selection.address, source: "host" } }
      : { skip: { family: "ipv6", reason: "not-public", detail: selection.address } };
  }

  /** Takes a snapshot of the configuration file; a failure never blocks a write. */
  async function takeSnapshot(): Promise<string | undefined> {
    if (options.snapshots === undefined) {
      return undefined;
    }

    try {
      const snapshot = await options.snapshots.take(
        DERP_SYNC_SNAPSHOT_REASON,
        options.getSnapshotTargets(),
      );
      return snapshot.id;
    } catch (error) {
      log.warn(
        "config",
        "Failed to snapshot before syncing the DERP addresses: %s",
        errorMessage(error),
      );
      return undefined;
    }
  }

  /** Records the write; the audit store swallows its own failures. */
  async function recordAudit(plan: DerpSyncPlan): Promise<void> {
    if (options.audit === undefined) {
      return;
    }

    try {
      await options.audit.record({
        actor: "system",
        actorType: "system",
        action: AUDIT_ACTIONS.derpAddressSync,
        target: plan.changes.map((change) => `derp.server.${change.family}`).join(", "),
        detail: plan.changes
          .map((change) => `${change.to} (was ${change.from ?? "unset"})`)
          .join(", "),
        result: "success",
      });
    } catch (error) {
      log.warn("server", "Unable to record the DERP address sync: %s", errorMessage(error));
    }
  }

  /**
   * Whether Headscale has to be reloaded, and whether this run already did it.
   * The integration only runs when the operator turned it on: reloading
   * Headscale briefly interrupts every connected client.
   */
  async function reloadAfterWrite(settings: DerpSyncSettings): Promise<DerpSyncReload> {
    if (options.integration === undefined || !settings.autoReload) {
      return "manual";
    }

    try {
      await options.integration.onConfigChange(options.headscale);
      return "triggered";
    } catch (error) {
      log.warn(
        "config",
        "The DERP address sync could not reload Headscale: %s",
        errorMessage(error),
      );
      return "failed";
    }
  }

  async function execute(manual: boolean): Promise<DerpSyncRun | undefined> {
    if (ticking) {
      // Overlap guard: a slow DNS answer must not stack a second writer on top
      // of the first one.
      return undefined;
    }

    ticking = true;
    try {
      await ensureLoaded();
      const settings = document.settings;
      if (!manual && !settings.enabled) {
        return undefined;
      }

      const derp = options.config.getDERPSettings();
      const wanted = selectedFamilies(settings.families);
      const detected: Partial<Record<DerpSyncFamily, DerpSyncValue>> = {};
      const skipped: DerpSyncSkip[] = [];

      for (const family of ["ipv4", "ipv6"] as const) {
        if (!wanted.includes(family)) {
          skipped.push({ family, reason: "family-disabled" });
        }
      }

      if (wanted.includes("ipv4")) {
        const result = await detectIpv4(derp.serverUrl);
        if (result.value !== undefined) {
          detected.ipv4 = result.value;
        }
        if (result.skip !== undefined) {
          skipped.push(result.skip);
        }
      }

      if (wanted.includes("ipv6")) {
        const result = await detectIpv6();
        if (result.value !== undefined) {
          detected.ipv6 = result.value;
        }
        if (result.skip !== undefined) {
          skipped.push(result.skip);
        }
      }

      const plan = planDerpSync({ ipv4: derp.server.ipv4, ipv6: derp.server.ipv6 }, detected);
      const at = now();

      let outcome: DerpSyncOutcome;
      let snapshotId: string | undefined;
      let reload: DerpSyncReload = "not-needed";

      if (plan.changes.length === 0) {
        // Nothing differs, so nothing is written and nothing is reloaded.
        outcome = plan.unchanged.length > 0 ? "unchanged" : "skipped";
      } else if (!options.config.writable()) {
        for (const change of plan.changes) {
          skipped.push({ family: change.family, reason: "config-not-writable" });
        }

        outcome = "skipped";
      } else {
        snapshotId = await takeSnapshot();
        await options.config.patch(plan.patches);
        await recordAudit(plan);
        reload = await reloadAfterWrite(settings);
        outcome = "changed";
      }

      const run: DerpSyncRun = {
        at: at.toISOString(),
        outcome,
        detected,
        changes: plan.changes,
        skipped,
        unchanged: plan.unchanged,
        ...(snapshotId === undefined ? {} : { snapshotId }),
        reload,
      };

      document = { settings, last: run };
      await persist();

      log.info(
        "config",
        "DERP address sync: %s (%d change(s), %d skipped)",
        outcome,
        plan.changes.length,
        skipped.length,
      );

      return run;
    } catch (error) {
      // Belt and braces: a tick must never surface as an unhandled rejection.
      const run: DerpSyncRun = {
        at: now().toISOString(),
        outcome: "failed",
        detected: {},
        changes: [],
        skipped: [],
        unchanged: [],
        reload: "not-needed",
        error: errorMessage(error),
      };

      document = { settings: document.settings, last: run };
      await persist();
      log.error("config", "DERP address sync failed: %s", errorMessage(error));

      return run;
    } finally {
      ticking = false;
    }
  }

  return {
    async ready() {
      await ensureLoaded();
    },

    settings() {
      return document.settings;
    },

    last() {
      return document.last;
    },

    async update(patch) {
      await ensureLoaded();
      const previous = document.settings;
      const settings = normalizeDerpSyncSettings({ ...previous, ...patch });
      document = { ...document, settings };

      const written = await persist();
      if (!written) {
        document = { ...document, settings: previous };
        return { success: false, settings: previous };
      }

      schedule();
      return { success: true, settings };
    },

    runNow() {
      return execute(true);
    },

    runOnce() {
      return execute(false);
    },

    start() {
      // Lazy: startup must not wait on the store, and a disabled sync must cost
      // nothing at all.
      void ensureLoaded()
        .then(() => schedule())
        .catch(() => undefined);
    },

    dispose() {
      clearTimer();
    },
  };
}
