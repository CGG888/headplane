import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { SnapshotMeta } from "~/server/snapshots/types";

import type { SnapshotActionResult } from "../actions";
import { SNAPSHOT_ERROR_KEYS } from "../error-keys";

interface RestoreSnapshotProps {
  snapshot: SnapshotMeta;
}

/**
 * Restoring overwrites the live configuration, so the confirmation keeps its
 * own centred dialog: the destructive wording, the exact snapshot and the
 * single confirm button all live here, away from the row's download links.
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

      <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
        <DialogPanel
          isDisabled={isBusy}
          onSubmit={(event) => {
            // The panel supplies the confirmation buttons, so the restore is
            // submitted through the fetcher rather than by navigating away.
            event.preventDefault();
            const form = new FormData();
            form.set("action_id", "restore_snapshot");
            form.set("snapshot_id", snapshot.id);
            fetcher.submit(form, { method: "post" });
          }}
          variant="destructive"
        >
          <Title>{t("settings.snapshots.restoreTitle")}</Title>
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
        </DialogPanel>
      </Dialog>
    </>
  );
}
