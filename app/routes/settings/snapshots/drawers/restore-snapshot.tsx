import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Drawer, { DrawerPanel } from "~/components/drawer";
import { useI18n } from "~/i18n/provider";
import type { SnapshotMeta } from "~/server/snapshots/types";

import type { SnapshotActionResult } from "../actions";
import { SNAPSHOT_ERROR_KEYS } from "../error-keys";

interface RestoreSnapshotProps {
  snapshot: SnapshotMeta;
}

/**
 * Restoring overwrites the live configuration, so the confirmation keeps its
 * own drawer: the destructive wording, the exact snapshot and the single
 * confirm button all live here, away from the row's download links.
 */
export default function RestoreSnapshot({ snapshot }: RestoreSnapshotProps) {
  const { t, locale } = useI18n();
  const fetcher = useFetcher<SnapshotActionResult>();
  const [isOpen, setIsOpen] = useState(false);
  const isBusy = fetcher.state !== "idle";

  const error =
    fetcher.data && !fetcher.data.success
      ? t(SNAPSHOT_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;

  useEffect(() => {
    if (fetcher.data?.success) {
      setIsOpen(false);
    }
  }, [fetcher.data]);

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="danger">
        {t("settings.snapshots.restore")}
      </Button>

      <Drawer isOpen={isOpen} onOpenChange={setIsOpen}>
        <DrawerPanel title={t("settings.snapshots.restoreTitle")}>
          <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t("settings.snapshots.restoreBody", {
                  time: new Date(snapshot.at).toLocaleString(locale),
                  files: snapshot.files.map((file) => file.name).join(", "),
                })}
              </span>
            </p>

            {error ? (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            ) : undefined}

            <fetcher.Form className="flex justify-end gap-3" method="post">
              <input name="action_id" type="hidden" value="restore_snapshot" />
              <input name="snapshot_id" type="hidden" value={snapshot.id} />
              <Button onClick={() => setIsOpen(false)} type="button">
                {t("common.cancel")}
              </Button>
              <Button disabled={isBusy} type="submit" variant="danger">
                {t("common.confirm")}
              </Button>
            </fetcher.Form>
          </div>
        </DrawerPanel>
      </Drawer>
    </>
  );
}
