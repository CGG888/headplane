import { type } from "arktype";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useForm } from "~/hooks/use-form";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { normalizeRegistrationKey } from "~/utils/register-key";

import type { MachineRejectErrorCode } from "../machine-actions";

const rejectSchema = type({
  register_key: "string > 0",
});

type RejectResult = { success: true } | { success: false; errorCode: MachineRejectErrorCode };

const ERROR_KEYS: Record<MachineRejectErrorCode, TranslationKey> = {
  missingKey: "machines.reject.errors.missingKey",
  invalidKey: "machines.new.machineKeyInvalid",
  unsupported: "machines.reject.errors.unsupported",
  failed: "machines.reject.errors.failed",
};

export interface RejectRegistrationProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

/**
 * The confirmation for turning a pending registration down.
 *
 * It is deliberately a separate dialog from the register flow and takes only
 * the device's registration key: rejecting never touches a machine that already
 * exists, so there is no node to name and nothing to confuse this with the
 * remove action. The body says what happens — the device does not join, its
 * request disappears, and the operator can register it again later — and the
 * destructive confirm is the same one every other destructive dialog uses.
 */
export default function RejectRegistration({ isOpen, setIsOpen }: RejectRegistrationProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<RejectResult>();
  const submittingRef = useRef(false);
  const form = useForm({
    schema: rejectSchema,
    validate: (values) =>
      normalizeRegistrationKey(String(values.register_key ?? ""))
        ? undefined
        : { register_key: t("machines.new.machineKeyInvalid") },
  });
  const { reset } = form;

  const error =
    fetcher.data && !fetcher.data.success ? t(ERROR_KEYS[fetcher.data.errorCode]) : null;
  const isDisabled = fetcher.state !== "idle" || !form.canSubmit;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
      if (fetcher.data.success) {
        setIsOpen(false);
      }
    }
  }, [fetcher.data, fetcher.state, setIsOpen]);

  // A dialog that opens with the previous attempt's key still in it invites
  // rejecting the wrong device, so it always starts empty.
  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen, reset]);

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
          const authId = normalizeRegistrationKey(String(form.values.register_key ?? ""));
          if (!authId) {
            return;
          }

          submittingRef.current = true;
          const body = new FormData();
          body.set("action_id", "reject_registration");
          body.set("register_key", authId);
          fetcher.submit(body, { method: "POST" });
        }}
        variant="destructive"
      >
        <Title>{t("machines.reject.title")}</Title>
        <Text>{t("machines.reject.body")}</Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <Input
          {...form.field("register_key")}
          description={t("machines.new.machineKeyDescription")}
          label={t("machines.new.machineKeyLabel")}
          placeholder="hskey-authreq-XXXXXXXXXXXXXXXXXXXXXXXX"
          required
        />
      </DialogPanel>
    </Dialog>
  );
}
