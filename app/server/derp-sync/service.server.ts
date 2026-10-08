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
// address through `loadHostIpv6Addresses`, the same probe the relay card uses,
// and ranked by the same selection, so a rotating privacy address is never
// preferred over a stable one. A local address is only written when the probe
// could confirm this process shares the host's network namespace; a bridged
// container reads `unknown` rather than `isolated`, and is skipped rather than
// advertising a container-only address. When the operator enabled the external
// IPv6 echo (off by default, configured on this same settings card), its answer
// wins: it is what the internet actually sees, so it is right even when every
// local address is the container's or the router's.
//
// Override policy A: the detected address is always authoritative. If it differs
// from `derp.server.ipv4`/`ipv6` the run writes it, per family and only for the
// key that actually changed, after taking the snapshot and recording the audit
// entry.
//
// Two entry points share one detection path: `checkNow()` reports what a run
// would do and writes nothing, `runNow()` writes what changed and then follows
// the reload switch. Auto-reload defaults to on, because an address written into
// the configuration file only reaches clients after Headscale reloads.
//
// Lifecycle mirrors the other services on the app context: `start()` returns
// immediately and schedules nothing while the sync is disabled, and `dispose()`
// clears the timer on shutdown or HMR reload. A tick is guarded against overlap
// and against throwing. A failing run is reported to the notification service;
// a run that found nothing to change never is.

import { AUDIT_ACTIONS } from "~/server/audit/actions";
import {
  invalidateDerpData,
  refreshDerpAfterWrite,
  toReloadState,
  type DerpReloadTarget,
} from "~/server/derp-refresh";
import type { Headscale } from "~/server/headscale/api";
import { loadHostIpv6Addresses, selectHostIpv6Address } from "~/server/host-addresses";
import { loadHostEcho, readHostEchoSettings, type HostEchoResult } from "~/server/host-echo";
import { loadSharedRelayResolution, type RelayResolution } from "~/server/relay-dns";
import type { SnapshotService } from "~/server/snapshots/service.server";
import type { SnapshotTarget } from "~/server/snapshots/types";
import log from "~/utils/log";

