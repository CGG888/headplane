import { Activity, BookOpen, Cpu, RefreshCw } from "lucide-react";
import { useFetcher } from "react-router";

import Attribute from "~/components/attribute";
import Button from "~/components/button";
import Link from "~/components/link";
import Notice from "~/components/notice";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsField,
  SettingsPage,
} from "~/components/settings-nav";
import StatusCircle from "~/components/status-circle";
import Text from "~/components/text";
import { useI18n, type I18nValue } from "~/i18n/provider";
import {
  agentsContext,
  authContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { nodesResource } from "~/server/headscale/live-store";
import {
  AGENT_NODE_ROW_LIMIT,
  agentSelfVersion,
  buildAgentCoverage,
  describeInterval,
  type AgentInterval,
} from "~/utils/agent-coverage";
import { formatTimeDelta } from "~/utils/time";

import type { Route } from "./+types/agent";

/** Every optional value is exposed as `null` plus a flag, never as a failure. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Renders a sync interval in the largest whole unit the locale can name. */
function formatInterval(t: I18nValue["t"], interval: AgentInterval): string {
  switch (interval.unit) {
    case "hours":
      return t("settings.agent.durationHours", { count: interval.count });
    case "minutes":
      return t("settings.agent.durationMinutes", { count: interval.count });
    default:
      return t("settings.agent.durationSeconds", { count: interval.count });
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const agents = context.get(agentsContext);
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  await auth.require(request);

  if (agents.state !== "enabled") {
    return { enabled: false as const, reason: agents.reason };
  }

  const sync = agents.value.lastSync();

  // Both probes fail soft: a value that cannot be read becomes `null`, which the
  // page renders as an em dash with a short reason instead of losing the page.
  const [records, stateExists] = await Promise.all([
    agents.value.hostRecords().catch(() => null),
    agents.value.stateExists().catch(() => null),
  ]);

  let tailnetCount: number | null = null;
  try {
    const { api } = await getRequestApi(request);
    const snapshot = await headscaleLiveStore.get(nodesResource, api);
    tailnetCount = snapshot.data.length;
  } catch {
    tailnetCount = null;
  }

  const coverage = buildAgentCoverage({
    hosts: sync.hosts,
    records: records ?? [],
    tailnetCount,
    limit: AGENT_NODE_ROW_LIMIT,
  });

  return {
    enabled: true as const,
    syncedAt: iso(sync.syncedAt),
    nodeCount: sync.nodeCount,
    error: sync.error,
    errorCode: sync.errorCode,
    authUrl: sync.authUrl,
    coverage: {
      reportedCount: coverage.reportedCount,
      tailnetCount: coverage.tailnetCount,
      missingCount: coverage.missingCount,
      surplusCount: coverage.surplusCount,
      newestAt: iso(coverage.newestAt),
      oldestAt: iso(coverage.oldestAt),
      hiddenCount: coverage.hiddenCount,
      rows: coverage.rows.map((row) => ({
        nodeKey: row.nodeKey,
        name: row.name,
        version: row.version,
        os: row.os,
        updatedAt: iso(row.updatedAt),
      })),
      recordsUnavailable: records === null,
      tailnetUnavailable: tailnetCount === null,
    },
    runtime: {
      executablePath: sync.executablePath,
      workDir: sync.workDir,
      cacheTtl: sync.cacheTtl,
      tailscaleNetns: sync.tailscaleNetns,
      agentVersion: agentSelfVersion(sync.hosts, agents.value.agentNodeKey()),
      stateExists,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const agents = context.get(agentsContext);
  const auth = context.get(authContext);

  await auth.require(request);

  if (agents.state !== "enabled") {
    return { success: false, error: agents.reason };
  }

  await agents.value.triggerSync();
  const sync = agents.value.lastSync();
  return {
    success: !sync.error,
    error: sync.error,
    authUrl: sync.authUrl,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr, locale } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const isSyncing = fetcher.state !== "idle";

  const documentationLink = (
    <Link external styled to="https://headplane.net/features/agent">
      {t("settings.agent.documentation")}
    </Link>
  );

  if (!loaderData.enabled) {
    return (
      <SettingsPage
        notices={
          <Notice title={t("settings.agent.notEnabledTitle")}>
            {tr("settings.agent.notEnabledBody", {
              reason: loaderData.reason,
              link: documentationLink,
            })}
          </Notice>
        }
        title={t("settings.agent.title")}
      >
        <SettingsCollapsibleGroup>
          <SettingsCollapsible
            defaultOpen
            description={t("settings.agent.setupRowBody")}
            icon={BookOpen}
            status={{ tone: "error", label: t("settings.agent.notEnabledTitle") }}
            title={t("settings.agent.setupTitle")}
          >
            <Text>
              {tr("settings.agent.setupBody", {
                link: documentationLink,
              })}
            </Text>
          </SettingsCollapsible>
        </SettingsCollapsibleGroup>
      </SettingsPage>
    );
  }

  const { coverage, runtime } = loaderData;
  const isPending = !loaderData.syncedAt && loaderData.authUrl;
  const hasError = Boolean(loaderData.error);
  const statusTone = hasError ? "error" : isPending ? "warn" : "ok";
  const statusText = hasError
    ? t("settings.agent.statusError")
    : isPending
      ? t("settings.agent.statusWaiting")
      : t("settings.agent.statusHealthy");
  const lastSynced = loaderData.syncedAt
    ? formatTimeDelta(new Date(loaderData.syncedAt))
    : t("settings.agent.never");
  const lastSyncedAt = loaderData.syncedAt
    ? new Date(loaderData.syncedAt).toLocaleString(locale)
    : t("settings.agent.never");

  const interval = describeInterval(runtime.cacheTtl);
  const intervalText = interval ? formatInterval(t, interval) : t("settings.agent.runtimeTtlUnset");

  const hasCoverageGap = (coverage.missingCount ?? 0) > 0 || (coverage.surplusCount ?? 0) > 0;
  // A coverage comparison is only "ok" when the tailnet count is known and every
  // node reported, so an unreadable count stays neutral instead of reassuring.
  const coverageTone = hasCoverageGap
    ? "warn"
    : coverage.tailnetCount === null || coverage.reportedCount === 0
      ? "neutral"
      : "ok";
  const coverageStatus =
    coverage.tailnetCount === null
      ? t("settings.agent.coverageStatusUnknown", { reported: coverage.reportedCount })
      : t("settings.agent.coverageStatus", {
          reported: coverage.reportedCount,
          tailnet: coverage.tailnetCount,
        });
  const coverageNote =
    (coverage.missingCount ?? 0) > 0
      ? t("settings.agent.coverageMissing", { count: coverage.missingCount ?? 0 })
      : (coverage.surplusCount ?? 0) > 0
        ? t("settings.agent.coverageSurplus", { count: coverage.surplusCount ?? 0 })
        : coverage.tailnetCount === null
          ? undefined
          : t("settings.agent.coverageMatched");
  const newestReport = coverage.newestAt
    ? new Date(coverage.newestAt).toLocaleString(locale)
    : t("settings.agent.never");
  const oldestReport = coverage.oldestAt
    ? new Date(coverage.oldestAt).toLocaleString(locale)
    : t("settings.agent.never");

  return (
    <SettingsPage
      description={t("settings.overview.agentBody")}
      notices={
        isPending || loaderData.error ? (
          <>
            {isPending ? (
              <Notice title={t("settings.agent.needsApprovalTitle")} variant="warning">
                {t("settings.agent.needsApprovalBody")}
              </Notice>
            ) : undefined}

            {loaderData.error ? (
              <>
                {loaderData.errorCode === "apiKeyRejected" ? (
                  <Notice variant="error" title={t("settings.agent.apiKeyRejectedTitle")}>
                    {tr("settings.agent.apiKeyRejectedBody", {
                      link: (
                        <Link styled to="/settings/api-keys">
                          {t("settings.agent.apiKeysLink")}
                        </Link>
                      ),
                    })}
                  </Notice>
                ) : undefined}
                <Notice variant="error" title={t("settings.agent.syncErrorTitle")}>
                  {loaderData.error}
                </Notice>
              </>
            ) : undefined}
          </>
        ) : undefined
      }
      title={t("settings.agent.title")}
    >
      <SettingsCollapsibleGroup>
        <SettingsCollapsible
          defaultOpen
          description={t("settings.agent.actionsBody")}
          icon={RefreshCw}
          status={{ tone: statusTone, label: statusText }}
          summary={t("settings.agent.summarySync", {
            nodes: loaderData.nodeCount,
            time: lastSynced,
          })}
          title={t("settings.agent.actionsTitle")}
        >
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <span className="flex items-center gap-2.5 text-sm font-medium">
                <StatusCircle isOnline={!hasError && !isPending} className="h-3.5 w-3.5" />
                {statusText}
              </span>
              <Text>
                <span className="font-medium">{t("settings.agent.lastSynced")}</span>
                <span suppressHydrationWarning>{lastSynced}</span>
              </Text>
              <Text>
                <span className="font-medium">{t("settings.agent.lastSyncedAt")}</span>
                <span suppressHydrationWarning>{lastSyncedAt}</span>
              </Text>
              <Text>
                <span className="font-medium">{t("settings.agent.nodesSynced")}</span>
                {loaderData.nodeCount}
              </Text>
            </div>

            <Text>
              {interval
                ? t("settings.agent.cadenceBody", { interval: intervalText })
                : t("settings.agent.runtimeTtlUnset")}
            </Text>

            <div className="flex flex-col gap-3">
              <Text>{t("settings.agent.syncBody")}</Text>
              <fetcher.Form method="post">
                <SettingsActions>
                  <Button disabled={isSyncing} type="submit" variant="heavy">
                    {isSyncing ? t("settings.agent.syncing") : t("settings.agent.syncNow")}
                  </Button>
                </SettingsActions>
              </fetcher.Form>
            </div>

            {isPending ? (
              <SettingsField label={t("settings.agent.approveTitle")}>
                <Text>
                  {tr("settings.agent.approveBody", {
                    link: (
                      <Link external styled to={loaderData.authUrl!}>
                        {t("settings.agent.thisLink")}
                      </Link>
                    ),
                  })}
                </Text>
              </SettingsField>
            ) : undefined}

            <SettingsField label={t("settings.agent.setupTitle")}>
              <Text>
                {tr("settings.agent.setupBody", {
                  link: documentationLink,
                })}
              </Text>
            </SettingsField>
          </div>
        </SettingsCollapsible>

        <SettingsCollapsible
          defaultOpen
          description={t("settings.agent.coverageBody")}
          icon={Activity}
          status={{ tone: coverageTone, label: coverageStatus }}
          summary={`${t("settings.agent.coverageNewest")}${newestReport}`}
          title={t("settings.agent.coverageTitle")}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <Text>
                <span className="font-medium">{t("settings.agent.coverageReported")}</span>
                {coverage.reportedCount}
              </Text>
              <Text>
                <span className="font-medium">{t("settings.agent.coverageTailnet")}</span>
                {coverage.tailnetCount ?? "—"}
              </Text>
              <Text>
                <span className="font-medium">{t("settings.agent.coverageNewest")}</span>
                <span suppressHydrationWarning>{newestReport}</span>
              </Text>
              <Text>
                <span className="font-medium">{t("settings.agent.coverageOldest")}</span>
                <span suppressHydrationWarning>{oldestReport}</span>
              </Text>
            </div>

            {coverage.tailnetUnavailable ? (
              <Text className="text-mist-600 dark:text-mist-400">
                {t("settings.agent.coverageTailnetUnreadable")}
              </Text>
            ) : undefined}

            {coverageNote ? <Text>{coverageNote}</Text> : undefined}

            {coverage.rows.length === 0 ? (
              <Text className="text-mist-600 dark:text-mist-400">
                {t("settings.agent.coverageEmpty")}
              </Text>
            ) : (
              <table className="w-full table-fixed border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="text-xs font-bold uppercase">
                    <th
                      className="border-b border-mist-200 pr-2 pb-2 dark:border-mist-800"
                      scope="col"
                    >
                      {t("settings.agent.coverageTableNode")}
                    </th>
                    <th
                      className="w-24 border-b border-mist-200 pr-2 pb-2 dark:border-mist-800"
                      scope="col"
                    >
                      {t("settings.agent.coverageTableVersion")}
                    </th>
                    <th
                      className="hidden w-40 border-b border-mist-200 pr-2 pb-2 sm:table-cell dark:border-mist-800"
                      scope="col"
                    >
                      {t("settings.agent.coverageTableOs")}
                    </th>
                    <th
                      className="w-40 border-b border-mist-200 pb-2 dark:border-mist-800"
                      scope="col"
                    >
                      {t("settings.agent.coverageTableUpdated")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.rows.map((row) => (
                    <tr className="align-middle" key={row.nodeKey}>
                      <td className="border-b border-mist-100 py-2 pr-2 dark:border-mist-800">
                        <span className="block truncate" title={row.nodeKey}>
                          {row.name ?? row.nodeKey}
                        </span>
                      </td>
                      <td className="border-b border-mist-100 py-2 pr-2 whitespace-nowrap dark:border-mist-800">
                        {row.version ?? "—"}
                      </td>
                      <td className="hidden border-b border-mist-100 py-2 pr-2 sm:table-cell dark:border-mist-800">
                        <span className="block truncate">{row.os ?? "—"}</span>
                      </td>
                      <td className="border-b border-mist-100 py-2 whitespace-nowrap dark:border-mist-800">
                        <span suppressHydrationWarning>
                          {row.updatedAt ? new Date(row.updatedAt).toLocaleString(locale) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {coverage.recordsUnavailable ? (
              <Text className="text-mist-600 dark:text-mist-400">
                {t("settings.agent.coverageUpdatedUnreadable")}
              </Text>
            ) : undefined}

            {coverage.hiddenCount > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Text className="text-mist-600 dark:text-mist-400">
                  {t("settings.agent.coverageHidden", { count: coverage.hiddenCount })}
                </Text>
                <Link styled to="/machines">
                  {t("settings.agent.coverageViewMachines")}
                </Link>
              </div>
            ) : undefined}
          </div>
        </SettingsCollapsible>

        <SettingsCollapsible
          description={t("settings.agent.runtimeBody")}
          icon={Cpu}
          status={{ tone: "neutral", label: t("settings.agent.runtimeStatus") }}
          summary={t("settings.agent.runtimeSummary", {
            path: runtime.executablePath,
            interval: intervalText,
          })}
          title={t("settings.agent.runtimeTitle")}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col">
              <Attribute
                isCopyable
                name={t("settings.agent.runtimeExecutable")}
                value={runtime.executablePath}
              />
              <Attribute
                isCopyable
                name={t("settings.agent.runtimeWorkDir")}
                value={runtime.workDir}
              />
              <Attribute name={t("settings.agent.runtimeCacheTtl")} value={intervalText} />
              <Attribute
                name={t("settings.agent.runtimeNetns")}
                value={
                  runtime.tailscaleNetns
                    ? t("settings.agent.runtimeOn")
                    : t("settings.agent.runtimeOff")
                }
              />
              <Attribute
                name={t("settings.agent.runtimeState")}
                value={
                  runtime.stateExists === null
                    ? "—"
                    : runtime.stateExists
                      ? t("settings.agent.runtimeStatePresent")
                      : t("settings.agent.runtimeStateMissing")
                }
              />
              <Attribute
                name={t("settings.agent.runtimeVersion")}
                value={runtime.agentVersion ?? "—"}
              />
            </div>

            <Text className="text-mist-600 dark:text-mist-400">
              {t("settings.agent.runtimeCacheTtlBody", { interval: intervalText })}
            </Text>
            <Text className="text-mist-600 dark:text-mist-400">
              {t("settings.agent.runtimeStateBody")}
            </Text>
            {runtime.stateExists === null ? (
              <Text className="text-mist-600 dark:text-mist-400">
                {t("settings.agent.runtimeStateUnreadable")}
              </Text>
            ) : undefined}
            {runtime.agentVersion === null ? (
              <Text className="text-mist-600 dark:text-mist-400">
                {t("settings.agent.runtimeVersionUnreadable")}
              </Text>
            ) : undefined}
          </div>
        </SettingsCollapsible>
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}
