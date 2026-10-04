import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Link from "~/components/link";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";
import { isValidGroupName } from "~/utils/acl-policy";

interface UserGroupsProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  // The Headscale username, which is what the ACL policy references.
  userName: string;
  displayName: string;
  groups: string[];
  availableGroups: string[];
  // Whether the stored policy contains HuJSON comments, which saving drops.
  policyHasComments?: boolean;
}

export default function UserGroups({
  isOpen,
  setIsOpen,
  userName,
  displayName,
  groups,
  availableGroups,
  policyHasComments,
}: UserGroupsProps) {
  const { t, tr } = useI18n();
  const fetcher = useFetcher<{ message?: string; error?: string; errorCode?: string }>();
  const submittingRef = useRef(false);
  const [selected, setSelected] = useState([...groups]);

  // Fixed messages come back as a code so the UI can translate them; API and
  // policy parse errors are passed through verbatim.
  const error = fetcher.data?.errorCode ? t("users.groups.policyReadOnly") : fetcher.data?.error;
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (isOpen) {
      setSelected([...groups]);
    }
  }, [isOpen, groups]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
      if (!fetcher.data.error && !fetcher.data.errorCode) {
        setIsOpen(false);
      }
    }
  }, [fetcher.data, fetcher.state]);

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
        isDisabled={isSubmitting}
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;
          const form = new FormData();
          form.set("action_id", "update_user_groups");
          form.set("user_name", userName);
          form.set("groups", selected.join(","));
          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("users.groups.title", { name: displayName })}</Title>
        <Text>
          {tr("users.groups.body", {
            code: <code className="font-mono">groups</code>,
            link: (
              <Link external styled to="https://tailscale.com/kb/1018/acls">
                {t("users.groups.tailscaleGuide")}
              </Link>
            ),
          })}
        </Text>
        {policyHasComments ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t("users.groups.commentsWarning")}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <TokenList
          emptyText={t("users.groups.emptyText")}
          isDisabled={isSubmitting}
          label={t("users.groups.label")}
          onChange={setSelected}
          placeholder={t("users.groups.placeholder")}
          suggestions={availableGroups}
          validate={isValidGroupName}
          values={selected}
        />
      </DialogPanel>
    </Dialog>
  );
}
