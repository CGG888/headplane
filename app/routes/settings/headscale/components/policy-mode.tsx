import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Code from "~/components/code";
import Notice from "~/components/notice";
import RadioGroup from "~/components/radio-group";
import { useI18n } from "~/i18n/provider";

import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

type PolicyMode = "file" | "database";

interface PolicyModeProps {
  isDisabled: boolean;
  mode: PolicyMode;
  path: string;
}

export default function PolicyModeSettings({ isDisabled, mode, path }: PolicyModeProps) {
  const { t, tr } = useI18n();
  const fetcher = useFetcher<HeadscaleSettingsResult>();
  const [selected, setSelected] = useState<PolicyMode>(mode);

  const isBusy = fetcher.state !== "idle";
  const disabled = isDisabled || isBusy;

  // The loader is the source of truth: the chooser follows the saved mode and
  // drops an attempted switch the server rejected, so it never shows a mode
  // that was not written.
  useEffect(() => {
    if (!fetcher.data || !fetcher.data.success) {
      setSelected(mode);
    }
  }, [mode, fetcher.data]);

  const error =
    fetcher.data && !fetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;
  const saved = Boolean(fetcher.data?.success) && !isBusy;

  return (
    <section className="w-full sm:w-2/3">
      <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.policyTitle")}</h2>
      <p className="my-2">{t("settings.headscale.policyBody")}</p>
      <p className="text-sm">
        <span className="font-medium">{t("settings.headscale.policyPathLabel")}: </span>
        <Code>{path.length > 0 ? path : "—"}</Code>
      </p>

      <fetcher.Form className="mt-4 flex flex-col gap-4" method="post">
        <input name="action_id" type="hidden" value="set_policy_mode" />
        <input name="policy_mode" type="hidden" value={selected} />

        <RadioGroup
          className="gap-4"
          label={t("settings.headscale.policyModeLabel")}
          onValueChange={(value) => setSelected(value === "database" ? "database" : "file")}
          value={selected}
        >
          <RadioGroup.Radio
            disabled={disabled}
            label={t("settings.headscale.policyModeFile")}
            value="file"
          >
            <div className="block">
              <p className="font-bold">{t("settings.headscale.policyModeFile")}</p>
              <p className="opacity-70">{t("settings.headscale.policyModeFileDescription")}</p>
            </div>
          </RadioGroup.Radio>
          <RadioGroup.Radio
            disabled={disabled}
            label={t("settings.headscale.policyModeDatabase")}
            value="database"
          >
            <div className="block">
              <p className="font-bold">{t("settings.headscale.policyModeDatabase")}</p>
              <p className="opacity-70">{t("settings.headscale.policyModeDatabaseDescription")}</p>
            </div>
          </RadioGroup.Radio>
        </RadioGroup>

        <Notice variant="warning">
          {tr("settings.headscale.policyWarning", {
            command: <Code>headscale policy set -f /path/to/policy.hujson</Code>,
          })}
        </Notice>

        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : undefined}

        <div className="flex items-center gap-3">
          <Button disabled={disabled || selected === mode} type="submit" variant="heavy">
            {t("settings.headscale.savePolicy")}
          </Button>
          {saved ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              {t("settings.headscale.saved")}
            </span>
          ) : undefined}
        </div>
      </fetcher.Form>
    </section>
  );
}
