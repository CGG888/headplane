import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import { SettingsField } from "~/components/settings-nav";
import Switch from "~/components/switch";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { DERPEmbeddedServerView } from "~/server/headscale/config-loader";

import {
  isAbsoluteFilePath,
  isDerpIpv4Address,
  isDerpIpv6Address,
  isDerpStunAddress,
  parseDerpRegionId,
} from "../derp-settings";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";
import DerpConnectivityHints from "./derp-connectivity-hints";

/** The values the preset wrote, so the page can show them without a reload. */
export interface EmbeddedDerpPresetValues {
  regionId: string;
  regionCode: string;
  regionName: string;
  stunListenAddr: string;
  ipv4: string;
  ipv6: string;
}

interface DerpEmbeddedPresetProps {
  isDisabled: boolean;
  privateKeyDefault: string;
  server: DERPEmbeddedServerView;
  onApplied: (values: EmbeddedDerpPresetValues) => void;
}

/**
 * One-click setup for the embedded DERP server. Every field is prefilled from
 * the current configuration (or Headscale's documented example values) and
 * stays editable, so the preset never silently overwrites a region code or
 * name the operator already chose.
 */
export default function DerpEmbeddedPreset({
  isDisabled,
  privateKeyDefault,
  server,
  onApplied,
}: DerpEmbeddedPresetProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<HeadscaleSettingsResult>();

  const [isOpen, setIsOpen] = useState(false);
  const [regionId, setRegionId] = useState(String(server.regionId));
  const [regionCode, setRegionCode] = useState(server.regionCode);
  const [regionName, setRegionName] = useState(server.regionName);
  const [stunListenAddr, setStunListenAddr] = useState(server.stunListenAddr);
  const [ipv4, setIpv4] = useState(server.ipv4);
  const [ipv6, setIpv6] = useState(server.ipv6);
  const [privateKeyPath, setPrivateKeyPath] = useState(server.privateKeyPath || privateKeyDefault);
  // Dropping the public map is the one part of the preset that is not prefilled
  // from the configuration, so it always starts off and has to be asked for.
  const [clearPublicMap, setClearPublicMap] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();

  // Re-prefill on every open so the dialog always starts from the current
  // configuration rather than a previous edit.
  useEffect(() => {
    if (!isOpen) {
      fetcher.data = undefined;
      return;
    }

    setRegionId(String(server.regionId));
    setRegionCode(server.regionCode);
    setRegionName(server.regionName);
    setStunListenAddr(server.stunListenAddr);
    setIpv4(server.ipv4);
    setIpv6(server.ipv6);
    setPrivateKeyPath(server.privateKeyPath || privateKeyDefault);
    setClearPublicMap(false);
    setLocalError(undefined);
  }, [isOpen]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.success) {
      return;
    }

    onApplied({ regionId, regionCode, regionName, stunListenAddr, ipv4, ipv6 });
    setIsOpen(false);
  }, [fetcher.state, fetcher.data]);

  const serverError =
    fetcher.data && !fetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (parseDerpRegionId(regionId) === undefined) {
      setLocalError(t("settings.headscale.errors.invalidDerpRegionId"));
      return;
    }

    if (regionCode.trim().length === 0 || regionName.trim().length === 0) {
      setLocalError(t("settings.headscale.errors.invalidDerpRegionCode"));
      return;
    }

    if (!isDerpStunAddress(stunListenAddr)) {
      setLocalError(t("settings.headscale.errors.invalidDerpStunAddr"));
      return;
    }

    // Optional: an empty address leaves the key out, which unsets it.
    if (!isDerpIpv4Address(ipv4)) {
      setLocalError(t("settings.headscale.errors.invalidDerpIpv4"));
      return;
    }

    if (!isDerpIpv6Address(ipv6)) {
      setLocalError(t("settings.headscale.errors.invalidDerpIpv6"));
      return;
    }

    if (!isAbsoluteFilePath(privateKeyPath)) {
      setLocalError(t("settings.headscale.errors.invalidDerpPrivateKeyPath"));
      return;
    }

    setLocalError(undefined);

    const form = new FormData();
    form.set("action_id", "preset_embedded_derp");
    form.set("derp_server_region_id", regionId.trim());
    form.set("derp_server_region_code", regionCode.trim());
    form.set("derp_server_region_name", regionName.trim());
    form.set("derp_server_stun_listen_addr", stunListenAddr.trim());
    form.set("derp_server_ipv4", ipv4.trim());
    form.set("derp_server_ipv6", ipv6.trim());
    form.set("derp_server_private_key_path", privateKeyPath.trim());
    form.set("derp_clear_public_map", clearPublicMap ? "true" : "false");
    fetcher.submit(form, { method: "POST" });
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button className="my-2" disabled={isDisabled} onClick={() => setIsOpen(true)}>
        {t("settings.headscale.derp.presetButton")}
      </Button>
      <DialogPanel isDisabled={isDisabled || fetcher.state !== "idle"} onSubmit={onSubmit}>
        <Title>{t("settings.headscale.derp.presetTitle")}</Title>
        <Text>{t("settings.headscale.derp.presetBody")}</Text>
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {t("settings.headscale.derp.presetConsequence")}
        </p>

        <Input
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.regionIdLabel")}
          name="preset_region_id"
          onChange={setRegionId}
          placeholder="999"
          required
          value={regionId}
        />
        <Input
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.regionCodeLabel")}
          name="preset_region_code"
          onChange={setRegionCode}
          placeholder="headscale"
          required
          value={regionCode}
        />
        <Input
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.regionNameLabel")}
          name="preset_region_name"
          onChange={setRegionName}
          placeholder="Headscale Embedded DERP"
          required
          value={regionName}
        />
        <Input
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.stunListenAddrLabel")}
          name="preset_stun_listen_addr"
          onChange={setStunListenAddr}
          placeholder="0.0.0.0:3478"
          required
          value={stunListenAddr}
        />
        <Input
          description={t("settings.headscale.derp.ipv4Description")}
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.ipv4Label")}
          name="preset_ipv4"
          onChange={setIpv4}
          placeholder="198.51.100.1"
          value={ipv4}
        />
        <Input
          description={t("settings.headscale.derp.ipv6Description")}
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.ipv6Label")}
          name="preset_ipv6"
          onChange={setIpv6}
          placeholder="2001:db8::1"
          value={ipv6}
        />
        <Input
          description={t("settings.headscale.derp.privateKeyPathDescription")}
          disabled={fetcher.state !== "idle"}
          label={t("settings.headscale.derp.privateKeyPathLabel")}
          name="preset_private_key_path"
          onChange={setPrivateKeyPath}
          placeholder="/var/lib/headscale/derp_server_private.key"
          required
          value={privateKeyPath}
        />

        <DerpConnectivityHints />

        <SettingsField
          description={t("settings.headscale.derp.presetClearMapDescription")}
          label={t("settings.headscale.derp.presetClearMapLabel")}
        >
          <Switch
            checked={clearPublicMap}
            disabled={fetcher.state !== "idle"}
            label={t("settings.headscale.derp.presetClearMapLabel")}
            onCheckedChange={setClearPublicMap}
          />
        </SettingsField>
        <input
          name="derp_clear_public_map"
          type="hidden"
          value={clearPublicMap ? "true" : "false"}
        />

        {clearPublicMap ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t("settings.headscale.derp.presetClearMapWarning")}
          </p>
        ) : undefined}

        {(localError ?? serverError) ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {localError ?? serverError}
          </p>
        ) : undefined}
      </DialogPanel>
    </Dialog>
  );
}
