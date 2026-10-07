import { type } from "arktype";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import Code from "~/components/code";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";
import type { Machine } from "~/types";

const renameSchema = type({
  name: "string > 0",
});

const dnsLabelPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

interface RenameProps {
  machine: Machine;
  isOpen: boolean;
  magic?: string;
  setIsOpen: (isOpen: boolean) => void;
}

/** What the action reports back; `error` is Headscale's own explanation. */
type RenameResult = { success: true } | { success: false; error?: string };

export default function Rename({ machine, magic, isOpen, setIsOpen }: RenameProps) {
  const { t, tr } = useI18n();
  // A fetcher keeps the machines page (and this dialog) mounted while the
  // action runs. A plain form submission replaces the page with the route's
  // ErrorBoundary as soon as Headscale refuses the rename, which loses both the
  // list and the reason.
  const fetcher = useFetcher<RenameResult>();
  const submittingRef = useRef(false);
  const form = useForm({
    schema: renameSchema,
    defaultValues: { name: machine.givenName },
    validate: (values) => {
      const name = String(values.name ?? "").toLowerCase();
      if (!dnsLabelPattern.test(name)) {
        return { name: t("machines.rename.invalid") };
      }

      return undefined;
    },
  });
  const name = form.values.name as string;
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
        isDisabled={fetcher.state !== "idle" || !form.canSubmit}
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;
          const body = new FormData();
          body.set("action_id", "rename");
          body.set("node_id", machine.id);
          // Headscale stores node names as lowercase DNS labels, and the action
          // validates the lowercased form, so submit exactly that.
          body.set("name", name.toLowerCase());
          fetcher.submit(body, { method: "POST" });
        }}
      >
        <Title>{t("machines.rename.title", { name: machine.givenName })}</Title>
        <Text className="mb-6">{t("machines.rename.body")}</Text>
        <Input
          {...form.field("name")}
          required
          label={t("machines.rename.nameLabel")}
          placeholder={t("machines.rename.nameLabel")}
        />
        {error ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        {magic ? (
          name.length > 0 && name !== machine.givenName ? (
            <p className="mt-2 text-sm leading-tight text-mist-600 dark:text-mist-300">
              {tr("machines.rename.hostnameChanged", {
                newName: (
                  <Code className="text-sm">{name.toLowerCase().replaceAll(/\s+/g, "-")}</Code>
                ),
                oldName: <Code className="text-sm">{machine.givenName}</Code>,
              })}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-tight text-mist-600 dark:text-mist-300">
              {tr("machines.rename.hostnameCurrent", {
                name: <Code className="text-sm">{machine.givenName}</Code>,
              })}
            </p>
          )
        ) : undefined}
      </DialogPanel>
    </Dialog>
  );
}
