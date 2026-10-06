import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Select from "~/components/select";
import {
  SettingsActions,
  SettingsField,
  SettingsStatus,
  type SettingsStatusTone,
} from "~/components/settings-nav";
import Switch from "~/components/switch";
import { useI18n } from "~/i18n/provider";

import {
  LOGIN_ACTION_ERROR_KEYS,
  LOGIN_FIELD_DESCRIPTIONS,
  LOGIN_FIELD_LABELS,
  LOGIN_GROUP_LABELS,
  LOGIN_LOCKOUT_REASON_KEYS,
  LOGIN_PATH_KEYS,
  LOGIN_ROLE_KEYS,
  LOGIN_SOURCE_KEYS,
} from "../labels";
import {
  LOGIN_OIDC_FIELD_GROUPS,
  LOGIN_OIDC_SECRET_MASK,
  type LoginOidcFieldId,
  type LoginOidcFieldView,
  type LoginOidcSource,
  type LoginOidcView,
} from "../login-oidc";
import type { LoginActionData } from "../result";

/** The badge that says where the value in effect came from. */
const SOURCE_TONES: Record<LoginOidcSource, SettingsStatusTone> = {
  env: "warn",
  saved: "ok",
  file: "neutral",
  default: "neutral",
  unset: "neutral",
};

interface LoginOidcSettingsProps {
  view: LoginOidcView;
  canEdit: boolean;
  /** Lets the card open itself when this form is showing a rejection. */
  onErrorChange?: (hasError: boolean) => void;
}

/**
 * The editing form for HeadplaneCN's own console sign-in. It is deliberately
 * one flat form — nothing nested — so the confirmation button that the lockout
 * rail asks for can resubmit exactly the values the operator typed.
 */
