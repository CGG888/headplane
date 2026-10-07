import { useEffect, useRef } from "react";
import { useFetcher, useNavigate } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { Machine } from "~/types";

interface DeleteProps {
  machine: Machine;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

/** What the action reports back; `error` is Headscale's own explanation. */
type DeleteResult = { success: true } | { success: false; error?: string };

export default function Delete({ machine, isOpen, setIsOpen }: DeleteProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  // Submitting through a fetcher (instead of the panel's own form) keeps the
  // page mounted when Headscale refuses the deletion, so the reason can be
  // shown here rather than on a full-page error boundary.
  const fetcher = useFetcher<DeleteResult>();
  const submittingRef = useRef(false);
  const error =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.success
      ? (fetcher.data.error ?? t("machines.common.errors.apiFailed"))
      : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
      if (fetcher.data.success) {
        setIsOpen(false);
        navigate("/machines");
      }
    }
  }, [fetcher.data, fetcher.state, setIsOpen, navigate]);

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
        variant="destructive"
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;
          const body = new FormData();
          body.set("action_id", "delete");
          body.set("node_id", machine.id);
          fetcher.submit(body, { method: "POST" });
        }}
      >
        <Title>{t("machines.remove.title", { name: machine.givenName })}</Title>
        <Text>{t("machines.remove.body")}</Text>
        {error ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
