import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { Key } from "~/types";

import type { ApiKeyActionResult } from "../actions";
import { API_KEY_ERROR_KEYS } from "../error-keys";

interface ExpireApiKeyProps {
  apiKey: Key;
}

export default function ExpireApiKey({ apiKey }: ExpireApiKeyProps) {
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
      <Button onClick={() => setIsOpen(true)} variant="heavy">
        {t("settings.apiKeys.expire")}
      </Button>
      <DialogPanel
        isDisabled={fetcher.state !== "idle"}
        variant="destructive"
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;
          const form = new FormData();
          form.set("action_id", "expire_api_key");
          form.set("prefix", apiKey.prefix);
          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("settings.apiKeys.expireTitle", { prefix: apiKey.prefix })}</Title>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <Text>{t("settings.apiKeys.expireBody")}</Text>
      </DialogPanel>
    </Dialog>
  );
}
