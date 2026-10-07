import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Select from "~/components/select";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { Machine, User } from "~/types";
import { getUserDisplayName } from "~/utils/user";

interface MoveProps {
  machine: Machine;
  users: User[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

/** What the action reports back; `error` is Headscale's own explanation. */
type MoveResult = { success: true } | { success: false; error?: string };

export default function Move({ machine, users, isOpen, setIsOpen }: MoveProps) {
  const { t } = useI18n();
  // Headscale resolves the new owner by username, so the request carries the
  // selected user's name rather than the numeric id.
  const [userName, setUserName] = useState<string | null>(machine.user?.name ?? null);
  // Submitting through a fetcher keeps this dialog mounted when Headscale
  // refuses the reassignment, so the reason shows up here instead of replacing
  // the whole page with an error boundary.
  const fetcher = useFetcher<MoveResult>();
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
      }
    }
  }, [fetcher.data, fetcher.state, setIsOpen]);

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
        isDisabled={
          fetcher.state !== "idle" || userName === null || userName === machine.user?.name
        }
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;
          const body = new FormData();
          body.set("action_id", "reassign");
          body.set("node_id", machine.id);
          body.set("user_name", userName ?? "");
          fetcher.submit(body, { method: "POST" });
        }}
      >
        <Title>{t("machines.move.title", { name: machine.givenName })}</Title>
        <Text>{t("machines.move.body")}</Text>
        <Select
          defaultValue={machine.user?.name}
          required
          label={t("machines.common.ownerLabel")}
          name="user"
          onValueChange={(key) => {
            setUserName(key);
          }}
          placeholder={t("machines.common.selectUser")}
          items={users.map((user) => ({
            value: user.name,
            label: getUserDisplayName(user, t("machines.common.tagOwned")),
          }))}
        />
        {error ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
