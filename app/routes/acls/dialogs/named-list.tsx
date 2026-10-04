import { useEffect, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { isValidGroupName, isValidTagName } from "~/utils/acl-policy";

export type NamedListKind = "group" | "tag";

interface NamedListDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  kind: NamedListKind;
  // Present when editing, absent when creating a new entry.
  name?: string;
  members?: string[];
  existingNames: string[];
  suggestions: string[];
  onSave: (name: string, members: string[]) => void;
}

const COPY = {
  group: {
    kindKey: "acls.namedList.group",
    prefix: "group:",
    fieldKey: "acls.namedList.membersLabel",
    fieldDescriptionKey: "acls.namedList.membersDescription",
    emptyKey: "acls.namedList.membersEmpty",
    placeholderKey: "acls.namedList.membersPlaceholder",
    validate: isValidGroupName,
    hintKey: "acls.namedList.groupHint",
    duplicateKey: "acls.namedList.duplicate",
  },
  tag: {
    kindKey: "acls.namedList.tag",
    prefix: "tag:",
    fieldKey: "acls.namedList.ownersLabel",
    fieldDescriptionKey: "acls.namedList.ownersDescription",
    emptyKey: "acls.namedList.ownersEmpty",
    placeholderKey: "acls.namedList.ownersPlaceholder",
    validate: isValidTagName,
    hintKey: "acls.namedList.tagHint",
    duplicateKey: "acls.namedList.duplicate",
  },
} as const satisfies Record<
  NamedListKind,
  {
    kindKey: TranslationKey;
    prefix: string;
    fieldKey: TranslationKey;
    fieldDescriptionKey: TranslationKey;
    emptyKey: TranslationKey;
    placeholderKey: TranslationKey;
    validate: (name: string) => boolean;
    hintKey: TranslationKey;
    duplicateKey: TranslationKey;
  }
>;

export default function NamedListDialog({
  isOpen,
  setIsOpen,
  kind,
  name,
  members,
  existingNames,
  suggestions,
  onSave,
}: NamedListDialogProps) {
  const { t } = useI18n();
  const copy = COPY[kind];
  const kindLabel = t(copy.kindKey);
  const hint = t(copy.hintKey);
  const [draftName, setDraftName] = useState(name ?? copy.prefix);
  const [draftMembers, setDraftMembers] = useState<string[]>(members ?? []);

  useEffect(() => {
    if (isOpen) {
      setDraftName(name ?? copy.prefix);
      setDraftMembers(members ? [...members] : []);
    }
  }, [isOpen, name, members, copy.prefix]);

  const trimmedName = draftName.trim();
  const isDuplicate = trimmedName !== name && existingNames.includes(trimmedName);
  const nameIsInvalid = !copy.validate(trimmedName) || isDuplicate;
  // The field opens pre-filled with the `group:`/`tag:` prefix, which is not a
  // valid name yet. Saving stays blocked, but nothing is flagged until it is edited.
  const isPristine = trimmedName.length === 0 || trimmedName === copy.prefix;
  const showNameError = !isPristine && nameIsInvalid;

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={nameIsInvalid}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(trimmedName, draftMembers);
          setIsOpen(false);
        }}
      >
        <Title>
          {name
            ? t("acls.namedList.editTitle", { kind: kindLabel, name })
            : t("acls.namedList.newTitle", { kind: kindLabel })}
        </Title>
        <Text>{hint}</Text>
        <Input
          errorMessage={isDuplicate ? t(copy.duplicateKey, { kind: kindLabel }) : hint}
          invalid={showNameError}
          label={t("acls.common.nameLabel")}
          onChange={setDraftName}
          placeholder={copy.prefix + t("acls.namedList.examplePlaceholder")}
          value={draftName}
        />
        <TokenList
          description={t(copy.fieldDescriptionKey)}
          emptyText={t(copy.emptyKey)}
          label={t(copy.fieldKey)}
          onChange={setDraftMembers}
          placeholder={t(copy.placeholderKey)}
          suggestions={suggestions}
          values={draftMembers}
        />
      </DialogPanel>
    </Dialog>
  );
}
