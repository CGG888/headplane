import { useEffect, useMemo, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import Select from "~/components/select";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";
import { KNOWN_SSH_ACTIONS, sshRuleIssues, type Policy, type SshRule } from "~/utils/acl-policy";

import RuleIssues from "../components/rule-issues";

interface SshRuleDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  rule?: SshRule;
  policy: Policy;
  sources: string[];
  destinations: string[];
  onSave: (rule: SshRule) => void;
}

const EMPTY: SshRule = { action: "accept", src: [], dst: [], users: [], extra: {} };
const SSH_USERS = ["root", "autogroup:nonroot"];

export default function SshRuleDialog({
  isOpen,
  setIsOpen,
  rule,
  policy,
  sources,
  destinations,
  onSave,
}: SshRuleDialogProps) {
  const { t, tr } = useI18n();
  const [draft, setDraft] = useState<SshRule>(rule ?? EMPTY);

  useEffect(() => {
    if (isOpen) {
      setDraft(rule ? structuredClone(rule) : structuredClone(EMPTY));
    }
  }, [isOpen, rule]);

  // Headscale refuses most of what the generic Access Control catalog suggests
  // (hosts, `*`, group destinations, `autogroup:admin`). The checks below are
  // the ones it runs itself, so the rule is known to be acceptable before it is
  // saved: a rejected rule would otherwise come back as an HTTP 500.
  const issues = useMemo(() => sshRuleIssues(draft, policy), [draft, policy]);

  const isInvalid =
    draft.src.length === 0 ||
    draft.dst.length === 0 ||
    draft.users.length === 0 ||
    issues.length > 0;

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={isInvalid}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
          setIsOpen(false);
        }}
      >
        <Title>{rule ? t("acls.sshRule.editTitle") : t("acls.sshRule.newTitle")}</Title>
        <Text>
          {tr("acls.sshRule.body", {
            link: (
              <Link external styled to="https://tailscale.com/kb/1193/tailscale-ssh">
                {t("acls.sshRule.docs")}
              </Link>
            ),
          })}
        </Text>
        <Select
          items={[
            { value: "accept", label: t("acls.sshRule.actionAccept") },
            { value: "check", label: t("acls.sshRule.actionCheck") },
            // An action we do not know is listed as-is so it survives an edit.
            ...(KNOWN_SSH_ACTIONS.includes(draft.action)
              ? []
              : [
                  {
                    value: draft.action,
                    label: t("acls.sshRule.actionUnknown", { action: draft.action }),
                  },
                ]),
          ]}
          label={t("acls.sshRule.actionLabel")}
          onValueChange={(value) => setDraft({ ...draft, action: value ?? draft.action })}
          value={draft.action}
        />
        <TokenList
          description={t("acls.sshRule.sourcesDescription")}
          emptyText={t("acls.common.noSources")}
          label={t("acls.common.sources")}
          onChange={(src) => setDraft({ ...draft, src })}
          placeholder={t("acls.sshRule.sourcesPlaceholder")}
          suggestions={sources}
          values={draft.src}
        />
        <TokenList
          description={t("acls.sshRule.destinationsDescription")}
          emptyText={t("acls.common.noDestinations")}
          label={t("acls.common.destinations")}
          onChange={(dst) => setDraft({ ...draft, dst })}
          placeholder={t("acls.sshRule.destinationsPlaceholder")}
          suggestions={destinations}
          values={draft.dst}
        />
        <TokenList
          description={t("acls.sshRule.usersDescription")}
          emptyText={t("acls.sshRule.usersEmpty")}
          label={t("acls.sshRule.usersLabel")}
          onChange={(users) => setDraft({ ...draft, users })}
          placeholder={t("acls.sshRule.usersPlaceholder")}
          suggestions={SSH_USERS}
          values={draft.users}
        />
        {draft.action === "check" ? (
          <Input
            description={t("acls.sshRule.checkDescription")}
            label={t("acls.sshRule.checkLabel")}
            onChange={(checkPeriod) =>
              setDraft({ ...draft, checkPeriod: checkPeriod.length > 0 ? checkPeriod : undefined })
            }
            placeholder={t("acls.sshRule.checkPlaceholder")}
            value={draft.checkPeriod ?? ""}
          />
        ) : null}
        <RuleIssues issues={issues} />
      </DialogPanel>
    </Dialog>
  );
}
