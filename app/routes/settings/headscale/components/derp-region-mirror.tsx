import {
  Ban,
  ClipboardPaste,
  Gauge,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import { RegionFlag } from "~/components/region-flag";
import Select from "~/components/select";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsField,
  SettingsStatus,
  type SettingsStatusTone,
} from "~/components/settings-nav";
import Switch from "~/components/switch";
import TableList from "~/components/table-list";
import Text from "~/components/text";
import Title from "~/components/title";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import {
  MIRROR_FILE_HINT,
  MIRROR_INTERVAL_HOURS,
  MIRROR_INTERVAL_KEYS,
  MIRROR_LATENCY_NOTICE_KEYS,
  MIRROR_LATENCY_SOURCE_KEYS,
  MIRROR_MAX_SOURCES,
  MIRROR_PROBE_OUTCOME_KEYS,
  MIRROR_PROBE_POLL_MS,
  MIRROR_PROBE_STATUS_ACTION_ID,
  MIRROR_REASON_KEYS,
  MIRROR_RELOAD_KEYS,
  MIRROR_SOURCE_KIND_KEYS,
  formatMirrorLatency,
  isMirrorProbeStale,
  mirrorLatencyNotice,
  mirrorOutcomeKey,
  mirrorRegionLookup,
  mirroredNodeCount,
  previewRegionNumbers,
  recommendedRegionIds,
  regionsBelowLatency,
  sortMirrorRegions,
  storedRegionNumbers,
  withLiveMeasurements,
  type MirrorNumbering,
  type MirrorProbeStatus,
  type MirrorProbeView,
  type MirrorRegionRow,
  type MirrorRun,
  type MirrorSettingsView,
  type MirrorSortMode,
  type MirrorSourceAttemptView,
  type MirrorSourceFailure,
} from "../derp-mirror";
import {
  HEADSCALE_SETTINGS_ERROR_KEYS,
  type HeadscaleSettingsResult,
  type MirrorPathReport,
} from "../error-keys";

/** How a finished run reads at a glance. */
const OUTCOME_TONES: Record<string, SettingsStatusTone> = {
  "settings.headscale.derp.mirror.outcomeChanged": "ok",
  "settings.headscale.derp.mirror.outcomeUnchanged": "neutral",
  "settings.headscale.derp.mirror.outcomeWouldChange": "warn",
  "settings.headscale.derp.mirror.outcomeSkipped": "warn",
  "settings.headscale.derp.mirror.outcomeFailed": "error",
};

/** The three speeds the quick filter offers, in milliseconds. */
const LATENCY_PRESETS = [50, 100, 200] as const;

/**
 * The keyboard ring the region table's own scroll box carries. The table keeps a
 * bounded height so a long official list can never stretch or clip the card, and
 * the box takes focus so the rows that bound hides stay reachable without a
 * pointer.
 */
const REGION_TABLE_RING =
  "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1 dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900";

/**
 * Why the official map could not be read, as the sentence the card prints. The
 * server sends the stable code, so the wording stays here with the rest of the
 * card's text. The same table words every source a run tried and the pasted body
 * it could not read, because those are the same codes.
 */
const FETCH_REASON_KEYS: Record<MirrorSourceFailure, TranslationKey> = {
  timeout: "settings.headscale.derp.mirror.fetchReasonTimeout",
  network: "settings.headscale.derp.mirror.fetchReasonNetwork",
  status: "settings.headscale.derp.mirror.fetchReasonStatus",
  "too-large": "settings.headscale.derp.mirror.fetchReasonTooLarge",
  unreadable: "settings.headscale.derp.mirror.fetchReasonUnreadable",
};

/** A byte count as the card prints it, rounded up so "0 KB" is never a lie. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  const kilobytes = Math.ceil(bytes / 1024);
  return kilobytes >= 1024 ? `${Math.round(kilobytes / 1024)} MB` : `${kilobytes} KB`;
}

interface DerpRegionMirrorProps {
  /**
   * False when the Headplane Agent is not reporting, so nothing is measured:
   * disabled, never synced, or its newest sync failed. The card then says so and
   * points at the Agent settings page.
   */
  agentAvailable: boolean;
  /**
   * Whether Headscale's own configuration file may be written. The mirror keeps
   * everything of its own outside that file, so the card stays usable when it is
   * read-only — but the one step that edits `derp.paths` is then left to the
   * operator, which is what the card says.
   */
  configWritable: boolean;
  isDisabled: boolean;
  /** The newest run or check, or `undefined` when neither has happened yet. */
  last: MirrorRun | undefined;
  /** The order the server's rule produced for the official regions. */
  numbering: MirrorNumbering;
  /**
   * Whether Headscale's `derp.paths` already lists the mirror's target file,
   * resolved the way the server compares a configured path.
   */
  pathListed: boolean;
  /** The entries `derp.paths` lists right now, exactly as they are written. */
  paths: string[];
  /** The newest latency probe this server ran, and how it ended. */
  probe: MirrorProbeView;
  /**
   * The run's state as the page loaded it. The card follows a run it starts by
   * polling, and this is what a card opened in the middle of one starts from.
   */
  probeStatus: MirrorProbeStatus;
  /**
   * How large a pasted body may be, in bytes. Read from the server so the card
   * states the limit the save actually enforces instead of one of its own.
   */
  pasteLimitBytes: number;
  /** Why the official map could not be read, when the last read failed. */
  regionError?: MirrorSourceFailure;
  /**
   * Every source the loader tried, in order, with why each failed. The source
   * that answered is the last entry and carries no reason.
   */
  regionAttempts: MirrorSourceAttemptView[];
  /** The cached official map, already reduced to plain values. */
  regions: MirrorRegionRow[];
  settings: MirrorSettingsView;
}

/**
 * The sources a read tried, one line each. A failed source says why in the same
 * wording the card already uses for an unreadable map, so a blocked endpoint
 * reads as a blocked endpoint rather than as a map with nothing in it.
 */
function SourceAttempts({ attempts }: { attempts: MirrorSourceAttemptView[] }) {
  const { t } = useI18n();
  if (attempts.length === 0) {
    return undefined;
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {attempts.map((attempt, index) => (
        <li className="text-xs text-mist-500 dark:text-mist-400" key={`${attempt.url}:${index}`}>
          {t("settings.headscale.derp.mirror.sourceAttempt", {
            url: attempt.url,
            reason:
              attempt.reason === undefined
                ? t("settings.headscale.derp.mirror.sourceAnswered")
                : t(FETCH_REASON_KEYS[attempt.reason]),
          })}
        </li>
      ))}
    </ul>
  );
}

/** Native checkbox, so it works inside the card's single save form. */
function RegionCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      aria-label={label}
      checked={checked}
      className={cn(
        "h-4 w-4 cursor-pointer rounded border-mist-300 accent-indigo-500",
        "focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
        "dark:border-mist-600 dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
  );
}

/**
 * The newest run, check or renumbering, in the page's usual summary block.
 *
 * The server records a run, not a line-by-line diff: what it settled on is the
 * numbering and whether the file had to be replaced, so that is what this block
 * prints, alongside the reason a run stopped and how the reload went.
 */
