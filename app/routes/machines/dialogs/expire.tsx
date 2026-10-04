import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import RadioGroup from "~/components/radio-group";
import Text from "~/components/text";
import Title from "~/components/title";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type { Machine } from "~/types";
import { isNoExpiry } from "~/utils/node-info";

import type { MachineExpiryErrorCode } from "../machine-actions";

type ExpiryMode = "never" | "default" | "custom";

interface ExpireProps {
  machine: Machine;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

type ExpiryResult = { success: true } | { success: false; errorCode: MachineExpiryErrorCode };

const ERROR_KEYS: Record<MachineExpiryErrorCode, TranslationKey> = {
  invalidExpiry: "machines.expire.errors.invalidDate",
  expiryInPast: "machines.expire.errors.pastDate",
};

/** Formats an expiry for a `<input type="datetime-local">`, in local time. */
function toLocalInputValue(expiry: string | null | undefined): string {
  if (isNoExpiry(expiry)) {
    return "";
  }

  const date = new Date(expiry as string);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function parseLocalValue(value: string): Date | null {
  if (value.length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function Expire({ machine, isOpen, setIsOpen }: ExpireProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<ExpiryResult>();
  const submittingRef = useRef(false);
  const [mode, setMode] = useState<ExpiryMode>(isNoExpiry(machine.expiry) ? "never" : "default");
  const [expiry, setExpiry] = useState(() => toLocalInputValue(machine.expiry));

  const error =
    fetcher.data && !fetcher.data.success ? t(ERROR_KEYS[fetcher.data.errorCode]) : null;
  const customDate = mode === "custom" ? parseLocalValue(expiry) : null;
  const isDisabled = fetcher.state !== "idle" || (mode === "custom" && customDate === null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
      if (fetcher.data.success) {
        setIsOpen(false);
      }
    }
  }, [fetcher.data, fetcher.state, setIsOpen]);

  useEffect(() => {
    if (isOpen) {
      setMode(isNoExpiry(machine.expiry) ? "never" : "default");
      setExpiry(toLocalInputValue(machine.expiry));
    }
  }, [isOpen, machine.expiry]);

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
          form.set("action_id", "set_expiry");
          form.set("node_id", machine.id);
          form.set("expiry_mode", mode);
          if (customDate) {
            // Send an absolute timestamp so the server does not have to guess
            // the browser's timezone.
            form.set("expiry", customDate.toISOString());
          }

          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("machines.expire.title", { name: machine.givenName })}</Title>
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
