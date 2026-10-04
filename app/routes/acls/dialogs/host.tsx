import { useEffect, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import { isValidHostName } from "~/utils/acl-policy";

interface HostDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  name?: string;
  value?: string;
  existingNames: string[];
  onSave: (name: string, value: string) => void;
}

export default function HostDialog({
  isOpen,
  setIsOpen,
  name,
  value,
  existingNames,
  onSave,
}: HostDialogProps) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState(name ?? "");
  const [draftValue, setDraftValue] = useState(value ?? "");

  useEffect(() => {
    if (isOpen) {
      setDraftName(name ?? "");
      setDraftValue(value ?? "");
    }
  }, [isOpen, name, value]);

  const isDuplicate = draftName !== name && existingNames.includes(draftName);
  const nameIsInvalid = !isValidHostName(draftName) || isDuplicate;
  const valueIsInvalid = draftValue.trim().length === 0;

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={nameIsInvalid || valueIsInvalid}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draftName, draftValue.trim());
          setIsOpen(false);
        }}
      >
        <Title>{name ? t("acls.host.editTitle", { name }) : t("acls.host.newTitle")}</Title>
        <Text>{t("acls.host.body")}</Text>
        <Input
          errorMessage={isDuplicate ? t("acls.host.duplicate") : t("acls.host.invalid")}
          invalid={nameIsInvalid}
          label={t("acls.common.nameLabel")}
          onChange={setDraftName}
          placeholder={t("acls.host.namePlaceholder")}
          value={draftName}
        />
        <Input
          invalid={draftValue.length > 0 && valueIsInvalid}
          label={t("acls.host.addressLabel")}
          onChange={setDraftValue}
          placeholder={t("acls.host.addressPlaceholder")}
          value={draftValue}
        />
      </DialogPanel>
    </Dialog>
  );
}
