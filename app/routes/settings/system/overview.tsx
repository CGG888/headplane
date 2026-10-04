import { CheckCircle, CircleAlert, CircleX } from "lucide-react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Chip from "~/components/chip";
import Code from "~/components/code";
import { SettingsSection, SettingsSectionList } from "~/components/drawer";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import StatusCircle from "~/components/status-circle";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import {
  appConfigContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  requestApiContext,
} from "~/server/context";
import { isDataUnauthorizedError } from "~/server/headscale/api/error-client";
import { formatServerVersion } from "~/server/headscale/api/server-version";
import { Capabilities } from "~/server/web/roles";
import cn from "~/utils/cn";

import type { Route } from "./+types/overview";
import { systemAction } from "./actions";
import { loadConfigChecks } from "./config-probe";
import {
  computeDiagnostics,
  integrationAction,
  isBehindProxy,
  isNewerVersion,
  type ApiKeyStatus,
  type Diagnostic,
  type DiagnosticStatus,
  type OidcStatus,
} from "./diagnostics";
import { SYSTEM_ERROR_KEYS, type SystemResult } from "./error-keys";
import { headscaleReleaseChecker } from "./release-check";

const STATUS_KEYS: Record<DiagnosticStatus, TranslationKey> = {
  pass: "settings.system.checkStatusPass",
  warning: "settings.system.checkStatusWarning",
  fail: "settings.system.checkStatusFail",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const appConfig = context.get(appConfigContext);
  const integration = context.get(integrationContext);
  const getRequestApi = context.get(requestApiContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.ui_access)) {
    throw data({ localized: { key: "errors.permission.view" } }, { status: 403 });
  }

  const reachable = await headscale.health();

  // Same probe the app layout uses to log a session out: a 401 from the API
  // key list means the key Headplane was configured with is dead.
  let apiKey: ApiKeyStatus = "unknown";
  if (reachable) {
    try {
      const { api } = await getRequestApi(request);
      await api.apiKeys.list();
      apiKey = "valid";
    } catch (error) {
      apiKey = isDataUnauthorizedError(error) ? "invalid" : "unknown";
    }
  }

  const configReadable = headscaleConfig.readable();
  const configWritable = headscaleConfig.writable();
  const { policyMode, trustedProxies } = headscaleConfig.getTailnetSettings();

  // An unreadable config file says nothing about OIDC, so that stays unknown
  // instead of being reported as "not configured".
  let oidc: OidcStatus = "unknown";
  if (configReadable) {
    oidc = headscaleConfig.getOIDCSettings() ? "configured" : "missing";
  }

  const serverVersion = headscale.version;
  const latest = await headscaleReleaseChecker.latest();
  const updateAvailable = latest !== undefined && isNewerVersion(serverVersion, latest);

  const behindProxy = isBehindProxy(request.headers);
  const trustedProxyCount = trustedProxies.length;
  const integrationName = integration?.name;

  // A web version of `headscale configtest`, read straight from the file on
  // disk. It degrades to an empty list when the file cannot be read, so it
  // never blocks the status page.
  const configChecks = await loadConfigChecks(appConfig?.headscale.config_path);

  return {
    reachable,
    version: formatServerVersion(serverVersion),
    updateAvailable,
    latestVersion: updateAvailable && latest ? formatServerVersion(latest) : undefined,
    canProcess: auth.can(principal, Capabilities.configure_iam),
    integration: integration
      ? { name: integration.name, action: integrationAction(integration.name) }
      : null,
    // The raw inputs behind the diagnostics, for anything that wants the values
    // without parsing the check list.
    checks: {
      apiKey,
      configReadable,
      configWritable,
      policyMode,
      oidc,
      trustedProxyCount,
      behindProxy,
      integrationName: integrationName ?? null,
    },
    diagnostics: computeDiagnostics({
      reachable,
      apiKey,
      version: serverVersion,
      configReadable,
      configWritable,
      policyMode,
      oidc,
      trustedProxies: trustedProxyCount,
      behindProxy,
      integrationName,
    }),
    configChecks,
  };
}

