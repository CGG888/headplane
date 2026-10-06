import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { PreAuthKey } from "~/types";

import { confirmedDeleteRequest } from "../delete-confirm";
import { AUTH_KEY_ERROR_KEYS } from "../error-keys";
import type { AuthKeyDeleteResult } from "../result";

interface DeleteAuthKeyProps {
  authKey: PreAuthKey;
  /** Headscale user id of the owner, or null for a tag-only key. */
  userId: string | null;
}

/**
 * Deletes the key's record from Headscale for good. The identifier in the
 * dialog is the same key string the row already shows; the request itself only
 * carries the stable key id and, for a self-service account, the owner the
 * action checks ownership against.
 */
export default function DeleteAuthKey({ authKey, userId }: DeleteAuthKeyProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<AuthKeyDeleteResult>();
  const submittingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const error =
    fetcher.data && !fetcher.data.success ? t(AUTH_KEY_ERROR_KEYS[fetcher.data.errorCode]) : null;

  useEffect(() => {
    if (fetcher.data?.success) {
      submittingRef.current = false;
      setIsOpen(false);
    }

    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.success) {
      submittingRef.current = false;
    }
  }, [fetcher.data, fetcher.state]);

  const handleOpenChange = (open: boolean) => {
    if (!open && submittingRef.current) {
      return;
    }

    setIsOpen(open);
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Button onClick={() => setIsOpen(true)} variant="danger">
        {t("settings.authKeys.delete")}
      </Button>
      <DialogPanel
        isDisabled={fetcher.state !== "idle"}
        onSubmit={(event) => {
          event.preventDefault();

          // The only path that submits: the confirmation dialog is open and the
          // operator pressed its confirm button.
          const entries: Record<string, string> = { key_id: authKey.id };
          if (userId) {
            entries.user_id = userId;
          }

          const form = confirmedDeleteRequest(isOpen, entries);
          if (!form) {
            return;
          }

          submittingRef.current = true;
          fetcher.submit(form, { method: "POST" });
        }}
        variant="destructive"
      >
        <Title>{t("settings.authKeys.deleteTitle", { key: authKey.key })}</Title>
        <Text>{t("settings.authKeys.deleteBody", { key: authKey.key })}</Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
