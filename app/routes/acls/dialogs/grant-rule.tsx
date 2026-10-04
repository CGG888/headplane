import { useEffect, useState } from "react";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
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

const EMPTY: GrantRule = { src: [], dst: [], ip: [], via: [], extra: {} };

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

  // An application grant targets an app instead of a port, so its ip list may
  // stay empty. Everything the editor cannot show rides in `extra`.
  const app = draft.app;
  const isInvalid =
    draft.src.length === 0 || draft.dst.length === 0 || (draft.ip.length === 0 && !app);

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={isInvalid}
        onSubmit={(event) => {
          event.preventDefault();
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
          description={t("acls.grantRule.ipDescription")}
          emptyText={t("acls.grantRule.ipEmpty")}
          label={t("acls.grantRule.ipLabel")}
          onChange={(ip) => setDraft({ ...draft, ip })}
          placeholder={t("acls.grantRule.ipPlaceholder")}
          suggestions={IP_SUGGESTIONS}
          validate={isValidGrantIp}
          values={draft.ip}
        />
        {!app && draft.ip.length === 0 ? (
          <p className="text-xs text-red-500 dark:text-red-400">{t("acls.grantRule.ipRequired")}</p>
        ) : null}
        <TokenList
          description={t("acls.grantRule.viaDescription")}
          emptyText={t("acls.grantRule.viaEmpty")}
          label={t("acls.grantRule.viaLabel")}
          onChange={(via) => setDraft({ ...draft, via })}
          placeholder={t("acls.grantRule.viaPlaceholder")}
          suggestions={sources}
          values={draft.via}
        />
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-mist-700 dark:text-mist-200">
                {t("acls.grantRule.appLabel")}
              </p>
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("acls.grantRule.appDescription")}
              </p>
            </div>
            <Button
              className="shrink-0"
              onClick={() =>
                setDraft(
                  app
                    ? { ...draft, app: undefined }
                    : { ...draft, app: { name: "", connectors: [], extra: {} } },
                )
              }
              type="button"
            >
              {app ? t("acls.grantRule.appClear") : t("acls.grantRule.appAdd")}
            </Button>
          </div>
          {app ? (
            <>
              <Input
                label={t("acls.grantRule.appNameLabel")}
                onChange={(name) => setDraft({ ...draft, app: { ...app, name } })}
                placeholder={t("acls.grantRule.appNamePlaceholder")}
                value={app.name}
              />
              <TokenList
                description={t("acls.grantRule.appConnectorsDescription")}
                emptyText={t("acls.grantRule.appConnectorsEmpty")}
                label={t("acls.grantRule.appConnectorsLabel")}
                onChange={(connectors) => setDraft({ ...draft, app: { ...app, connectors } })}
                placeholder={t("acls.grantRule.appConnectorsPlaceholder")}
                suggestions={sources}
                values={app.connectors}
              />
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("acls.grantRule.appNote")}
              </p>
            </>
          ) : null}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
