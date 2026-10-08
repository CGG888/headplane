// MARK: Official DERP region mirror service
//
// The background job that maintains a local DERP map file containing only the
// Tailscale official regions the operator selected, renumbered into the 900s.
// The relays stay Tailscale's own: this mirrors and filters the official map so
// a client's relay list is short, in Chinese, and stable, instead of following
// whichever official region a client's own latency probe liked today.
//
// The official map is read through the cached fetcher the DERP cards already use
// (`~/server/headscale/derp-map-remote`), so a mirror run adds no second
// downloader and no new dependency. The generated document is validated with the
// validator the local-map editor uses before anything is written: a map
// Headscale would refuse to load is never left on disk.
//
// Two entry points share one path: `check()` fetches, filters, generates and
// compares and writes nothing at all (no snapshot, no reload, no alert, and no
// change to the stored numbering), while `runNow()` writes what actually changed
// and then follows the reload switch. `reassign()` is the same writing run with
// the stored numbering dropped, which is how an operator re-ranks every region
// by today's measurements.
//
// Safety rails, in the order they apply: the selection must not be empty; the
// target must be an absolute path with no `..` in it; the official map must
// describe at least one selected region; the rendered YAML must pass the schema
// validator; and the file or its directory must be writable. Only then is the
// previous file read, compared, and — when it differs — snapshotted and replaced
// by an atomic temp-plus-rename that keeps the file's mode. Every failure keeps
// the previous file exactly as it was and records a stable reason code; a
// *writing* run that failed is reported through the notification service, which
// dedupes and cools the report down like every other alert.
//
// Lifecycle mirrors the other services on the app context: `start()` returns
// immediately and schedules nothing while the mirror is disabled, and `dispose()`
// clears the timer on shutdown or HMR reload. A tick is guarded against overlap
// and against throwing.
//
// The measuring half of the numbering lives here too. The latency probe dials
// dozens of official nodes across two address families, each with a 1.2s budget
// of its own, so a run can take far longer than anything in front of Headplane
// is willing to wait for; `startLatencyProbe()` therefore starts it as a
// background run of this service and answers at once, `latencyProbeStatus()` is
// the small snapshot the card polls while it goes, and `cancelLatencyProbe()`
// stops it. One run is in flight at a time, and a finished run stores what it
// measured merged over what the store already held, so a run that was stopped
// early cannot drop the regions an earlier one measured.

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { isDerpMapDocument, validateDerpMap } from "~/routes/settings/headscale/derp-map-schema";
import { AUDIT_ACTIONS } from "~/server/audit/actions";
import {
  invalidateDerpData,
  refreshDerpAfterWrite,
  toReloadState,
  type DerpReloadTarget,
} from "~/server/derp-refresh";
import type { Headscale } from "~/server/headscale/api";
import {
  loadRemoteDerpMapOutcome,
  type RemoteDerpMapOptions,
} from "~/server/headscale/derp-map-remote";
import type { SnapshotService } from "~/server/snapshots/service.server";
import type { SnapshotTarget } from "~/server/snapshots/types";
import log from "~/utils/log";

import {
  assignRegionNumbers,
  buildMirrorMap,
  mirrorMapChanged,
  renderMirrorYaml,
} from "./generate";
import {
  locallyMeasuredRegionLatencies,
  mergeLatencyReadings,
  regionLatencyBests,
} from "./latency";
import { probeRegionLatencies, type ProbeTlsAttempt, type ProbeUdpFactory } from "./probe.server";
import {
  derpMirrorIntervalMs,
  normalizeDerpMirrorSettings,
  pruneAssignmentToSelection,
  type DerpMirrorSettings,
} from "./settings";
import {
  OFFICIAL_DERP_MAP_URL as OFFICIAL_MAP_URL,
  readPastedMap,
  resolveMirrorSourceChain,
  type MirrorSource,
  type OfficialMapReport,
} from "./sources";
import { readDerpMirrorDocument, writeDerpMirrorDocument } from "./store";
import type {
  DerpLatencyRegionReading,
  DerpMirrorLatency,
  DerpMirrorMode,
  DerpMirrorPastedMap,
  DerpMirrorProbeOutcome,
  DerpMirrorProbeStart,
  DerpMirrorProbeStatus,
  DerpMirrorReason,
  DerpMirrorReload,
  DerpMirrorRun,
  DerpMirrorSourceAttempt,
  OfficialRegion,
} from "./types";

/** The snapshot reason recorded before a mirror write. */
export const DERP_MIRROR_SNAPSHOT_REASON = "derp-region-mirror";

/**
 * The official map, used when `derp.urls` lists nothing: the operator removed
 * the official URL from Headscale, but the mirror's whole point is Tailscale's
 * public regions, so the official map is what it falls back to. Re-exported from
 * the module that owns the source order, so the service and the page agree.
 */
