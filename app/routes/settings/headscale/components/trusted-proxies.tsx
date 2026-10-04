import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import { SettingsActions } from "~/components/settings-nav";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";
import { validateTrustedProxyCidr } from "../trusted-proxies";

interface TrustedProxiesProps {
  isDisabled: boolean;
  proxies: string[];
}

export default function TrustedProxies({ isDisabled, proxies }: TrustedProxiesProps) {
  const { t } = useI18n();

  // Separate fetchers keep a removal from clearing a half-typed entry, and
  // keep the two error messages attached to the control that produced them.
  const addFetcher = useFetcher<HeadscaleSettingsResult>();
  const removeFetcher = useFetcher<HeadscaleSettingsResult>();

  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();

  const isBusy = addFetcher.state !== "idle" || removeFetcher.state !== "idle";
  const disabled = isDisabled || isBusy;

  // Clearing the field only once the server accepted the entry keeps a
  // rejected value in place so it can be corrected.
  useEffect(() => {
    if (addFetcher.state === "idle" && addFetcher.data?.success) {
      setValue("");
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
    const proxy = value.trim();
    const problem = validateTrustedProxyCidr(proxy);

    if (problem === "invalid") {
      event.preventDefault();
      setLocalError(t("settings.headscale.errors.invalidCidr"));
      return;
    }

    if (problem === "unspecified") {
      event.preventDefault();
      setLocalError(t("settings.headscale.errors.unspecifiedCidr"));
      return;
    }

    if (proxies.includes(proxy)) {
      event.preventDefault();
      setLocalError(t("settings.headscale.errors.duplicateProxy"));
      return;
    }

    setLocalError(undefined);
  }

  return (
    <section className="flex w-full flex-col">
      <TableList>
        {proxies.length === 0 ? (
          <TableList.Item className="justify-center py-4 opacity-70">
            <p className="font-semibold">{t("settings.headscale.trustedProxiesEmpty")}</p>
          </TableList.Item>
        ) : (
          proxies.map((proxy) => (
            <TableList.Item key={proxy}>
              <p className="font-mono text-sm">{proxy}</p>
              <removeFetcher.Form method="post">
                <input name="action_id" type="hidden" value="remove_trusted_proxy" />
                <input name="proxy" type="hidden" value={proxy} />
                <Button
                  className={cn("rounded-md px-2 py-1", "text-red-500 dark:text-red-400")}
                  disabled={disabled}
                  type="submit"
                >
                  {t("settings.headscale.removeProxy")}
                </Button>
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

      <addFetcher.Form className="mt-4 flex flex-col gap-3" method="post" onSubmit={onSubmit}>
        <input name="action_id" type="hidden" value="add_trusted_proxy" />
        <Input
          disabled={disabled}
          errorMessage={localError}
          invalid={Boolean(localError)}
          label={t("settings.headscale.proxyLabel")}
          name="proxy"
          onChange={(next) => {
            setValue(next);
            setLocalError(undefined);
          }}
          placeholder={t("settings.headscale.proxyPlaceholder")}
          required
          value={value}
        />
        <SettingsActions>
          <Button disabled={disabled} type="submit" variant="heavy">
            {t("settings.headscale.addProxy")}
          </Button>
        </SettingsActions>
      </addFetcher.Form>

      {addError ? (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {addError}
        </p>
      ) : undefined}
    </section>
  );
}
