import { Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";

import {
  backfillSummary,
  confirmedBackfillRequest,
  type BackfillResult,
} from "../backfill-request";

/**
 * The machines list's repair control for nodes that lost their addresses.
 *
 * It runs one server-wide operation rather than acting on a node, so it only
 * ever opens a confirmation: the dialog says what Headscale will scan, that
 * only the gaps are filled, and — because Headscale also clears addresses whose
 * prefix was removed from its configuration — that removals are possible too.
 * The run's report replaces the form once it lands, and the list behind it is
 * re-read by the action, so the addresses are already updated when it appears.
 */
export default function BackfillIps() {
  const { t } = useI18n();
  const fetcher = useFetcher<BackfillResult>();
  const submittingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [report, setReport] = useState<BackfillResult | null>(null);

  const summary = report?.success ? backfillSummary(report.changes) : undefined;
  const error =
    report && !report.success ? (report.error ?? t("machines.backfill.errors.failed")) : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
      setReport(fetcher.data);
    }
  }, [fetcher.data, fetcher.state]);

  // A dialog that reopens with the last run's report still in it reads as if
  // that run had just happened, so the report is dropped when it closes.
  useEffect(() => {
    if (!isOpen) {
      setReport(null);
    }
  }, [isOpen]);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && submittingRef.current) {
          return;
        }

        setIsOpen(open);
      }}
    >
      <Button onClick={() => setIsOpen(true)}>
        <Wrench className="h-4 w-4 shrink-0" />
        {t("machines.backfill.action")}
      </Button>
      {summary ? (
        <DialogPanel variant="unactionable">
          <Title>{t("machines.backfill.title")}</Title>
          <Text>
            {summary.changes === 0
              ? t("machines.backfill.successNone")
              : summary.nodes > 0
                ? t("machines.backfill.successNodes", { count: summary.nodes })
                : t("machines.backfill.successChanges", { count: summary.changes })}
          </Text>
        </DialogPanel>
      ) : (
        <DialogPanel
          isDisabled={fetcher.state !== "idle"}
          onSubmit={(event) => {
            event.preventDefault();

            // The only path that submits: the confirmation dialog is open and
            // the operator pressed its confirm button.
            const form = confirmedBackfillRequest(isOpen);
            if (!form) {
              return;
            }

            submittingRef.current = true;
            fetcher.submit(form, { method: "POST" });
          }}
          variant="destructive"
        >
          <Title>{t("machines.backfill.title")}</Title>
          <Text>{t("machines.backfill.body")}</Text>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t("machines.backfill.removals")}
          </p>
          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </DialogPanel>
      )}
    </Dialog>
  );
}
