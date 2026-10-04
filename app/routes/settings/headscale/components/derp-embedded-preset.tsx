import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { DERPEmbeddedServerView } from "~/server/headscale/config-loader";

import { isAbsoluteFilePath, isDerpStunAddress, parseDerpRegionId } from "../derp-settings";
import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";
import DerpConnectivityHints from "./derp-connectivity-hints";

/** The values the preset wrote, so the page can show them without a reload. */
export interface EmbeddedDerpPresetValues {
  regionId: string;
  regionCode: string;
  regionName: string;
  stunListenAddr: string;
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
  const [privateKeyPath, setPrivateKeyPath] = useState(server.privateKeyPath || privateKeyDefault);
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
    setPrivateKeyPath(server.privateKeyPath || privateKeyDefault);
    setLocalError(undefined);
  }, [isOpen]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.success) {
      return;
    }

    onApplied({ regionId, regionCode, regionName, stunListenAddr });
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
    form.set("derp_server_private_key_path", privateKeyPath.trim());
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

        {(localError ?? serverError) ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {localError ?? serverError}
          </p>
        ) : undefined}
      </DialogPanel>
    </Dialog>
  );
}
