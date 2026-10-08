import { useEffect, useMemo, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";
import { aclRuleIssues, withDefaultPort, type AclRule } from "~/utils/acl-policy";

import RuleIssues from "../components/rule-issues";

interface AclRuleDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  rule?: AclRule;
  sources: string[];
  destinations: string[];
  onSave: (rule: AclRule) => void;
}

const EMPTY: AclRule = { action: "accept", src: [], dst: [], extra: {} };

export default function AclRuleDialog({
  isOpen,
  setIsOpen,
  rule,
  sources,
  destinations,
  onSave,
}: AclRuleDialogProps) {
  const { t, tr } = useI18n();
  const [draft, setDraft] = useState<AclRule>(rule ?? EMPTY);

  useEffect(() => {
    if (isOpen) {
      setDraft(rule ? structuredClone(rule) : structuredClone(EMPTY));
    }
  }, [isOpen, rule]);

  // An `autogroup:self` destination only accepts users, groups, `*` and
  // `autogroup:member` as sources; anything else is rejected by Headscale.
  const issues = useMemo(() => aclRuleIssues(draft), [draft]);
  const isInvalid = draft.src.length === 0 || draft.dst.length === 0 || issues.length > 0;

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={isInvalid}
        onSubmit={(event) => {
          event.preventDefault();
          // A hand-written policy may be missing the port spec Headscale wants.
          onSave({ ...draft, dst: draft.dst.map(withDefaultPort) });
          setIsOpen(false);
        }}
      >
        <Title>{rule ? t("acls.aclRule.editTitle") : t("acls.aclRule.newTitle")}</Title>
        <Text>
          {tr("acls.aclRule.body", {
            example: <code className="font-mono">tag:web:80,443</code>,
            allPorts: <code className="font-mono">:*</code>,
            guide: (
              <Link external styled to="https://tailscale.com/kb/1018/acls">
                {t("acls.links.tailscaleGuide")}
              </Link>
            ),
          })}
        </Text>
        <TokenList
          description={t("acls.aclRule.sourcesDescription")}
          emptyText={t("acls.common.noSources")}
          label={t("acls.common.sources")}
          onChange={(src) => setDraft({ ...draft, src })}
          placeholder={t("acls.aclRule.sourcesPlaceholder")}
          suggestions={sources}
          values={draft.src}
        />
        <TokenList
          description={t("acls.aclRule.destinationsDescription")}
          emptyText={t("acls.common.noDestinations")}
          label={t("acls.common.destinations")}
          normalize={withDefaultPort}
          onChange={(dst) => setDraft({ ...draft, dst })}
          placeholder={t("acls.aclRule.destinationsPlaceholder")}
          suggestions={destinations}
          values={draft.dst}
        />
        <Input
          description={t("acls.aclRule.protocolDescription")}
          label={t("acls.aclRule.protocolLabel")}
          onChange={(proto) => setDraft({ ...draft, proto: proto.length > 0 ? proto : undefined })}
          placeholder={t("acls.aclRule.protocolPlaceholder")}
          value={draft.proto ?? ""}
        />
        <RuleIssues issues={issues} />
      </DialogPanel>
    </Dialog>
  );
}