export const OFFICIAL_DERP_MAP_URL = OFFICIAL_MAP_URL;

/** How long a fetched official map may be reused, as the fetcher needs it. */
export interface DerpMirrorCacheSettings {
  /** `derp.auto_update_enabled`. */
  autoUpdateEnabled: boolean;
  /** `derp.update_frequency`, a Go duration such as `3h`. */
  updateFrequency: string;
}

/** The Headscale configuration surface the service reads. */
export interface DerpMirrorConfigPort {
  getDERPSettings(): DerpMirrorCacheSettings & {
    /** `derp.urls`: the remote maps Headscale merges, the official one by default. */
    urls: string[];
  };
}

/** The reload/restart integration, as the service needs it. */
export type DerpMirrorReloadPort = DerpReloadTarget;

/** The audit sink, as the service needs it. */
export interface DerpMirrorAuditPort {
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
 * The notification sink, as the service needs it. The mirror reports through the
 * alert service's existing DERP transition instead of a new event id: the event
 * catalogue is compiled into the notifications card's label map, so a new id
 * would have to be added there and to every locale. The reason code carries the
 * mirror's own identity (`derp-region-mirror:<code>`), which is what the webhook
 * body shows.
 */
export interface DerpMirrorAlertPort {
  reportDerpSync(input: { failed: boolean; reason?: string }): Promise<unknown>;
}

export interface DerpMirrorServiceOptions {
  /** Headplane's `server.data_path`; the JSON store lives directly inside it. */
  dataPath: string;
  config: DerpMirrorConfigPort;
  /** The exact file a write may snapshot; the mirror target. */
  snapshots?: SnapshotService;
  audit?: DerpMirrorAuditPort;
  /** The notification service; a failing writing run is reported through it. */
  alerts?: DerpMirrorAlertPort;
  headscale: Headscale;
  integration?: DerpMirrorReloadPort;
  /**
   * The official map, by default through the shared cached fetcher. Resolves to
   * the first source that yielded a usable map, with every source it tried and
   * why each of the others failed; a report with no regions means nothing
   * answered.
   */
  loadOfficialRegions?: (
    sources: readonly MirrorSource[],
    cache: DerpMirrorCacheSettings,
  ) => Promise<OfficialMapReport>;
  /** Measured latency per official region id, in milliseconds. */
  loadLatencies?: () => Promise<Record<string, number>>;
  /**
   * Test seams for the background latency probe: its sockets, its clocks and
   * its budgets. Production passes none, so the run dials the official relays
   * through the default implementation; a unit test injects fakes and never
   * touches the network.
   */
  probe?: DerpMirrorProbeSeams;
  /** Injectable clock, for tests. */
  now?: () => Date;
  /** Test hook: overrides the interval the settings would schedule. */
  intervalMs?: number;
}

/** How the background latency run may be steered, for tests. */
export interface DerpMirrorProbeSeams {
  /** The budget of one attempt, in milliseconds. */
  timeoutMs?: number;
  /** The budget of the whole run, in milliseconds. */
  overallTimeoutMs?: number;
  /** How many attempts may run at once. */
  concurrency?: number;
  /** Read the monotonic clock the probe times with. */
  now?: () => number;
  /** Read the wall clock the stored measurement is dated by. */
  wallClock?: () => Date;
  /** Open a UDP socket instead of the real one. */
  udp?: ProbeUdpFactory;
  /** Time a TCP/TLS handshake instead of the real one. */
  tcp?: ProbeTlsAttempt;
}

export interface DerpMirrorUpdateResult {
  success: boolean;
  settings: DerpMirrorSettings;
}

export interface DerpMirrorService {
  /** Reads the store once, so loaders can render the persisted settings. */
  ready(): Promise<void>;
  settings(): DerpMirrorSettings;
  /** The newest run, as the store holds it; `undefined` before the first run. */
  last(): DerpMirrorRun | undefined;
  update(patch: Partial<DerpMirrorSettings>): Promise<DerpMirrorUpdateResult>;
  /** A dry run: fetch, filter, generate, compare — and write nothing. */
  check(): Promise<DerpMirrorRun | undefined>;
  /** A writing run: replace the file when the rendered map differs. */
  runNow(): Promise<DerpMirrorRun | undefined>;
  /** A writing run that drops the stored numbering and ranks every region again. */
  reassign(): Promise<DerpMirrorRun | undefined>;
  /**
   * Starts the latency probe as a background run of this service and answers at
   * once. The run outlives the request that asked for it, so no HTTP request —
   * and no reverse proxy in front of Headplane — ever waits for the probes;
   * `started` is false when a run was already in flight.
   */
  startLatencyProbe(): DerpMirrorProbeStart;
  /** The run in flight, or the newest finished one, as plain values. */
  latencyProbeStatus(): DerpMirrorProbeStatus;
  /** Stops the run in flight and keeps what it measured; false when there was none. */
  cancelLatencyProbe(): boolean;
  start(): void;
  dispose(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why a finished run counts as failed. A run that only found nothing to change
 * carries no reason and is not a failure; every skip a run recorded, and a
 * reload that did not happen, are.
 */
export function derpMirrorFailureReason(run: DerpMirrorRun): DerpMirrorReason | undefined {
  if (run.outcome === "failed") {
    return run.reason ?? "unexpected";
  }

  if (run.reload === "failed") {
    return "reload-failed";
  }

  return run.reason;
}

/** How the target path is unsafe to write, as the code the card localizes. */
export function mirrorTargetProblem(targetPath: string): DerpMirrorReason | undefined {
  const trimmed = targetPath.trim();
  if (trimmed.length === 0 || !isAbsolute(trimmed)) {
    return "target-relative";
  }

  // A `..` segment would climb out of the directory the operator pointed at, so
  // it is refused even though the path is absolute.
  return trimmed.split(/[\\/]+/).includes("..") ? "target-unsafe" : undefined;
}

/**
 * The official map through the shared cached fetcher, one source after another.
 *
 * The first source that answers with a usable map wins and becomes the run's
 * recorded source; every source before it is remembered with the reason it
 * contributed nothing, so a blocked endpoint is visible as a blocked endpoint
 * instead of as an empty map. A source list that names nothing falls back to the
 * official address, which is what an unconfigured install has always fetched.
 * Every URL is dialled at most once per cache window, because the fetcher is the
 * same process-wide cache the DERP cards read through.
 */
export async function loadOfficialRegionsReport(
  sources: readonly MirrorSource[],
  cache: DerpMirrorCacheSettings,
  remote: RemoteDerpMapOptions = {},
): Promise<OfficialMapReport> {
  const targets: MirrorSource[] =
    sources.length > 0 ? [...sources] : [{ url: OFFICIAL_MAP_URL, kind: "official" }];

  const attempts: DerpMirrorSourceAttempt[] = [];
  for (const source of targets) {
    const outcome = await loadRemoteDerpMapOutcome(source.url, cache, remote);
    if (outcome.regions !== undefined && outcome.regions.length > 0) {
      attempts.push({ url: source.url });
      return {
        regions: outcome.regions,
        source: source.url,
        sourceKind: source.kind,
        attempts,
      };
    }

    attempts.push({ url: source.url, reason: outcome.reason ?? "unreadable" });
  }

  return { attempts };
}

/**
 * The narrower answer the older callers use: just the regions, or undefined when
 * no source was usable. Kept so a caller that only needs a map does not have to
 * read a report.
 */
export async function loadOfficialRegions(
  urls: string[],
  cache: DerpMirrorCacheSettings,
  remote: RemoteDerpMapOptions = {},
): Promise<OfficialRegion[] | undefined> {
  const sources: MirrorSource[] = urls.map((url) => ({ url, kind: "custom" }));
  return (await loadOfficialRegionsReport(sources, cache, remote)).regions;
}

/** The assignment a finished run settled on, if it differs from the stored one. */
interface SettledAssignment {
  assignment: Record<string, number>;
  assignmentRankedAt?: string;
}

/**
 * The latency run in flight, or the newest finished one. It is deliberately not
 * part of the store: it is what the card polls while the probes are still going,
 * and the store only ever holds the record a finished run settled on.
 */
interface LatencyRun {
  /** Aborts this run, and only this run. */
  controller: AbortController;
  startedAt: string;
  finishedAt?: string;
  total: number;
  completed: number;
  measured: number;
  /** What the run has measured so far, in completion order. */
  readings: DerpLatencyRegionReading[];
  outcome?: DerpMirrorProbeOutcome;
  error?: DerpMirrorProbeStatus["error"];
}

export function createDerpMirrorService(options: DerpMirrorServiceOptions): DerpMirrorService {
  let settings = normalizeDerpMirrorSettings(undefined);
  let last: DerpMirrorRun | undefined;
  let loadPromise: Promise<void> | undefined;
  let writeChain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let disposed = false;
  let latencyRun: LatencyRun | undefined;

  const now = () => options.now?.() ?? new Date();
  const loadRegions = options.loadOfficialRegions ?? loadOfficialRegionsReport;
  const loadLatencies = options.loadLatencies ?? (async () => ({}));

  /**
   * The official map this run reads: the operator's pasted body when one is
   * stored — no source is dialled at all then — otherwise the resolved source
   * chain through the shared cached fetcher. Never throws: a source list that
   * cannot be read is reported the way a failed fetch is, so the run records the
   * reasons and keeps the previous file.
   */
  async function readOfficialMap(current: DerpMirrorSettings): Promise<OfficialMapReport> {
    if (current.pastedMap !== undefined) {
      return readPastedMap(current.pastedMap);
    }

    // Read outside the guard: a configuration that cannot answer at all is an
    // unexpected failure, exactly as it was before sources existed.
    const derp = options.config.getDERPSettings();
    const chain = resolveMirrorSourceChain(current, derp.urls);
    try {
      return await loadRegions(chain, {
        autoUpdateEnabled: derp.autoUpdateEnabled,
        updateFrequency: derp.updateFrequency,
      });
    } catch (error) {
      log.debug("config", `The official DERP map could not be read: ${errorMessage(error)}`);
      return {
        attempts: chain.map((source) => ({ url: source.url, reason: "network" as const })),
      };
    }
  }

  /** The source a report names, as the fields a run stores about it. */
  function sourceFields(
    report: OfficialMapReport,
    pasted: DerpMirrorPastedMap | undefined,
  ): Pick<DerpMirrorRun, "source" | "sourceKind" | "pastedAt" | "attempts"> {
    return {
      ...(report.source === undefined ? {} : { source: report.source }),
      ...(report.sourceKind === undefined ? {} : { sourceKind: report.sourceKind }),
      ...(pasted === undefined ? {} : { pastedAt: pasted.at }),
      ...(report.attempts.length === 0 ? {} : { attempts: report.attempts }),
    };
  }

  function ensureLoaded(): Promise<void> {
    loadPromise ??= readDerpMirrorDocument(options.dataPath)
      .then((document) => {
        settings = document.settings;
        last = document.last;
      })
      .catch(() => undefined);
    return loadPromise;
  }

  /**
   * Persists the newest run, and the assignment it settled on when it ranked
   * one. The document is re-read first so a settings save the operator made
   * while the run was in flight is not rolled back; only the fields this run owns
   * are written over it. A failure here never fails the run — the map file is
   * already right — it is only logged.
   */
  function persistRun(run: DerpMirrorRun, next: DerpMirrorSettings): Promise<void> {
    writeChain = writeChain.then(async () => {
      try {
        const current = await readDerpMirrorDocument(options.dataPath);
        const merged: DerpMirrorSettings = {
          ...current.settings,
          assignment: next.assignment,
          // Keep the timestamp the numbering was actually ranked at: a kept
          // assignment does not produce a new one.
          ...(next.assignmentRankedAt === undefined
            ? current.settings.assignmentRankedAt === undefined
              ? {}
              : { assignmentRankedAt: current.settings.assignmentRankedAt }
            : { assignmentRankedAt: next.assignmentRankedAt }),
        };

        await writeDerpMirrorDocument(options.dataPath, { settings: merged, last: run });
        settings = merged;
        last = run;
      } catch (error) {
        log.warn("config", "Unable to save the DERP region mirror run: %s", errorMessage(error));
      }
    });

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
    if (disposed || !settings.enabled) {
      // The inert state: nothing is scheduled and nothing is fetched.
      return;
    }

    timer = setInterval(
      () => {
        void execute("run", false, false);
      },
      options.intervalMs ?? derpMirrorIntervalMs(settings.intervalHours),
    );

    // The HTTP server keeps the process alive; the mirror never should.
    timer.unref?.();
  }

  /**
   * Whether the target may be written. An existing file decides on its own: a
   * read-only file is refused even when its directory is writable, because the
   * rename that replaces it would fail on Windows and would silently drop the
   * permissions on any platform. Only a target that does not exist yet falls
   * back to the directory it would be created in.
   */
  async function isWritable(targetPath: string): Promise<boolean> {
    try {
      const info = await stat(targetPath);
      if (!info.isFile()) {
        return false;
      }

      await access(targetPath, constants.W_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return false;
      }
    }

    try {
      await access(dirname(targetPath), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** The mode the target already has, so its replacement keeps it. */
  async function targetMode(targetPath: string): Promise<number | undefined> {
    try {
      const info = await stat(targetPath);
      return info.isFile() ? info.mode & 0o777 : undefined;
    } catch {
      return undefined;
    }
  }

  /** The current contents, or undefined when there is no readable file yet. */
  async function readTarget(targetPath: string): Promise<string | undefined> {
    try {
      return await readFile(targetPath, "utf8");
    } catch {
      return undefined;
    }
  }

  /**
   * Replaces the file atomically: the new map is written next to it under a
   * temporary name, given the mode the file already had, and renamed into place.
   * A crash therefore leaves either the old map or the new one, never half of
   * either.
   */
  async function writeTarget(targetPath: string, content: string, mode?: number): Promise<void> {
    await mkdir(dirname(targetPath), { recursive: true });
    const temp = `${targetPath}.${randomUUID()}.tmp`;

    try {
      await writeFile(
        temp,
        content,
        mode === undefined
          ? { encoding: "utf8", flag: "wx" }
          : { encoding: "utf8", flag: "wx", mode },
      );
      if (mode !== undefined) {
        // `writeFile`'s mode is masked by the umask; the operator's file keeps
        // exactly the permissions it had.
        await chmod(temp, mode);
      }

      await rename(temp, targetPath);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Snapshots the single file about to be replaced. A missing snapshot service
   * only means the deployment keeps no snapshots; a failure, on the other hand,
   * is thrown to the caller, which refuses the write — the snapshot is the only
   * way back from a mirror that replaced the wrong file.
   */
  async function takeSnapshot(target: SnapshotTarget): Promise<string | undefined> {
    if (options.snapshots === undefined) {
      return undefined;
    }

    const snapshot = await options.snapshots.take(DERP_MIRROR_SNAPSHOT_REASON, [target]);
    return snapshot.id;
  }

  /** Records the write; the audit store swallows its own failures. */
  async function recordAudit(run: DerpMirrorRun, nodes: number): Promise<void> {
    if (options.audit === undefined) {
      return;
    }

    try {
      await options.audit.record({
        actor: "system",
        actorType: "system",
        action: AUDIT_ACTIONS.derpRegionMirror,
        target: run.targetPath,
        detail: `${run.mirrored.length} region(s), ${nodes} node(s)`,
        result: "success",
      });
    } catch (error) {
      log.warn("server", "Unable to record the DERP region mirror: %s", errorMessage(error));
    }
  }

  /**
   * Whether Headscale has to be reloaded, and whether this run already did it.
   * The integration only runs while the reload switch is on: reloading Headscale
   * briefly interrupts every connected client.
   */
  async function reloadAfterWrite(): Promise<DerpMirrorReload> {
    if (options.integration === undefined || !settings.autoReload) {
      // Nothing pushes the file to Headscale, but every page that already parsed
      // it must stop showing the regions from before this run.
      invalidateDerpData();
      return "manual";
    }

    // The run wrote the file Headscale loads, so this is the file-content class:
    // Headscale's own updater covers it, and a deployment that cannot reload
    // says so instead of reporting the change as live.
    const result = await refreshDerpAfterWrite({
      headscale: options.headscale,
      integration: options.integration,
      changeKind: "map-file",
      reason: "derp_mirror_run",
    });

    return toReloadState(result.outcome);
  }

  /**
   * Reports one finished writing run. Only a failure is reported: a check is
   * interactive and shows its own result, and a run that found nothing to change
   * is not a failure. Never throws.
   */
  async function reportToAlerts(run: DerpMirrorRun): Promise<void> {
    if (options.alerts === undefined || run.mode !== "run") {
      return;
    }

    const reason = derpMirrorFailureReason(run);
    try {
      await options.alerts.reportDerpSync({
        failed: reason !== undefined,
        ...(reason === undefined ? {} : { reason: `derp-region-mirror:${reason}` }),
      });
    } catch (error) {
      log.warn(
        "server",
        "Unable to report the DERP region mirror result to the notifier: %s",
        errorMessage(error),
      );
    }
  }

  /**
   * Stores the run as the newest one, then reports it, then returns it.
   *
   * A `check` is a preview: it reports what a run would do and writes nothing
   * at all, so it neither stores a run nor changes the remembered assignment.
   * A disposed service abandons its in-flight run the same way.
   */
  async function finish(
    run: DerpMirrorRun,
    next?: SettledAssignment,
    writeAssignment = true,
  ): Promise<DerpMirrorRun> {
    if (run.mode !== "run" || disposed) {
      return run;
    }

    const rankedAt = writeAssignment ? next?.assignmentRankedAt : undefined;
    await persistRun(run, {
      ...settings,
      assignment: writeAssignment ? (next?.assignment ?? run.assignment) : settings.assignment,
      ...(rankedAt === undefined ? {} : { assignmentRankedAt: rankedAt }),
    });

    log.info(
      "config",
      "DERP region mirror run: %s (%d region(s))%s",
      run.outcome,
      run.mirrored.length,
      run.reason === undefined ? "" : ` reason=${run.reason}`,
    );

    await reportToAlerts(run);
    return run;
  }

  async function execute(
    mode: DerpMirrorMode,
    manual: boolean,
    forceRerank: boolean,
  ): Promise<DerpMirrorRun | undefined> {
    if (ticking) {
      // Overlap guard: a slow fetch must not stack a second writer on top of
      // the first one.
      return undefined;
    }

    ticking = true;
    try {
      await ensureLoaded();
      if (disposed) {
        // Disposal abandons the run: once the service is gone, nothing may
        // snapshot the target, replace the map, write an audit row or persist
        // state.
        return undefined;
      }

      const current = settings;
      if (!manual && !current.enabled) {
        return undefined;
      }

      const targetPath = resolve(current.targetPath);
      // Everything but the outcome is known up front, so every exit path writes
      // the same shape to the store.
      const base: Omit<DerpMirrorRun, "outcome"> = {
        at: now().toISOString(),
        mode,
        selected: [...current.officialRegionIds],
        mirrored: [],
        assignment: { ...current.assignment },
        targetPath,
        changed: false,
        reload: "not-needed",
      };

      // 1. The selection decides whether there is anything to mirror at all.
      if (current.officialRegionIds.length === 0) {
        return await finish({ ...base, outcome: "skipped", reason: "selection-empty" });
      }

      // 2. Only a path the operator mounted may be written: absolute, and with
      //    no parent traversal that would climb out of the directory behind it.
      const targetReason = mirrorTargetProblem(current.targetPath);
      if (targetReason !== undefined) {
        return await finish({
          ...base,
          outcome: "skipped",
          reason: targetReason,
          detail: current.targetPath,
        });
      }

      // 3. The official map: a pasted body when one is stored, otherwise the
      //    resolved source chain through the shared cached fetcher.
      const report = await readOfficialMap(current);
      const regions = report.regions;
      const sources = sourceFields(report, current.pastedMap);

      if (regions === undefined || regions.length === 0) {
        return await finish({
          ...base,
          ...sources,
          outcome: "skipped",
          reason: "fetch-unusable",
        });
      }

      // 4. Only regions the fetched map actually describes can be mirrored.
      const available = regions.map((region) => String(region.regionId));
      const mirrored = current.officialRegionIds.filter((id) => available.includes(id));
      if (mirrored.length === 0) {
        return await finish({
          ...base,
          ...sources,
          outcome: "skipped",
          reason: "no-regions",
          detail: current.officialRegionIds.join(", "),
        });
      }

      // 5. Ranking: the stored numbering is kept unless this is a re-rank. The
      //    latencies this server measured itself win over the reported ones, so
      //    a re-rank uses the same values the region filter's table shows.
      let latencies: Record<string, number> = {};
      try {
        latencies = await loadLatencies();
      } catch (error) {
        log.debug("config", `Relay latency could not be read: ${errorMessage(error)}`);
      }

      const numbered = assignRegionNumbers(
        mirrored,
        latencies,
        forceRerank ? undefined : current.assignment,
        locallyMeasuredRegionLatencies(current.latency),
      );

      // A selection larger than the 900s can number would otherwise render a map
      // that quietly leaves regions out, and every client behind them would lose
      // its relay. Refusing to write keeps the file, and says which regions were
      // left over.
      if (numbered.unassigned.length > 0) {
        return await finish({
          ...base,
          ...sources,
          mirrored,
          assignment: numbered.assignment,
          outcome: "skipped",
          reason: "numbering-exhausted",
          detail: numbered.unassigned.join(", "),
        });
      }

      // 6. Render, then validate with the validator the map editor uses: a
      //    document Headscale would refuse is never written.
      const map = buildMirrorMap(regions, numbered.assignment, mirrored);
      const yaml = renderMirrorYaml(map);
      const issues = validateDerpMap(yaml);
      if (issues.length > 0) {
        return await finish({
          ...base,
          ...sources,
          mirrored,
          assignment: numbered.assignment,
          outcome: "skipped",
          reason: "validation-failed",
          detail: issues[0]?.code ?? "unknown",
        });
      }

      // 7. Compare against what is already there. An identical map is left
      //    alone, so the file's modification time is untouched too.
      const previous = await readTarget(targetPath);

      // A path that already holds something other than a DERP map is refused
      // outright. `mirrorMapChanged` counts an unparsable file as a change, so a
      // typo that points the mirror at Headscale's own configuration would
      // otherwise replace that whole file with a map. A DERP map that is merely
      // broken is still repaired: only the document's shape decides this.
      if (previous !== undefined && previous.trim().length > 0 && !isDerpMapDocument(previous)) {
        return await finish({
          ...base,
          ...sources,
          mirrored,
          assignment: numbered.assignment,
          outcome: "skipped",
          reason: "target-not-mirror",
          detail: targetPath,
        });
      }

      const changed = mirrorMapChanged(previous, yaml);
      const settled = { ...base, ...sources, mirrored, assignment: numbered.assignment, changed };

      if (!changed) {
        // The numbering the run settled on is still persisted: a selection that
        // changed while the map happened to render the same keeps its numbers.
        return await finish({ ...settled, outcome: "unchanged" }, numbered, mode === "run");
      }

      if (mode === "check") {
        // A check reports what a run would write and leaves the file, the
        // snapshots, the audit log, the stored numbering and the notifier
        // exactly as they were.
        return await finish({ ...settled, outcome: "changed" }, numbered, false);
      }

      if (!(await isWritable(targetPath))) {
        return await finish({
          ...settled,
          outcome: "skipped",
          reason: "not-writable",
          detail: targetPath,
        });
      }

      if (disposed) {
        // Disposed while the fetches were in flight: the write must not start
        // at all, so the run is abandoned instead of reported as a result.
        return undefined;
      }

      // 8. Snapshot that single file, replace it, record it, then follow the
      //    reload switch. A snapshot that fails stops the write: it is the only
      //    way back from a mirror that replaced the wrong file.
      let snapshotId: string | undefined;
      try {
        snapshotId = await takeSnapshot({ path: targetPath, kind: "derp_map" });
      } catch (error) {
        log.warn(
          "config",
          "Failed to snapshot before mirroring the DERP regions: %s",
          errorMessage(error),
        );
        return await finish({
          ...settled,
          outcome: "skipped",
          reason: "snapshot-failed",
          detail: errorMessage(error),
        });
      }

      await writeTarget(targetPath, yaml, await targetMode(targetPath));

      const written: DerpMirrorRun = {
        ...settled,
        outcome: "changed",
        ...(snapshotId === undefined ? {} : { snapshotId }),
        reload: "not-needed",
      };
      await recordAudit(
        written,
        Object.values(map.regions).reduce((n, r) => n + r.nodes.length, 0),
      );

      const reload = await reloadAfterWrite();
      const finished: DerpMirrorRun = {
        ...written,
        reload,
        ...(reload === "failed" ? { reason: "reload-failed" as const } : {}),
      };

      await persistRun(finished, {
        ...current,
        assignment: numbered.assignment,
        ...(numbered.rankedAt === undefined ? {} : { assignmentRankedAt: numbered.rankedAt }),
      });

      await reportToAlerts(finished);
      return finished;
    } catch (error) {
      // Belt and braces: a tick must never surface as an unhandled rejection.
      const run: DerpMirrorRun = {
        at: now().toISOString(),
        mode,
        outcome: "failed",
        selected: [...settings.officialRegionIds],
        mirrored: [],
        assignment: { ...settings.assignment },
        targetPath: settings.targetPath,
        changed: false,
        reason: "unexpected",
        reload: "not-needed",
        error: errorMessage(error),
      };

      log.error("config", "DERP region mirror failed: %s", errorMessage(error));
      await finish(run, undefined, false);
      return run;
    } finally {
      ticking = false;
    }
  }

  async function updateSettings(
    patch: Partial<DerpMirrorSettings>,
  ): Promise<DerpMirrorUpdateResult> {
    await ensureLoaded();
    const previous = settings;
    const merged = normalizeDerpMirrorSettings({ ...previous, ...patch });

    // A save leaves the stored numbering covering exactly the regions the
    // selection keeps. The server's `assignRegionNumbers` only ever returns
    // the selected regions, so an entry for a region the operator dropped is
    // stale as soon as the selection is saved, and the preview would be the
    // only thing still showing it.
    const next: DerpMirrorSettings = {
      ...merged,
      assignment: pruneAssignmentToSelection(merged.assignment, merged.officialRegionIds),
    };

    // Queued on the chain a run also writes through. A save that wrote the file
    // on its own could land between a finishing run's read and its write, and
    // that run would then save back the settings it had read a moment earlier.
    let failure: unknown;
    writeChain = writeChain.then(async () => {
      try {
        const current = await readDerpMirrorDocument(options.dataPath);
        await writeDerpMirrorDocument(options.dataPath, {
          settings: next,
          ...(current.last === undefined ? {} : { last: current.last }),
        });
        settings = next;
      } catch (error) {
        failure = error;
      }
    });

    await writeChain;
    if (failure !== undefined) {
      log.warn(
        "config",
        "Unable to save the DERP region mirror settings: %s",
        errorMessage(failure),
      );
      return { success: false, settings: previous };
    }

    schedule();
    return { success: true, settings: next };
  }

  // MARK: The latency probe, as a background run

  /**
   * The run in flight, or the newest finished one, as plain values. It never
   * touches the store or the network: this is what the card polls while the
   * probes are still going, and every request it answers is a few in-memory
   * reads, so none of them can come anywhere near a reverse proxy's timeout.
   */
  function latencyProbeStatus(): DerpMirrorProbeStatus {
    return {
      running: latencyRun !== undefined && latencyRun.finishedAt === undefined,
      ...(latencyRun === undefined ? {} : { startedAt: latencyRun.startedAt }),
      ...(latencyRun?.finishedAt === undefined ? {} : { finishedAt: latencyRun.finishedAt }),
      total: latencyRun?.total ?? 0,
      completed: latencyRun?.completed ?? 0,
      measured: latencyRun?.measured ?? 0,
      regions: regionLatencyBests(latencyRun?.readings ?? []),
      ...(latencyRun?.outcome === undefined ? {} : { outcome: latencyRun.outcome }),
      ...(latencyRun?.error === undefined ? {} : { error: latencyRun.error }),
    };
  }

  /**
   * Starts the probe as a background run and returns at once. Only one run is
   * ever in flight: two would fight over the same store and double the traffic
   * the official relays see, and the operator can stop this one instead.
   */
  function startLatencyProbe(): DerpMirrorProbeStart {
    if (latencyRun !== undefined && latencyRun.finishedAt === undefined) {
      return { started: false, status: latencyProbeStatus() };
    }

    const controller = new AbortController();
    latencyRun = {
      controller,
      startedAt: now().toISOString(),
      total: 0,
      completed: 0,
      measured: 0,
      readings: [],
    };

    // Deliberately not awaited: the run belongs to the service, so the request
    // that asked for it answers immediately and the run keeps going without it.
    void executeLatencyProbe(latencyRun);
    return { started: true, status: latencyProbeStatus() };
  }

  /** Stops the run in flight; the run itself still finishes and stores what it had. */
  function cancelLatencyProbe(): boolean {
    if (latencyRun === undefined || latencyRun.finishedAt !== undefined) {
      return false;
    }

    latencyRun.controller.abort();
    return true;
  }

  /**
   * One background latency run: fetch the official map, probe every region and
   * store what came back. Never rejects and never throws — a run that cannot
   * even start probing records a stable code the card localizes, and an
   * unexpected failure is only logged.
   */
  async function executeLatencyProbe(run: LatencyRun): Promise<void> {
    try {
      await ensureLoaded();

      // The same reader a mirror run uses, pasted map included, so the regions
      // measured here are the regions the mirror would hand out.
      const mapReport = await readOfficialMap(settings);
      const regions = mapReport.regions;

      if (regions === undefined || regions.length === 0) {
        // Nothing to probe: the same answer the old in-request path gave, now
        // carried by the run's own status instead of by a failed request.
        run.error = "derpMirrorUnavailable";
        return;
      }

      const seams = options.probe ?? {};
      const report = await probeRegionLatencies(regions, {
        signal: run.controller.signal,
        ...(seams.timeoutMs === undefined ? {} : { timeoutMs: seams.timeoutMs }),
        ...(seams.overallTimeoutMs === undefined
          ? {}
          : { overallTimeoutMs: seams.overallTimeoutMs }),
        ...(seams.concurrency === undefined ? {} : { concurrency: seams.concurrency }),
        ...(seams.now === undefined ? {} : { now: seams.now }),
        ...(seams.udp === undefined ? {} : { udp: seams.udp }),
        ...(seams.tcp === undefined ? {} : { tcp: seams.tcp }),
        wallClock: seams.wallClock ?? now,
        onProgress: (progress) => {
          run.total = progress.total;
          run.completed = progress.completed;
          run.measured = progress.measured;
          run.readings = progress.regions;
        },
      });

      run.total = report.attempted;
      run.completed = report.attempts.length;
      run.measured = report.measured;
      run.readings = report.regions;
      run.outcome = report.outcome;

      // Merged over the stored record: a run that was stopped early, or that
      // ran out of its budget, must not drop what an earlier run measured.
      const latency: DerpMirrorLatency = mergeLatencyReadings(settings.latency, {
        measuredAt: report.measuredAt,
        outcome: report.outcome,
        regions: report.regions,
      });

      if (disposed) {
        // The probe outlived the service that started it; its reading is not
        // stored.
        return;
      }

      const saved = await updateSettings({ latency });
      if (!saved.success) {
        log.warn("config", "Unable to save the DERP latency probe results");
      }

      log.info(
        "config",
        "DERP region latency probe: %s (%d/%d attempts, %d region(s))%s",
        report.outcome,
        report.measured,
        report.attempted,
        report.regions.length,
        report.budgetExhausted ? " budget-exhausted" : "",
      );
    } catch (error) {
      run.error = "derpMirrorProbeFailed";
      log.warn("config", "The DERP latency probe failed: %s", errorMessage(error));
    } finally {
      run.finishedAt = now().toISOString();
    }
  }

  return {
    async ready() {
      await ensureLoaded();
    },

    settings() {
      return settings;
    },

    last() {
      return last;
    },

    update: updateSettings,

    check() {
      return execute("check", true, false);
    },

    runNow() {
      return execute("run", true, false);
    },

    reassign() {
      return execute("run", true, true);
    },

    startLatencyProbe,

    latencyProbeStatus,

    cancelLatencyProbe,

    start() {
      // Lazy: startup must not wait on the store, and a disabled mirror must
      // cost nothing at all.
      void ensureLoaded()
        .then(() => schedule())
        .catch(() => undefined);
    },

    dispose() {
      // Cancels the timer and abandons any run still in flight: the awaited
      // steps that follow check this flag before they write anything.
      disposed = true;
      clearTimer();
      // A latency probe still in flight is cancelled too.
      latencyRun?.controller.abort();
    },
  };
}
