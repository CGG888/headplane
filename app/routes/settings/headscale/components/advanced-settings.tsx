import { useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Select from "~/components/select";
import Switch from "~/components/switch";
import Text from "~/components/text";
import { useI18n } from "~/i18n/provider";
import type { AdvancedSettingsView } from "~/server/headscale/config-loader";

import { LOG_FORMATS, LOG_LEVELS } from "../advanced-settings";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

interface AdvancedSettingsProps {
  isDisabled: boolean;
  settings: AdvancedSettingsView;
}

/** The error paragraph every group renders when the server rejected a save. */
function GroupError({ message }: { message: string | undefined }) {
  if (!message) {
    return undefined;
  }

  return (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      {message}
    </p>
  );
}

interface SaveRowProps {
  disabled: boolean;
  label: string;
  savedLabel: string | undefined;
}

function SaveRow({ disabled, label, savedLabel }: SaveRowProps) {
  return (
    <div className="flex items-center gap-3">
      <Button disabled={disabled} type="submit" variant="heavy">
        {label}
      </Button>
      {savedLabel ? (
        <span className="text-sm text-emerald-600 dark:text-emerald-400">{savedLabel}</span>
      ) : undefined}
    </div>
  );
}

interface BooleanFieldProps {
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  name: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * A switch plus the hidden field that makes the submitted value explicit, so
 * the action never has to guess what an absent checkbox means.
 */
function BooleanField({
  checked,
  description,
  disabled,
  label,
  name,
  onCheckedChange,
}: BooleanFieldProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Text className="font-semibold">{label}</Text>
          <Text className="text-sm opacity-70">{description}</Text>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          label={label}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <input name={name} type="hidden" value={checked ? "true" : "false"} />
    </>
  );
}

export default function AdvancedSettings({ isDisabled, settings }: AdvancedSettingsProps) {
  const { t } = useI18n();

  // One fetcher per group keeps each save button, error and confirmation
  // attached to the fields it submitted.
  const nodeFetcher = useFetcher<HeadscaleSettingsResult>();
  const logFetcher = useFetcher<HeadscaleSettingsResult>();
  const featureFetcher = useFetcher<HeadscaleSettingsResult>();

  const [nodeExpiry, setNodeExpiry] = useState(settings.nodeExpiry);
  const [inactivityTimeout, setInactivityTimeout] = useState(settings.ephemeralInactivityTimeout);
  const [logLevel, setLogLevel] = useState(settings.logLevel);
  const [logFormat, setLogFormat] = useState(settings.logFormat);
  // Headscale stores the opt-out, the switch reads as the opt-in.
  const [checkUpdates, setCheckUpdates] = useState(!settings.disableCheckUpdates);
  const [taildrop, setTaildrop] = useState(settings.taildropEnabled);
  const [autoUpdate, setAutoUpdate] = useState(settings.autoUpdateEnabled);
  const [logtail, setLogtail] = useState(settings.logtailEnabled);

  const nodeDisabled = isDisabled || nodeFetcher.state !== "idle";
  const logDisabled = isDisabled || logFetcher.state !== "idle";
  const featureDisabled = isDisabled || featureFetcher.state !== "idle";

  const nodeError =
    nodeFetcher.data && !nodeFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[nodeFetcher.data.errorCode])
      : undefined;
  const logError =
    logFetcher.data && !logFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[logFetcher.data.errorCode])
      : undefined;
  const featureError =
    featureFetcher.data && !featureFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[featureFetcher.data.errorCode])
      : undefined;

  // Headscale accepts a wider zerolog level set than Headplane writes. A value
  // outside the whitelist is offered as its own entry so the file is shown as
  // it is; saving it back is what the action rejects.
  const levelItems: { value: string; label: string }[] = LOG_LEVELS.map((level) => ({
    value: level,
    label: level,
  }));
  if (logLevel.length > 0 && !LOG_LEVELS.some((level) => level === logLevel)) {
    levelItems.unshift({ value: logLevel, label: logLevel });
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex w-full flex-col">
        <h3 className="text-lg font-medium">{t("settings.headscale.advancedNodeTitle")}</h3>
        <p className="mt-1 mb-4 text-sm opacity-70">{t("settings.headscale.advancedNodeBody")}</p>

        <nodeFetcher.Form className="flex flex-col gap-5" method="post">
          <input name="action_id" type="hidden" value="save_node_settings" />

          <Input
            description={t("settings.headscale.nodeExpiryDescription")}
            disabled={nodeDisabled}
            label={t("settings.headscale.nodeExpiryLabel")}
            name="node_expiry"
            onChange={setNodeExpiry}
            placeholder="720h"
            required
            value={nodeExpiry}
          />
          <Input
            description={t("settings.headscale.ephemeralInactivityDescription")}
            disabled={nodeDisabled}
            label={t("settings.headscale.ephemeralInactivityLabel")}
            name="ephemeral_inactivity_timeout"
            onChange={setInactivityTimeout}
            placeholder="30m"
            required
            value={inactivityTimeout}
          />

          <GroupError message={nodeError} />
          <SaveRow
            disabled={nodeDisabled}
            label={t("settings.headscale.saveNodeSettings")}
            savedLabel={
              nodeFetcher.state === "idle" && nodeFetcher.data?.success
                ? t("settings.headscale.saved")
                : undefined
            }
          />
        </nodeFetcher.Form>
      </section>

      <section className="flex w-full flex-col">
        <h3 className="text-lg font-medium">{t("settings.headscale.advancedLogTitle")}</h3>
        <p className="mt-1 mb-4 text-sm opacity-70">{t("settings.headscale.advancedLogBody")}</p>

        <logFetcher.Form className="flex flex-col gap-5" method="post">
          <input name="action_id" type="hidden" value="save_log_settings" />

          <div>
            <Select
              description={t("settings.headscale.logLevelDescription")}
              disabled={logDisabled}
              items={levelItems}
              label={t("settings.headscale.logLevelLabel")}
              onValueChange={(value) => setLogLevel(value ?? "info")}
              value={logLevel}
            />
            <input name="log_level" type="hidden" value={logLevel} />
          </div>

          <div>
            <Select
              description={t("settings.headscale.logFormatDescription")}
              disabled={logDisabled}
              items={LOG_FORMATS.map((format) => ({ value: format, label: format }))}
              label={t("settings.headscale.logFormatLabel")}
              onValueChange={(value) => setLogFormat(value === "json" ? "json" : "text")}
              value={logFormat}
            />
            <input name="log_format" type="hidden" value={logFormat} />
          </div>

          <GroupError message={logError} />
          <SaveRow
            disabled={logDisabled}
            label={t("settings.headscale.saveLogSettings")}
            savedLabel={
              logFetcher.state === "idle" && logFetcher.data?.success
                ? t("settings.headscale.saved")
                : undefined
            }
          />
        </logFetcher.Form>
      </section>

      <section className="flex w-full flex-col">
        <h3 className="text-lg font-medium">{t("settings.headscale.advancedFeaturesTitle")}</h3>
        <p className="mt-1 mb-4 text-sm opacity-70">
          {t("settings.headscale.advancedFeaturesBody")}
        </p>

        <featureFetcher.Form className="flex flex-col gap-5" method="post">
          <input name="action_id" type="hidden" value="save_feature_settings" />

          <BooleanField
            checked={taildrop}
            description={t("settings.headscale.taildropDescription")}
            disabled={featureDisabled}
            label={t("settings.headscale.taildropLabel")}
            name="taildrop_enabled"
            onCheckedChange={setTaildrop}
          />
          <BooleanField
            checked={autoUpdate}
            description={t("settings.headscale.autoUpdateDescription")}
            disabled={featureDisabled}
            label={t("settings.headscale.autoUpdateLabel")}
            name="auto_update_enabled"
            onCheckedChange={setAutoUpdate}
          />
          <BooleanField
            checked={logtail}
            description={t("settings.headscale.logtailDescription")}
            disabled={featureDisabled}
            label={t("settings.headscale.logtailLabel")}
            name="logtail_enabled"
            onCheckedChange={setLogtail}
          />
          <BooleanField
            checked={checkUpdates}
            description={t("settings.headscale.checkUpdatesDescription")}
            disabled={featureDisabled}
            label={t("settings.headscale.checkUpdatesLabel")}
            name="check_updates"
            onCheckedChange={setCheckUpdates}
          />

          <GroupError message={featureError} />
          <SaveRow
            disabled={featureDisabled}
            label={t("settings.headscale.saveFeatureSettings")}
            savedLabel={
              featureFetcher.state === "idle" && featureFetcher.data?.success
                ? t("settings.headscale.saved")
                : undefined
            }
          />
        </featureFetcher.Form>
      </section>
    </div>
  );
}