export default function LoginOidcSettings({
  view,
  canEdit,
  onErrorChange,
}: LoginOidcSettingsProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<LoginActionData>();
  const isBusy = fetcher.state !== "idle";
  const disabled = !canEdit || isBusy;

  const byId = new Map(view.fields.map((field) => [field.id, field] as const));
  const valueOf = (id: LoginOidcFieldId): string | boolean | null => byId.get(id)?.value ?? null;
  const isPinned = (id: LoginOidcFieldId): boolean => byId.get(id)?.pinned === true;

  const [enabled, setEnabled] = useState(valueOf("enabled") === true);
  const [pkce, setPkce] = useState(valueOf("use_pkce") === true);
  const [logoutIdp, setLogoutIdp] = useState(valueOf("logout_idp") === true);
  const [role, setRole] = useState(
    typeof valueOf("default_role") === "string" ? (valueOf("default_role") as string) : "member",
  );
  const [clearSecret, setClearSecret] = useState(false);

  const failure = fetcher.data?.success === false ? fetcher.data : undefined;
  const rawCode = failure?.errorCode;
  const confirming =
    failure !== undefined && rawCode === "confirmationRequired" ? failure : undefined;
  const errorCode =
    rawCode === undefined || rawCode === "confirmationRequired" ? undefined : rawCode;
  const saved = fetcher.data?.success === true && fetcher.data.kind === "save" && !isBusy;

  const messages: string[] =
    errorCode === undefined
      ? []
      : failure?.errors !== undefined && failure.errors.length > 0
        ? [...new Set(failure.errors)].map((code) => t(LOGIN_ACTION_ERROR_KEYS[code]))
        : [t(LOGIN_ACTION_ERROR_KEYS[errorCode])];

  useEffect(() => {
    onErrorChange?.(messages.length > 0 || confirming !== undefined);
  }, [confirming, messages.length, onErrorChange]);

  const booleanState: Record<string, [boolean, (value: boolean) => void]> = {
    enabled: [enabled, setEnabled],
    use_pkce: [pkce, setPkce],
    logout_idp: [logoutIdp, setLogoutIdp],
  };

  function renderField(id: LoginOidcFieldId) {
    const field: LoginOidcFieldView | undefined = byId.get(id);
    if (field === undefined) {
      return undefined;
    }

    const pinned = field.pinned;
    const fieldDisabled = disabled || pinned;

    return (
      <SettingsField
        description={
          <>
            <span className="block">{t(LOGIN_FIELD_DESCRIPTIONS[id])}</span>
            {pinned ? (
              <span className="block">
                {t("settings.login.pinnedHint", { env: view.envVars[id] ?? "" })}
              </span>
            ) : undefined}
            {id === "client_secret" ? (
              <span className="block">
                {field.secretSet
                  ? t("settings.login.fieldClientSecretSet")
                  : t("settings.login.fieldClientSecretUnset")}
              </span>
            ) : undefined}
          </>
        }
        key={id}
        label={
          <span className="flex flex-wrap items-center gap-2">
            {t(LOGIN_FIELD_LABELS[id])}
            <SettingsStatus tone={SOURCE_TONES[field.source]}>
              {t(LOGIN_SOURCE_KEYS[field.source])}
            </SettingsStatus>
          </span>
        }
      >
        {id === "enabled" || id === "use_pkce" || id === "logout_idp" ? (
          <>
            <Switch
              checked={booleanState[id][0]}
              disabled={fieldDisabled}
              label={t(LOGIN_FIELD_LABELS[id])}
              onCheckedChange={booleanState[id][1]}
            />
            {pinned ? undefined : (
              <input name={id} type="hidden" value={booleanState[id][0] ? "true" : "false"} />
            )}
          </>
        ) : id === "default_role" ? (
          <>
            <Select
              disabled={fieldDisabled}
              items={Object.entries(LOGIN_ROLE_KEYS).map(([value, key]) => ({
                value,
                label: t(key),
              }))}
              label={t(LOGIN_FIELD_LABELS[id])}
              onValueChange={(value) => setRole(value ?? "member")}
              value={role}
            />
            {pinned ? undefined : <input name="default_role" type="hidden" value={role} />}
          </>
        ) : id === "client_secret" ? (
          <Input
            autoComplete="new-password"
            defaultValue=""
            disabled={fieldDisabled || clearSecret}
            label={t(LOGIN_FIELD_LABELS[id])}
            name={pinned ? undefined : "client_secret"}
            placeholder={field.secretSet ? LOGIN_OIDC_SECRET_MASK : undefined}
            type="password"
          />
        ) : (
          <Input
            defaultValue={typeof field.value === "string" ? field.value : ""}
            disabled={fieldDisabled}
            label={t(LOGIN_FIELD_LABELS[id])}
            name={pinned ? undefined : id}
          />
        )}
      </SettingsField>
    );
  }

  const remainingPaths = confirming?.remaining ?? view.remaining;
  const remainingLabels = (["oidc", "apiKey", "proxy"] as const)
    .filter((path) => remainingPaths[path])
    .map((path) => t(LOGIN_PATH_KEYS[path]));

  return (
    <section className="flex w-full flex-col gap-5">
      <p className="text-sm text-mist-600 dark:text-mist-400">
        {t("settings.login.configPrecedence")}
      </p>

      {view.configUnreadable ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {t("settings.login.errorConfigUnreadable")}
        </p>
      ) : undefined}

      {view.restartRequired ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          <span className="font-medium">{t("settings.login.restartRequiredShort")}</span>{" "}
          {t("settings.login.configRestartWarning")}
        </p>
      ) : undefined}

      <fetcher.Form className="flex flex-col gap-5" method="post">
        <input name="action_id" type="hidden" value="save" />

        {LOGIN_OIDC_FIELD_GROUPS.map((group) => (
          <div className="flex flex-col gap-4" key={group.id}>
            <h3 className="text-sm font-semibold text-mist-700 dark:text-mist-200">
              {t(LOGIN_GROUP_LABELS[group.id])}
            </h3>
            {group.fields.map((id) => renderField(id))}
          </div>
        ))}

        {isPinned("client_secret") ? undefined : (
          <SettingsField description={t("settings.login.fieldClientSecretClearDescription")}>
            <span className="flex items-center gap-2">
              <Switch
                checked={clearSecret}
                disabled={disabled}
                label={t("settings.login.fieldClientSecretClear")}
                onCheckedChange={setClearSecret}
              />
              <span className="text-sm">{t("settings.login.fieldClientSecretClear")}</span>
            </span>
            <input
              name="clear_client_secret"
              type="hidden"
              value={clearSecret ? "true" : "false"}
            />
          </SettingsField>
        )}

        {confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <span className="font-medium">{t("settings.login.confirmTitle")}</span>
            <span>{t("settings.login.confirmIntro")}</span>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {confirming.reasons?.map((reason) => (
                <li key={reason}>{t(LOGIN_LOCKOUT_REASON_KEYS[reason])}</li>
              ))}
            </ul>
            <span>
              {t("settings.login.confirmRemaining", {
                methods: remainingLabels.join(", ") || t("settings.login.pathNone"),
              })}
            </span>
            <span className="text-xs">{t("settings.login.confirmHint")}</span>
          </div>
        ) : undefined}

        {messages.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 rounded-lg bg-red-50 p-3 pl-8 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : undefined}

        {!canEdit ? (
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("errors.permission.modifyIam")}
          </p>
        ) : undefined}

        <SettingsActions>
          {saved ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              {t("settings.login.savedMessage")}
            </span>
          ) : undefined}
          <Button disabled={disabled} type="submit" variant="heavy">
            {isBusy
              ? t("settings.login.saving")
              : confirming
                ? t("settings.login.confirmButton")
                : t("settings.login.saveButton")}
          </Button>
        </SettingsActions>

        {confirming ? <input name="confirm" type="hidden" value="true" /> : undefined}
      </fetcher.Form>
    </section>
  );
}