export const action = systemAction;

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const fetcher = useFetcher<SystemResult>();
  const isBusy = fetcher.state !== "idle";

  const result = fetcher.data;
  const error = result && !result.success ? t(SYSTEM_ERROR_KEYS[result.errorCode]) : undefined;
  const succeeded = Boolean(result?.success) && !isBusy;

  const { reachable, integration } = loaderData;
  const isReload = integration?.action === "reload";

  /** The one-line "what is set right now" text of a check list row. */
  const summarize = (checks: readonly CheckRow[]) => {
    const counts = { pass: 0, warning: 0, fail: 0 };
    for (const check of checks) {
      counts[check.status] += 1;
    }

    return t("settings.system.summaryChecks", {
      total: checks.length,
      pass: counts.pass,
      warning: counts.warning,
      fail: counts.fail,
    });
  };

  // A failure is the one thing an operator has to see without opening anything.
  // The reachable check is left out because the notice above already says it.
  const failed = [...loaderData.diagnostics, ...loaderData.configChecks].filter(
    (check) => check.status === "fail" && check.id !== "reachable",
  );

  const processSummary = !integration
    ? t("settings.system.summaryProcessNone")
    : !loaderData.canProcess
      ? t("settings.system.processRestrictedTitle")
      : `${integration.name} · ${
          isReload ? t("settings.system.processReload") : t("settings.system.processRestart")
        }`;

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-4">
      <div className="flex w-full flex-col sm:w-2/3">
        <p className="text-md mb-4">
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.system.breadcrumb")}
        </p>
        <h1 className="mt-4 mb-2 text-2xl font-medium">{t("settings.system.title")}</h1>
        <p>{t("settings.system.body")}</p>
      </div>

      {!reachable ? (
        <Notice
          icon={<CircleX className="text-red-500" />}
          title={t("settings.system.statusUnhealthy")}
          variant="error"
        >
          {t("settings.system.statusUnhealthyBody")}
        </Notice>
      ) : undefined}

      {failed.length > 0 ? (
        <Notice
          title={t("settings.system.checksFailedTitle", { count: failed.length })}
          variant="error"
        >
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {failed.map((check) => (
              <li key={check.id}>{t(check.titleKey)}</li>
            ))}
          </ul>
        </Notice>
      ) : undefined}

      <div className="w-full sm:w-2/3">
        <SettingsSectionList>
          <SettingsSection
            badge={
              loaderData.updateAvailable ? (
                <Chip
                  className="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                  text={t("settings.system.updateBadge")}
                />
              ) : undefined
            }
            summary={
              reachable
                ? t("settings.system.summaryHealthy", { version: loaderData.version })
                : t("settings.system.statusUnhealthy")
            }
            title={t("settings.system.statusTitle")}
          >
            <div className="flex items-center gap-3">
              <StatusCircle className="h-5 w-5" isOnline={reachable} />
              <span className="text-lg font-medium">
                {reachable
                  ? t("settings.system.statusHealthy")
                  : t("settings.system.statusUnhealthy")}
              </span>
            </div>
            {!reachable ? (
              <p className="mt-2 text-sm">{t("settings.system.statusUnhealthyBody")}</p>
            ) : undefined}

            <p className="text-md mt-4 flex items-center gap-2">
              <span className="font-medium">{t("settings.system.versionLabel")}:</span>
              <Code>{loaderData.version}</Code>
            </p>
            {loaderData.updateAvailable && loaderData.latestVersion ? (
              <p className="mt-1 text-sm opacity-70">
                {t("settings.system.updateBody", {
                  latest: loaderData.latestVersion,
                  current: loaderData.version,
                })}
              </p>
            ) : undefined}
          </SettingsSection>

          <SettingsSection
            description={t("settings.system.processBody")}
            summary={processSummary}
            title={t("settings.system.processTitle")}
          >
            {integration ? (
              <p className="text-sm opacity-70">
                {isReload
                  ? t("settings.system.processSemanticsReload", { name: integration.name })
                  : t("settings.system.processSemanticsRestart", { name: integration.name })}
              </p>
            ) : (
              <Notice
                icon={<CircleX className="text-mist-400" />}
                title={t("settings.system.processUnavailableTitle")}
              >
                {tr("settings.system.processUnavailableBody", {
                  link: (
                    <Link external styled to="https://headplane.net/features/system-status">
                      {t("settings.system.processUnavailableLink")}
                    </Link>
                  ),
                })}
              </Notice>
            )}

            <fetcher.Form className="mt-4 flex items-center gap-3" method="post">
              <input name="action_id" type="hidden" value="process_config_change" />
              <Button
                disabled={isBusy || !integration || !loaderData.canProcess}
                type="submit"
                variant={isReload ? "heavy" : "danger"}
              >
                {isBusy
                  ? t("settings.system.processPending")
                  : isReload
                    ? t("settings.system.processReload")
                    : t("settings.system.processRestart")}
              </Button>
              {succeeded ? (
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                  {t("settings.system.processSuccess")}
                </span>
              ) : undefined}
            </fetcher.Form>

            {!loaderData.canProcess ? (
              <Notice title={t("settings.system.processRestrictedTitle")} variant="warning">
                {t("errors.permission.modifyIam")}
              </Notice>
            ) : undefined}

            {error ? (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            ) : undefined}
          </SettingsSection>

          <SettingsSection
            description={t("settings.system.checksBody")}
            size="wide"
            summary={summarize(loaderData.diagnostics)}
            title={t("settings.system.checksTitle")}
          >
            <CheckList checks={loaderData.diagnostics} />
          </SettingsSection>

          <SettingsSection
            description={t("settings.system.configChecks.body")}
            size="wide"
            summary={
              loaderData.configChecks.length > 0
                ? summarize(loaderData.configChecks)
                : t("settings.system.summaryChecksUnavailable")
            }
            title={t("settings.system.configChecks.title")}
          >
            {loaderData.configChecks.length > 0 ? (
              <CheckList checks={loaderData.configChecks} />
            ) : (
              <p className="text-sm opacity-70">{t("settings.system.configChecks.unavailable")}</p>
            )}
          </SettingsSection>
        </SettingsSectionList>
      </div>
    </div>
  );
}

