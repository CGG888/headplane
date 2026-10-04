import { useFetcher } from "react-router";

import Button from "~/components/button";
import Link from "~/components/link";
import Notice from "~/components/notice";
import { SettingsCollapsible } from "~/components/settings-nav";
import StatusCircle from "~/components/status-circle";
import Text from "~/components/text";
import Title from "~/components/title";
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

  if (!loaderData.enabled) {
    return (
      <div className="flex max-w-(--breakpoint-lg) flex-col gap-8">
        <Title>{t("settings.agent.title")}</Title>
        <Notice title={t("settings.agent.notEnabledTitle")}>
          {tr("settings.agent.notEnabledBody", {
            reason: loaderData.reason,
            link: (
              <Link external styled to="https://headplane.net/features/agent">
                {t("settings.agent.documentation")}
              </Link>
            ),
          })}
        </Notice>
        <SettingsCollapsible
          defaultOpen
          description={t("settings.agent.setupRowBody")}
          title={t("settings.agent.setupTitle")}
        >
          <Text>
            {tr("settings.agent.setupBody", {
              link: (
                <Link external styled to="https://headplane.net/features/agent">
                  {t("settings.agent.documentation")}
                </Link>
              ),
            })}
          </Text>
        </SettingsCollapsible>
      </div>
    );
  }

  const isPending = !loaderData.syncedAt && loaderData.authUrl;
  const hasError = Boolean(loaderData.error);

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-8">
      <div className="flex w-full flex-col sm:w-2/3">
        <Title>{t("settings.agent.title")}</Title>
        <Text>{t("settings.overview.agentBody")}</Text>
      </div>

      <div className="flex items-center gap-3">
        <StatusCircle isOnline={!hasError && !isPending} className="h-5 w-5" />
        <span className="text-lg font-medium">
          {hasError
            ? t("settings.agent.statusError")
            : isPending
              ? t("settings.agent.statusWaiting")
              : t("settings.agent.statusHealthy")}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <Text>
          <span className="font-medium">{t("settings.agent.lastSynced")}</span>
          {loaderData.syncedAt ? (
            <span suppressHydrationWarning>{formatTimeDelta(new Date(loaderData.syncedAt))}</span>
          ) : (
            t("settings.agent.never")
          )}
        </Text>
        <Text>
          <span className="font-medium">{t("settings.agent.nodesSynced")}</span>
          {loaderData.nodeCount}
        </Text>
      </div>

      {isPending ? (
        <Notice variant="warning" title={t("settings.agent.needsApprovalTitle")}>
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

      <SettingsCollapsible
        defaultOpen
        description={t("settings.agent.actionsBody")}
        title={t("settings.agent.actionsTitle")}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Text>{t("settings.agent.syncBody")}</Text>
            <fetcher.Form method="post">
              <Button disabled={isSyncing} type="submit" variant="heavy">
                {isSyncing ? t("settings.agent.syncing") : t("settings.agent.syncNow")}
              </Button>
            </fetcher.Form>
          </div>

          {isPending ? (
            <div className="flex flex-col gap-2">
              <h2 className="font-medium">{t("settings.agent.approveTitle")}</h2>
              <Text>
                {tr("settings.agent.approveBody", {
                  link: (
                    <Link external styled to={loaderData.authUrl!}>
                      {t("settings.agent.thisLink")}
                    </Link>
                  ),
                })}
              </Text>
            </div>
          ) : undefined}

          <div className="flex flex-col gap-2">
            <h2 className="font-medium">{t("settings.agent.setupTitle")}</h2>
            <Text>
              {tr("settings.agent.setupBody", {
                link: (
                  <Link external styled to="https://headplane.net/features/agent">
                    {t("settings.agent.documentation")}
                  </Link>
                ),
              })}
            </Text>
          </div>
        </div>
      </SettingsCollapsible>
    </div>
  );
}
