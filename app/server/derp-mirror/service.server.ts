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

import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { validateDerpMap } from "~/routes/settings/headscale/derp-map-schema";
import { AUDIT_ACTIONS } from "~/server/audit/actions";
import type { Headscale } from "~/server/headscale/api";
import {
  loadRemoteDerpMapDetail,
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
  derpMirrorIntervalMs,
  normalizeDerpMirrorSettings,
  pruneAssignmentToSelection,
  type DerpMirrorSettings,
} from "./settings";
import { readDerpMirrorDocument, writeDerpMirrorDocument, writeDerpMirrorSettings } from "./store";
import type {
  DerpMirrorMode,
  DerpMirrorReason,
  DerpMirrorReload,
  DerpMirrorRun,
  OfficialRegion,
} from "./types";

/** The snapshot reason recorded before a mirror write. */
export const DERP_MIRROR_SNAPSHOT_REASON = "derp-region-mirror";

/**
 * The official map, used when `derp.urls` lists nothing: the operator removed
 * the official URL from Headscale, but the mirror's whole point is Tailscale's
 * public regions, so the official map is what it falls back to.
 */
export const OFFICIAL_DERP_MAP_URL = "https://controlplane.tailscale.com/derpmap/default";

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
export interface DerpMirrorReloadPort {
  onConfigChange(headscale: Headscale): Promise<void> | void;
}

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
   * undefined when no configured URL yielded a usable map.
   */
  loadOfficialRegions?: (
    urls: string[],
    cache: DerpMirrorCacheSettings,
  ) => Promise<OfficialRegion[] | undefined>;
  /** Measured latency per official region id, in milliseconds. */
  loadLatencies?: () => Promise<Record<string, number>>;
  /** Injectable clock, for tests. */
  now?: () => Date;
  /** Test hook: overrides the interval the settings would schedule. */
  intervalMs?: number;
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
 * The official map through the shared cached fetcher; the first URL that answers
 * with a usable map wins, and a configuration that lists none falls back to the
 * official one. Every URL is dialled at most once per cache window, because the
 * fetcher is the same process-wide cache the DERP cards read through.
 */
export async function loadOfficialRegions(
  urls: string[],
  cache: DerpMirrorCacheSettings,
  remote: RemoteDerpMapOptions = {},
): Promise<OfficialRegion[] | undefined> {
  const targets = [...new Set(urls.map((url) => url.trim()).filter((url) => url.length > 0))];
  if (targets.length === 0) {
    targets.push(OFFICIAL_DERP_MAP_URL);
  }

  for (const url of targets) {
    const regions = await loadRemoteDerpMapDetail(url, cache, remote);
    if (regions !== undefined && regions.length > 0) {
      return regions;
    }
  }

  return undefined;
}

/** The service's default fetcher: the shared loader, with no test seams. */
function loadOfficialRegionsDefault(
  urls: string[],
  cache: DerpMirrorCacheSettings,
): Promise<OfficialRegion[] | undefined> {
  return loadOfficialRegions(urls, cache);
}

/** The assignment a finished run settled on, if it differs from the stored one. */
interface SettledAssignment {
  assignment: Record<string, number>;
  assignmentRankedAt?: string;
}

