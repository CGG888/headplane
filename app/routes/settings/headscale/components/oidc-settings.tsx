import { useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Link from "~/components/link";
import Notice from "~/components/notice";
import Select from "~/components/select";
import Switch from "~/components/switch";
import Text from "~/components/text";
import { useI18n } from "~/i18n/provider";
import type { OIDCSettingsView } from "~/server/headscale/config-loader";

import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";

/** Headscale's own defaults, used until an `oidc:` block exists in the file. */
const OIDC_DEFAULTS: OIDCSettingsView = {
  issuer: "",
  clientId: "",
  hasClientSecret: false,
  scope: ["openid", "profile", "email"],
  emailVerifiedRequired: true,
  useExpiryFromToken: false,
  onlyStartIfOIDCIsAvailable: true,
  pkceEnabled: false,
  pkceMethod: "S256",
  allowedDomains: [],
  allowedGroups: [],
  allowedUsers: [],
};

interface OidcSettingsProps {
  isDisabled: boolean;
  oidc: OIDCSettingsView | null;
}

export default function OidcSettings({ isDisabled, oidc }: OidcSettingsProps) {
  const { t, tr } = useI18n();
  const fetcher = useFetcher<HeadscaleSettingsResult>();
  const isBusy = fetcher.state !== "idle";

  const settings = oidc ?? OIDC_DEFAULTS;
  const [emailVerified, setEmailVerified] = useState(settings.emailVerifiedRequired);
  const [useExpiry, setUseExpiry] = useState(settings.useExpiryFromToken);
  const [onlyStartIfOidc, setOnlyStartIfOidc] = useState(settings.onlyStartIfOIDCIsAvailable);
  const [pkceEnabled, setPkceEnabled] = useState(settings.pkceEnabled);
  const [pkceMethod, setPkceMethod] = useState(settings.pkceMethod);

  const disabled = isDisabled || isBusy;
  const error =
    fetcher.data && !fetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;
  const saved = Boolean(fetcher.data?.success) && !isBusy;

  return (
    <section className="flex w-full flex-col sm:w-2/3">
      <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.oidcTitle")}</h2>
      <p className="my-2">
        {tr("settings.headscale.oidcBody", {
          link: (
            <Link
              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              to="/settings/restrictions"
            >
              {t("settings.headscale.restrictionsLink")}
            </Link>
          ),
        })}
      </p>

      {oidc ? undefined : (
        <Notice title={t("settings.headscale.oidcMissingTitle")} variant="warning">
          {t("settings.headscale.oidcMissingBody")}
        </Notice>
      )}

      <fetcher.Form className="flex flex-col gap-5" method="post">
        <input name="action_id" type="hidden" value="save_oidc" />

        <Input
          defaultValue={settings.issuer}
          description={t("settings.headscale.issuerDescription")}
          disabled={disabled}
          label={t("settings.headscale.issuerLabel")}
          name="issuer"
        />
        <Input
          defaultValue={settings.clientId}
          disabled={disabled}
          label={t("settings.headscale.clientIdLabel")}
          name="client_id"
        />
        <Input
          autoComplete="new-password"
          description={
            settings.hasClientSecret
              ? t("settings.headscale.clientSecretSet")
              : t("settings.headscale.clientSecretUnset")
          }
          disabled={disabled}
          label={t("settings.headscale.clientSecretLabel")}
          name="client_secret"
          type="password"
        />
        <Input
          defaultValue={settings.scope.join(", ")}
          description={t("settings.headscale.scopeDescription")}
          disabled={disabled}
          label={t("settings.headscale.scopeLabel")}
          name="scope"
          required
        />

        <div className="flex items-center justify-between gap-4">
          <div>
            <Text className="font-semibold">
              {t("settings.headscale.emailVerifiedRequiredLabel")}
            </Text>
            <Text className="text-sm opacity-70">
              {t("settings.headscale.emailVerifiedRequiredDescription")}
            </Text>
          </div>
          <Switch
            checked={emailVerified}
            disabled={disabled}
            label={t("settings.headscale.emailVerifiedRequiredLabel")}
            onCheckedChange={setEmailVerified}
          />
        </div>
        <input
          name="email_verified_required"
          type="hidden"
          value={emailVerified ? "true" : "false"}
        />

        <div className="flex items-center justify-between gap-4">
          <div>
            <Text className="font-semibold">{t("settings.headscale.useExpiryFromTokenLabel")}</Text>
            <Text className="text-sm opacity-70">
              {t("settings.headscale.useExpiryFromTokenDescription")}
            </Text>
          </div>
          <Switch
            checked={useExpiry}
            disabled={disabled}
            label={t("settings.headscale.useExpiryFromTokenLabel")}
            onCheckedChange={setUseExpiry}
          />
        </div>
        <input name="use_expiry_from_token" type="hidden" value={useExpiry ? "true" : "false"} />

        <div className="flex items-center justify-between gap-4">
          <div>
            <Text className="font-semibold">{t("settings.headscale.onlyStartIfOidcLabel")}</Text>
            <Text className="text-sm opacity-70">
              {t("settings.headscale.onlyStartIfOidcDescription")}
            </Text>
          </div>
          <Switch
            checked={onlyStartIfOidc}
            disabled={disabled}
            label={t("settings.headscale.onlyStartIfOidcLabel")}
            onCheckedChange={setOnlyStartIfOidc}
          />
        </div>
        <input
          name="only_start_if_oidc_is_available"
          type="hidden"
          value={onlyStartIfOidc ? "true" : "false"}
        />

        <div className="flex items-center justify-between gap-4">
          <div>
            <Text className="font-semibold">{t("settings.headscale.pkceEnabledLabel")}</Text>
            <Text className="text-sm opacity-70">
              {t("settings.headscale.pkceEnabledDescription")}
            </Text>
          </div>
          <Switch
            checked={pkceEnabled}
            disabled={disabled}
            label={t("settings.headscale.pkceEnabledLabel")}
            onCheckedChange={setPkceEnabled}
          />
        </div>
        <input name="pkce_enabled" type="hidden" value={pkceEnabled ? "true" : "false"} />

        <div>
          <Select
            disabled={disabled}
            items={[
              { value: "plain", label: t("settings.headscale.pkceMethodPlain") },
              { value: "S256", label: t("settings.headscale.pkceMethodS256") },
            ]}
            label={t("settings.headscale.pkceMethodLabel")}
            onValueChange={(value) => setPkceMethod(value ?? "S256")}
            value={pkceMethod}
          />
          <input name="pkce_method" type="hidden" value={pkceMethod} />
        </div>

        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : undefined}

        <div className="flex items-center gap-3">
          <Button disabled={disabled} type="submit" variant="heavy">
            {t("settings.headscale.saveOidc")}
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
