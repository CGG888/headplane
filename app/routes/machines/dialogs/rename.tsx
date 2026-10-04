import { type } from "arktype";

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

export default function Rename({ machine, magic, isOpen, setIsOpen }: RenameProps) {
  const { t, tr } = useI18n();
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

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel isDisabled={!form.canSubmit}>
        <Title>{t("machines.rename.title", { name: machine.givenName })}</Title>
        <Text className="mb-6">{t("machines.rename.body")}</Text>
        <input name="action_id" type="hidden" value="rename" />
        <input name="node_id" type="hidden" value={machine.id} />
        <Input
          {...form.field("name")}
          required
          label={t("machines.rename.nameLabel")}
          placeholder={t("machines.rename.nameLabel")}
        />
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
