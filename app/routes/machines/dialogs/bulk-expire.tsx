import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import RadioGroup from "~/components/radio-group";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import { isNoExpiry, type PopulatedNode } from "~/utils/node-info";
import toast from "~/utils/toast";

import {
  bulkErrorMessage,
  bulkSummary,
  type BulkErrorResult,
  type BulkResult,
} from "../components/bulk-result";
import { parseLocalValue } from "./expire";

type ExpiryMode = "never" | "default" | "custom";

interface BulkExpireProps {
  nodes: PopulatedNode[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onComplete: () => void;
}

export default function BulkExpire({ nodes, isOpen, setIsOpen, onComplete }: BulkExpireProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<BulkResult | BulkErrorResult>();
  const submittingRef = useRef(false);
  // There is no single machine to read a default from, so use "never" only when
  // every selected machine already has key expiry disabled.
  const [mode, setMode] = useState<ExpiryMode>(() =>
    nodes.every((node) => isNoExpiry(node.expiry)) ? "never" : "default",
  );
  const [expiry, setExpiry] = useState("");

  const error = fetcher.data && !fetcher.data.success ? bulkErrorMessage(t, fetcher.data) : null;
  const customDate = mode === "custom" ? parseLocalValue(expiry) : null;
  const isDisabled = fetcher.state !== "idle" || (mode === "custom" && customDate === null);

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
      setMode(nodes.every((node) => isNoExpiry(node.expiry)) ? "never" : "default");
      setExpiry("");
    }
  }, [isOpen, nodes]);

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
        isDisabled={isDisabled}
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "custom" && customDate === null) {
            return;
          }

          submittingRef.current = true;
          const form = new FormData();
          form.set("action_id", "bulk_set_expiry");
          form.set("expiry_mode", mode);
          if (customDate) {
            // Send an absolute timestamp so the server does not have to guess
            // the browser's timezone.
            form.set("expiry", customDate.toISOString());
          }
          for (const node of nodes) {
            form.append("node_ids", node.id);
          }

          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("machines.bulk.expire.title", { count: nodes.length })}</Title>
        <Text>{t("machines.expire.body")}</Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <RadioGroup
          className="gap-4"
          label={t("machines.expire.modeLabel")}
          onValueChange={(value) => setMode(value as ExpiryMode)}
          value={mode}
        >
          <RadioGroup.Radio label={t("machines.expire.modeNever")} value="never">
            <div className="block">
              <p className="font-bold">{t("machines.expire.modeNever")}</p>
              <p className="opacity-70">{t("machines.expire.modeNeverBody")}</p>
            </div>
          </RadioGroup.Radio>
          <RadioGroup.Radio label={t("machines.expire.modeDefault")} value="default">
            <div className="block">
              <p className="font-bold">{t("machines.expire.modeDefault")}</p>
              <p className="opacity-70">{t("machines.expire.modeDefaultBody")}</p>
            </div>
          </RadioGroup.Radio>
          <RadioGroup.Radio label={t("machines.expire.modeCustom")} value="custom">
            <div className="block">
              <p className="font-bold">{t("machines.expire.modeCustom")}</p>
              <p className="opacity-70">{t("machines.expire.modeCustomBody")}</p>
            </div>
          </RadioGroup.Radio>
        </RadioGroup>
        {mode === "custom" ? (
          <Input
            description={t("machines.expire.dateDescription")}
            label={t("machines.expire.dateLabel")}
            onChange={setExpiry}
            required
            type="datetime-local"
            value={expiry}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
