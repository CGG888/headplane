import { Archive, Camera, DatabaseBackup, Download } from "lucide-react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsPage,
} from "~/components/settings-nav";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import { authContext, snapshotContext } from "~/server/context";
import type { SnapshotMeta } from "~/server/snapshots/types";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { snapshotsAction, type SnapshotActionResult } from "./actions";
import { SNAPSHOT_ERROR_KEYS } from "./error-keys";
import { formatBytes } from "./labels";
import SnapshotRow from "./snapshot-row";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const snapshots = context.get(snapshotContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  const entries: SnapshotMeta[] = await snapshots.list();

  return { entries, root: snapshots.root() };
}

export const action = snapshotsAction;

export default function Page({ loaderData: { entries, root } }: Route.ComponentProps) {
  const { t } = useI18n();
  const totalSize = entries.reduce((sum, snapshot) => sum + snapshot.totalSize, 0);

  return (
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.snapshots.breadcrumb")}
        </>
      }
      description={t("settings.snapshots.body")}
      notices={
        <Notice title={t("settings.snapshots.destructiveTitle")} variant="warning">
          {t("settings.snapshots.destructiveBody")}
        </Notice>
      }
      title={t("settings.snapshots.title")}
    >
      <SettingsCollapsibleGroup>
        <TakeSnapshotSection root={root} />

        <SettingsCollapsible
          defaultOpen
          description={t("settings.snapshots.listBody")}
          icon={Archive}
          status={{
            tone: entries.length > 0 ? "ok" : "neutral",
            label: t("settings.snapshots.summaryStored", {
              count: entries.length,
              size: formatBytes(totalSize),
            }),
          }}
          title={t("settings.snapshots.listTitle")}
        >
          <TableList className="border-0">
            {entries.length === 0 ? (
              <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
                <Camera />
                <p className="font-semibold">{t("settings.snapshots.empty")}</p>
              </TableList.Item>
            ) : (
              entries.map((snapshot) => (
                <TableList.Item key={snapshot.id}>
                  <SnapshotRow snapshot={snapshot} />
                </TableList.Item>
              ))
            )}
          </TableList>
        </SettingsCollapsible>

        <DataBackupSection />
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}

/** Taking a snapshot is rare, so its form stays folded away above the list. */
function TakeSnapshotSection({ root }: { root: string }) {
  const { t } = useI18n();
  const fetcher = useFetcher<SnapshotActionResult>();
  const isBusy = fetcher.state !== "idle";
  const result = fetcher.data;
  const error = result && !result.success ? t(SNAPSHOT_ERROR_KEYS[result.errorCode]) : undefined;
  const succeeded = !isBusy && result?.success === true && result.snapshotId !== undefined;

  return (
    <SettingsCollapsible
      description={t("settings.snapshots.takeBody")}
      icon={Camera}
      status={succeeded ? { tone: "ok", label: t("settings.snapshots.takeSuccess") } : undefined}
      summary={t("settings.snapshots.storedAt", { path: root })}
      title={t("settings.snapshots.takeTitle")}
    >
      <fetcher.Form className="flex flex-col gap-3" method="post">
        <input name="action_id" type="hidden" value="take_snapshot" />
        <SettingsActions>
          <Button disabled={isBusy} type="submit" variant="heavy">
            {isBusy ? t("settings.snapshots.takePending") : t("settings.snapshots.take")}
          </Button>
        </SettingsActions>
        {error ? (
          <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : undefined}
        <p className="text-xs text-mist-600 dark:text-mist-400">
          {t("settings.snapshots.storedAt", { path: root })}
        </p>
      </fetcher.Form>
    </SettingsCollapsible>
  );
}

/**
 * Headplane's own database is a separate thing from a configuration snapshot,
 * so it gets its own card: the download takes local users, sessions, the audit
 * log and the rest off the server, and nothing here can put it back.
 */
function DataBackupSection() {
  const { t } = useI18n();

  return (
    <SettingsCollapsible
      description={t("settings.snapshots.dataBackup.body")}
      icon={DatabaseBackup}
      title={t("settings.snapshots.dataBackup.title")}
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{t("settings.snapshots.dataBackup.contentsTitle")}</p>
          <p className="opacity-80">{t("settings.snapshots.dataBackup.contents")}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{t("settings.snapshots.dataBackup.excludesTitle")}</p>
          <p className="opacity-80">{t("settings.snapshots.dataBackup.excludes")}</p>
        </div>
      </div>
      <SettingsActions>
        <a className={DOWNLOAD_BUTTON} download href="/settings/snapshots/data-backup">
          <Download className="h-4 w-4" />
          {t("settings.snapshots.dataBackup.download")}
        </a>
      </SettingsActions>
      <p className="text-xs text-mist-600 dark:text-mist-400">
        {t("settings.snapshots.dataBackup.noRestore")}
      </p>
    </SettingsCollapsible>
  );
}

/** The download is a plain link, so it carries the card's button look itself. */
const DOWNLOAD_BUTTON =
  "flex w-fit items-center gap-2 rounded-md border border-mist-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-mist-50 dark:border-mist-700 dark:bg-mist-800/50 dark:hover:bg-mist-700/50";

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
