import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import CodeBlock from "~/components/code-block";
import Notice from "~/components/notice";
import NumberInput from "~/components/number-input";
import { SettingsCollapsible } from "~/components/settings-nav";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";

import type { ApiKeyActionResult } from "../actions";
import { API_KEY_ERROR_KEYS } from "../error-keys";

export default function CreateApiKey() {
  const { t } = useI18n();
  const fetcher = useFetcher<ApiKeyActionResult>();
  const [isRevealDismissed, setIsRevealDismissed] = useState(false);

  // The full key is only ever returned by this one response, so it stays in the
  // block above the list until the user asks for the form back.
  const createdKey =
    !isRevealDismissed && fetcher.data && fetcher.data.success && "apiKey" in fetcher.data
      ? fetcher.data.apiKey
      : null;
  const error =
    fetcher.data && !fetcher.data.success ? t(API_KEY_ERROR_KEYS[fetcher.data.errorCode]) : null;

  useEffect(() => {
    if (fetcher.data) {
      setIsRevealDismissed(false);
    }
  }, [fetcher.data]);

  return (
    <SettingsCollapsible
      defaultOpen
      description={t("settings.apiKeys.createSectionBody")}
      title={t("settings.apiKeys.create")}
    >
      {createdKey ? (
        <div className="flex flex-col gap-4">
          <Title className="text-lg font-medium">{t("settings.apiKeys.createdTitle")}</Title>
          <Notice variant="warning">{t("settings.apiKeys.createdBody")}</Notice>
          <CodeBlock>{createdKey}</CodeBlock>
          <Button onClick={() => setIsRevealDismissed(true)} variant="heavy">
            {t("settings.apiKeys.createAnother")}
          </Button>
        </div>
      ) : (
        <fetcher.Form className="flex flex-col gap-4" method="post">
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
    </SettingsCollapsible>
  );
}
