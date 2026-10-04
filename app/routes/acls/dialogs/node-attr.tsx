import { useEffect, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";
import type { NodeAttr } from "~/utils/acl-policy";

interface NodeAttrDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  entry?: NodeAttr;
  sources: string[];
  onSave: (entry: NodeAttr) => void;
}

const EMPTY: NodeAttr = { target: [], attr: [], extra: {} };

// The attributes Headscale understands today.
const ATTR_SUGGESTIONS = [
  "drive:access",
  "drive:share",
  "nextdns:<profile>",
  "nextdns:no-device-info",
  "magicdns-aaaa",
  "disable-ipv4",
  "randomize-client-port",
  "disable-captive-portal-detection",
];

export default function NodeAttrDialog({
  isOpen,
  setIsOpen,
  entry,
  sources,
  onSave,
}: NodeAttrDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<NodeAttr>(entry ?? EMPTY);

  useEffect(() => {
    if (isOpen) {
      setDraft(entry ? structuredClone(entry) : structuredClone(EMPTY));
    }
  }, [isOpen, entry]);

  const isInvalid = draft.target.length === 0 || draft.attr.length === 0;

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={isInvalid}
        onSubmit={(event) => {
          event.preventDefault();
          // `extra` rides along so unknown keys survive the edit.
          onSave({ ...draft });
          setIsOpen(false);
        }}
      >
        <Title>{entry ? t("acls.nodeAttr.editTitle") : t("acls.nodeAttr.newTitle")}</Title>
        <Text>{t("acls.nodeAttr.body")}</Text>
        <TokenList
          description={t("acls.nodeAttr.targetsDescription")}
          emptyText={t("acls.nodeAttr.targetsEmpty")}
          label={t("acls.nodeAttr.targetsLabel")}
          onChange={(target) => setDraft({ ...draft, target })}
          placeholder={t("acls.nodeAttr.targetsPlaceholder")}
          suggestions={sources}
          values={draft.target}
        />
        <TokenList
          description={t("acls.nodeAttr.attrsDescription")}
          emptyText={t("acls.nodeAttr.attrsEmpty")}
          label={t("acls.nodeAttr.attrsLabel")}
          onChange={(attr) => setDraft({ ...draft, attr })}
          placeholder={t("acls.nodeAttr.attrsPlaceholder")}
          suggestions={ATTR_SUGGESTIONS}
          values={draft.attr}
        />
      </DialogPanel>
    </Dialog>
  );
}