type CheckRow = Pick<Diagnostic, "status" | "titleKey" | "bodyKey" | "vars" | "link"> & {
  id: string;
};

function CheckList({ checks }: { checks: readonly CheckRow[] }) {
  const { t } = useI18n();

  return (
    <ul className="flex flex-col gap-3">
      {checks.map((diagnostic) => (
        <li
          className="rounded-lg border border-mist-200 p-4 dark:border-mist-700"
          key={diagnostic.id}
        >
          <div className="flex items-center gap-2">
            <StatusIcon status={diagnostic.status} />
            <span className="font-medium">{t(diagnostic.titleKey)}</span>
            <span className={cn("text-xs", STATUS_TEXT[diagnostic.status])}>
              {t(STATUS_KEYS[diagnostic.status])}
            </span>
          </div>
          <p className="mt-2 text-sm opacity-80">{t(diagnostic.bodyKey, diagnostic.vars)}</p>
          {diagnostic.link ? (
            <Link
              className="mt-2 inline-block text-sm font-medium text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              to={diagnostic.link.to}
            >
              {t(diagnostic.link.labelKey)}
            </Link>
          ) : undefined}
        </li>
      ))}
    </ul>
  );
}

const STATUS_TEXT: Record<DiagnosticStatus, string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  warning: "text-yellow-600 dark:text-yellow-500",
  fail: "text-red-600 dark:text-red-400",
};

function StatusIcon({ status }: { status: DiagnosticStatus }) {
  const className = cn("h-5 w-5 shrink-0", STATUS_TEXT[status]);
  switch (status) {
    case "pass":
      return <CheckCircle className={className} />;
    case "warning":
      return <CircleAlert className={className} />;
    case "fail":
      return <CircleX className={className} />;
  }
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