import {
  buildIpv4Candidates,
  buildIpv6ExcludedCandidates,
  buildIpv6HostCandidates,
  isIpLiteralHost,
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
  DerpSyncCandidate,
  DerpSyncDocument,
  DerpSyncFailureReason,
  DerpSyncFamily,
  DerpSyncMode,
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
export type DerpSyncReloadPort = DerpReloadTarget;

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

/**
 * The notification sink, as the service needs it: the alert service's own
 * transition, cooldown and history handling, with the sync's failure code as the
 * subject. Kept structural so neither service imports the other's types.
 */
export interface DerpSyncAlertPort {
  reportDerpSync(input: { failed: boolean; reason?: string }): Promise<unknown>;
}

export interface DerpSyncServiceOptions {
  /** Headplane's `server.data_path`; the JSON store lives directly inside it. */
  dataPath: string;
  config: DerpSyncConfigPort;
  /** The exact files a write may snapshot; the Headscale configuration file. */
  getSnapshotTargets: () => SnapshotTarget[];
  snapshots?: SnapshotService;
  audit?: DerpSyncAuditPort;
  /** The notification service; a failing run is reported through it. */
  alerts?: DerpSyncAlertPort;
  headscale: Headscale;
  integration?: DerpSyncReloadPort;
  /** Resolves the relay hostname; defaults to the shared, cached resolver. */
  resolveRelay?: (host: string) => Promise<RelayResolution | undefined>;
  /** Enumerates the host's own global unicast IPv6 addresses. */
  loadHostIpv6?: () => Promise<Awaited<ReturnType<typeof loadHostIpv6Addresses>>>;
  /**
   * The external IPv6 echo answer, read from the same setting this settings card
   * offers. Off by default, so this only reaches the network when an operator
   * turned the probe on.
   */
  resolveHostEcho?: () => Promise<HostEchoResult>;
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
  /** The "Check" button: both detections and the comparison, writing nothing. */
  checkNow(): Promise<DerpSyncRun | undefined>;
  /** The "Run now" button: detect, write what changed, follow the reload switch. */
  runNow(): Promise<DerpSyncRun | undefined>;
  /** One scheduled tick; a no-op while the sync is disabled. */
  runOnce(): Promise<DerpSyncRun | undefined>;
  start(): void;
  dispose(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One family's detection outcome: a value, the reason it was skipped, and the
 * candidates that decision was made from. */
interface FamilyDetection {
  value?: DerpSyncValue;
  skip?: DerpSyncSkip;
  candidates: DerpSyncCandidate[];
}

/**
 * Why a finished run counts as failed: an unexpected error, a reload that did
 * not happen, a write that could not be made, or a run that yielded no usable
 * address at all. A run that one family skipped while the other was detected
 * still did its job; only when nothing usable remains is the detection itself
 * the failure. A run that only found a disabled family, or nothing at all to
 * change, is not a failure.
 */
export function derpSyncFailureReason(run: DerpSyncRun): DerpSyncFailureReason | undefined {
  if (run.outcome === "failed") {
    return "unexpected";
  }

  if (run.reload === "failed") {
    return "reload-failed";
  }

  if (run.skipped.some((skip) => skip.reason === "config-not-writable")) {
    return "not-writable";
  }

  // One family can be skipped for a reason of its own (no A record, a container
  // namespace, an address that is not public) while the other was detected and
  // written. That is not a failed detection, so it must not raise the alert.
  const usable = Object.keys(run.detected).length > 0;
  if (!usable && run.skipped.some((skip) => skip.reason !== "family-disabled")) {
    return "detection-unusable";
  }

  return undefined;
}

export function createDerpSyncService(options: DerpSyncServiceOptions): DerpSyncService {
  let document: DerpSyncDocument = { settings: normalizeDerpSyncSettings(undefined) };
  let loadPromise: Promise<void> | undefined;
  let writeChain: Promise<boolean> = Promise.resolve(true);
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let disposed = false;

  const now = () => options.now?.() ?? new Date();
  const resolveRelay = options.resolveRelay ?? ((host: string) => loadSharedRelayResolution(host));
  const loadHostIpv6 = options.loadHostIpv6 ?? (() => loadHostIpv6Addresses());
  const resolveHostEcho =
    options.resolveHostEcho ??
    (async () => {
      const settings = await readHostEchoSettings(options.dataPath);
      return loadHostEcho(settings);
    });

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
    if (disposed || !document.settings.enabled) {
      // The inert state: nothing is scheduled, and no probe runs on its own.
      return;
    }

    timer = setInterval(
      () => {
        void execute("run", false);
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
        candidates: [],
      };
    }

    const literal = literalSyncIpv4(host);
    if (literal !== undefined) {
      const candidates = buildIpv4Candidates([{ address: literal, source: "literal" }], literal);
      return isPublicSyncIpv4(literal)
        ? { value: { address: literal, source: "literal" }, candidates }
        : { skip: { family: "ipv4", reason: "not-public", detail: literal }, candidates };
    }

    if (isIpLiteralHost(host)) {
      // The relay is named by an address literal, not by a name, so there is no
      // A record to read: IPv4 has no answer here. Reported without a lookup,
      // because a lookup on a bracketed literal would fail for the wrong reason.
      return { skip: { family: "ipv4", reason: "no-records", detail: host }, candidates: [] };
    }

    const resolution = await resolveRelay(host);
    if (resolution === undefined) {
      return { skip: { family: "ipv4", reason: "lookup-failed", detail: host }, candidates: [] };
    }

    const answers = resolution.ipv4.map((address) => ({ address, source: "dns" as const }));
    if (resolution.ipv4.length === 0) {
      const reason =
        resolution.reason === "timeout" || resolution.reason === "resolver-error"
          ? "lookup-failed"
          : "no-records";
      return { skip: { family: "ipv4", reason, detail: host }, candidates: [] };
    }

    const accepted = pickPublicSyncIpv4(resolution.ipv4);
    const candidates = buildIpv4Candidates(answers, accepted);
    if (accepted === undefined) {
      return {
        skip: { family: "ipv4", reason: "not-public", detail: resolution.ipv4.join(", ") },
        candidates,
      };
    }

    return { value: { address: accepted, source: "dns" }, candidates };
  }

  /**
   * The address clients must be able to reach, IPv6 side.
   *
   * A local address is only advertised when the process can show it shares the
   * host's network namespace: a bridged container reads `unknown` rather than
   * `isolated` (see `classifyNetworkNamespace`), and the interfaces it sees are
   * its own, so any namespace that is not confirmed to be the host's is skipped
   * with a reason instead of being assumed to be the host. The external echo —
   * when the operator enabled it — wins over that rule: it is the one source
   * that knows what the internet sees, which is exactly the NAT66 or
   * forwarded-address case where no local address is right.
   */
  async function detectIpv6(): Promise<FamilyDetection> {
    const [host, echo] = await Promise.all([loadHostIpv6(), resolveHostEcho()]);
    const echoAddress = echo.address;
    const echoUsable = echoAddress !== undefined && isPublicSyncIpv6(echoAddress);
    // Only a namespace Headplane could confirm is the host's makes a local
    // address trustworthy; the echo below is the one exception to that.
    const trusted = host.namespace === "host";
    const excluded = buildIpv6ExcludedCandidates(
      (host.excluded ?? []).map((entry) => ({
        address: entry.address,
        interfaceName: entry.interfaceName,
        kind: entry.kind,
      })),
    );

    // An answer that is present but unusable is still worth showing: it is why
    // the echo did not decide the address.
    const rejectedEcho: DerpSyncCandidate[] =
      echoAddress === undefined || echoUsable
        ? []
        : [
            {
              family: "ipv6",
              address: echoAddress,
              source: "echo",
              chosen: false,
              reason: "not-public",
            },
          ];

    // The selection is built even when the namespace is not the host's, so the
    // panel can show what this process saw; it is only ever written from a
    // namespace that could be confirmed as the host's.
    const selection = selectHostIpv6Address(host.candidates);
    const localCandidates = buildIpv6HostCandidates(
      selection.candidates.map((candidate) => ({
        address: candidate.address,
        interfaceName: candidate.interfaceName,
        temporary: candidate.temporary,
      })),
      echoUsable ? echoAddress : trusted ? selection.address : undefined,
      echoUsable,
    );

    if (echoUsable) {
      return {
        value: { address: echoAddress, source: "echo" },
        candidates: [
          {
            family: "ipv6",
            address: echoAddress,
            source: "echo",
            chosen: true,
            reason: "selected",
          },
          ...localCandidates,
          ...excluded,
        ],
      };
    }

    if (!trusted) {
      // A container that does not share the host's stack enumerates its own
      // interfaces, so writing one would advertise an address clients cannot
      // reach. The addresses it did see are still reported as candidates.
      return {
        skip: { family: "ipv6", reason: "namespace-unavailable" },
        candidates: [...localCandidates, ...rejectedEcho, ...excluded],
      };
    }

    const chosen = selection.address;
    if (chosen === undefined) {
      return {
        skip: { family: "ipv6", reason: "no-host-address" },
        candidates: [...rejectedEcho, ...excluded],
      };
    }

    return isPublicSyncIpv6(chosen)
      ? {
          value: { address: chosen, source: "host" },
          candidates: [...localCandidates, ...rejectedEcho, ...excluded],
        }
      : {
          skip: { family: "ipv6", reason: "not-public", detail: chosen },
          candidates: [...localCandidates, ...rejectedEcho, ...excluded],
        };
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
   * The integration only runs while the reload switch is on: reloading Headscale
   * briefly interrupts every connected client.
   */
  async function reloadAfterWrite(settings: DerpSyncSettings): Promise<DerpSyncReload> {
    if (options.integration === undefined || !settings.autoReload) {
      invalidateDerpData();
      return "manual";
    }

    // This run wrote Headscale's own configuration (`derp.server.ipv4`/`ipv6`),
    // so only a process that reads that file again can see the new address.
    const result = await refreshDerpAfterWrite({
      headscale: options.headscale,
      integration: options.integration,
      changeKind: "config",
      reason: "derp_sync_run",
    });

    return toReloadState(result.outcome);
  }

  /**
   * Reports one finished run to the notification service. Only a writing run is
   * reported: a check is interactive and shows its own result, and a run that
   * found nothing to change is not a failure. Never throws.
   */
  async function reportToAlerts(run: DerpSyncRun): Promise<void> {
    if (options.alerts === undefined || run.mode !== "run") {
      return;
    }

    try {
      await options.alerts.reportDerpSync({
        failed: run.failure !== undefined,
        ...(run.failure === undefined ? {} : { reason: run.failure }),
      });
    } catch (error) {
      log.warn(
        "server",
        "Unable to report the DERP address sync result to the notifier: %s",
        errorMessage(error),
      );
    }
  }

  async function execute(mode: DerpSyncMode, manual: boolean): Promise<DerpSyncRun | undefined> {
    if (ticking) {
      // Overlap guard: a slow DNS answer must not stack a second writer on top
      // of the first one.
      return undefined;
    }

    ticking = true;
    try {
      await ensureLoaded();
      if (disposed) {
        // Disposal abandons the run: once the service is gone, nothing may
        // touch the configuration, the audit log or the store.
        return undefined;
      }

      const settings = document.settings;
      if (!manual && !settings.enabled) {
        return undefined;
      }

      const derp = options.config.getDERPSettings();
      const wanted = selectedFamilies(settings.families);
      const detected: Partial<Record<DerpSyncFamily, DerpSyncValue>> = {};
      const skipped: DerpSyncSkip[] = [];
      const candidates: DerpSyncCandidate[] = [];

      for (const family of ["ipv4", "ipv6"] as const) {
        if (!wanted.includes(family)) {
          skipped.push({ family, reason: "family-disabled" });
        }
      }

      if (wanted.includes("ipv4")) {
        const result = await detectIpv4(derp.serverUrl);
        candidates.push(...result.candidates);
        if (result.value !== undefined) {
          detected.ipv4 = result.value;
        }
        if (result.skip !== undefined) {
          skipped.push(result.skip);
        }
      }

      if (wanted.includes("ipv6")) {
        const result = await detectIpv6();
        candidates.push(...result.candidates);
        if (result.value !== undefined) {
          detected.ipv6 = result.value;
        }
        if (result.skip !== undefined) {
          skipped.push(result.skip);
        }
      }

      const plan = planDerpSync({ ipv4: derp.server.ipv4, ipv6: derp.server.ipv6 }, detected);
      const at = now();
      const writing = mode === "run";

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
      } else if (!writing) {
        // The check reports what a run would write and leaves the configuration
        // file, the snapshots and the audit log exactly as they were.
        outcome = "changed";
      } else if (disposed) {
        // Disposed while the detections were in flight: the write must not
        // start at all, so the run is abandoned instead of persisted.
        return undefined;
      } else {
        snapshotId = await takeSnapshot();
        await options.config.patch(plan.patches);
        await recordAudit(plan);
        reload = await reloadAfterWrite(settings);
        outcome = "changed";
      }

      const run: DerpSyncRun = {
        at: at.toISOString(),
        mode,
        outcome,
        detected,
        candidates,
        changes: plan.changes,
        skipped,
        unchanged: plan.unchanged,
        ...(snapshotId === undefined ? {} : { snapshotId }),
        reload,
      };

      const failure = writing ? derpSyncFailureReason(run) : undefined;
      const settled: DerpSyncRun = {
        ...run,
        ...(failure === undefined ? {} : { failure }),
      };

      // The settings read at the top only decide what this run does. Committing
      // them back would roll back a save the operator made while the run waited
      // on DNS, in memory and then on disk, so the current settings are kept.
      document = { settings: document.settings, last: settled };
      await persist();

      log.info(
        "config",
        "DERP address sync %s: %s (%d change(s), %d skipped)",
        mode,
        outcome,
        plan.changes.length,
        skipped.length,
      );

      await reportToAlerts(settled);

      return settled;
    } catch (error) {
      // Belt and braces: a tick must never surface as an unhandled rejection.
      const run: DerpSyncRun = {
        at: now().toISOString(),
        mode,
        outcome: "failed",
        detected: {},
        candidates: [],
        changes: [],
        skipped: [],
        unchanged: [],
        reload: "not-needed",
        ...(mode === "run" ? { failure: "unexpected" as const } : {}),
        error: errorMessage(error),
      };

      if (disposed) {
        // The service is gone; a failure it can no longer report is not stored.
        return undefined;
      }

      document = { settings: document.settings, last: run };
      await persist();
      log.error("config", "DERP address sync failed: %s", errorMessage(error));

      await reportToAlerts(run);

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

    checkNow() {
      return execute("check", true);
    },

    runNow() {
      return execute("run", true);
    },

    runOnce() {
      return execute("run", false);
    },

    start() {
      // Lazy: startup must not wait on the store, and a disabled sync must cost
      // nothing at all.
      void ensureLoaded()
        .then(() => schedule())
        .catch(() => undefined);
    },

    dispose() {
      // Cancels the timer and abandons any run still in flight: its remaining
      // awaits check this flag before they write anything.
      disposed = true;
      clearTimer();
    },
  };
}
