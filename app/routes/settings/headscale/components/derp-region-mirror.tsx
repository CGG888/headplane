import { Globe, Lock, RefreshCw, Search, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
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
import type { RemoteDerpMapFailure } from "~/server/headscale/derp-map-remote";
import cn from "~/utils/cn";

import {
  MIRROR_FILE_HINT,
  MIRROR_INTERVAL_HOURS,
  MIRROR_INTERVAL_KEYS,
  MIRROR_REASON_KEYS,
  MIRROR_RELOAD_KEYS,
  fixedRegionIds,
  formatMirrorLatency,
  mirrorOutcomeKey,
  mirrorRegionLookup,
  mirroredNodeCount,
  previewRegionNumbers,
  recommendedRegionIds,
  regionsBelowLatency,
  sortMirrorRegions,
  type MirrorNumbering,
  type MirrorRegionRow,
  type MirrorRun,
  type MirrorSettingsView,
  type MirrorSortMode,
} from "../derp-mirror";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

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
 * Why the official map could not be read, as the sentence the card prints. The
 * server sends the stable code, so the wording stays here with the rest of the
 * card's text.
 */
const FETCH_REASON_KEYS: Record<RemoteDerpMapFailure, TranslationKey> = {
  timeout: "settings.headscale.derp.mirror.fetchReasonTimeout",
  network: "settings.headscale.derp.mirror.fetchReasonNetwork",
  status: "settings.headscale.derp.mirror.fetchReasonStatus",
  "too-large": "settings.headscale.derp.mirror.fetchReasonTooLarge",
  unreadable: "settings.headscale.derp.mirror.fetchReasonUnreadable",
};

interface DerpRegionMirrorProps {
  /** False when the Headplane Agent is not running, so nothing is measured. */
  agentEnabled: boolean;
  isDisabled: boolean;
  /** The newest run or check, or `undefined` when neither has happened yet. */
  last: MirrorRun | undefined;
  /** The order and the fixed anchors the server's rule produced. */
  numbering: MirrorNumbering;
  /** Why the official map could not be read, when the last read failed. */
  regionError?: RemoteDerpMapFailure;
  /** The cached official map, already reduced to plain values. */
  regions: MirrorRegionRow[];
  settings: MirrorSettingsView;
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
 * The official region filter card of the DERP tab.
 *
 * The card explains what these regions are before it shows anything else: they
 * are Tailscale's public relays, not the operator's own nodes, and the card can
 * mirror only the ones worth keeping into a local map file that Headscale hands
 * to clients. The table ticks a selection, previews the numbers a fresh ranking
 * assigns and persists the whole thing in one save. Check, Update now and
 * Renumber are separate forms, so none of them can nest inside the save.
 */
export default function DerpRegionMirror({
  agentEnabled,
  isDisabled,
  last,
  numbering,
  regionError,
  regions,
  settings,
}: DerpRegionMirrorProps) {
  const { t, locale } = useI18n();

  const saveFetcher = useFetcher<HeadscaleSettingsResult>();
  const checkFetcher = useFetcher<HeadscaleSettingsResult>();
  const runFetcher = useFetcher<HeadscaleSettingsResult>();
  const reassignFetcher = useFetcher<HeadscaleSettingsResult>();

  const fixedIds = useMemo(() => fixedRegionIds(numbering), [numbering]);
  const fixed = useMemo(() => new Set(fixedIds), [fixedIds]);

  const [enabled, setEnabled] = useState(settings.enabled);
  const [targetPath, setTargetPath] = useState(settings.targetPath);
  const [intervalHours, setIntervalHours] = useState(String(settings.intervalHours));
  const [autoReload, setAutoReload] = useState(settings.autoReload);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set([...fixedIds, ...settings.selectedIds]),
  );
  const [sortMode, setSortMode] = useState<MirrorSortMode>("official");
  const [ceiling, setCeiling] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The stored values are the source of truth once a save lands, but a live
  // revalidation that changed nothing must not throw away unsaved ticks, so the
  // serialized settings stand in for "the server really has something else now".
  const savedKey = JSON.stringify([
    settings.enabled,
    settings.targetPath,
    settings.intervalHours,
    settings.autoReload,
    [...settings.selectedIds].toSorted((a, b) => a - b),
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
    setSelected(new Set([...fixedIds, ...settings.selectedIds]));
  }, [
    fixedIds,
    saveFetcher.state,
    savedKey,
    settings.autoReload,
    settings.enabled,
    settings.intervalHours,
    settings.selectedIds,
    settings.targetPath,
  ]);

  // Selecting is client state: nothing is written until Save. The two pinned
  // regions cannot be removed, because the server always mirrors them.
  function toggle(officialId: number, next: boolean) {
    setSelected((previous) => {
      const updated = new Set(previous);
      if (next) {
        updated.add(officialId);
      } else {
        updated.delete(officialId);
      }

      for (const id of fixedIds) {
        updated.add(id);
      }

      return updated;
    });
  }

  const ceilingMs = ceiling.trim() === "" ? undefined : Number(ceiling);
  const rows = useMemo(
    () => regionsBelowLatency(sortMirrorRegions(regions, sortMode), ceilingMs),
    [ceilingMs, regions, sortMode],
  );
  const numbers = useMemo(() => previewRegionNumbers(numbering, selected), [numbering, selected]);

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

  // The dialog only closes itself once the server accepted the renumbering, so
  // a rejected request keeps the explanation on screen next to the error.
  useEffect(() => {
    if (reassignFetcher.state === "idle" && reassignFetcher.data?.success) {
      setConfirmOpen(false);
    }
  }, [reassignFetcher.state, reassignFetcher.data]);

  const intervalItems = MIRROR_INTERVAL_HOURS.map((hours) => ({
    value: String(hours),
    label: t(MIRROR_INTERVAL_KEYS[hours]),
  }));

  const sortItems = [
    { value: "official", label: t("settings.headscale.derp.mirror.sortOfficial") },
    { value: "latency", label: t("settings.headscale.derp.mirror.sortLatency") },
  ];

  // The fastest three the agent measured; the two pinned regions are always
  // mirrored anyway, so the preset replaces the rest of the selection with them.
  function applyRecommended() {
    setSelected(new Set([...fixedIds, ...recommendedRegionIds(regions)]));
  }

  const errorBox = (message: string) => (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      {message}
    </p>
  );

  return (
    <SettingsCollapsible
      description={t("settings.headscale.derp.mirror.regionsBody")}
      icon={Globe}
      status={{
        tone: regions.length === 0 ? "warn" : selected.size > 0 ? "ok" : "neutral",
        label: t("settings.headscale.derp.mirror.selectedSummary", { count: selected.size }),
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
            </div>
          ) : (
            <>
              {!agentEnabled ? (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  {t("settings.headscale.derp.mirror.agentRequired")}
                </p>
              ) : undefined}

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

              <div className="flex flex-wrap items-end gap-3">
                <SettingsField
                  className="min-w-40"
                  label={t("settings.headscale.derp.mirror.sortLabel")}
                >
                  <Select
                    items={sortItems}
                    onValueChange={(value) =>
                      setSortMode(value === "latency" ? "latency" : "official")
                    }
                    value={sortMode}
                  />
                </SettingsField>

                <SettingsField
                  className="min-w-40"
                  description={t("settings.headscale.derp.mirror.filterDescription")}
                  label={t("settings.headscale.derp.mirror.filterLabel")}
                >
                  <Input
                    inputMode="numeric"
                    label={t("settings.headscale.derp.mirror.filterLabel")}
                    labelHidden
                    onChange={setCeiling}
                    placeholder={t("settings.headscale.derp.mirror.filterPlaceholder")}
                    value={ceiling}
                  />
                </SettingsField>

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

              <TableList>
                <TableList.Item className="text-xs font-semibold opacity-70">
                  <span className="w-28">{t("settings.headscale.derp.mirror.columnNumber")}</span>
                  <span className="flex-1">{t("settings.headscale.derp.mirror.columnName")}</span>
                  <span className="w-16">{t("settings.headscale.derp.mirror.columnCode")}</span>
                  <span className="flex-1">
                    {t("settings.headscale.derp.mirror.columnOfficialName")}
                  </span>
                  <span className="w-14 text-right">
                    {t("settings.headscale.derp.mirror.columnNodes")}
                  </span>
                  <span className="w-24 text-right">
                    {t("settings.headscale.derp.mirror.columnLatency")}
                  </span>
                  <span className="w-14 text-right">
                    {t("settings.headscale.derp.mirror.columnSelect")}
                  </span>
                </TableList.Item>

                {rows.map((region) => {
                  const isFixed = fixed.has(region.officialId);
                  const latency = formatMirrorLatency(region.latencyMs);
                  const number = numbers.get(region.officialId);
                  const keepsOther =
                    number !== undefined &&
                    region.storedNumber !== undefined &&
                    region.storedNumber !== number;

                  return (
                    <TableList.Item key={region.officialId}>
                      <span className="w-28 font-mono text-sm">
                        {number === undefined ? (
                          <span className="opacity-50">—</span>
                        ) : (
                          <>
                            {number}
                            {isFixed ? (
                              <Lock
                                aria-label={t("settings.headscale.derp.mirror.fixedRegion")}
                                className="ml-1 inline h-3 w-3 opacity-50"
                              />
                            ) : undefined}
                          </>
                        )}
                        {keepsOther ? (
                          <span className="ml-1 text-xs opacity-60">
                            {t("settings.headscale.derp.mirror.currentNumber", {
                              number: region.storedNumber ?? 0,
                            })}
                          </span>
                        ) : undefined}
                      </span>
                      <span className="flex-1 truncate text-sm">{region.chineseName}</span>
                      <span className="w-16 font-mono text-xs opacity-80">{region.code}</span>
                      <span className="flex-1 truncate text-sm text-mist-600 dark:text-mist-400">
                        {region.officialName}
                      </span>
                      <span className="w-14 text-right font-mono text-xs">{region.nodeCount}</span>
                      <span className="w-24 text-right font-mono text-xs">
                        {latency === undefined ? (
                          <span className="opacity-60">
                            {t("settings.headscale.derp.mirror.latencyUnknown")}
                          </span>
                        ) : (
                          latency
                        )}
                      </span>
                      <span className="flex w-14 justify-end">
                        <RegionCheckbox
                          checked={selected.has(region.officialId)}
                          disabled={isFixed}
                          label={t("settings.headscale.derp.mirror.selectRegion", {
                            code: region.code,
                          })}
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
            <Button disabled={isDisabled || busy} type="submit" variant="heavy">
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
                onClick={() => setResultAction("run")}
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

        <SettingsCollapsible
          description={t("settings.headscale.derp.mirror.lastRunBody")}
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
