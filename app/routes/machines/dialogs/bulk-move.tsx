import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Select from "~/components/select";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types";
import toast from "~/utils/toast";
import { getUserDisplayName } from "~/utils/user";

import {
  bulkErrorMessage,
  bulkSummary,
  type BulkErrorResult,
  type BulkResult,
} from "../components/bulk-result";

interface BulkMoveProps {
  nodeIds: string[];
  users: User[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onComplete: () => void;
}

export default function BulkMove({ nodeIds, users, isOpen, setIsOpen, onComplete }: BulkMoveProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<BulkResult | BulkErrorResult>();
  const submittingRef = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);

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

  useEffect(() => {
    if (isOpen) {
      setUserId(null);
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
      <DialogPanel
        isDisabled={fetcher.state !== "idle" || userId === null}
        onSubmit={(event) => {
          event.preventDefault();
          if (userId === null) {
            return;
          }

          submittingRef.current = true;
          const form = new FormData();
          form.set("action_id", "bulk_reassign");
          form.set("user_id", userId);
          for (const id of nodeIds) {
            form.append("node_ids", id);
          }

          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("machines.bulk.move.title", { count: nodeIds.length })}</Title>
        <Text>{t("machines.move.body")}</Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <Select
          label={t("machines.common.ownerLabel")}
          onValueChange={setUserId}
          placeholder={t("machines.common.selectUser")}
          required
          value={userId}
          items={users.map((user) => ({
            value: user.id,
            label: getUserDisplayName(user, t("machines.common.tagOwned")),
          }))}
        />
      </DialogPanel>
    </Dialog>
  );
}
