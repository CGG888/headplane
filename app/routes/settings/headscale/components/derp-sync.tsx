import { RefreshCw, Wifi } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
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
  type DerpSyncFamilies,
  type DerpSyncFamily,
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
};

/** What the write means for the running Headscale. */
const RELOAD_KEYS: Record<DerpSyncReload, TranslationKey> = {
  "not-needed": "settings.headscale.derp.sync.reloadNotNeeded",
  manual: "settings.headscale.derp.sync.reloadManual",
  triggered: "settings.headscale.derp.sync.reloadTriggered",
  failed: "settings.headscale.derp.sync.reloadFailed",
};

interface DerpSyncSettingsProps {
  isDisabled: boolean;
  /** The newest run, or `undefined` when the sync has never run. */
  last: DerpSyncRun | undefined;
  settings: DerpSyncSettings;
}

/**
 * The auto-sync card of the DERP tab. The schedule and its "run now" button are
 * separate forms: saving the settings must never be able to trigger a run, and a
 * run must never rewrite the settings. Both post to the Headscale settings
 * action, so the permission and read-only guards apply to them unchanged.
 */
export default function DerpSyncSettings({ isDisabled, last, settings }: DerpSyncSettingsProps) {
  const { t, locale } = useI18n();

  const settingsFetcher = useFetcher<HeadscaleSettingsResult>();
  const runFetcher = useFetcher<HeadscaleSettingsResult>();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [intervalHours, setIntervalHours] = useState(String(settings.intervalHours));
  const [families, setFamilies] = useState<DerpSyncFamilies>(settings.families);
  const [autoReload, setAutoReload] = useState(settings.autoReload);

  const busy = settingsFetcher.state !== "idle";
  const running = runFetcher.state !== "idle";
  const saved = settingsFetcher.state === "idle" && settingsFetcher.data?.success === true;
  const error =
    settingsFetcher.data && !settingsFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[settingsFetcher.data.errorCode])
      : undefined;

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

        <runFetcher.Form method="post">
          <input name="action_id" type="hidden" value="run_derp_sync" />
          <SettingsActions>
            <Button disabled={isDisabled || running} type="submit">
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {running
                ? t("settings.headscale.derp.sync.running")
                : t("settings.headscale.derp.sync.runNow")}
            </Button>
          </SettingsActions>
        </runFetcher.Form>

        {last === undefined ? (
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.sync.never")}
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-mist-200 p-3 text-sm dark:border-mist-800">
            <div className="flex flex-wrap items-center gap-2">
              <SettingsStatus tone={OUTCOME_TONES[last.outcome]}>
                {t(OUTCOME_KEYS[last.outcome])}
              </SettingsStatus>
              <span className="text-mist-600 dark:text-mist-400">
                {t("settings.headscale.derp.sync.lastRun", {
                  at: new Date(last.at).toLocaleString(locale),
                })}
              </span>
            </div>

            {last.changes.length > 0 ? (
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
