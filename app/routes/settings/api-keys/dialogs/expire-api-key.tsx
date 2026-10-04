import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Drawer, { DrawerPanel } from "~/components/drawer";
import Text from "~/components/text";
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

  const handleOpenChange = (open: boolean) => {
    if (!open && submittingRef.current) {
      return;
    }

    setIsOpen(open);
  };

  return (
    <Drawer isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Button onClick={() => setIsOpen(true)} variant="heavy">
        {t("settings.apiKeys.expire")}
      </Button>
      <DrawerPanel title={t("settings.apiKeys.expireTitle", { prefix: apiKey.prefix })}>
        <fetcher.Form
          className="flex flex-col gap-4"
          method="post"
          onSubmit={() => {
            submittingRef.current = true;
          }}
        >
          <input name="action_id" type="hidden" value="expire_api_key" />
          <input name="prefix" type="hidden" value={apiKey.prefix} />
          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <Text>{t("settings.apiKeys.expireBody")}</Text>
          <div className="flex justify-end gap-3">
            <Button onClick={() => handleOpenChange(false)} type="button">
              {t("common.cancel")}
            </Button>
            <Button disabled={fetcher.state !== "idle"} type="submit" variant="danger">
              {t("common.confirm")}
            </Button>
          </div>
        </fetcher.Form>
      </DrawerPanel>
    </Drawer>
  );
}