function RunSummary({ last, regions }: { last: MirrorRun; regions: MirrorRegionRow[] }) {
  const { t, locale } = useI18n();
  const lookup = mirrorRegionLookup(regions);
  const outcomeKey = mirrorOutcomeKey(last);
  const nodes = mirroredNodeCount(last, regions);

  const assigned = last.mirrored
    .map((officialId) => ({ officialId, number: last.assignment[officialId] }))
    .filter((entry): entry is { officialId: string; number: number } => entry.number !== undefined);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-mist-200 p-3 text-sm dark:border-mist-800">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsStatus tone={OUTCOME_TONES[outcomeKey] ?? "neutral"}>
          {t(outcomeKey)}
        </SettingsStatus>
        <span className="text-mist-600 dark:text-mist-400">
          {t(
            last.mode === "check"
              ? "settings.headscale.derp.mirror.lastCheck"
              : "settings.headscale.derp.mirror.lastRun",
            { at: new Date(last.at).toLocaleString(locale) },
          )}
        </span>
      </div>

      {last.mode === "check" ? (
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t("settings.headscale.derp.mirror.checkWroteNothing")}
        </p>
      ) : undefined}

      <p className="text-mist-600 dark:text-mist-400">
        {t("settings.headscale.derp.mirror.mirroredSummary", {
          regions: last.mirrored.length,
          nodes,
        })}
      </p>

      {last.mirrored.length === 0 ? undefined : (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {last.mirrored.map((officialId) => {
            const row = lookup(officialId);
            return (
              <li className="font-mono text-xs" key={officialId}>
                {row === undefined
                  ? `#${officialId}`
                  : t("settings.headscale.derp.mirror.mirroredRegion", {
                      code: row.code,
                      nodes: row.nodeCount,
                    })}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">
          {t("settings.headscale.derp.mirror.assignmentTitle")}
        </span>
        {assigned.length === 0 ? (
          <p className="text-xs text-mist-500 dark:text-mist-400">
            {t("settings.headscale.derp.mirror.assignmentEmpty")}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {assigned.map((entry) => (
              <li className="font-mono text-xs" key={entry.officialId}>
                {t("settings.headscale.derp.mirror.assignmentLine", {
                  code: lookup(entry.officialId)?.code ?? `#${entry.officialId}`,
                  number: entry.number,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-mist-600 dark:text-mist-400">
        {t(
          last.changed
            ? last.mode === "check"
              ? "settings.headscale.derp.mirror.fileWouldChange"
              : "settings.headscale.derp.mirror.fileChanged"
            : "settings.headscale.derp.mirror.fileUnchanged",
        )}
      </p>

      {last.reason === undefined ? undefined : (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium">
            {t("settings.headscale.derp.mirror.reasonTitle")}
          </span>
          <p className="text-xs text-mist-500 dark:text-mist-400">
            {t(MIRROR_REASON_KEYS[last.reason])}
            {last.detail === undefined ? "" : ` · ${last.detail}`}
          </p>
        </div>
      )}

      {/* Which map this run actually read, and every source it tried before it
          found one. A run that read nothing at all lists the reasons instead of
          leaving the operator to guess which endpoint was blocked. */}
      {last.source === undefined && last.sourceKind === undefined ? undefined : (
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t("settings.headscale.derp.mirror.runSource", {
            source:
              last.sourceKind === "paste"
                ? t(MIRROR_SOURCE_KIND_KEYS.paste)
                : (last.source ?? t(MIRROR_SOURCE_KIND_KEYS[last.sourceKind ?? "custom"])),
          })}
        </p>
      )}

      {last.attempts === undefined || last.attempts.length === 0 ? undefined : (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium">
            {t("settings.headscale.derp.mirror.sourcesTriedTitle")}
          </span>
          <SourceAttempts attempts={last.attempts} />
        </div>
      )}

      <p className="text-xs text-mist-500 dark:text-mist-400">
        {t(MIRROR_RELOAD_KEYS[last.reload])}
      </p>

      {last.error === undefined ? undefined : (
        <p className="font-mono text-xs text-red-600 dark:text-red-400">{last.error}</p>
      )}

      {last.snapshotId === undefined ? undefined : (
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t("settings.headscale.derp.mirror.snapshotNote", { snapshot: last.snapshotId })}
        </p>
      )}
    </div>
  );
}

/**
 * What the server's automatic `derp.paths` step did, next to the path it
 * describes.
 *
 * A path that was already listed prints nothing here — the state chip above
 * already says so. An added entry says the truth about the reload: with the
 * target file on disk the switch follows the other settings actions and says
 * which happened, and when the first run still has to write the file the card
 * says so instead of asking for a reload that could not load anything.
 */
function PathReport({ report }: { report: MirrorPathReport }) {
  const { t } = useI18n();

  if (report.status === "present") {
    return undefined;
  }

  if (report.status === "skipped") {
    const key =
      report.reason === "read-only"
        ? "settings.headscale.derp.mirror.pathSkippedReadOnly"
        : report.reason === "invalid-target"
          ? "settings.headscale.derp.mirror.pathSkippedInvalid"
          : "settings.headscale.derp.mirror.pathSkippedWriteFailed";

    return (
      <p className="text-sm text-amber-700 dark:text-amber-300" role="status">
        {t(key)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5" role="status">
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        {report.fileExists === false
          ? t("settings.headscale.derp.mirror.pathAddedPending", { path: report.path })
          : t("settings.headscale.derp.mirror.pathAdded", { path: report.path })}
      </p>
      {report.fileExists === false ? undefined : (
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t(MIRROR_RELOAD_KEYS[report.reload ?? "manual"])}
        </p>
      )}
      {report.snapshotId === undefined ? undefined : (
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t("settings.headscale.derp.mirror.snapshotNote", { snapshot: report.snapshotId })}
        </p>
      )}
    </div>
  );
}

/**
 * The official region filter card of the DERP tab.
 *
 * The card explains what these regions are before it shows anything else: they
 * are Tailscale's public relays, not the operator's own nodes, and the card can
 * mirror only the ones worth keeping into a local map file that Headscale hands
 * to clients. The table ticks a selection, previews the numbers the server's
 * rule assigns to exactly that selection and persists the whole thing in one
 * save; the selection starts empty, can be cleared at any time and one click can
 * write the ticked regions into the manual region-name mapping.
 * Check, Update now and Renumber are separate forms, so none of them can nest
 * inside the save.
 */
export default function DerpRegionMirror({
  agentAvailable,
  configWritable,
  isDisabled,
  last,
  numbering,
  pasteLimitBytes,
  pathListed,
  paths,
  probe,
  probeStatus,
  regionAttempts,
  regionError,
  regions,
  settings,
}: DerpRegionMirrorProps) {
  const { t, locale } = useI18n();

  const saveFetcher = useFetcher<HeadscaleSettingsResult>();
  const checkFetcher = useFetcher<HeadscaleSettingsResult>();
  const runFetcher = useFetcher<HeadscaleSettingsResult>();
  const reassignFetcher = useFetcher<HeadscaleSettingsResult>();
  const namesFetcher = useFetcher<HeadscaleSettingsResult>();
  const pathFetcher = useFetcher<HeadscaleSettingsResult>();
  const probeFetcher = useFetcher<HeadscaleSettingsResult>();
  const cancelFetcher = useFetcher<HeadscaleSettingsResult>();
  const statusFetcher = useFetcher<HeadscaleSettingsResult>();
  const pasteFetcher = useFetcher<HeadscaleSettingsResult>();
  const clearPasteFetcher = useFetcher<HeadscaleSettingsResult>();
  const revalidator = useRevalidator();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [targetPath, setTargetPath] = useState(settings.targetPath);
  // The source list is an ordered, repeatable field, so it lives as one array of
  // rows in the card and is submitted as one `mirror_source` per row.
  const [sourceUrls, setSourceUrls] = useState<string[]>(() => [...settings.sourceUrls]);
  const [pasteBody, setPasteBody] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [intervalHours, setIntervalHours] = useState(String(settings.intervalHours));
  const [autoReload, setAutoReload] = useState(settings.autoReload);
  // The stored selection is the truth: a fresh install starts with nothing
  // ticked, so mirroring only starts once the operator picks regions.
  const [selected, setSelected] = useState<Set<number>>(() => new Set(settings.selectedIds));
  const [sortMode, setSortMode] = useState<MirrorSortMode>("official");
  const [ceiling, setCeiling] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Which of the three controls last sent a request: the save form, one of the
  // run buttons, or the manual "add to derp.paths" button. Each reports its own
  // outcome, and only the newest one is worth showing, so this keeps them from
  // overwriting each other out of order.
  const [pathAction, setPathAction] = useState<"save" | "run" | "manual">("save");

  // The latency run the card follows. The run itself belongs to the server and
  // outlives every request the page makes, so the card never waits for it: it
  // polls the run's small status while the probes are going and shows what that
  // status has measured so far.
  const [liveProbe, setLiveProbe] = useState<MirrorProbeStatus>(probeStatus);

  // A status is only adopted when it is not older than the run already being
  // followed: a poll still in flight when a new run starts answers with the
  // finished previous run and must not stop the card following the new one.
  const watchedRunRef = useRef<string | undefined>(probeStatus.startedAt);
  const adoptProbeStatus = useCallback((status: MirrorProbeStatus | undefined) => {
    if (status === undefined) {
      return;
    }

    const watched = watchedRunRef.current;
    if (watched !== undefined && status.startedAt !== undefined && status.startedAt < watched) {
      return;
    }

    if (status.startedAt !== undefined) {
      watchedRunRef.current = status.startedAt;
    }

    setLiveProbe(status);
  }, []);

  // Every request that carries a status feeds the same state: the action that
  // started the run, the poll, and the stop control.
  useEffect(() => {
    for (const data of [probeFetcher.data, statusFetcher.data, cancelFetcher.data]) {
      if (data !== undefined && data.success && data.probe !== undefined) {
        adoptProbeStatus(data.probe);
      }
    }
  }, [adoptProbeStatus, cancelFetcher.data, probeFetcher.data, statusFetcher.data]);

  const starting = probeFetcher.state !== "idle";
  const stopping = cancelFetcher.state !== "idle";
  const probing = liveProbe.running || starting || stopping;

  // The fetcher instance is refreshed on every render; the interval reads it
  // through a ref so re-creating it never restarts (and so never starves) the
  // timer.
  const statusFetcherRef = useRef(statusFetcher);
  useEffect(() => {
    statusFetcherRef.current = statusFetcher;
  });

  useEffect(() => {
    if (!probing) {
      return;
    }

    const timer = setInterval(() => {
      const fetcher = statusFetcherRef.current;
      if (fetcher.state !== "idle") {
        // The previous read has not answered yet; never stack requests.
        return;
      }

      const form = new FormData();
      form.set("action_id", MIRROR_PROBE_STATUS_ACTION_ID);
      fetcher.submit(form, { method: "POST" });
    }, MIRROR_PROBE_POLL_MS);

    // Navigating away (or the run finishing) clears the interval, so a closed
    // card never keeps polling.
    return () => clearInterval(timer);
  }, [probing]);

  // The stored measurement only changes when the run finishes, so the page data
  // is refreshed once per run the card watched — which is what makes the stored
  // outcome, the notices and the numbering catch up with what was just measured.
  const watchedToFinishRef = useRef(false);
  useEffect(() => {
    if (liveProbe.running) {
      watchedToFinishRef.current = true;
      return;
    }

    if (!watchedToFinishRef.current || liveProbe.finishedAt === undefined) {
      return;
    }

    watchedToFinishRef.current = false;
    revalidator.revalidate();
  }, [liveProbe, revalidator]);

  // The stored values are the source of truth once a save lands, but a live
  // revalidation that changed nothing must not throw away unsaved ticks, so the
  // serialized settings stand in for "the server really has something else now".
  const savedKey = JSON.stringify([
    settings.enabled,
    settings.targetPath,
    settings.intervalHours,
    settings.autoReload,
    [...settings.selectedIds].toSorted((a, b) => a - b),
    settings.sourceUrls,
  ]);
  const syncedRef = useRef(savedKey);

  useEffect(() => {
    if (saveFetcher.state !== "idle" || syncedRef.current === savedKey) {
      return;
    }

    syncedRef.current = savedKey;
    setEnabled(settings.enabled);
    setTargetPath(settings.targetPath);
    setIntervalHours(String(settings.intervalHours));
    setAutoReload(settings.autoReload);
    setSelected(new Set(settings.selectedIds));
    setSourceUrls([...settings.sourceUrls]);
  }, [
    saveFetcher.state,
    savedKey,
    settings.autoReload,
    settings.enabled,
    settings.intervalHours,
    settings.selectedIds,
    settings.sourceUrls,
    settings.targetPath,
  ]);

  // Selecting is client state: nothing is written until Save, and every region
  // is toggled on its own — no region has a fixed number or a locked tick.
  function toggle(officialId: number, next: boolean) {
    setSelected((previous) => {
      const updated = new Set(previous);
      if (next) {
        updated.add(officialId);
      } else {
        updated.delete(officialId);
      }

      return updated;
    });
  }

  /** Removes every tick, so the next save mirrors nothing at all. */
  function clearSelection() {
    setSelected(new Set());
  }

  const ceilingMs = ceiling.trim() === "" ? undefined : Number(ceiling);
  // What the run in flight has measured so far, laid over the stored values, so
  // the table fills in as the probes answer instead of appearing all at once.
  const liveRegions = liveProbe.regions;
  const liveCount = Object.keys(liveRegions).length;
  const rows = useMemo(
    () =>
      regionsBelowLatency(
        sortMirrorRegions(withLiveMeasurements(regions, liveRegions), sortMode),
        ceilingMs,
      ),
    [ceilingMs, liveRegions, regions, sortMode],
  );
  // The stored numbering is part of the preview: a ticked region the assignment
  // already numbers keeps that number, exactly as the server's rule keeps it.
  const stored = useMemo(() => storedRegionNumbers(regions), [regions]);
  const numbers = useMemo(
    () => previewRegionNumbers(numbering, selected, stored),
    [numbering, selected, stored],
  );
  const latencyNotice = useMemo(
    () => mirrorLatencyNotice(regions, agentAvailable),
    [agentAvailable, regions],
  );
  // The one sentence the newest probe leaves behind, if it has one: a run that
  // found nothing says so plainly instead of leaving measured and reported
  // values looking alike, and a stopped run says it stopped.
  const probeNoticeKey =
    probe.outcome === undefined ? undefined : MIRROR_PROBE_OUTCOME_KEYS[probe.outcome];
  const probeNotice = probeNoticeKey === undefined ? undefined : t(probeNoticeKey);

  const busy = saveFetcher.state !== "idle";
  const checking = checkFetcher.state !== "idle";
  const running = runFetcher.state !== "idle";
  const reassigning = reassignFetcher.state !== "idle";
  const saved = saveFetcher.state === "idle" && saveFetcher.data?.success === true;

  // Each action returns the run it performed, so its result is rendered right
  // where it was started instead of only in the summary at the bottom. The
  // remembered action keeps that result on screen after the fetcher goes idle.
  const [resultAction, setResultAction] = useState<"check" | "run" | "reassign">("check");
  const actionFetcher =
    resultAction === "check" ? checkFetcher : resultAction === "run" ? runFetcher : reassignFetcher;
  const actionRun =
    actionFetcher.data !== undefined && actionFetcher.data.success
      ? actionFetcher.data.mirror
      : undefined;

  const errorFor = (data: HeadscaleSettingsResult | undefined) =>
    data !== undefined && !data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[data.errorCode])
      : undefined;

  const saveError = errorFor(saveFetcher.data);
  const checkError = errorFor(checkFetcher.data);
  const runError = errorFor(runFetcher.data);
  const reassignError = errorFor(reassignFetcher.data);
  const namesError = errorFor(namesFetcher.data);
  // A refused start means a run was already in flight: the card follows that
  // run through the status it is polling, so the busy sentence would only
  // contradict the progress shown right next to it.
  const probeError =
    probeFetcher.data !== undefined &&
    !probeFetcher.data.success &&
    probeFetcher.data.errorCode === "derpMirrorProbeBusy"
      ? undefined
      : errorFor(probeFetcher.data);
  const namesAdded =
    namesFetcher.data !== undefined && namesFetcher.data.success
      ? namesFetcher.data.addedRegionNames
      : undefined;
  const addingNames = namesFetcher.state !== "idle";

  // The pasted map: what the store holds, what the operator is writing right
  // now, and how each request ended. The paste is the one source that outranks
  // every URL, so the card says so wherever it lists sources.
  const paste = settings.paste;
  const pasteLimitLabel = formatBytes(pasteLimitBytes);
  const pasteError = errorFor(pasteFetcher.data);
  const clearPasteError = errorFor(clearPasteFetcher.data);
  const savingPaste = pasteFetcher.state !== "idle";
  const clearingPaste = clearPasteFetcher.state !== "idle";
  // Confirmation for the paste that just landed: the loader's own state decides,
  // so clearing the map takes the message away with it.
  const pasteStored =
    paste !== undefined && pasteFetcher.data !== undefined && pasteFetcher.data.success;
  // Whatever a run would read right now: the pasted map when one is stored,
  // otherwise the resolved URL chain, labelled with where each source comes from.
  const effectiveSources =
    settings.sources
      .map((source) => `${t(MIRROR_SOURCE_KIND_KEYS[source.kind])}: ${source.url}`)
      .join(" · ") || t("settings.headscale.derp.mirror.pathHintNone");
  const sourceSummary =
    paste === undefined
      ? t("settings.headscale.derp.mirror.sourcesEffective", { sources: effectiveSources })
      : t("settings.headscale.derp.mirror.sourcesEffectivePaste");
  const sourcesAreDefault = settings.sourceUrls.length === 0 && paste === undefined;
  const canAddSource = sourceUrls.length < MIRROR_MAX_SOURCES;

  // The manual escape hatch for a configuration Headplane may not write. Its
  // errors are the DERP path action's own codes, localized like every other
  // error on the page.
  const pathError = errorFor(pathFetcher.data);
  const addingPath = pathFetcher.state !== "idle";
  const savePathReport =
    saveFetcher.data !== undefined && saveFetcher.data.success
      ? saveFetcher.data.mirrorPath
      : undefined;
  const runPathReport =
    actionFetcher.data !== undefined && actionFetcher.data.success
      ? actionFetcher.data.mirrorPath
      : undefined;
  // The manual button reports through its own fetcher, so its outcome is the
  // only one on screen after it was used: the automatic reports describe a
  // different attempt at the same list.
  const pathReport =
    pathAction === "manual" ? undefined : pathAction === "save" ? savePathReport : runPathReport;

  // Every failure this card prints, so a collapsed card opens on any of them: the
  // fetcher results it reports right where each action was started, the source
  // read behind the table, and the newest run it shows — a run that failed, or a
  // write that landed but whose reload did not. The refused probe start is not
  // among them: the card follows the run already in flight instead of printing
  // that the machine was busy.
  const cardError =
    [
      saveError,
      checkError,
      runError,
      reassignError,
      namesError,
      probeError,
      liveProbe.error,
      pasteError,
      clearPasteError,
      pathError,
      regionError,
    ].some((message) => message !== undefined) ||
    actionRun?.outcome === "failed" ||
    actionRun?.reload === "failed" ||
    last?.outcome === "failed" ||
    last?.reload === "failed";

  // The hover hint the operator had to guess at before: which path this card is
  // talking about, and everything Headscale's list holds right now.
  const pathHint = t("settings.headscale.derp.mirror.pathHint", {
    path: settings.targetPath,
    paths: paths.length === 0 ? t("settings.headscale.derp.mirror.pathHintNone") : paths.join(", "),
  });

  // The dialog only closes itself once the server accepted the renumbering, so
  // a rejected request keeps the explanation on screen next to the error.
  useEffect(() => {
    if (reassignFetcher.state === "idle" && reassignFetcher.data?.success) {
      setConfirmOpen(false);
    }
  }, [reassignFetcher.state, reassignFetcher.data]);

  // The paste dialog closes on the same rule, and the textarea is emptied then:
  // the stored body is what the card reports from the loader, not from a stale
  // draft the operator would have to clear by hand.
  useEffect(() => {
    if (pasteFetcher.state === "idle" && pasteFetcher.data?.success) {
      setPasteOpen(false);
      setPasteBody("");
    }
  }, [pasteFetcher.state, pasteFetcher.data]);

  const intervalItems = MIRROR_INTERVAL_HOURS.map((hours) => ({
    value: String(hours),
    label: t(MIRROR_INTERVAL_KEYS[hours]),
  }));

  const sortItems = [
    { value: "official", label: t("settings.headscale.derp.mirror.sortOfficial") },
    { value: "latency", label: t("settings.headscale.derp.mirror.sortLatency") },
  ];

  // The fastest three the agent measured; the preset replaces the selection with
  // exactly those regions. The embedded relay is never one of them: the mirror
  // refuses to copy it, so recommending it would only fill a slot the file will
  // not contain.
  function applyRecommended() {
    setSelected(new Set(recommendedRegionIds(regions.filter((region) => !region.embedded))));
  }

  /**
   * Writes every ticked region into the manual region-name mapping, under the
   * number the preview mirrors it as — that number is the region id those
   * regions carry once the mirrored map is the one Headscale hands out. The
   * request goes through a fetcher because the button lives inside the card's
   * one save form, and nothing may nest forms.
   */
  function addRegionNames() {
    const form = new FormData();
    form.set("action_id", "add_mirror_region_names");
    for (const region of regions) {
      const number = numbers.get(region.officialId);
      if (number === undefined) {
        continue;
      }

      form.append("mirror_region_number", String(number));
      form.append("mirror_region_name", region.chineseName);
    }

    namesFetcher.submit(form, { method: "POST" });
  }

  /**
   * The manual half of the `derp.paths` step, kept for the case where the
   * automatic one was skipped: it appends the file the mirror is configured to
   * write through the same action the DERP tab's own path list uses. It goes
   * through a fetcher because the button lives inside the card's one save form,
   * where nothing may nest a second form.
   */
  function addMirrorPath() {
    setPathAction("manual");
    const form = new FormData();
    form.set("action_id", "add_derp_path");
    form.set("path", settings.targetPath);
    pathFetcher.submit(form, { method: "POST" });
  }

  /**
   * Asks the server to measure the official regions from this machine. This is
   * the only thing on the page that dials the official relays, and it goes
   * through a fetcher because the button lives inside the card's one save form,
   * where nothing may nest a second form.
   *
   * The request only *starts* the run: the server answers as soon as the run is
   * under way, because the probes themselves take far longer than a reverse
   * proxy in front of Headplane is willing to wait. The card then follows the
   * run through {@link MIRROR_PROBE_STATUS_ACTION_ID}.
   */
  function probeLatency() {
    const form = new FormData();
    form.set("action_id", "probe_derp_latency");
    probeFetcher.submit(form, { method: "POST" });
  }

  /** Stops the run in progress; the server keeps what it had gathered. */
  function stopProbe() {
    const form = new FormData();
    form.set("action_id", "cancel_derp_latency_probe");
    cancelFetcher.submit(form, { method: "POST" });
  }

  /** Replaces one source row's URL, keeping the row's position in the order. */
  function updateSource(index: number, url: string) {
    setSourceUrls((previous) => previous.map((entry, at) => (at === index ? url : entry)));
  }

  /** Appends an empty row; the save skips a blank one and validates the rest. */
  function addSource() {
    setSourceUrls((previous) =>
      previous.length >= MIRROR_MAX_SOURCES ? previous : [...previous, ""],
    );
  }

  function removeSource(index: number) {
    setSourceUrls((previous) => previous.filter((_, at) => at !== index));
  }

  /**
   * Stores the pasted official map. It goes through a fetcher because the paste
   * dialog is the card's second form and nothing may nest forms; the server
   * validates the body with the reader a fetched one goes through, so nothing is
   * stored that a run could not consume.
   */
  function savePaste() {
    const form = new FormData();
    form.set("action_id", "save_derp_mirror_paste");
    form.set("mirror_paste", pasteBody);
    pasteFetcher.submit(form, { method: "POST" });
  }

  /** Drops the stored body, putting the mirror back on its URL sources. */
  function clearPaste() {
    const form = new FormData();
    form.set("action_id", "clear_derp_mirror_paste");
    clearPasteFetcher.submit(form, { method: "POST" });
  }

  /**
   * Refreshes only a stale measurement when the card is opened. The card mounts
   * when the operator opens it, never on a page load, and a run younger than
   * {@link MIRROR_PROBE_FRESH_MS} is left alone — so opening the card again
   * does not dial the official relays again. A run already in flight is followed
   * rather than restarted, and the guard is the loop breaker: a render after a
   * run finished must not start another one.
   */
  const autoProbeRef = useRef(false);
  useEffect(() => {
    if (autoProbeRef.current || isDisabled || regions.length === 0) {
      return;
    }

    if (liveProbe.running) {
      autoProbeRef.current = true;
      return;
    }

    if (!isMirrorProbeStale(probe, Date.now())) {
      return;
    }

    autoProbeRef.current = true;
    const form = new FormData();
    form.set("action_id", "probe_derp_latency");
    probeFetcher.submit(form, { method: "POST" });
  }, [isDisabled, liveProbe.running, probe, probeFetcher, regions.length]);

  const errorBox = (message: string) => (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      {message}
    </p>
  );

  // An enabled filter whose file Headscale never loads is the one state that
  // outranks the selection count in the card's own chip: the card is collapsed
  // by default, and that is exactly the confusion this reports.
  const pathNeedsAttention = settings.enabled && !pathListed;

  return (
    <SettingsCollapsible
      description={t("settings.headscale.derp.mirror.regionsBody")}
      hasError={cardError}
      icon={Globe}
      status={{
        tone: pathNeedsAttention
          ? "warn"
          : regions.length === 0
            ? "warn"
            : selected.size > 0
              ? "ok"
              : "neutral",
        label: pathNeedsAttention
          ? t("settings.headscale.derp.mirror.pathStateMissing")
          : t("settings.headscale.derp.mirror.selectedSummary", { count: selected.size }),
      }}
      summary={t("settings.headscale.derp.mirror.summary", {
        file: settings.targetPath,
        regions: regions.length,
        selected: selected.size,
      })}
      title={t("settings.headscale.derp.mirror.title")}
    >
      <section className="flex w-full flex-col gap-5">
        <p className="rounded-lg bg-mist-100 p-3 text-sm text-mist-600 dark:bg-mist-800/50 dark:text-mist-300">
          {t("settings.headscale.derp.mirror.intro")}
        </p>

        <saveFetcher.Form className="flex flex-col gap-5" method="post">
          <input name="action_id" type="hidden" value="save_derp_mirror" />
          <input name="mirror_enabled" type="hidden" value={enabled ? "true" : "false"} />
          <input name="mirror_auto_reload" type="hidden" value={autoReload ? "true" : "false"} />
          <input name="mirror_interval_hours" type="hidden" value={intervalHours} />
          {[...selected]
            .toSorted((a, b) => a - b)
            .map((officialId) => (
              <input key={officialId} name="mirror_region" type="hidden" value={officialId} />
            ))}

          {regions.length === 0 ? (
            <div className="flex flex-col gap-1 py-2">
              <p
                className={cn(
                  "text-sm",
                  regionError === undefined ? "opacity-70" : "text-amber-700 dark:text-amber-300",
                )}
              >
                {regionError === undefined
                  ? t("settings.headscale.derp.mirror.regionsEmpty")
                  : t("settings.headscale.derp.mirror.regionsUnreadable", {
                      reason: t(FETCH_REASON_KEYS[regionError]),
                    })}
              </p>
              {regionError === undefined ? undefined : (
                <p className="text-xs text-mist-500 dark:text-mist-400">
                  {t("settings.headscale.derp.mirror.regionsRetry")}
                </p>
              )}
              <SourceAttempts attempts={regionAttempts} />
            </div>
          ) : (
            <>
              {latencyNotice === undefined ? undefined : (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  {t(MIRROR_LATENCY_NOTICE_KEYS[latencyNotice])}
                  {latencyNotice === "agent-unavailable" ? (
                    <>
                      {" "}
                      <Link
                        className="font-medium underline underline-offset-2"
                        to="/settings/agent"
                      >
                        {t("settings.headscale.derp.mirror.agentSettingsLink")}
                      </Link>
                    </>
                  ) : undefined}
                </p>
              )}

              <p className="text-sm text-mist-600 dark:text-mist-400">
                {t("settings.headscale.derp.mirror.numberingNote")}
              </p>
              <p className="text-sm text-mist-600 dark:text-mist-400">
                {settings.rankedAt === undefined
                  ? t("settings.headscale.derp.mirror.rankingNever")
                  : t("settings.headscale.derp.mirror.rankingAt", {
                      at: new Date(settings.rankedAt).toLocaleString(locale),
                    })}
              </p>

              {/* The one measurement this page can take itself. It never runs on
                  a page load: this card mounts only once it is opened, and only
                  a stale measurement is refreshed then. The run happens on the
                  server, so the card only ever starts it, reads its progress and
                  stops it — none of these requests waits for the probes. */}
              <div className="flex flex-col gap-2 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={isDisabled || probing} onClick={probeLatency} type="button">
                    <Gauge className="mr-1.5 h-4 w-4" />
                    {probing
                      ? t("settings.headscale.derp.mirror.probeRunning")
                      : t("settings.headscale.derp.mirror.probe")}
                  </Button>
                  {probing ? (
                    <Button onClick={stopProbe} type="button" variant="ghost">
                      <Ban className="mr-1.5 h-4 w-4" />
                      {t("settings.headscale.derp.mirror.probeStop")}
                    </Button>
                  ) : undefined}
                  <span className="text-xs text-mist-500 dark:text-mist-400">
                    {probe.measuredAt === undefined
                      ? t("settings.headscale.derp.mirror.probeNever")
                      : t("settings.headscale.derp.mirror.probeMeasuredAt", {
                          at: new Date(probe.measuredAt).toLocaleString(locale),
                        })}
                  </span>
                </div>
                {probing ? (
                  // Progress as the probes answer: the rows below fill in with
                  // the same values, so this counts the regions the run in flight
                  // has measured against every region in the table.
                  <p className="text-xs text-mist-500 dark:text-mist-400" role="status">
                    {t("settings.headscale.derp.mirror.probeProgress", {
                      done: liveCount,
                      total: regions.length,
                    })}
                  </p>
                ) : undefined}
                <p className="text-xs text-mist-600 dark:text-mist-400">
                  {t("settings.headscale.derp.mirror.probeNote")}
                </p>
                {probeError === undefined ? undefined : errorBox(probeError)}
                {liveProbe.error === undefined
                  ? undefined
                  : errorBox(t(HEADSCALE_SETTINGS_ERROR_KEYS[liveProbe.error]))}
                {probeNotice === undefined ? undefined : (
                  <p
                    className={cn(
                      "rounded-lg p-2 text-xs",
                      probe.outcome === "empty"
                        ? "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                        : "bg-mist-100 text-mist-600 dark:bg-mist-800/50 dark:text-mist-300",
                    )}
                  >
                    {probeNotice}
                  </p>
                )}
              </div>

              {/* The filter row is one horizontal group: the sort select and the
                  number input each take their label from their own component and
                  print it above the control, so every control in the row keeps
                  the same label, the same gap and the same 38px height, and the
                  preset chips share that one baseline. The filter's help text
                  sits under the row instead of under a single field, where a
                  second line on one item would push every other control out of
                  line with it. */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-end gap-3">
                  <Select
                    className="min-w-40"
                    items={sortItems}
                    label={t("settings.headscale.derp.mirror.sortLabel")}
                    onValueChange={(value) =>
                      setSortMode(value === "latency" ? "latency" : "official")
                    }
                    value={sortMode}
                  />

                  {/* The field's own label is the only visible one: it is wired
                      to the input with htmlFor/id, so the name is not announced
                      twice, and the fixed width keeps the label, the number and
                      the millisecond presets reading as a single control. */}
                  <Input
                    className="w-40"
                    inputMode="numeric"
                    label={t("settings.headscale.derp.mirror.filterLabel")}
                    onChange={setCeiling}
                    placeholder={t("settings.headscale.derp.mirror.filterPlaceholder")}
                    value={ceiling}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {LATENCY_PRESETS.map((preset) => (
                      <Button
                        className="rounded-full px-2.5 py-1 text-xs"
                        key={preset}
                        onClick={() => setCeiling(String(preset))}
                        type="button"
                      >
                        {t("settings.headscale.derp.mirror.filterPreset", { ms: preset })}
                      </Button>
                    ))}
                    <Button
                      disabled={rows.length === 0}
                      onClick={() =>
                        setSelected((previous) => {
                          const updated = new Set(previous);
                          for (const row of rows) {
                            if (row.embedded) {
                              continue;
                            }

                            updated.add(row.officialId);
                          }

                          return updated;
                        })
                      }
                      type="button"
                    >
                      {t("settings.headscale.derp.mirror.selectFiltered")}
                    </Button>
                    <Button disabled={ceiling === ""} onClick={() => setCeiling("")} type="button">
                      {t("settings.headscale.derp.mirror.filterClear")}
                    </Button>
                    <Button onClick={applyRecommended} type="button" variant="ghost">
                      <Sparkles className="h-4 w-4" />
                      {t("settings.headscale.derp.mirror.recommended")}
                    </Button>
                  </div>
                </div>

                <p className="text-sm text-mist-600 dark:text-mist-400">
                  {t("settings.headscale.derp.mirror.filterDescription")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={selected.size === 0} onClick={clearSelection} type="button">
                  {t("settings.headscale.derp.mirror.selectionClear")}
                </Button>
                <Button
                  disabled={isDisabled || addingNames || numbers.size === 0}
                  onClick={addRegionNames}
                  type="button"
                  variant="ghost"
                >
                  <Tags className="h-4 w-4" />
                  {addingNames
                    ? t("settings.headscale.derp.mirror.addingRegionNames")
                    : t("settings.headscale.derp.mirror.addRegionNames")}
                </Button>
                {namesAdded === undefined ? undefined : (
                  <span className="text-sm text-emerald-600 dark:text-emerald-400">
                    {t("settings.headscale.derp.mirror.namesAdded", { count: namesAdded })}
                  </span>
                )}
              </div>
              {namesError === undefined ? undefined : errorBox(namesError)}

              {/* The official list is Tailscale's and can grow, so the table
                  keeps a bounded height and scrolls vertically in place instead
                  of stretching the card: the header row stays pinned, the
                  numbers the operator watches stay in the first column of the
                  row they belong to, and the box itself takes focus so nothing
                  the bound hides is out of reach of a keyboard. The search and
                  filter row, the selection helpers and the actions all stay
                  outside this scroll area. */}
              <TableList
                aria-label={t("settings.headscale.derp.mirror.regionTableLabel")}
                className={cn("max-h-96 min-h-0 overflow-y-auto", REGION_TABLE_RING)}
                role="group"
                tabIndex={0}
              >
                <TableList.Item className="sticky top-0 z-10 bg-white text-xs font-semibold text-mist-600 dark:bg-mist-900 dark:text-mist-400">
                  <span className="w-28">{t("settings.headscale.derp.mirror.columnNumber")}</span>
                  <span className="flex-1">{t("settings.headscale.derp.mirror.columnName")}</span>
                  <span className="w-16">{t("settings.headscale.derp.mirror.columnCode")}</span>
                  <span className="flex-1">
                    {t("settings.headscale.derp.mirror.columnOfficialName")}
                  </span>
                  <span className="w-14 text-right">
                    {t("settings.headscale.derp.mirror.columnNodes")}
                  </span>
                  <span className="w-28 text-right">
                    {t("settings.headscale.derp.mirror.columnLatency")}
                  </span>
                  <span className="w-14 text-right">
                    {t("settings.headscale.derp.mirror.columnSelect")}
                  </span>
                </TableList.Item>

                {rows.map((region) => {
                  const latency = formatMirrorLatency(region.latencyMs);
                  // The embedded relay is never written — Headscale already
                  // publishes it — so it carries no number here either.
                  const number = region.embedded ? undefined : numbers.get(region.officialId);
                  const keepsOther =
                    number !== undefined &&
                    region.storedNumber !== undefined &&
                    region.storedNumber !== number;

                  return (
                    <TableList.Item key={region.officialId}>
                      <span
                        className="w-28 font-mono text-sm"
                        {...(region.embedded
                          ? { title: t("settings.headscale.derp.mirror.embeddedRegion") }
                          : {})}
                      >
                        {number === undefined ? <span className="opacity-50">—</span> : number}
                        {keepsOther ? (
                          <span className="ml-1 text-xs opacity-60">
                            {t("settings.headscale.derp.mirror.currentNumber", {
                              number: region.storedNumber ?? 0,
                            })}
                          </span>
                        ) : undefined}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-x-1.5">
                        <RegionFlag code={region.code} name={region.chineseName} />
                        <span className="min-w-0 truncate text-sm">{region.chineseName}</span>
                      </span>
                      <span className="w-16 font-mono text-xs opacity-80">{region.code}</span>
                      <span className="flex-1 truncate text-sm text-mist-600 dark:text-mist-400">
                        {region.officialName}
                      </span>
                      <span className="w-14 text-right font-mono text-xs">{region.nodeCount}</span>
                      <span className="w-28 text-right font-mono text-xs">
                        {latency === undefined ? (
                          <span className="opacity-60">
                            {t("settings.headscale.derp.mirror.latencyUnknown")}
                          </span>
                        ) : region.latencySource === undefined ? (
                          latency
                        ) : (
                          // The two sources are never confused: the number is
                          // labelled with where it came from, and a measurement
                          // taken here is explained as this server's own path.
                          <span
                            className="flex flex-col items-end leading-tight"
                            title={t(MIRROR_LATENCY_SOURCE_KEYS[region.latencySource])}
                          >
                            <span>{latency}</span>
                            <span className="font-sans text-[10px] opacity-70">
                              {t(MIRROR_LATENCY_SOURCE_KEYS[region.latencySource])}
                            </span>
                          </span>
                        )}
                      </span>
                      <span className="flex w-14 justify-end">
                        <RegionCheckbox
                          checked={selected.has(region.officialId)}
                          disabled={region.embedded}
                          label={
                            region.embedded
                              ? t("settings.headscale.derp.mirror.embeddedRegion")
                              : t("settings.headscale.derp.mirror.selectRegion", {
                                  code: region.code,
                                })
                          }
                          onChange={(next) => toggle(region.officialId, next)}
                        />
                      </span>
                    </TableList.Item>
                  );
                })}
              </TableList>

              <p className="text-sm text-mist-600 dark:text-mist-400">
                {t("settings.headscale.derp.mirror.selectionNote")}
              </p>
            </>
          )}

          <div className="flex flex-col gap-4 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
            <div className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <RefreshCw className="h-4 w-4" />
                {t("settings.headscale.derp.mirror.settingsTitle")}
              </span>
              <span className="text-sm text-mist-600 dark:text-mist-400">
                {t("settings.headscale.derp.mirror.settingsBody")}
              </span>
            </div>

            <SettingsField
              description={t("settings.headscale.derp.mirror.enabledDescription")}
              label={t("settings.headscale.derp.mirror.enabledLabel")}
            >
              <Switch
                checked={enabled}
                disabled={isDisabled || busy}
                label={t("settings.headscale.derp.mirror.enabledLabel")}
                onCheckedChange={setEnabled}
              />
            </SettingsField>
            {enabled || !pathListed ? undefined : (
              // Turning the mirror off never edits `derp.paths`: removing an
              // entry the operator may still be relying on is not this card's
              // job, so the card says the list is left alone.
              <p className="text-sm text-mist-600 dark:text-mist-400">
                {t("settings.headscale.derp.mirror.pathStateDisabledNote")}
              </p>
            )}

            <SettingsField
              description={t("settings.headscale.derp.mirror.pathDescription")}
              label={t("settings.headscale.derp.mirror.pathLabel")}
            >
              <Input
                disabled={isDisabled || busy}
                label={t("settings.headscale.derp.mirror.pathLabel")}
                labelHidden
                name="mirror_path"
                onChange={setTargetPath}
                placeholder={t("settings.headscale.derp.mirror.pathPlaceholder")}
                value={targetPath}
              />
            </SettingsField>
            <p className="rounded-lg bg-mist-100 p-3 text-sm text-mist-600 dark:bg-mist-800/50 dark:text-mist-300">
              {t("settings.headscale.derp.mirror.pathNote", { file: MIRROR_FILE_HINT })}
            </p>

            {/* The map sources, in the order a run tries them. An empty list is
                the built-in chain, which is what every install had before this
                field existed, so the card says which of the two is in use
                instead of leaving an empty box looking unconfigured. */}
            <SettingsField
              description={t("settings.headscale.derp.mirror.sourcesDescription", {
                max: MIRROR_MAX_SOURCES,
              })}
              label={t("settings.headscale.derp.mirror.sourcesLabel")}
            >
              <div className="flex flex-col gap-2">
                {sourceUrls.map((url, index) => (
                  <div className="flex items-end gap-2" key={index}>
                    <Input
                      disabled={isDisabled || busy}
                      label={t("settings.headscale.derp.mirror.sourceRowLabel", {
                        index: index + 1,
                      })}
                      labelHidden
                      name="mirror_source"
                      onChange={(value) => updateSource(index, value)}
                      placeholder={t("settings.headscale.derp.mirror.sourcePlaceholder")}
                      value={url}
                    />
                    <Button
                      disabled={isDisabled || busy}
                      onClick={() => removeSource(index)}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("settings.headscale.derp.mirror.sourceRemove")}
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={isDisabled || busy || !canAddSource}
                    onClick={addSource}
                    type="button"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    {t("settings.headscale.derp.mirror.sourceAdd")}
                  </Button>
                </div>
              </div>
            </SettingsField>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm text-mist-600 dark:text-mist-400" role="status">
                {sourceSummary}
              </p>
              {sourcesAreDefault ? (
                <p className="text-sm text-mist-600 dark:text-mist-400">
                  {t("settings.headscale.derp.mirror.sourcesDefaultInUse")}
                </p>
              ) : undefined}
            </div>

            {/* Whether Headscale actually loads the file this card writes. The
                chip is the state, the line under it explains what that state
                means here, and the hover hint names the expected path and every
                entry the configuration lists right now — which is exactly what
                the operator had to look up by hand before. */}
            <div className="flex flex-col gap-1" title={pathHint}>
              <div className="flex flex-wrap items-center gap-2">
                <SettingsStatus tone={pathListed ? "ok" : "warn"}>
                  {t(
                    pathListed
                      ? "settings.headscale.derp.mirror.pathStateListed"
                      : "settings.headscale.derp.mirror.pathStateMissing",
                  )}
                </SettingsStatus>
                <span className="text-sm text-mist-600 dark:text-mist-400">
                  {pathListed
                    ? t("settings.headscale.derp.mirror.pathStateListedNote")
                    : configWritable
                      ? t("settings.headscale.derp.mirror.pathStateMissingNote")
                      : t("settings.headscale.derp.mirror.pathStateReadOnlyNote", {
                          path: settings.targetPath,
                        })}
                </span>
              </div>

              {/* The manual escape hatch: it stays for the case where the
                  automatic step was skipped. It writes Headscale's own
                  configuration, so it is only offered when that file may be
                  written at all. */}
              {pathListed ? undefined : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={isDisabled || !configWritable || addingPath || busy}
                    onClick={addMirrorPath}
                    type="button"
                    variant="ghost"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    {addingPath
                      ? t("settings.headscale.derp.mirror.pathAdding")
                      : t("settings.headscale.derp.mirror.pathAddTo")}
                  </Button>
                </div>
              )}
              {pathError === undefined ? undefined : errorBox(pathError)}
              {pathReport === undefined ? undefined : <PathReport report={pathReport} />}
            </div>

            <SettingsField
              description={t("settings.headscale.derp.mirror.intervalDescription")}
              label={t("settings.headscale.derp.mirror.intervalLabel")}
            >
              <Select
                disabled={isDisabled || busy}
                items={intervalItems}
                onValueChange={(value) => setIntervalHours(value ?? intervalHours)}
                value={intervalHours}
              />
            </SettingsField>

            <SettingsField
              description={t("settings.headscale.derp.mirror.autoReloadDescription")}
              label={t("settings.headscale.derp.mirror.autoReloadLabel")}
            >
              <Switch
                checked={autoReload}
                disabled={isDisabled || busy}
                label={t("settings.headscale.derp.mirror.autoReloadLabel")}
                onCheckedChange={setAutoReload}
              />
            </SettingsField>
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {t("settings.headscale.derp.mirror.autoReloadWarning")}
            </p>
          </div>

          {saveError === undefined ? undefined : errorBox(saveError)}

          <SettingsActions>
            {saved ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                {t("settings.headscale.saved")}
              </span>
            ) : undefined}
            <Button
              disabled={isDisabled || busy}
              onClick={() => setPathAction("save")}
              type="submit"
              variant="heavy"
            >
              {t("settings.headscale.derp.mirror.save")}
            </Button>
          </SettingsActions>
        </saveFetcher.Form>

        <div className="flex flex-col gap-3 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.mirror.buttonsBody")}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <checkFetcher.Form className="flex-1" method="post">
              <input name="action_id" type="hidden" value="check_derp_mirror" />
              <Button
                className="w-full"
                disabled={isDisabled || checking}
                onClick={() => setResultAction("check")}
                type="submit"
              >
                <Search className="mr-1.5 h-4 w-4" />
                {checking
                  ? t("settings.headscale.derp.mirror.checking")
                  : t("settings.headscale.derp.mirror.check")}
              </Button>
            </checkFetcher.Form>

            <runFetcher.Form className="flex-1" method="post">
              <input name="action_id" type="hidden" value="run_derp_mirror" />
              <Button
                className="w-full"
                disabled={isDisabled || running}
                onClick={() => {
                  setResultAction("run");
                  setPathAction("run");
                }}
                type="submit"
                variant="heavy"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                {running
                  ? t("settings.headscale.derp.mirror.running")
                  : t("settings.headscale.derp.mirror.runNow")}
              </Button>
            </runFetcher.Form>

            <Dialog isOpen={confirmOpen} onOpenChange={setConfirmOpen}>
              <Button disabled={isDisabled || reassigning} type="button">
                <Wand2 className="mr-1.5 h-4 w-4" />
                {reassigning
                  ? t("settings.headscale.derp.mirror.reassigning")
                  : t("settings.headscale.derp.mirror.reassign")}
              </Button>
              <DialogPanel
                isDisabled={isDisabled || reassigning}
                onSubmit={(event) => {
                  // The panel is the only form here; the request goes through the
                  // fetcher so the result can be reported without leaving the card.
                  event.preventDefault();
                  const form = new FormData();
                  form.set("action_id", "reassign_derp_mirror");
                  setResultAction("reassign");
                  setPathAction("run");
                  reassignFetcher.submit(form, { method: "POST" });
                }}
              >
                <Title>{t("settings.headscale.derp.mirror.reassignTitle")}</Title>
                <Text className="mb-2">{t("settings.headscale.derp.mirror.reassignBody")}</Text>
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  {t("settings.headscale.derp.mirror.reassignWarning")}
                </p>
                {reassignError === undefined ? undefined : errorBox(reassignError)}
              </DialogPanel>
            </Dialog>
          </div>
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.mirror.checkNote")}
          </p>
          {checkError === undefined ? undefined : errorBox(checkError)}
          {runError === undefined ? undefined : errorBox(runError)}

          {checking || running || reassigning ? (
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.derp.mirror.working")}
            </p>
          ) : undefined}

          {actionRun === undefined ? undefined : <RunSummary last={actionRun} regions={regions} />}
        </div>

        {/* The last resort for a network no source can be reached from: the
            operator pastes the official map's body. It is stored, not written,
            and every run then uses it instead of dialling anything until it is
            cleared — which is the "until when" this block states. The dialog is
            the card's second form, so it lives outside the save form. */}
        <div className="flex flex-col gap-3 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
          <div className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <ClipboardPaste className="h-4 w-4" />
              {t("settings.headscale.derp.mirror.pasteTitle")}
            </span>
            <span className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.derp.mirror.pasteBody", { size: pasteLimitLabel })}
            </span>
          </div>

          <p
            className={cn(
              "text-sm",
              paste === undefined
                ? "text-mist-600 dark:text-mist-400"
                : "text-amber-700 dark:text-amber-300",
            )}
            role="status"
          >
            {paste === undefined
              ? t("settings.headscale.derp.mirror.pasteNone")
              : t("settings.headscale.derp.mirror.pasteInUse", {
                  regions: paste.regions,
                  at: new Date(paste.at).toLocaleString(locale),
                })}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Dialog isOpen={pasteOpen} onOpenChange={setPasteOpen}>
              <Button disabled={isDisabled} type="button">
                <ClipboardPaste className="mr-1.5 h-4 w-4" />
                {t("settings.headscale.derp.mirror.pasteOpen")}
              </Button>
              <DialogPanel
                isDisabled={isDisabled || savingPaste}
                onSubmit={(event) => {
                  // The body is validated server-side with the reader a fetched
                  // map goes through, so only a usable map is ever stored.
                  event.preventDefault();
                  savePaste();
                }}
              >
                <Title>{t("settings.headscale.derp.mirror.pasteDialogTitle")}</Title>
                <Text className="mb-2">
                  {t("settings.headscale.derp.mirror.pasteDialogBody", { size: pasteLimitLabel })}
                </Text>
                <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="mirror_paste">
                  {t("settings.headscale.derp.mirror.pasteLabel")}
                  <textarea
                    className={cn(
                      "min-h-40 w-full rounded-md px-3 py-2 font-mono text-xs",
                      "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
                      "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
                      "border border-mist-200 bg-white dark:border-mist-800 dark:bg-mist-900",
                    )}
                    id="mirror_paste"
                    onChange={(event) => setPasteBody(event.target.value)}
                    placeholder={t("settings.headscale.derp.mirror.pastePlaceholder")}
                    value={pasteBody}
                  />
                </label>
                {savingPaste ? (
                  <p className="text-sm text-mist-600 dark:text-mist-400">
                    {t("settings.headscale.derp.mirror.pasteSaving")}
                  </p>
                ) : undefined}
                {pasteError === undefined ? undefined : errorBox(pasteError)}
              </DialogPanel>
            </Dialog>

            {paste === undefined ? undefined : (
              <Button
                disabled={isDisabled || clearingPaste}
                onClick={clearPaste}
                type="button"
                variant="ghost"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {clearingPaste
                  ? t("settings.headscale.derp.mirror.pasteClearing")
                  : t("settings.headscale.derp.mirror.pasteClear")}
              </Button>
            )}
          </div>

          {pasteStored ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              {t("settings.headscale.derp.mirror.pasteSaved")}
            </p>
          ) : undefined}
          {clearPasteError === undefined ? undefined : errorBox(clearPasteError)}
        </div>

        <SettingsCollapsible
          description={t("settings.headscale.derp.mirror.lastRunBody")}
          hasError={last !== undefined && (last.outcome === "failed" || last.reload === "failed")}
          icon={RefreshCw}
          nested
          status={{
            tone:
              last === undefined ? "neutral" : (OUTCOME_TONES[mirrorOutcomeKey(last)] ?? "neutral"),
            label:
              last === undefined
                ? t("settings.headscale.derp.mirror.never")
                : t(mirrorOutcomeKey(last)),
          }}
          title={t("settings.headscale.derp.mirror.lastRunTitle")}
        >
          {last === undefined ? (
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.derp.mirror.never")}
            </p>
          ) : (
            <RunSummary last={last} regions={regions} />
          )}
        </SettingsCollapsible>
      </section>
    </SettingsCollapsible>
  );
}
