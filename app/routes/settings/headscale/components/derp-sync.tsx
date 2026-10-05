import { Globe, RefreshCw, Search, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
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
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import {
  DERP_SYNC_INTERVAL_HOURS,
  type DerpSyncCandidateReason,
  type DerpSyncFamilies,
  type DerpSyncFamily,
  type DerpSyncFailureReason,
  type DerpSyncOutcome,
  type DerpSyncReload,
  type DerpSyncRun,
  type DerpSyncSettings,
  type DerpSyncSkipReason,
  type DerpSyncSource,
} from "~/server/derp-sync/types";

import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

/** How a finished run reads at a glance. */
const OUTCOME_KEYS: Record<DerpSyncOutcome, TranslationKey> = {
  changed: "settings.headscale.derp.sync.outcomeChanged",
  unchanged: "settings.headscale.derp.sync.outcomeUnchanged",
  skipped: "settings.headscale.derp.sync.outcomeSkipped",
  failed: "settings.headscale.derp.sync.outcomeFailed",
};

const OUTCOME_TONES: Record<DerpSyncOutcome, SettingsStatusTone> = {
  changed: "ok",
  unchanged: "neutral",
  skipped: "warn",
  failed: "error",
};

/** Why a family was left alone. */
const SKIP_KEYS: Record<DerpSyncSkipReason, TranslationKey> = {
  "family-disabled": "settings.headscale.derp.sync.skipFamilyDisabled",
  "host-missing": "settings.headscale.derp.sync.skipHostMissing",
  "invalid-host": "settings.headscale.derp.sync.skipInvalidHost",
  "lookup-failed": "settings.headscale.derp.sync.skipLookupFailed",
  "no-records": "settings.headscale.derp.sync.skipNoRecords",
  "not-public": "settings.headscale.derp.sync.skipNotPublic",
  "no-host-address": "settings.headscale.derp.sync.skipNoHostAddress",
  "namespace-unavailable": "settings.headscale.derp.sync.skipNamespace",
  "config-not-writable": "settings.headscale.derp.sync.skipConfigNotWritable",
};

/** Where a detected address came from. */
const SOURCE_KEYS: Record<DerpSyncSource, TranslationKey> = {
  dns: "settings.headscale.derp.sync.sourceDns",
  host: "settings.headscale.derp.sync.sourceHost",
  literal: "settings.headscale.derp.sync.sourceLiteral",
  // The external IPv6 echo, which reports what the internet sees rather than
  // what any local interface holds.
  echo: "settings.headscale.derp.sync.sourceEcho",
};

/** Why one candidate was or was not the address the run settled on. */
const CANDIDATE_KEYS: Record<DerpSyncCandidateReason, TranslationKey> = {
  selected: "settings.headscale.derp.sync.candidateSelected",
  "ranked-lower": "settings.headscale.derp.sync.candidateRankedLower",
  temporary: "settings.headscale.derp.sync.candidateTemporary",
  "not-public": "settings.headscale.derp.sync.candidateNotPublic",
  "echo-wins": "settings.headscale.derp.sync.candidateEchoWins",
  excluded: "settings.headscale.derp.sync.candidateExcluded",
};

/** What the write means for the running Headscale. */
const RELOAD_KEYS: Record<DerpSyncReload, TranslationKey> = {
  "not-needed": "settings.headscale.derp.sync.reloadNotNeeded",
  manual: "settings.headscale.derp.sync.reloadManual",
  triggered: "settings.headscale.derp.sync.reloadTriggered",
  failed: "settings.headscale.derp.sync.reloadFailed",
};

/** Why a run counted as failed, and what the operator can do about it. */
const FAILURE_KEYS: Record<DerpSyncFailureReason, TranslationKey> = {
  "detection-unusable": "settings.headscale.derp.sync.failureDetectionUnusable",
  "not-writable": "settings.headscale.derp.sync.failureNotWritable",
  "reload-failed": "settings.headscale.derp.sync.failureReloadFailed",
  unexpected: "settings.headscale.derp.sync.failureUnexpected",
};

/** The external echo configuration, as the loader hands it to the card. */
export interface DerpSyncEchoSettings {
  enabled: boolean;
  url: string;
  defaultUrl: string;
  fallbacks: string[];
}

interface DerpSyncSettingsProps {
  /** The external IPv6 echo the sync consumes; a plain value, no server module. */
  echo: DerpSyncEchoSettings;
  isDisabled: boolean;
  /** The newest run or check, or `undefined` when neither has happened. */
  last: DerpSyncRun | undefined;
  settings: DerpSyncSettings;
}

/**
 * The auto-sync card of the DERP tab.
 *
 * Four forms, never nested: the schedule, the external echo (its own store),
 * Check and Run now. Saving a setting can never trigger a run, a run can never
 * rewrite a setting, and Check can never write anything at all.
 */
export default function DerpSyncSettings({
  echo,
  isDisabled,
  last,
  settings,
}: DerpSyncSettingsProps) {
  const { t, locale } = useI18n();

  const settingsFetcher = useFetcher<HeadscaleSettingsResult>();
  const echoFetcher = useFetcher<HeadscaleSettingsResult>();
  const checkFetcher = useFetcher<HeadscaleSettingsResult>();
  const runFetcher = useFetcher<HeadscaleSettingsResult>();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [intervalHours, setIntervalHours] = useState(String(settings.intervalHours));
  const [families, setFamilies] = useState<DerpSyncFamilies>(settings.families);
  const [autoReload, setAutoReload] = useState(settings.autoReload);
  const [echoEnabled, setEchoEnabled] = useState(echo.enabled);
  const [echoUrl, setEchoUrl] = useState(echo.url);

  const busy = settingsFetcher.state !== "idle";
  const echoBusy = echoFetcher.state !== "idle";
  const checking = checkFetcher.state !== "idle";
  const running = runFetcher.state !== "idle";
  const saved = settingsFetcher.state === "idle" && settingsFetcher.data?.success === true;
  const echoSaved = echoFetcher.state === "idle" && echoFetcher.data?.success === true;
  const error =
    settingsFetcher.data && !settingsFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[settingsFetcher.data.errorCode])
      : undefined;
  const echoError =
    echoFetcher.data && !echoFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[echoFetcher.data.errorCode])
      : undefined;

  // Once an echo save lands, the loader revalidates with the stored (normalized)
  // values, so the form follows the file rather than the text that was typed.
  useEffect(() => {
    if (echoFetcher.state !== "idle") {
      return;
    }

    setEchoEnabled(echo.enabled);
    setEchoUrl(echo.url);
  }, [echo.enabled, echo.url, echoFetcher.state]);

  const familyLabel = (family: DerpSyncFamily) =>
    family === "ipv4"
      ? t("settings.headscale.derp.sync.familyIpv4")
      : t("settings.headscale.derp.sync.familyIpv6");

  const intervalItems = DERP_SYNC_INTERVAL_HOURS.map((hours) => ({
    value: String(hours),
    label: t(`settings.headscale.derp.sync.interval${hours}` as TranslationKey),
  }));

  const familyItems = [
    { value: "both", label: t("settings.headscale.derp.sync.familyBoth") },
    { value: "ipv4", label: t("settings.headscale.derp.sync.familyIpv4") },
    { value: "ipv6", label: t("settings.headscale.derp.sync.familyIpv6") },
  ];

  // The loader sends a plain value, so the two families are listed explicitly
  // rather than by key order.
  const detected =
    last === undefined
      ? []
      : (["ipv4", "ipv6"] as const).flatMap((family) => {
          const value = last.detected[family];
          return value === undefined ? [] : [{ family, value }];
        });

  const candidates = last?.candidates ?? [];
  // A rotating privacy address is the one thing an operator has to act on by
  // hand, so the hint lives right here, next to the address it applies to.
  const temporarySelected = candidates.some(
    (candidate) => candidate.chosen && candidate.temporary === true,
  );

  const outcomeKey =
    last !== undefined && last.mode === "check" && last.outcome === "changed"
      ? "settings.headscale.derp.sync.outcomeWouldChange"
      : last === undefined
        ? undefined
        : OUTCOME_KEYS[last.outcome];

  return (
    <SettingsCollapsible
      description={t("settings.headscale.derp.sync.body")}
      icon={Wifi}
      status={{
        tone: settings.enabled ? "ok" : "neutral",
        label: settings.enabled
          ? t("settings.headscale.statusEnabled")
          : t("settings.headscale.statusDisabled"),
      }}
      title={t("settings.headscale.derp.sync.title")}
    >
      <section className="flex w-full flex-col gap-5">
        <p className="rounded-lg bg-mist-100 p-3 text-sm text-mist-600 dark:bg-mist-800/50 dark:text-mist-300">
          {t("settings.headscale.derp.sync.note")}
        </p>

        <p className="rounded-lg bg-mist-100 p-3 text-sm text-mist-600 dark:bg-mist-800/50 dark:text-mist-300">
          {t("settings.headscale.derp.sync.overrideNote")}
        </p>

        <settingsFetcher.Form className="flex flex-col gap-5" method="post">
          <input name="action_id" type="hidden" value="save_derp_sync" />

          <SettingsField
            description={t("settings.headscale.derp.sync.enabledDescription")}
            label={t("settings.headscale.derp.sync.enabledLabel")}
          >
            <Switch
              checked={enabled}
              disabled={isDisabled || busy}
              label={t("settings.headscale.derp.sync.enabledLabel")}
              onCheckedChange={setEnabled}
            />
          </SettingsField>
          <input name="derp_sync_enabled" type="hidden" value={enabled ? "true" : "false"} />

          <SettingsField
            description={t("settings.headscale.derp.sync.intervalDescription")}
            label={t("settings.headscale.derp.sync.intervalLabel")}
          >
            <Select
              disabled={isDisabled || busy}
              items={intervalItems}
              onValueChange={(value) => setIntervalHours(value ?? intervalHours)}
              value={intervalHours}
            />
          </SettingsField>
          <input name="derp_sync_interval_hours" type="hidden" value={intervalHours} />

          <SettingsField
            description={t("settings.headscale.derp.sync.familiesDescription")}
            label={t("settings.headscale.derp.sync.familiesLabel")}
          >
            <Select
              disabled={isDisabled || busy}
              items={familyItems}
              onValueChange={(value) => setFamilies((value ?? families) as DerpSyncFamilies)}
              value={families}
            />
          </SettingsField>
          <input name="derp_sync_families" type="hidden" value={families} />

          <SettingsField
            description={t("settings.headscale.derp.sync.autoReloadDescription")}
            label={t("settings.headscale.derp.sync.autoReloadLabel")}
          >
            <Switch
              checked={autoReload}
              disabled={isDisabled || busy}
              label={t("settings.headscale.derp.sync.autoReloadLabel")}
              onCheckedChange={setAutoReload}
            />
          </SettingsField>
          <input name="derp_sync_auto_reload" type="hidden" value={autoReload ? "true" : "false"} />

          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          ) : undefined}

          <SettingsActions>
            {saved ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                {t("settings.headscale.saved")}
              </span>
            ) : undefined}
            <Button disabled={isDisabled || busy} type="submit" variant="heavy">
              {t("settings.headscale.derp.sync.save")}
            </Button>
          </SettingsActions>
        </settingsFetcher.Form>

        <echoFetcher.Form
          className="flex flex-col gap-4 rounded-lg border border-mist-200 p-3 dark:border-mist-800"
          method="post"
        >
          <input name="action_id" type="hidden" value="save_host_echo" />

          <div className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4" />
              {t("settings.headscale.derp.sync.echoTitle")}
            </span>
            <span className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.derp.sync.echoBody")}
            </span>
          </div>

          <SettingsField
            description={t("settings.headscale.derp.sync.echoEnabledDescription")}
            label={t("settings.headscale.derp.sync.echoEnabledLabel")}
          >
            <Switch
              checked={echoEnabled}
              disabled={isDisabled || echoBusy}
              label={t("settings.headscale.derp.sync.echoEnabledLabel")}
              onCheckedChange={setEchoEnabled}
            />
          </SettingsField>
          <input name="host_echo_enabled" type="hidden" value={echoEnabled ? "true" : "false"} />

          <SettingsField
            description={t("settings.headscale.derp.sync.echoUrlDescription")}
            label={t("settings.headscale.derp.sync.echoUrlLabel")}
          >
            <Input
              disabled={isDisabled || echoBusy}
              label={t("settings.headscale.derp.sync.echoUrlLabel")}
              labelHidden
              name="host_echo_url"
              onChange={setEchoUrl}
              placeholder={echo.defaultUrl}
              value={echoUrl}
            />
          </SettingsField>

          <p className="rounded-lg bg-mist-100 p-3 text-sm text-mist-600 dark:bg-mist-800/50 dark:text-mist-300">
            {t("settings.headscale.derp.sync.echoNote", { urls: echo.fallbacks.join(", ") })}
          </p>

          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.sync.echoPrivacy")}
          </p>

          {echoError ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {echoError}
            </p>
          ) : undefined}

          <SettingsActions>
            {echoSaved ? (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                {t("settings.headscale.derp.sync.echoSaved")}
              </span>
            ) : undefined}
            <Button disabled={isDisabled || echoBusy} type="submit">
              {t("settings.headscale.derp.sync.echoSave")}
            </Button>
          </SettingsActions>
        </echoFetcher.Form>

        <div className="flex flex-col gap-3 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.sync.buttonsBody")}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <checkFetcher.Form className="flex-1" method="post">
              <input name="action_id" type="hidden" value="check_derp_sync" />
              <Button className="w-full" disabled={isDisabled || checking} type="submit">
                <Search className="mr-1.5 h-4 w-4" />
                {checking
                  ? t("settings.headscale.derp.sync.checking")
                  : t("settings.headscale.derp.sync.checkNow")}
              </Button>
            </checkFetcher.Form>
            <runFetcher.Form className="flex-1" method="post">
              <input name="action_id" type="hidden" value="run_derp_sync" />
              <Button
                className="w-full"
                disabled={isDisabled || running}
                type="submit"
                variant="heavy"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                {running
                  ? t("settings.headscale.derp.sync.running")
                  : t("settings.headscale.derp.sync.runNow")}
              </Button>
            </runFetcher.Form>
          </div>
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.sync.checkNote")}
          </p>
        </div>

        <p className="text-sm text-mist-600 dark:text-mist-400">
          {t("settings.headscale.derp.sync.alertNote")}
        </p>

        <SettingsCollapsible
          description={t("settings.headscale.derp.sync.detectionBody")}
          nested
          status={{
            tone: "neutral",
            label: t("settings.headscale.derp.sync.detectionSummary", {
              count: candidates.length,
            }),
          }}
          title={t("settings.headscale.derp.sync.detectionTitle")}
        >
          {candidates.length === 0 ? (
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.derp.sync.detectionEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {candidates.map((candidate, index) => (
                <li
                  className="font-mono text-xs"
                  key={`${candidate.family}-${candidate.address}-${index}`}
                >
                  {t("settings.headscale.derp.sync.candidateLine", {
                    family: familyLabel(candidate.family),
                    address: candidate.address,
                    source: t(SOURCE_KEYS[candidate.source]),
                    reason: t(CANDIDATE_KEYS[candidate.reason]),
                  })}
                  {candidate.interfaceName === undefined ? "" : ` · ${candidate.interfaceName}`}
                  {candidate.detail === undefined ? "" : ` · ${candidate.detail}`}
                </li>
              ))}
            </ul>
          )}
        </SettingsCollapsible>

        {last === undefined ? (
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.sync.never")}
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-mist-200 p-3 text-sm dark:border-mist-800">
            <div className="flex flex-wrap items-center gap-2">
              <SettingsStatus tone={OUTCOME_TONES[last.outcome]}>
                {t(outcomeKey ?? OUTCOME_KEYS[last.outcome])}
              </SettingsStatus>
              <span className="text-mist-600 dark:text-mist-400">
                {t(
                  last.mode === "check"
                    ? "settings.headscale.derp.sync.lastCheck"
                    : "settings.headscale.derp.sync.lastRun",
                  { at: new Date(last.at).toLocaleString(locale) },
                )}
              </span>
            </div>

            {last.mode === "check" ? (
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("settings.headscale.derp.sync.checkWroteNothing")}
              </p>
            ) : undefined}

            {temporarySelected ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {t("settings.headscale.derp.sync.temporaryHint")}
              </p>
            ) : undefined}

            {last.changes.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {t(
                    last.mode === "check"
                      ? "settings.headscale.derp.sync.wouldChangeTitle"
                      : "settings.headscale.derp.sync.changesTitle",
                  )}
                </span>
                <ul className="flex flex-col gap-0.5">
                  {last.changes.map((change) => (
                    <li className="font-mono text-xs" key={change.family}>
                      {change.from === undefined
                        ? t("settings.headscale.derp.sync.changeAdded", {
                            family: familyLabel(change.family),
                            to: change.to,
                          })
                        : t("settings.headscale.derp.sync.changeLine", {
                            family: familyLabel(change.family),
                            from: change.from,
                            to: change.to,
                          })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined}

            {detected.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {t("settings.headscale.derp.sync.detectedTitle")}
                </span>
                <ul className="flex flex-col gap-0.5">
                  {detected.map(({ family, value }) => (
                    <li className="font-mono text-xs" key={family}>
                      {t("settings.headscale.derp.sync.detectedLine", {
                        family: familyLabel(family),
                        address: value.address,
                        source: t(SOURCE_KEYS[value.source]),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined}

            {last.skipped.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {t("settings.headscale.derp.sync.skippedTitle")}
                </span>
                <ul className="flex flex-col gap-0.5 text-xs text-mist-500 dark:text-mist-400">
                  {last.skipped.map((skip) => (
                    <li key={`${skip.family}-${skip.reason}`}>
                      {t(SKIP_KEYS[skip.reason], { family: familyLabel(skip.family) })}
                      {skip.detail === undefined ? "" : ` · ${skip.detail}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined}

            <p className="text-xs text-mist-500 dark:text-mist-400">
              {t(RELOAD_KEYS[last.reload])}
            </p>

            {last.failure === undefined ? undefined : (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-red-600 dark:text-red-400">
                  {t("settings.headscale.derp.sync.failureTitle")}
                </span>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t(FAILURE_KEYS[last.failure])}
                </p>
                <p className="text-xs text-mist-500 dark:text-mist-400">
                  {t("settings.headscale.derp.sync.failureReported")}
                </p>
              </div>
            )}

            {last.snapshotId === undefined ? undefined : (
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("settings.headscale.derp.sync.snapshotNote", { snapshot: last.snapshotId })}
              </p>
            )}

            {last.error === undefined ? undefined : (
              <p className="text-xs text-red-600 dark:text-red-400">{last.error}</p>
            )}
          </div>
        )}
      </section>
    </SettingsCollapsible>
  );
}
