import { useEffect, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";

interface ExitNodeDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  approvers: string[];
  suggestions: string[];
  onSave: (approvers: string[]) => void;
}

// Exit node approval is a single list, so this dialog edits that list rather
// than one entry of it.
export default function ExitNodeDialog({
  isOpen,
  setIsOpen,
  approvers,
  suggestions,
  onSave,
}: ExitNodeDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string[]>(approvers);

  useEffect(() => {
    if (isOpen) {
      setDraft([...approvers]);
    }
  }, [isOpen, approvers]);

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={draft.length === 0}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
          setIsOpen(false);
        }}
      >
        <Title>{t("acls.exitNode.editTitle")}</Title>
        <Text>{t("acls.exitNode.body")}</Text>
        <TokenList
          description={t("acls.exitNode.approversDescription")}
          emptyText={t("acls.exitNode.approversEmpty")}
          label={t("acls.exitNode.approversLabel")}
          onChange={setDraft}
          placeholder={t("acls.exitNode.approversPlaceholder")}
          suggestions={suggestions}
          values={draft}
        />
      </DialogPanel>
    </Dialog>
  );
}
