import {
  Activity,
  Boxes,
  Cable,
  CheckCircle,
  CircleAlert,
  CircleX,
  Database,
  FileCheck,
  FileText,
  Globe,
  HeartPulse,
  KeyRound,
  Lock,
  Package,
  Power,
  Settings2,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Chip from "~/components/chip";
import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsPage,
  SettingsPanel,
  SettingsTab,
  SettingsTabList,
  SettingsTabs,
  type SettingsStatusTone,
} from "~/components/settings-nav";
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
import type { ConfigCheckId } from "./config-checks";
import { loadConfigChecks } from "./config-probe";
import {
  computeDiagnostics,
  integrationAction,
  isBehindProxy,
  isNewerVersion,
  type ApiKeyStatus,
  type Diagnostic,
  type DiagnosticId,
  type DiagnosticStatus,
  type OidcStatus,
} from "./diagnostics";
import { SYSTEM_ERROR_KEYS, type SystemResult } from "./error-keys";
import MetricsPanel from "./metrics-panel";
import { loadMetrics } from "./metrics-probe";
import { headplaneReleaseChecker, headscaleReleaseChecker } from "./release-check";
import { selfUpdateNotice } from "./self-update";

const STATUS_KEYS: Record<DiagnosticStatus, TranslationKey> = {
  pass: "settings.system.checkStatusPass",
  warning: "settings.system.checkStatusWarning",
  fail: "settings.system.checkStatusFail",
};

/** A named set of checks that opens and closes as one block. */
interface CheckGroup<Id extends string> {
  id: string;
  titleKey: TranslationKey;
  icon: LucideIcon;
  ids: readonly Id[];
}

/** The diagnostics, grouped the way an operator works through them. */
const DIAGNOSTIC_GROUPS: readonly CheckGroup<DiagnosticId>[] = [
  {
    id: "connection",
    titleKey: "settings.system.groups.connection",
    icon: Cable,
    ids: ["reachable", "apiKey"],
  },
  { id: "version", titleKey: "settings.system.groups.version", icon: Package, ids: ["version"] },
  {
    id: "configuration",
    titleKey: "settings.system.groups.configuration",
    icon: Settings2,
    ids: ["policyMode", "oidc", "trustedProxies", "configAccess"],
  },
  {
    id: "integration",
    titleKey: "settings.system.groups.integration",
    icon: Boxes,
    ids: ["integration"],
  },
];

