import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { Key } from "~/types";

import type { ApiKeyActionResult } from "../actions";
import { confirmedDeleteRequest } from "../delete-confirm";
import { API_KEY_ERROR_KEYS } from "../error-keys";

interface DeleteApiKeyProps {
  apiKey: Key;
}

/**
 * Deletes the key's record from Headscale for good. Unlike the expire dialog
 * this one has to say what is lost, because Headscale's list only hides the
 * row afterwards — the key itself can never be read back.
 */
export default function DeleteApiKey({ apiKey }: DeleteApiKeyProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<ApiKeyActionResult>();
  const submittingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const error =
    fetcher.data && !fetcher.data.success ? t(API_KEY_ERROR_KEYS[fetcher.data.errorCode]) : null;

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
        {t("settings.apiKeys.delete")}
      </Button>
      <DialogPanel
        isDisabled={fetcher.state !== "idle"}
        onSubmit={(event) => {
          event.preventDefault();

          // The only path that submits: the confirmation dialog is open and the
          // operator pressed its confirm button.
          const form = confirmedDeleteRequest(isOpen, { prefix: apiKey.prefix });
          if (!form) {
            return;
          }

          submittingRef.current = true;
          fetcher.submit(form, { method: "POST" });
        }}
        variant="destructive"
      >
        <Title>{t("settings.apiKeys.deleteTitle", { prefix: apiKey.prefix })}</Title>
        <Text>{t("settings.apiKeys.deleteBody", { prefix: apiKey.prefix })}</Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
