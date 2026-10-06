import { BellRing, History, Webhook } from "lucide-react";
import { useState } from "react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import Select from "~/components/select";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsField,
  SettingsPage,
  SettingsStatus,
  type SettingsStatusTone,
} from "~/components/settings-nav";
import Switch from "~/components/switch";
import TableList from "~/components/table-list";
import Text from "~/components/text";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type { AlertDelivery, AlertLanguage, AlertSettings } from "~/server/alerts/types";
import { alertsContext, authContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { alertsAction, type AlertActionResult } from "./actions";
import { alertMessage } from "./alert-message";
import { ALERT_ERROR_KEYS } from "./error-keys";
import { ALERT_EVENT_KEYS, ALERT_EVENT_ORDER } from "./labels";

/**
 * The payload languages the channel can be pinned to. `default` follows the
 * application default, the other three are the supported UI locales; their
 * labels come from the existing `language.*` entries so the names are spelled
 * the same way everywhere.
 */
const ALERT_LANGUAGE_ITEMS: { value: AlertLanguage; labelKey: TranslationKey }[] = [
  { value: "default", labelKey: "settings.notifications.notificationLanguageDefault" },
  { value: "en", labelKey: "language.en" },
  { value: "zh-Hans", labelKey: "language.zh-Hans" },
  { value: "zh-Hant", labelKey: "language.zh-Hant" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const alerts = context.get(alertsContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  await alerts.ready();
  return { settings: alerts.settings(), history: alerts.history() };
}

export const action = alertsAction;

export default function Page({ loaderData: { settings, history } }: Route.ComponentProps) {
  const { t } = useI18n();
  const last = history[0];

  const statusTone: SettingsStatusTone = !settings.enabled
    ? "neutral"
    : last === undefined
      ? "neutral"
      : last.ok
        ? "ok"
        : "error";
  const statusLabel = !settings.enabled
    ? t("settings.notifications.statusDisabled")
    : last === undefined
      ? t("settings.notifications.statusNever")
      : last.ok
        ? t("settings.notifications.statusLastOk")
        : t("settings.notifications.statusLastFailed");

  return (
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.notifications.breadcrumb")}
        </>
      }
      description={t("settings.notifications.body")}
      notices={
        last !== undefined && !last.ok ? (
          <Notice title={t("settings.notifications.failureTitle")} variant="error">
            {t("settings.notifications.failureBody")}
          </Notice>
        ) : undefined
      }
      title={t("settings.notifications.title")}
    >
      <SettingsCollapsibleGroup>
        <ChannelSection settings={settings} />
        <EventsSection settings={settings} />
        <HistorySection history={history} statusLabel={statusLabel} statusTone={statusTone} />
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}

function ChannelSection({ settings }: { settings: AlertSettings }) {
  const { t } = useI18n();
  const saveFetcher = useFetcher<AlertActionResult>();
  const testFetcher = useFetcher<AlertActionResult>();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [webhookUrl, setWebhookUrl] = useState(settings.webhookUrl);
  const [secret, setSecret] = useState(settings.secret);
  const [notificationLanguage, setNotificationLanguage] = useState(settings.notificationLanguage);

  const saveResult = saveFetcher.data;
  const saveError =
    saveResult && !saveResult.success ? t(ALERT_ERROR_KEYS[saveResult.errorCode]) : undefined;
  const saved = !saveError && saveResult?.success === true && saveResult.kind === "save";

  const testResult = testFetcher.data;
  const testOutcome =
    testResult?.success === true && testResult.kind === "test" ? testResult : undefined;

  return (
    <SettingsCollapsible
      description={t("settings.notifications.channelBody")}
      hasError={Boolean(saveError) || testOutcome?.ok === false}
      icon={Webhook}
      status={{
        tone: settings.enabled ? "ok" : "neutral",
        label: settings.enabled
          ? t("settings.notifications.statusEnabled")
          : t("settings.notifications.statusDisabled"),
      }}
      summary={settings.webhookUrl || t("settings.notifications.channelSummaryEmpty")}
      title={t("settings.notifications.channelTitle")}
    >
      <saveFetcher.Form className="flex flex-col gap-4" method="post">
        <input name="action_id" type="hidden" value="save_channel" />
        <input name="enabled" type="hidden" value={enabled ? "true" : "false"} />

        <SettingsField
          description={t("settings.notifications.enabledDescription")}
          label={t("settings.notifications.enabledLabel")}
        >
          <span className="flex items-center gap-3">
            <Switch
              checked={enabled}
              label={t("settings.notifications.enabledLabel")}
              onCheckedChange={setEnabled}
            />
            <span className="text-sm text-mist-600 dark:text-mist-400">
              {enabled
                ? t("settings.notifications.enabledOn")
                : t("settings.notifications.enabledOff")}
            </span>
          </span>
        </SettingsField>

        {/* The connection fields pair up on a wide page; the switch keeps
            the full row because its help text is a sentence, not a label. */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Input
            description={t("settings.notifications.webhookUrlDescription")}
            label={t("settings.notifications.webhookUrlLabel")}
            name="webhook_url"
            onChange={setWebhookUrl}
            placeholder="https://example.com/headplane-hook"
            value={webhookUrl}
          />

          <Input
            autoComplete="off"
            description={t("settings.notifications.secretDescription")}
            label={t("settings.notifications.secretLabel")}
            name="secret"
            onChange={setSecret}
            type="password"
            value={secret}
          />

          <Select
            description={t("settings.notifications.notificationLanguageDescription")}
            items={ALERT_LANGUAGE_ITEMS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            label={t("settings.notifications.notificationLanguageLabel")}
            name="notification_language"
            onValueChange={(value) =>
              setNotificationLanguage((value ?? "default") as AlertLanguage)
            }
            value={notificationLanguage}
          />
        </div>

        <SettingsActions>
          <Button disabled={saveFetcher.state !== "idle"} type="submit" variant="heavy">
            {saveFetcher.state !== "idle"
              ? t("settings.notifications.saving")
              : t("settings.notifications.save")}
          </Button>
        </SettingsActions>

        {saveError ? (
          <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            {saveError}
          </p>
        ) : undefined}
        {saved ? <Text>{t("settings.notifications.saved")}</Text> : undefined}
      </saveFetcher.Form>

      <testFetcher.Form className="flex flex-col gap-3" method="post">
        <input name="action_id" type="hidden" value="test" />
        <input name="webhook_url" type="hidden" value={webhookUrl} />
        <input name="secret" type="hidden" value={secret} />
        <input name="notification_language" type="hidden" value={notificationLanguage} />

        <Text>{t("settings.notifications.testBody")}</Text>

        <SettingsActions>
          <Button disabled={testFetcher.state !== "idle"} type="submit">
            {testFetcher.state !== "idle"
              ? t("settings.notifications.testing")
              : t("settings.notifications.test")}
          </Button>
        </SettingsActions>

        {testOutcome ? (
          <span className="flex flex-wrap items-center gap-2">
            <SettingsStatus tone={testOutcome.ok ? "ok" : "error"}>
              {testOutcome.ok
                ? t("settings.notifications.testOk", { status: testOutcome.status ?? 200 })
                : t("settings.notifications.testFailed", { status: testOutcome.status ?? 0 })}
            </SettingsStatus>
            {testOutcome.error ? (
              <span className="font-mono text-xs text-red-600 dark:text-red-400">
                {testOutcome.error}
              </span>
            ) : undefined}
          </span>
        ) : undefined}
      </testFetcher.Form>
    </SettingsCollapsible>
  );
}

function EventsSection({ settings }: { settings: AlertSettings }) {
  const { t } = useI18n();
  const fetcher = useFetcher<AlertActionResult>();

  const [selected, setSelected] = useState<string[]>(settings.events);
  const result = fetcher.data;
  const error = result && !result.success ? t(ALERT_ERROR_KEYS[result.errorCode]) : undefined;
  const saved = !error && result?.success === true && result.kind === "save";

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <SettingsCollapsible
      description={t("settings.notifications.eventsBody")}
      hasError={Boolean(error)}
      icon={BellRing}
      status={{
        tone: selected.length > 0 ? "ok" : "error",
        label: t("settings.notifications.eventsSummary", { count: selected.length }),
      }}
      summary={selected
        .map((id) => t(ALERT_EVENT_KEYS[id as keyof typeof ALERT_EVENT_KEYS]))
        .join(" · ")}
      title={t("settings.notifications.eventsTitle")}
    >
      <fetcher.Form className="flex flex-col gap-4" method="post">
        <input name="action_id" type="hidden" value="save_events" />

        <SettingsField
          description={t("settings.notifications.eventsDescription")}
          label={t("settings.notifications.eventsLabel")}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ALERT_EVENT_ORDER.map((id) => (
              <label className="flex items-center gap-2 text-sm" key={id}>
                <input
                  checked={selected.includes(id)}
                  className="h-4 w-4 accent-indigo-500"
                  name="events"
                  onChange={() => toggle(id)}
                  type="checkbox"
                  value={id}
                />
                {t(ALERT_EVENT_KEYS[id])}
              </label>
            ))}
          </div>
        </SettingsField>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            defaultValue={String(settings.intervalSeconds)}
            description={t("settings.notifications.intervalDescription")}
            label={t("settings.notifications.intervalLabel")}
            name="interval"
            required
            type="number"
          />
          <Input
            defaultValue={String(settings.cooldownSeconds)}
            description={t("settings.notifications.cooldownDescription")}
            label={t("settings.notifications.cooldownLabel")}
            name="cooldown"
            required
            type="number"
          />
          <Input
            defaultValue={String(settings.apiKeyExpiryDays)}
            description={t("settings.notifications.expiryDescription")}
            label={t("settings.notifications.expiryLabel")}
            name="api_key_expiry_days"
            required
            type="number"
          />
        </div>

        <SettingsActions>
          <Button disabled={fetcher.state !== "idle"} type="submit" variant="heavy">
            {fetcher.state !== "idle"
              ? t("settings.notifications.saving")
              : t("settings.notifications.save")}
          </Button>
        </SettingsActions>

        {error ? (
          <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : undefined}
        {saved ? <Text>{t("settings.notifications.saved")}</Text> : undefined}
      </fetcher.Form>
    </SettingsCollapsible>
  );
}

function HistorySection({
  history,
  statusLabel,
  statusTone,
}: {
  history: AlertDelivery[];
  statusLabel: string;
  statusTone: SettingsStatusTone;
}) {
  const { t } = useI18n();

  return (
    <SettingsCollapsible
      description={t("settings.notifications.historyBody")}
      icon={History}
      status={{ tone: statusTone, label: statusLabel }}
      summary={t("settings.notifications.historySummary", { count: history.length })}
      title={t("settings.notifications.historyTitle")}
    >
      <TableList className="border-0">
        {history.length === 0 ? (
          <TableList.Item className="justify-center py-4 opacity-70">
            <p className="font-semibold">{t("settings.notifications.historyEmpty")}</p>
          </TableList.Item>
        ) : (
          history.map((entry) => (
            <TableList.Item className="justify-start gap-3" key={entry.id}>
              <DeliveryRow delivery={entry} />
            </TableList.Item>
          ))
        )}
      </TableList>
    </SettingsCollapsible>
  );
}

function DeliveryRow({ delivery }: { delivery: AlertDelivery }) {
  const { t, locale } = useI18n();
  const kind = delivery.ok ? "ok" : "error";
  // Built from the catalog on every render, so an alert already in the history
  // reads in the language the interface is switched to right now.
  const message = alertMessage(locale, {
    id: delivery.event,
    target: delivery.target,
    threshold: delivery.threshold,
  });

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{message.title}</span>
        <SettingsStatus tone={kind}>
          {delivery.ok
            ? t("settings.notifications.historyOk")
            : t("settings.notifications.historyFailed")}
        </SettingsStatus>
        {delivery.status !== null ? (
          <span className="font-mono text-xs text-mist-500 dark:text-mist-400">
            {t("settings.notifications.historyStatus", { status: delivery.status })}
          </span>
        ) : undefined}
      </span>

      <span className="text-mist-600 dark:text-mist-300">{message.body}</span>

      <span className="flex flex-wrap items-center gap-2 text-xs text-mist-600 dark:text-mist-400">
        <span suppressHydrationWarning>{new Date(delivery.at).toLocaleString()}</span>
        {delivery.target !== undefined ? <span>{delivery.target}</span> : undefined}
        {delivery.threshold !== undefined ? (
          <span>{t("settings.notifications.historyThreshold", { days: delivery.threshold })}</span>
        ) : undefined}
      </span>

      {delivery.error !== null ? (
        <span className="font-mono text-xs text-red-600 dark:text-red-400">{delivery.error}</span>
      ) : undefined}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
