import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { SnapshotMeta } from "~/server/snapshots/types";

import type { SnapshotActionResult } from "../actions";
import { SNAPSHOT_ERROR_KEYS } from "../error-keys";

interface RestoreSnapshotProps {
  snapshot: SnapshotMeta;
}

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
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)} variant="danger">
        {t("settings.snapshots.restore")}
      </Button>
      <DialogPanel
        isDisabled={isBusy}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData();
          form.set("action_id", "restore_snapshot");
          form.set("snapshot_id", snapshot.id);
          fetcher.submit(form, { method: "POST" });
        }}
        variant="destructive"
      >
        <Title>{t("settings.snapshots.restoreTitle")}</Title>
        <Text>
          {t("settings.snapshots.restoreBody", {
            time: new Date(snapshot.at).toLocaleString(locale),
            files: snapshot.files.map((file) => file.name).join(", "),
          })}
        </Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : undefined}
      </DialogPanel>
    </Dialog>
  );
}
