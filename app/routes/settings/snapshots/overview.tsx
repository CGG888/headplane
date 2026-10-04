import { Camera } from "lucide-react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import { SettingsCollapsible, SettingsCollapsibleGroup } from "~/components/settings-nav";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import { authContext, snapshotContext } from "~/server/context";
import type { SnapshotMeta } from "~/server/snapshots/types";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { snapshotsAction, type SnapshotActionResult } from "./actions";
import { SNAPSHOT_ERROR_KEYS } from "./error-keys";
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

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-4">
      <div className="flex w-full flex-col sm:w-2/3">
        <p className="text-md mb-4">
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.snapshots.breadcrumb")}
        </p>
        <h1 className="mt-4 mb-2 text-2xl font-medium">{t("settings.snapshots.title")}</h1>
        <p>{t("settings.snapshots.body")}</p>
      </div>

      <Notice title={t("settings.snapshots.destructiveTitle")} variant="warning">
        {t("settings.snapshots.destructiveBody")}
      </Notice>

      <SettingsCollapsibleGroup>
        <TakeSnapshotSection root={root} />
      </SettingsCollapsibleGroup>

      <TableList>
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
    </div>
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
      summary={t("settings.snapshots.storedAt", { path: root })}
      title={t("settings.snapshots.takeTitle")}
    >
      <fetcher.Form className="flex flex-col gap-3" method="post">
        <input name="action_id" type="hidden" value="take_snapshot" />
        <Button disabled={isBusy} type="submit" variant="heavy">
          {isBusy ? t("settings.snapshots.takePending") : t("settings.snapshots.take")}
        </Button>
        {succeeded ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("settings.snapshots.takeSuccess")}
          </span>
        ) : undefined}
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : undefined}
        <p className="text-xs opacity-60">{t("settings.snapshots.storedAt", { path: root })}</p>
      </fetcher.Form>
    </SettingsCollapsible>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
