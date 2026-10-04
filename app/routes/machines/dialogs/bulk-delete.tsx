import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import toast from "~/utils/toast";

import {
  bulkErrorMessage,
  bulkSummary,
  type BulkErrorResult,
  type BulkResult,
} from "../components/bulk-result";

interface BulkDeleteProps {
  nodeIds: string[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onComplete: () => void;
}

export default function BulkDelete({ nodeIds, isOpen, setIsOpen, onComplete }: BulkDeleteProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<BulkResult | BulkErrorResult>();
  const submittingRef = useRef(false);

  const error = fetcher.data && !fetcher.data.success ? bulkErrorMessage(t, fetcher.data) : null;

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result) {
      return;
    }

    submittingRef.current = false;
    if (result.success) {
      toast(bulkSummary(t, result));
      onComplete();
      setIsOpen(false);
    }
  }, [fetcher.data, fetcher.state, onComplete, setIsOpen, t]);

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
      <DialogPanel
        isDisabled={fetcher.state !== "idle"}
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;

          const form = new FormData();
          form.set("action_id", "bulk_delete");
          for (const id of nodeIds) {
            form.append("node_ids", id);
          }

          fetcher.submit(form, { method: "POST" });
        }}
        variant="destructive"
      >
        <Title>{t("machines.bulk.remove.title", { count: nodeIds.length })}</Title>
        <Text>{t("machines.bulk.remove.body", { count: nodeIds.length })}</Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
