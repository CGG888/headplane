import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import CodeBlock from "~/components/code-block";
import Dialog, { DialogPanel } from "~/components/dialog";
import Notice from "~/components/notice";
import NumberInput from "~/components/number-input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";

import type { ApiKeyActionResult } from "../actions";
import { API_KEY_ERROR_KEYS } from "../error-keys";

export default function CreateApiKey() {
  const { t } = useI18n();
  const fetcher = useFetcher<ApiKeyActionResult>();
  const submittingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  // The full key is only ever returned by this one response, so it is kept in
  // the dialog until the user closes it.
  const createdKey =
    fetcher.data && fetcher.data.success && "apiKey" in fetcher.data ? fetcher.data.apiKey : null;
  const error =
    fetcher.data && !fetcher.data.success ? t(API_KEY_ERROR_KEYS[fetcher.data.errorCode]) : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
    }
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    if (!isOpen) {
      fetcher.data = undefined;
    }
  }, [isOpen]);

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
      <Button className="my-4" onClick={() => setIsOpen(true)}>
        {t("settings.apiKeys.create")}
      </Button>
      {createdKey ? (
        <DialogPanel variant="unactionable">
          <Title>{t("settings.apiKeys.createdTitle")}</Title>
          <Notice variant="warning">{t("settings.apiKeys.createdBody")}</Notice>
          <CodeBlock>{createdKey}</CodeBlock>
        </DialogPanel>
      ) : (
        <DialogPanel
          isDisabled={fetcher.state !== "idle"}
          onSubmit={(event) => {
            event.preventDefault();
            submittingRef.current = true;
            const form = new FormData(event.currentTarget as HTMLFormElement);
            form.set("action_id", "create_api_key");
            fetcher.submit(form, { method: "POST" });
          }}
        >
          <Title>{t("settings.apiKeys.createTitle")}</Title>
          <Text>{t("settings.apiKeys.createBody")}</Text>
          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <NumberInput
            defaultValue={90}
            description={t("settings.apiKeys.expirationDescription")}
            label={t("settings.apiKeys.expirationLabel")}
            max={3650}
            min={1}
            name="expiration"
            required
          />
        </DialogPanel>
      )}
    </Dialog>
  );
}
