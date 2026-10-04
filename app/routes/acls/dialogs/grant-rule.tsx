import { useEffect, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";
import type { GrantRule } from "~/utils/acl-policy";

interface GrantRuleDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  rule?: GrantRule;
  sources: string[];
  destinations: string[];
  onSave: (rule: GrantRule) => void;
}

const EMPTY: GrantRule = { src: [], dst: [], ip: [], extra: {} };

// Headscale accepts `*`, a single port, a range or a comma separated list of
// either, optionally prefixed with a protocol.
const IP_SPEC = /^(?:(?:tcp|udp):)?(?:\*|\d{1,5}(?:-\d{1,5})?(?:,(?:\*|\d{1,5}(?:-\d{1,5})?))*)$/;

export function isValidGrantIp(value: string): boolean {
  return IP_SPEC.test(value.trim());
}

// The port specs a grant most commonly needs, offered as one-click chips.
const IP_SUGGESTIONS = ["*", "tcp:443", "udp:53", "80,443", "1000-2000"];

export default function GrantRuleDialog({
  isOpen,
  setIsOpen,
  rule,
  sources,
  destinations,
  onSave,
}: GrantRuleDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<GrantRule>(rule ?? EMPTY);

  useEffect(() => {
    if (isOpen) {
      setDraft(rule ? structuredClone(rule) : structuredClone(EMPTY));
    }
  }, [isOpen, rule]);

  // An application grant is identified by `app` in `extra`; it targets an
  // application rather than a port, so its ip list may stay empty.
  const hasApp = "app" in draft.extra;
  const isInvalid =
    draft.src.length === 0 || draft.dst.length === 0 || (draft.ip.length === 0 && !hasApp);

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
        <Title>{rule ? t("acls.grantRule.editTitle") : t("acls.grantRule.newTitle")}</Title>
        <Text>{t("acls.grantRule.body")}</Text>
        <TokenList
          description={t("acls.grantRule.sourcesDescription")}
          emptyText={t("acls.common.noSources")}
          label={t("acls.common.sources")}
          onChange={(src) => setDraft({ ...draft, src })}
          placeholder={t("acls.grantRule.sourcesPlaceholder")}
          suggestions={sources}
          values={draft.src}
        />
        <TokenList
          description={t("acls.grantRule.destinationsDescription")}
          emptyText={t("acls.common.noDestinations")}
          label={t("acls.common.destinations")}
          onChange={(dst) => setDraft({ ...draft, dst })}
          placeholder={t("acls.grantRule.destinationsPlaceholder")}
          suggestions={destinations}
          values={draft.dst}
        />
        <TokenList
          description={hasApp ? t("acls.grantRule.appNote") : t("acls.grantRule.ipDescription")}
          emptyText={t("acls.grantRule.ipEmpty")}
          label={t("acls.grantRule.ipLabel")}
          onChange={(ip) => setDraft({ ...draft, ip })}
          placeholder={t("acls.grantRule.ipPlaceholder")}
          suggestions={IP_SUGGESTIONS}
          validate={isValidGrantIp}
          values={draft.ip}
        />
        {!hasApp && draft.ip.length === 0 ? (
          <p className="text-xs text-red-500 dark:text-red-400">{t("acls.grantRule.ipRequired")}</p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
