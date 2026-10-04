import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import TableList from "~/components/table-list";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import { parseDerpRegionMapId } from "../derp-settings";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

interface DerpRegionNamesProps {
  isDisabled: boolean;
  names: Record<string, string>;
}

/** The control that removes one manual region name. */
function RemoveButton({ disabled, label }: { disabled: boolean; label: string }) {
  return (
    <Button
      className={cn("rounded-md px-2 py-1", "text-red-500 dark:text-red-400")}
      disabled={disabled}
      type="submit"
    >
      {label}
    </Button>
  );
}

/**
 * Editor for the manual `region id -> name` mapping. Headscale only names its
 * own embedded region, so operators can name the external regions Headplane
 * can only see as ids. The mapping is written to Headplane's data directory by
 * the settings action, not to Headscale's config.
 */
export default function DerpRegionNames({ isDisabled, names }: DerpRegionNamesProps) {
  const { t } = useI18n();
  const addFetcher = useFetcher<HeadscaleSettingsResult>();
  const removeFetcher = useFetcher<HeadscaleSettingsResult>();

  const [isOpen, setIsOpen] = useState(false);
  const [regionId, setRegionId] = useState("");
  const [regionName, setRegionName] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();

  const entries = Object.entries(names).toSorted(([a], [b]) => Number(a) - Number(b));

  // Clearing the dialog only once the server accepted the pair keeps a
  // rejected value in place so it can be corrected.
  useEffect(() => {
    if (addFetcher.state === "idle" && addFetcher.data?.success) {
      setIsOpen(false);
      setRegionId("");
      setRegionName("");
      setLocalError(undefined);
    }
  }, [addFetcher.state, addFetcher.data]);

  const addError =
    addFetcher.data && !addFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[addFetcher.data.errorCode])
      : undefined;
  const removeError =
    removeFetcher.data && !removeFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[removeFetcher.data.errorCode])
      : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (parseDerpRegionMapId(regionId) === undefined) {
      setLocalError(t("settings.headscale.errors.invalidDerpRegionMapId"));
      return;
    }

    if (regionName.trim().length === 0) {
      setLocalError(t("settings.headscale.errors.invalidDerpRegionMapName"));
      return;
    }

    setLocalError(undefined);

    const form = new FormData();
    form.set("action_id", "add_derp_region_name");
    form.set("derp_region_id", regionId.trim());
    form.set("derp_region_name", regionName.trim());
    addFetcher.submit(form, { method: "POST" });
  }

  return (
    <section className="flex w-full flex-col">
      <TableList>
        {entries.length === 0 ? (
          <TableList.Item className="justify-center py-4 opacity-70">
            <p className="font-semibold">{t("settings.headscale.derp.regionNamesEmpty")}</p>
          </TableList.Item>
        ) : (
          entries.map(([id, name]) => (
            <TableList.Item key={id}>
              <p className="font-mono text-sm">
                #{id} · {name}
              </p>
              <removeFetcher.Form method="post">
                <input name="action_id" type="hidden" value="remove_derp_region_name" />
                <input name="derp_region_id" type="hidden" value={id} />
                <RemoveButton
                  disabled={isDisabled || removeFetcher.state !== "idle"}
                  label={t("settings.headscale.derp.removeRegionName")}
                />
              </removeFetcher.Form>
            </TableList.Item>
          ))
        )}
      </TableList>

      {removeError ? (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {removeError}
        </p>
      ) : undefined}

      <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
        <Button
          className="mt-4"
          disabled={isDisabled || removeFetcher.state !== "idle"}
          onClick={() => setIsOpen(true)}
        >
          {t("settings.headscale.derp.addRegionName")}
        </Button>
        <DialogPanel isDisabled={isDisabled || addFetcher.state !== "idle"} onSubmit={onSubmit}>
          <Title>{t("settings.headscale.derp.regionNamesDialogTitle")}</Title>
          <Text className="mb-2">{t("settings.headscale.derp.regionNamesDialogBody")}</Text>
          <Input
            description={t("settings.headscale.derp.regionNameIdDescription")}
            disabled={addFetcher.state !== "idle"}
            label={t("settings.headscale.derp.regionNameIdLabel")}
            name="derp_region_id"
            onChange={(next) => {
              setRegionId(next);
              setLocalError(undefined);
            }}
            placeholder={t("settings.headscale.derp.regionNameIdPlaceholder")}
            required
            value={regionId}
          />
          <Input
            description={t("settings.headscale.derp.regionNameValueDescription")}
            disabled={addFetcher.state !== "idle"}
            label={t("settings.headscale.derp.regionNameValueLabel")}
            name="derp_region_name"
            onChange={(next) => {
              setRegionName(next);
              setLocalError(undefined);
            }}
            placeholder={t("settings.headscale.derp.regionNameValuePlaceholder")}
            required
            value={regionName}
          />

          {(localError ?? addError) ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {localError ?? addError}
            </p>
          ) : undefined}
        </DialogPanel>
      </Dialog>
    </section>
  );
}
