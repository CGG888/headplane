import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import CodeBlock from "~/components/code-block";
import { SettingsSection } from "~/components/drawer";
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
  // the drawer until the user closes it.
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
    <SettingsSection
      description={t("settings.apiKeys.createSectionBody")}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && submittingRef.current) {
          return;
        }
        setIsOpen(open);
      }}
      title={t("settings.apiKeys.create")}
    >
      {createdKey ? (
        <div className="flex flex-col gap-4">
          <Title className="text-lg font-medium">{t("settings.apiKeys.createdTitle")}</Title>
          <Notice variant="warning">{t("settings.apiKeys.createdBody")}</Notice>
          <CodeBlock>{createdKey}</CodeBlock>
        </div>
      ) : (
        <fetcher.Form
          className="flex flex-col gap-4"
          method="post"
          onSubmit={() => {
            submittingRef.current = true;
          }}
        >
          <input name="action_id" type="hidden" value="create_api_key" />
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
          <Button
            className="w-fit"
            disabled={fetcher.state !== "idle"}
            type="submit"
            variant="heavy"
          >
            {t("settings.apiKeys.create")}
          </Button>
        </fetcher.Form>
      )}
    </SettingsSection>
  );
}