/** The configuration file checks, grouped by the part of config.yaml they read. */
const CONFIG_CHECK_GROUPS: readonly CheckGroup<ConfigCheckId>[] = [
  {
    id: "oidc",
    titleKey: "settings.system.groups.oidc",
    icon: KeyRound,
    ids: ["configOidcKeys", "configOidc"],
  },
  {
    id: "proxies",
    titleKey: "settings.system.groups.proxies",
    icon: ShieldCheck,
    ids: ["configTrustedProxies"],
  },
  { id: "tls", titleKey: "settings.system.groups.tls", icon: Lock, ids: ["configTls"] },
  {
    id: "database",
    titleKey: "settings.system.groups.database",
    icon: Database,
    ids: ["configDatabase", "configNoiseKey"],
  },
  {
    id: "policy",
    titleKey: "settings.system.groups.policy",
    icon: FileText,
    ids: ["configPolicy"],
  },
  { id: "dns", titleKey: "settings.system.groups.dns", icon: Globe, ids: ["configDnsRecords"] },
];

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
  const configPath = appConfig?.headscale.config_path;

  // A web version of `headscale configtest`, read straight from the file on
  // disk, the metrics endpoint Headscale's own configuration points at, and the
  // two cached release lookups. All four degrade to "nothing to report" instead
  // of blocking the status page, so they run together rather than in series.
  const [latest, latestHeadplane, configChecks, metrics] = await Promise.all([
    headscaleReleaseChecker.latest(),
    headplaneReleaseChecker.latest(),
    loadConfigChecks(configPath),
    loadMetrics(configPath, appConfig?.headscale.url),
  ]);

  const updateAvailable = latest !== undefined && isNewerVersion(serverVersion, latest);
  // The self-update notice compares Headplane's own release against the version
  // this build reports as `__VERSION__`; a custom build is never nagged.
  const selfUpdate = selfUpdateNotice(__VERSION__, latestHeadplane);

  const behindProxy = isBehindProxy(request.headers);
  const trustedProxyCount = trustedProxies.length;
  const integrationName = integration?.name;

  return {
    reachable,
    version: formatServerVersion(serverVersion),
    updateAvailable,
    latestVersion: updateAvailable && latest ? formatServerVersion(latest) : undefined,
    selfUpdate,
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
    metrics,
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
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.system.breadcrumb")}
        </>
      }
      description={t("settings.system.body")}
      notices={
        <>
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

          {loaderData.selfUpdate ? (
            <Notice
              icon={<Package className="text-indigo-500" />}
              title={t("settings.system.selfUpdate.title")}
            >
              {tr("settings.system.selfUpdate.body", {
                current: loaderData.selfUpdate.current,
                latest: loaderData.selfUpdate.latest,
                link: (
                  <Link external styled to={loaderData.selfUpdate.url}>
                    {t("settings.system.selfUpdate.link")}
                  </Link>
                ),
              })}
            </Notice>
          ) : undefined}
        </>
      }
      title={t("settings.system.title")}
    >
      <SettingsTabs defaultValue="status" label={t("settings.system.tabsLabel")}>
        <SettingsTabList>
          <SettingsTab className="shrink-0" icon={HeartPulse} value="status">
            {t("settings.system.statusTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Power} value="process">
            {t("settings.system.processTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Stethoscope} value="diagnostics">
            {t("settings.system.checksTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={FileCheck} value="configuration">
            {t("settings.system.configChecks.title")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Activity} value="metrics">
            {t("settings.system.metrics.title")}
          </SettingsTab>
        </SettingsTabList>

        <SettingsPanel value="status">
          <SettingsCollapsible
            defaultOpen
            description={!reachable ? t("settings.system.statusUnhealthyBody") : undefined}
            icon={HeartPulse}
            status={{
              tone: reachable ? "ok" : "error",
              label: reachable
                ? t("settings.system.statusHealthy")
                : t("settings.system.statusUnhealthy"),
            }}
            title={t("settings.system.statusTitle")}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusCircle className="h-4 w-4" isOnline={reachable} />
              <span className="font-medium">{t("settings.system.versionLabel")}:</span>
              <Code>{loaderData.version}</Code>
              {loaderData.updateAvailable ? (
                <Chip
                  className="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                  text={t("settings.system.updateBadge")}
                />
              ) : undefined}
            </div>
            {loaderData.updateAvailable && loaderData.latestVersion ? (
              <p className="text-sm text-mist-600 dark:text-mist-400">
                {t("settings.system.updateBody", {
                  latest: loaderData.latestVersion,
                  current: loaderData.version,
                })}
              </p>
            ) : undefined}
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="process">
          <SettingsCollapsible
            defaultOpen
            description={t("settings.system.processBody")}
            icon={Power}
            status={{
              tone: !integration ? "neutral" : loaderData.canProcess ? "ok" : "warn",
              label: processSummary,
            }}
            title={t("settings.system.processTitle")}
          >
            {integration ? (
              <p className="text-sm text-mist-600 dark:text-mist-400">
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

            <fetcher.Form method="post">
              <input name="action_id" type="hidden" value="process_config_change" />
              <SettingsActions>
                {succeeded ? (
                  <span className="text-sm text-emerald-600 dark:text-emerald-400">
                    {t("settings.system.processSuccess")}
                  </span>
                ) : undefined}
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
              </SettingsActions>
            </fetcher.Form>

            {!loaderData.canProcess ? (
              <Notice title={t("settings.system.processRestrictedTitle")} variant="warning">
                {t("errors.permission.modifyIam")}
              </Notice>
            ) : undefined}

            {error ? (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            ) : undefined}
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="diagnostics">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{summarize(t, loaderData.diagnostics)}</p>
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.system.checksBody")}
            </p>
          </div>
          <CheckGroups checks={loaderData.diagnostics} groups={DIAGNOSTIC_GROUPS} />
        </SettingsPanel>

        <SettingsPanel value="configuration">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {loaderData.configChecks.length > 0
                ? summarize(t, loaderData.configChecks)
                : t("settings.system.summaryChecksUnavailable")}
            </p>
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.system.configChecks.body")}
            </p>
          </div>
          {loaderData.configChecks.length > 0 ? (
            <CheckGroups checks={loaderData.configChecks} groups={CONFIG_CHECK_GROUPS} />
          ) : (
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.system.configChecks.unavailable")}
            </p>
          )}
        </SettingsPanel>

        <SettingsPanel value="metrics">
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.system.metrics.body")}
          </p>
          <MetricsPanel metrics={loaderData.metrics} />
        </SettingsPanel>
      </SettingsTabs>
    </SettingsPage>
  );
}

type CheckRow = Pick<Diagnostic, "status" | "titleKey" | "bodyKey" | "vars" | "link"> & {
  id: string;
};

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface CheckCounts {
  pass: number;
  warning: number;
  fail: number;
}

function countChecks(checks: readonly CheckRow[]): CheckCounts {
  const counts: CheckCounts = { pass: 0, warning: 0, fail: 0 };
  for (const check of checks) {
    counts[check.status] += 1;
  }

  return counts;
}

/** The one-line "what is set right now" text of a check list row. */
function summarize(t: Translate, checks: readonly CheckRow[]) {
  const counts = countChecks(checks);

  return t("settings.system.summaryChecks", {
    total: checks.length,
    pass: counts.pass,
    warning: counts.warning,
    fail: counts.fail,
  });
}

/** The compact pill beside a group's title: only the counts that are non-zero. */
function countStatus(t: Translate, counts: CheckCounts) {
  const parts: string[] = [];
  if (counts.pass > 0) {
    parts.push(t("settings.system.statusPass", { count: counts.pass }));
  }
  if (counts.warning > 0) {
    parts.push(t("settings.system.statusWarning", { count: counts.warning }));
  }
  if (counts.fail > 0) {
    parts.push(t("settings.system.statusFail", { count: counts.fail }));
  }

  return parts.join(" · ");
}

/** A group reads green only when nothing in it needs attention. */
function countsTone(counts: CheckCounts): SettingsStatusTone {
  if (counts.fail > 0) {
    return "error";
  }

  return counts.warning > 0 ? "warn" : "ok";
}

/**
 * Renders the checks of a page as collapsible blocks, one per group. A group
 * only contains checks the loader produced, so a group with nothing to show is
 * skipped instead of rendering an empty block.
 */
function CheckGroups<Id extends string>({
  checks,
  groups,
}: {
  checks: readonly (CheckRow & { id: Id })[];
  groups: readonly CheckGroup<Id>[];
}) {
  const { t } = useI18n();

  return (
    <SettingsCollapsibleGroup>
      {groups.map((group) => {
        const rows = checks.filter((check) => group.ids.includes(check.id));
        if (rows.length === 0) {
          return undefined;
        }

        const counts = countChecks(rows);
        return (
          <SettingsCollapsible
            defaultOpen={counts.fail > 0}
            icon={group.icon}
            key={group.id}
            status={{ tone: countsTone(counts), label: countStatus(t, counts) }}
            summary={summarize(t, rows)}
            title={t(group.titleKey)}
          >
            <CheckList checks={rows} />
          </SettingsCollapsible>
        );
      })}
    </SettingsCollapsibleGroup>
  );
}

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
