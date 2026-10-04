import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Switch from "~/components/switch";
import TableList from "~/components/table-list";
import Text from "~/components/text";
import { useI18n } from "~/i18n/provider";
import type { DERPSettingsView } from "~/server/headscale/config-loader";
import cn from "~/utils/cn";

import { isHttpUrl, parseDerpRegionId } from "../derp-settings";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

interface DerpSettingsProps {
  isDisabled: boolean;
  settings: DERPSettingsView;
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

interface SaveRowProps {
  disabled: boolean;
  label: string;
  savedLabel: string | undefined;
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

/** The control used to remove one entry from a string list. */
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

export default function DerpSettings({ isDisabled, settings }: DerpSettingsProps) {
  const { t } = useI18n();

  // One fetcher per control keeps each save button, error and confirmation
  // attached to the fields it submitted.
  const addUrlFetcher = useFetcher<HeadscaleSettingsResult>();
  const removeUrlFetcher = useFetcher<HeadscaleSettingsResult>();
  const addPathFetcher = useFetcher<HeadscaleSettingsResult>();
  const removePathFetcher = useFetcher<HeadscaleSettingsResult>();
  const refreshFetcher = useFetcher<HeadscaleSettingsResult>();
  const serverFetcher = useFetcher<HeadscaleSettingsResult>();

  const [urlValue, setUrlValue] = useState("");
  const [urlLocalError, setUrlLocalError] = useState<string | undefined>();
  const [pathValue, setPathValue] = useState("");
  const [pathLocalError, setPathLocalError] = useState<string | undefined>();

  const [autoUpdate, setAutoUpdate] = useState(settings.autoUpdateEnabled);
  const [updateFrequency, setUpdateFrequency] = useState(settings.updateFrequency);

  const [serverEnabled, setServerEnabled] = useState(settings.server.enabled);
  const [regionId, setRegionId] = useState(String(settings.server.regionId));
  const [regionCode, setRegionCode] = useState(settings.server.regionCode);
  const [regionName, setRegionName] = useState(settings.server.regionName);
  const [stunListenAddr, setStunListenAddr] = useState(settings.server.stunListenAddr);
  const [verifyClients, setVerifyClients] = useState(settings.server.verifyClients);
  const [autoAdd, setAutoAdd] = useState(settings.server.automaticallyAddEmbeddedDerpRegion);
  const [serverLocalError, setServerLocalError] = useState<string | undefined>();

  // Clearing a field only once the server accepted the entry keeps a rejected
  // value in place so it can be corrected.
  useEffect(() => {
    if (addUrlFetcher.state === "idle" && addUrlFetcher.data?.success) {
      setUrlValue("");
      setUrlLocalError(undefined);
    }
  }, [addUrlFetcher.state, addUrlFetcher.data]);

  useEffect(() => {
    if (addPathFetcher.state === "idle" && addPathFetcher.data?.success) {
      setPathValue("");
      setPathLocalError(undefined);
    }
  }, [addPathFetcher.state, addPathFetcher.data]);

  const urlBusy = addUrlFetcher.state !== "idle" || removeUrlFetcher.state !== "idle";
  const pathBusy = addPathFetcher.state !== "idle" || removePathFetcher.state !== "idle";
  const refreshDisabled = isDisabled || refreshFetcher.state !== "idle";
  const serverDisabled = isDisabled || serverFetcher.state !== "idle";

  const addUrlError =
    addUrlFetcher.data && !addUrlFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[addUrlFetcher.data.errorCode])
      : undefined;
  const removeUrlError =
    removeUrlFetcher.data && !removeUrlFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[removeUrlFetcher.data.errorCode])
      : undefined;
  const addPathError =
    addPathFetcher.data && !addPathFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[addPathFetcher.data.errorCode])
      : undefined;
  const removePathError =
    removePathFetcher.data && !removePathFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[removePathFetcher.data.errorCode])
      : undefined;
  const refreshError =
    refreshFetcher.data && !refreshFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[refreshFetcher.data.errorCode])
      : undefined;
  const serverFetchError =
    serverFetcher.data && !serverFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[serverFetcher.data.errorCode])
      : undefined;

  function onAddUrl(event: FormEvent<HTMLFormElement>) {
    const url = urlValue.trim();
    if (!isHttpUrl(url)) {
      event.preventDefault();
      setUrlLocalError(t("settings.headscale.errors.invalidDerpUrl"));
      return;
    }

    if (settings.urls.includes(url)) {
      event.preventDefault();
      setUrlLocalError(t("settings.headscale.errors.duplicateDerpUrl"));
      return;
    }

    setUrlLocalError(undefined);
  }

  function onAddPath(event: FormEvent<HTMLFormElement>) {
    const path = pathValue.trim();
    if (path.length === 0) {
      event.preventDefault();
      setPathLocalError(t("settings.headscale.errors.invalidDerpPath"));
      return;
    }

    if (settings.paths.includes(path)) {
      event.preventDefault();
      setPathLocalError(t("settings.headscale.errors.duplicateDerpPath"));
      return;
    }

    setPathLocalError(undefined);
  }

  function onSaveServer(event: FormEvent<HTMLFormElement>) {
    if (parseDerpRegionId(regionId) === undefined) {
      event.preventDefault();
      setServerLocalError(t("settings.headscale.errors.invalidDerpRegionId"));
      return;
    }

    if (regionCode.trim().length === 0 || regionName.trim().length === 0) {
      event.preventDefault();
      setServerLocalError(t("settings.headscale.errors.invalidDerpRegionCode"));
      return;
    }

    setServerLocalError(undefined);
  }

  return (
    <>
      <section className="w-full sm:w-2/3">
        <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.derp.urlsTitle")}</h2>
        <p className="my-2">{t("settings.headscale.derp.urlsBody")}</p>

        <TableList>
          {settings.urls.length === 0 ? (
            <TableList.Item className="justify-center py-4 opacity-70">
              <p className="font-semibold">{t("settings.headscale.derp.urlsEmpty")}</p>
            </TableList.Item>
          ) : (
            settings.urls.map((url) => (
              <TableList.Item key={url}>
                <p className="font-mono text-sm">{url}</p>
                <removeUrlFetcher.Form method="post">
                  <input name="action_id" type="hidden" value="remove_derp_url" />
                  <input name="url" type="hidden" value={url} />
                  <RemoveButton
                    disabled={isDisabled || urlBusy}
                    label={t("settings.headscale.derp.removeUrl")}
                  />
                </removeUrlFetcher.Form>
              </TableList.Item>
            ))
          )}
        </TableList>

        {removeUrlError ? (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {removeUrlError}
          </p>
        ) : undefined}

        <addUrlFetcher.Form className="mt-4 flex items-end gap-3" method="post" onSubmit={onAddUrl}>
          <input name="action_id" type="hidden" value="add_derp_url" />
          <Input
            disabled={isDisabled || urlBusy}
            errorMessage={urlLocalError}
            invalid={Boolean(urlLocalError)}
            label={t("settings.headscale.derp.urlLabel")}
            name="url"
            onChange={(next) => {
              setUrlValue(next);
              setUrlLocalError(undefined);
            }}
            placeholder={t("settings.headscale.derp.urlPlaceholder")}
            required
            value={urlValue}
          />
          <Button disabled={isDisabled || urlBusy} type="submit" variant="heavy">
            {t("settings.headscale.derp.addUrl")}
          </Button>
        </addUrlFetcher.Form>

        <GroupError message={addUrlError} />
      </section>

      <section className="w-full sm:w-2/3">
        <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.derp.pathsTitle")}</h2>
        <p className="my-2">{t("settings.headscale.derp.pathsBody")}</p>

        <TableList>
          {settings.paths.length === 0 ? (
            <TableList.Item className="justify-center py-4 opacity-70">
              <p className="font-semibold">{t("settings.headscale.derp.pathsEmpty")}</p>
            </TableList.Item>
          ) : (
            settings.paths.map((path) => (
              <TableList.Item key={path}>
                <p className="font-mono text-sm">{path}</p>
                <removePathFetcher.Form method="post">
                  <input name="action_id" type="hidden" value="remove_derp_path" />
                  <input name="path" type="hidden" value={path} />
                  <RemoveButton
                    disabled={isDisabled || pathBusy}
                    label={t("settings.headscale.derp.removePath")}
                  />
                </removePathFetcher.Form>
              </TableList.Item>
            ))
          )}
        </TableList>

        {removePathError ? (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {removePathError}
          </p>
        ) : undefined}

        <addPathFetcher.Form
          className="mt-4 flex items-end gap-3"
          method="post"
          onSubmit={onAddPath}
        >
          <input name="action_id" type="hidden" value="add_derp_path" />
          <Input
            disabled={isDisabled || pathBusy}
            errorMessage={pathLocalError}
            invalid={Boolean(pathLocalError)}
            label={t("settings.headscale.derp.pathLabel")}
            name="path"
            onChange={(next) => {
              setPathValue(next);
              setPathLocalError(undefined);
            }}
            placeholder={t("settings.headscale.derp.pathPlaceholder")}
            required
            value={pathValue}
          />
          <Button disabled={isDisabled || pathBusy} type="submit" variant="heavy">
            {t("settings.headscale.derp.addPath")}
          </Button>
        </addPathFetcher.Form>

        <GroupError message={addPathError} />
      </section>

      <section className="w-full sm:w-2/3">
        <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.derp.refreshTitle")}</h2>
        <p className="my-2">{t("settings.headscale.derp.refreshBody")}</p>

        <refreshFetcher.Form className="flex flex-col gap-5" method="post">
          <input name="action_id" type="hidden" value="save_derp_settings" />

          <BooleanField
            checked={autoUpdate}
            description={t("settings.headscale.derp.autoUpdateDescription")}
            disabled={refreshDisabled}
            label={t("settings.headscale.derp.autoUpdateLabel")}
            name="derp_auto_update_enabled"
            onCheckedChange={setAutoUpdate}
          />
          <Input
            description={t("settings.headscale.derp.updateFrequencyDescription")}
            disabled={refreshDisabled}
            label={t("settings.headscale.derp.updateFrequencyLabel")}
            name="derp_update_frequency"
            onChange={setUpdateFrequency}
            placeholder="3h"
            required
            value={updateFrequency}
          />

          <GroupError message={refreshError} />
          <SaveRow
            disabled={refreshDisabled}
            label={t("settings.headscale.derp.saveRefresh")}
            savedLabel={
              refreshFetcher.state === "idle" && refreshFetcher.data?.success
                ? t("settings.headscale.saved")
                : undefined
            }
          />
        </refreshFetcher.Form>
      </section>

      <section className="w-full sm:w-2/3">
        <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.derp.serverTitle")}</h2>
        <p className="my-2">{t("settings.headscale.derp.serverBody")}</p>

        <serverFetcher.Form className="flex flex-col gap-5" method="post" onSubmit={onSaveServer}>
          <input name="action_id" type="hidden" value="save_derp_server" />

          <BooleanField
            checked={serverEnabled}
            description={t("settings.headscale.derp.serverEnabledDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.serverEnabledLabel")}
            name="derp_server_enabled"
            onCheckedChange={setServerEnabled}
          />
          <Input
            description={t("settings.headscale.derp.regionIdDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.regionIdLabel")}
            name="derp_server_region_id"
            onChange={setRegionId}
            placeholder="999"
            required
            value={regionId}
          />
          <Input
            description={t("settings.headscale.derp.regionCodeDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.regionCodeLabel")}
            name="derp_server_region_code"
            onChange={setRegionCode}
            placeholder="headscale"
            required
            value={regionCode}
          />
          <Input
            description={t("settings.headscale.derp.regionNameDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.regionNameLabel")}
            name="derp_server_region_name"
            onChange={setRegionName}
            placeholder="Headscale Embedded DERP"
            required
            value={regionName}
          />
          <Input
            description={t("settings.headscale.derp.stunListenAddrDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.stunListenAddrLabel")}
            name="derp_server_stun_listen_addr"
            onChange={setStunListenAddr}
            placeholder="0.0.0.0:3478"
            value={stunListenAddr}
          />
          <BooleanField
            checked={verifyClients}
            description={t("settings.headscale.derp.verifyClientsDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.verifyClientsLabel")}
            name="derp_server_verify_clients"
            onCheckedChange={setVerifyClients}
          />
          <BooleanField
            checked={autoAdd}
            description={t("settings.headscale.derp.autoAddRegionDescription")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.autoAddRegionLabel")}
            name="derp_server_automatically_add_embedded_derp_region"
            onCheckedChange={setAutoAdd}
          />

          <p className="text-sm opacity-70">
            {settings.server.hasPrivateKey
              ? t("settings.headscale.derp.keyConfigured")
              : t("settings.headscale.derp.keyMissing")}
          </p>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t("settings.headscale.derp.serverKeyWarning")}
          </p>

          <GroupError message={serverLocalError ?? serverFetchError} />
          <SaveRow
            disabled={serverDisabled}
            label={t("settings.headscale.derp.saveServer")}
            savedLabel={
              serverFetcher.state === "idle" && serverFetcher.data?.success
                ? t("settings.headscale.saved")
                : undefined
            }
          />
        </serverFetcher.Form>
      </section>
    </>
  );
}
