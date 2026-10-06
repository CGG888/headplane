import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import { SettingsActions } from "~/components/settings-nav";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

interface Row {
  id: number;
  name: string;
  value: string;
}

interface OidcExtraParamsProps {
  isDisabled: boolean;
  extraParams: Record<string, string>;
  /**
   * Reports whether this section is showing an error, up through the OIDC card
   * that renders it, so the page's card can open on a rejected save.
   */
  onErrorChange?: (hasError: boolean) => void;
}

/**
 * The `oidc.extra_params` editor. Headscale sends these pairs verbatim to the
 * identity provider's authorization endpoint, so the whole map is saved at
 * once: an empty list removes the key from the file.
 */
export default function OidcExtraParams({
  isDisabled,
  extraParams,
  onErrorChange,
}: OidcExtraParamsProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<HeadscaleSettingsResult>();
  const isBusy = fetcher.state !== "idle";

  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(extraParams).map(([name, value], index) => ({ id: index, name, value })),
  );
  // Ids keep counting up so removing a row never lets React reuse the input
  // state of the row that took its place.
  const [nextId, setNextId] = useState(rows.length);

  const disabled = isDisabled || isBusy;
  const error =
    fetcher.data && !fetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;
  const saved = fetcher.state === "idle" && Boolean(fetcher.data?.success);

  // The message below stays where it is drawn; only the fact that one exists
  // travels up.
  useEffect(() => {
    onErrorChange?.(error !== undefined);
  }, [error, onErrorChange]);

  function addRow() {
    setRows((current) => [...current, { id: nextId, name: "", value: "" }]);
    setNextId((current) => current + 1);
  }

  function removeRow(id: number) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function updateRow(id: number, patch: Partial<Omit<Row, "id">>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <section className="flex w-full flex-col gap-4 border-t border-mist-200 pt-4 dark:border-mist-800">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("settings.headscale.extraParamsTitle")}</p>
        <p className="text-sm text-mist-600 dark:text-mist-400">
          {t("settings.headscale.extraParamsBody")}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-mist-500 dark:text-mist-400">
          {t("settings.headscale.extraParamsEmpty")}
        </p>
      ) : undefined}

      <fetcher.Form className="flex flex-col gap-4" method="post">
        <input name="action_id" type="hidden" value="save_oidc_extra_params" />

        {rows.map((row) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end" key={row.id}>
            <Input
              disabled={disabled}
              label={t("settings.headscale.extraParamsKeyLabel")}
              name="extra_param_key"
              onChange={(next) => updateRow(row.id, { name: next })}
              placeholder={t("settings.headscale.extraParamsKeyPlaceholder")}
              value={row.name}
            />
            <Input
              disabled={disabled}
              label={t("settings.headscale.extraParamsValueLabel")}
              name="extra_param_value"
              onChange={(next) => updateRow(row.id, { value: next })}
              placeholder={t("settings.headscale.extraParamsValuePlaceholder")}
              value={row.value}
            />
            <Button
              className={cn("shrink-0 text-red-500 dark:text-red-400")}
              disabled={disabled}
              onClick={() => removeRow(row.id)}
              type="button"
              variant="ghost"
            >
              {t("settings.headscale.removeExtraParam")}
            </Button>
          </div>
        ))}

        <Button
          className="self-start"
          disabled={disabled}
          onClick={addRow}
          type="button"
          variant="light"
        >
          <Plus className="h-4 w-4" />
          {t("settings.headscale.addExtraParam")}
        </Button>

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
          <Button disabled={disabled} type="submit" variant="heavy">
            {t("settings.headscale.saveExtraParams")}
          </Button>
        </SettingsActions>
      </fetcher.Form>
    </section>
  );
}