export function createDerpMirrorService(options: DerpMirrorServiceOptions): DerpMirrorService {
  let settings = normalizeDerpMirrorSettings(undefined);
  let last: DerpMirrorRun | undefined;
  let loadPromise: Promise<void> | undefined;
  let writeChain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let tempCounter = 0;

  const now = () => options.now?.() ?? new Date();
  const loadRegions = options.loadOfficialRegions ?? loadOfficialRegionsDefault;
  const loadLatencies = options.loadLatencies ?? (async () => ({}));

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
    if (!settings.enabled) {
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
    const temp = `${targetPath}.${process.pid}.${tempCounter++}.tmp`;

    try {
      await writeFile(
        temp,
        content,
        mode === undefined ? { encoding: "utf8" } : { encoding: "utf8", mode },
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

  /** Snapshots the single file about to be replaced; a failure never blocks it. */
  async function takeSnapshot(target: SnapshotTarget): Promise<string | undefined> {
    if (options.snapshots === undefined) {
      return undefined;
    }

    try {
      const snapshot = await options.snapshots.take(DERP_MIRROR_SNAPSHOT_REASON, [target]);
      return snapshot.id;
    } catch (error) {
      log.warn(
        "config",
        "Failed to snapshot before mirroring the DERP regions: %s",
        errorMessage(error),
      );
      return undefined;
    }
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
      return "manual";
    }

    try {
      await options.integration.onConfigChange(options.headscale);
      return "triggered";
    } catch (error) {
      log.warn(
        "config",
        "The DERP region mirror could not reload Headscale: %s",
        errorMessage(error),
      );
      return "failed";
    }
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

  /** Stores the run as the newest one, then reports it, then returns it. */
  async function finish(
    run: DerpMirrorRun,
    next?: SettledAssignment,
    writeAssignment = true,
  ): Promise<DerpMirrorRun> {
    const rankedAt = writeAssignment ? next?.assignmentRankedAt : undefined;
    await persistRun(run, {
      ...settings,
      assignment: writeAssignment ? (next?.assignment ?? run.assignment) : settings.assignment,
      ...(rankedAt === undefined ? {} : { assignmentRankedAt: rankedAt }),
    });

    if (run.mode === "run") {
      log.info(
        "config",
        "DERP region mirror run: %s (%d region(s))%s",
        run.outcome,
        run.mirrored.length,
        run.reason === undefined ? "" : ` reason=${run.reason}`,
      );
    }

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

      // 3. The official map, through the shared cached fetcher.
      const derp = options.config.getDERPSettings();
      let regions: OfficialRegion[] | undefined;
      try {
        regions = await loadRegions(derp.urls, {
          autoUpdateEnabled: derp.autoUpdateEnabled,
          updateFrequency: derp.updateFrequency,
        });
      } catch (error) {
        regions = undefined;
        log.debug("config", `The official DERP map could not be read: ${errorMessage(error)}`);
      }

      if (regions === undefined || regions.length === 0) {
        return await finish({ ...base, outcome: "skipped", reason: "fetch-unusable" });
      }

      // 4. Only regions the fetched map actually describes can be mirrored.
      const available = regions.map((region) => String(region.regionId));
      const mirrored = current.officialRegionIds.filter((id) => available.includes(id));
      if (mirrored.length === 0) {
        return await finish({
          ...base,
          outcome: "skipped",
          reason: "no-regions",
          detail: current.officialRegionIds.join(", "),
        });
      }

      // 5. Ranking: the stored numbering is kept unless this is a re-rank.
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
      );

      // 6. Render, then validate with the validator the map editor uses: a
      //    document Headscale would refuse is never written.
      const map = buildMirrorMap(regions, numbered.assignment, mirrored);
      const yaml = renderMirrorYaml(map);
      const issues = validateDerpMap(yaml);
      if (issues.length > 0) {
        return await finish({
          ...base,
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
      const changed = mirrorMapChanged(previous, yaml);
      const settled = { ...base, mirrored, assignment: numbered.assignment, changed };

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

      // 8. Snapshot that single file, replace it, record it, then follow the
      //    reload switch.
      const snapshotId = await takeSnapshot({ path: targetPath, kind: "derp_map" });
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

    async update(patch) {
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

      try {
        await writeDerpMirrorSettings(options.dataPath, next);
      } catch (error) {
        log.warn(
          "config",
          "Unable to save the DERP region mirror settings: %s",
          errorMessage(error),
        );
        return { success: false, settings: previous };
      }

      settings = next;
      schedule();
      return { success: true, settings: next };
    },

    check() {
      return execute("check", true, false);
    },

    runNow() {
      return execute("run", true, false);
    },

    reassign() {
      return execute("run", true, true);
    },

    start() {
      // Lazy: startup must not wait on the store, and a disabled mirror must
      // cost nothing at all.
      void ensureLoaded()
        .then(() => schedule())
        .catch(() => undefined);
    },

    dispose() {
      clearTimer();
    },
  };
}
