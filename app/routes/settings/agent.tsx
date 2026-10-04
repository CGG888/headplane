import { BookOpen, RefreshCw } from "lucide-react";
import { useFetcher } from "react-router";

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
import { useI18n } from "~/i18n/provider";
import { agentsContext, authContext } from "~/server/context";
import { formatTimeDelta } from "~/utils/time";

import type { Route } from "./+types/agent";

export async function loader({ request, context }: Route.LoaderArgs) {
  const agents = context.get(agentsContext);
  const auth = context.get(authContext);

  await auth.require(request);

  if (agents.state !== "enabled") {
    return { enabled: false as const, reason: agents.reason };
  }

  const sync = agents.value.lastSync();
  return {
    enabled: true as const,
    syncedAt: sync.syncedAt?.toISOString() ?? null,
    nodeCount: sync.nodeCount,
    error: sync.error,
    errorCode: sync.errorCode,
    authUrl: sync.authUrl,
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
  const { t, tr } = useI18n();
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
                <span className="font-medium">{t("settings.agent.nodesSynced")}</span>
                {loaderData.nodeCount}
              </Text>
            </div>

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
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}
