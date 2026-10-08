import { Map, MapPinned, RefreshCw, Server } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsField,
} from "~/components/settings-nav";
import Switch from "~/components/switch";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import type { DERPSettingsView } from "~/server/headscale/config-loader";
import type { DerpMapFileView } from "~/server/headscale/derp-map-files";
import cn from "~/utils/cn";

import { computeDerpMapChecks } from "../derp-map-checks";
import {
  isDerpIpv4Address,
  isDerpIpv6Address,
  isHttpUrl,
  parseDerpRegionId,
} from "../derp-settings";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";
import DerpConnectivityHints from "./derp-connectivity-hints";
import DerpEmbeddedPreset, { type EmbeddedDerpPresetValues } from "./derp-embedded-preset";
import DerpMapFiles from "./derp-map-files";
import DerpPublicEndpoint from "./derp-public-endpoint";
import RelayDnsResolver from "./relay-dns-resolver";

/**
 * Whether any configured map file fails a check. The rows inside the paths card
 * print those verdicts, and the card starts closed, so the same check engine the
 * rows use decides whether the card has to open. A warning — a path whose file
 * has not been written yet, an unwritable one, an oversized one — is not an
 * error and leaves the card closed, exactly as the System page treats a failed
 * check as the only reason to open one.
 */
function mapFilesHaveFailures(mapFiles: DerpMapFileView[]): boolean {
  return mapFiles.some((file) =>
    computeDerpMapChecks({
      path: file.path,
      exists: file.exists,
      isFile: file.isFile,
      readable: file.readable,
      writable: file.writable,
      tooLarge: file.tooLarge,
      unavailable: file.unavailable,
      issues: file.issues,
    }).some((check) => check.status === "fail"),
  );
}

