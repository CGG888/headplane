import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import toast from "~/utils/toast";

import { AUTH_KEY_BULK_ERROR_KEYS } from "./error-keys";
import type { AuthKeyBulkDeleteResult } from "./result";

interface BulkDeleteExpiredAuthKeysProps {
  /** How many expired keys Headscale has, as the hint beside this reports. */
  count: number;
}

/**
 * The one-click cleanup the "N expired" hint offers: deletes the expired
 * pre-auth keys without touching the active ones. The request carries no key
 * list — the server recomputes the expired set from the caller's own scope —
 * so the count in the dialog is a preview rather than the payload.
 */
export default function BulkDeleteExpiredAuthKeys({ count }: BulkDeleteExpiredAuthKeysProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<AuthKeyBulkDeleteResult>();
  const [isOpen, setIsOpen] = useState(false);
  const [outcome, setOutcome] = useState<AuthKeyBulkDeleteResult | null>(null);
  /** True once a submission has been seen in flight, so its reply is settled. */
  const started = useRef(false);

  const isRunning = fetcher.state !== "idle";

  // A reply arrives with the fetcher idle again, so a run is only finished
  // after a request was actually observed in flight; otherwise the idle state
  // of an untouched fetcher would be read as a completed run.
  useEffect(() => {
    if (isRunning) {
      started.current = true;
      return;
    }

    if (!started.current) {
      return;
    }

    started.current = false;
    if (fetcher.data?.success && fetcher.data.failed === 0) {
      toast(t("settings.authKeys.bulkDeleteSummary", { count: fetcher.data.deleted }));
      setOutcome(null);
      setIsOpen(false);
      return;
    }

    setOutcome(fetcher.data ?? null);
  }, [isRunning, fetcher.data, t]);

  const handleOpenChange = (open: boolean) => {
    // A run in progress is not interruptible; a finished one always is.
    if (!open && isRunning) {
      return;
    }

    setIsOpen(open);
    if (!open) {
      setOutcome(null);
    }
  };

  if (count === 0) {
    return null;
  }

  const errorKey = outcome && !outcome.success ? AUTH_KEY_BULK_ERROR_KEYS[outcome.errorCode] : null;

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="danger">
        {t("settings.authKeys.bulkDeleteExpired")}
      </Button>

      <Dialog isOpen={isOpen} onOpenChange={handleOpenChange}>
        <DialogPanel
          isDisabled={isRunning}
          onSubmit={(event) => {
            event.preventDefault();
            if (isRunning) {
              return;
            }

            setOutcome(null);
            const form = new FormData();
            form.set("action_id", "delete_expired_preauthkeys");
            fetcher.submit(form, { method: "POST" });
          }}
          variant="destructive"
        >
          <Title>{t("settings.authKeys.bulkDeleteTitle", { count })}</Title>
          <Text>{t("settings.authKeys.bulkDeleteBody")}</Text>
          {isRunning ? (
            <p className="text-sm text-mist-600 dark:text-mist-300">
              {t("settings.authKeys.bulkDeleteProgress")}
            </p>
          ) : null}
          {outcome?.success && outcome.failed > 0 ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {t("settings.authKeys.bulkDeletePartial", {
                deleted: outcome.deleted,
                failed: outcome.failed,
              })}
            </p>
          ) : null}
          {errorKey ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {t(errorKey)}
            </p>
          ) : null}
        </DialogPanel>
      </Dialog>
    </>
  );
}