interface DerpSettingsProps {
  isDisabled: boolean;
  /** Inspection of every configured `derp.paths` entry, done by the loader. */
  mapFiles: DerpMapFileView[];
  /** Documented location of the region signing key, prefilled by the preset. */
  privateKeyDefault: string;
  /** Where the relays come from, resolved by the page into a status pill. */
  relaySourceStatus?: { tone: "ok" | "warn"; label: string };
  /** The existing "what is set right now" line for the relay source. */
  relaySourceSummary?: string;
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

interface SaveRowProps {
  disabled: boolean;
  label: string;
  savedLabel: string | undefined;
}

function SaveRow({ disabled, label, savedLabel }: SaveRowProps) {
  return (
    <SettingsActions>
      {savedLabel ? (
        <span className="text-sm text-emerald-600 dark:text-emerald-400">{savedLabel}</span>
      ) : undefined}
      <Button disabled={disabled} type="submit" variant="heavy">
        {label}
      </Button>
    </SettingsActions>
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
      <SettingsField description={description} label={label}>
        <Switch
          checked={checked}
          disabled={disabled}
          label={label}
          onCheckedChange={onCheckedChange}
        />
      </SettingsField>
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

export default function DerpSettings({
  isDisabled,
  mapFiles,
  privateKeyDefault,
  relaySourceStatus,
  relaySourceSummary,
  settings,
}: DerpSettingsProps) {
  const { t } = useI18n();

  // One fetcher per control keeps each save button, error and confirmation
  // attached to the fields it submitted. The per-path controls own their own
  // fetchers inside the map-file card.
  const addUrlFetcher = useFetcher<HeadscaleSettingsResult>();
  const removeUrlFetcher = useFetcher<HeadscaleSettingsResult>();
  const addPathFetcher = useFetcher<HeadscaleSettingsResult>();
  const refreshFetcher = useFetcher<HeadscaleSettingsResult>();
  const serverFetcher = useFetcher<HeadscaleSettingsResult>();

  const [urlValue, setUrlValue] = useState("");
  const [urlLocalError, setUrlLocalError] = useState<string | undefined>();
  const [pathValue, setPathValue] = useState("");
  const [pathLocalError, setPathLocalError] = useState<string | undefined>();
  // What the map-file rows report about their own saves: the card starts closed,
  // so a row's failure has to reach it from outside the card's own children.
  const [mapFilesError, setMapFilesError] = useState(false);

  const [autoUpdate, setAutoUpdate] = useState(settings.autoUpdateEnabled);
  const [updateFrequency, setUpdateFrequency] = useState(settings.updateFrequency);

  const [serverEnabled, setServerEnabled] = useState(settings.server.enabled);
  const [regionId, setRegionId] = useState(String(settings.server.regionId));
  const [regionCode, setRegionCode] = useState(settings.server.regionCode);
  const [regionName, setRegionName] = useState(settings.server.regionName);
  const [stunListenAddr, setStunListenAddr] = useState(settings.server.stunListenAddr);
  const [ipv4, setIpv4] = useState(settings.server.ipv4);
  const [ipv6, setIpv6] = useState(settings.server.ipv6);
  const [verifyClients, setVerifyClients] = useState(settings.server.verifyClients);
  const [autoAdd, setAutoAdd] = useState(settings.server.automaticallyAddEmbeddedDerpRegion);
  const [keyConfigured, setKeyConfigured] = useState(settings.server.hasPrivateKey);
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
  const pathBusy = addPathFetcher.state !== "idle";
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

    // Both public addresses are optional; an empty field clears the key.
    if (!isDerpIpv4Address(ipv4)) {
      event.preventDefault();
      setServerLocalError(t("settings.headscale.errors.invalidDerpIpv4"));
      return;
    }

    if (!isDerpIpv6Address(ipv6)) {
      event.preventDefault();
      setServerLocalError(t("settings.headscale.errors.invalidDerpIpv6"));
      return;
    }

    setServerLocalError(undefined);
  }

  // The preset writes the same fields the manual form edits, so the form is
  // brought in line immediately instead of showing stale values until a reload.
  function onPresetApplied(values: EmbeddedDerpPresetValues) {
    setServerEnabled(true);
    setRegionId(values.regionId);
    setRegionCode(values.regionCode);
    setRegionName(values.regionName);
    setStunListenAddr(values.stunListenAddr);
    setIpv4(values.ipv4);
    setIpv6(values.ipv6);
    setKeyConfigured(true);
  }

  return (
    <SettingsCollapsibleGroup>
      <SettingsCollapsible
        description={t("settings.headscale.derp.urlsBody")}
        hasError={Boolean(urlLocalError ?? addUrlError ?? removeUrlError)}
        icon={Map}
        status={relaySourceStatus}
        summary={relaySourceSummary}
        title={t("settings.headscale.derp.urlsTitle")}
      >
        <section className="flex w-full flex-col">
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

          <addUrlFetcher.Form
            className="mt-4 flex flex-col gap-3"
            method="post"
            onSubmit={onAddUrl}
          >
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
            <SettingsActions>
              <Button disabled={isDisabled || urlBusy} type="submit" variant="heavy">
                {t("settings.headscale.derp.addUrl")}
              </Button>
            </SettingsActions>
          </addUrlFetcher.Form>

          <GroupError message={addUrlError} />
        </section>
      </SettingsCollapsible>

      <SettingsCollapsible
        description={t("settings.headscale.derp.pathsBody")}
        hasError={
          Boolean(pathLocalError ?? addPathError) || mapFilesHaveFailures(mapFiles) || mapFilesError
        }
        icon={MapPinned}
        status={{
          tone: settings.paths.length > 0 ? "ok" : "neutral",
          label: t("settings.headscale.derp.pathCount", { count: settings.paths.length }),
        }}
        title={t("settings.headscale.derp.pathsTitle")}
      >
        <section className="flex w-full flex-col gap-4">
          {settings.paths.length === 0 ? (
            <TableList>
              <TableList.Item className="justify-center py-4 opacity-70">
                <p className="font-semibold">{t("settings.headscale.derp.pathsEmpty")}</p>
              </TableList.Item>
            </TableList>
          ) : (
            // Each path is inspected, viewable, editable, and rollable-back on
            // its own; the add form below only grows the list.
            <DerpMapFiles
              files={mapFiles}
              isDisabled={isDisabled || pathBusy}
              onErrorChange={setMapFilesError}
              paths={settings.paths}
            />
          )}

          <addPathFetcher.Form className="flex flex-col gap-3" method="post" onSubmit={onAddPath}>
            <input name="action_id" type="hidden" value="add_derp_path" />
            <Input
              description={t("settings.headscale.derp.pathCreateHint")}
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
            <SettingsActions>
              <Button disabled={isDisabled || pathBusy} type="submit" variant="heavy">
                {t("settings.headscale.derp.addPath")}
              </Button>
            </SettingsActions>
          </addPathFetcher.Form>

          <GroupError message={addPathError} />
        </section>
      </SettingsCollapsible>

      <SettingsCollapsible
        description={t("settings.headscale.derp.refreshBody")}
        hasError={Boolean(refreshError)}
        icon={RefreshCw}
        status={{
          tone: autoUpdate ? "ok" : "neutral",
          label: autoUpdate
            ? t("settings.headscale.statusEnabled")
            : t("settings.headscale.statusDisabled"),
        }}
        title={t("settings.headscale.derp.refreshTitle")}
      >
        <section className="flex w-full flex-col">
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

          {!autoUpdate ? (
            // The setting above is the general one; this is the quick answer to
            // "I just changed a map file and do not want to restart Headscale".
            <refreshFetcher.Form method="post">
              <input name="action_id" type="hidden" value="enable_derp_auto_update" />
              <p className="mb-3 text-xs text-mist-600 dark:text-mist-400">
                {t("settings.headscale.derp.enableAutoUpdateHint")}
              </p>
              <Button disabled={refreshDisabled} type="submit" variant="light">
                {t("settings.headscale.derp.enableAutoUpdate")}
              </Button>
            </refreshFetcher.Form>
          ) : undefined}
        </section>
      </SettingsCollapsible>

      <SettingsCollapsible
        description={t("settings.headscale.derp.serverBody")}
        hasError={Boolean(serverLocalError ?? serverFetchError)}
        icon={Server}
        status={{
          tone: serverEnabled ? "ok" : "neutral",
          label: serverEnabled
            ? t("settings.headscale.statusEnabled")
            : t("settings.headscale.statusDisabled"),
        }}
        title={t("settings.headscale.derp.serverTitle")}
      >
        <DerpEmbeddedPreset
          isDisabled={isDisabled}
          onApplied={onPresetApplied}
          privateKeyDefault={privateKeyDefault}
          server={settings.server}
        />
        <DerpPublicEndpoint serverUrl={settings.serverUrl} />
        <DerpConnectivityHints />
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
            placeholder="0.0.0.0:3478 / [::]:3478"
            value={stunListenAddr}
          />
          <Input
            description={t("settings.headscale.derp.ipv4Description")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.ipv4Label")}
            name="derp_server_ipv4"
            onChange={setIpv4}
            placeholder="198.51.100.1"
            value={ipv4}
          />
          <Input
            description={t("settings.headscale.derp.ipv6Description")}
            disabled={serverDisabled}
            label={t("settings.headscale.derp.ipv6Label")}
            name="derp_server_ipv6"
            onChange={setIpv6}
            placeholder="2001:db8::1"
            value={ipv6}
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

          <p className="text-sm text-mist-600 dark:text-mist-400">
            {keyConfigured
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
      </SettingsCollapsible>

      {/* The lookup behind the relay cards, and the DNS servers it may use. */}
      <RelayDnsResolver />
    </SettingsCollapsibleGroup>
  );
}
