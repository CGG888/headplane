import Attribute from "~/components/attribute";
import { useI18n } from "~/i18n/provider";
import type { Key } from "~/types";
import { isNoExpiry } from "~/utils/node-info";

import ExpireApiKey from "./dialogs/expire-api-key";

interface ApiKeyRowProps {
  apiKey: Key;
}

export default function ApiKeyRow({ apiKey }: ApiKeyRowProps) {
  const { t, locale } = useI18n();
  const createdAt = new Date(apiKey.createdAt).toLocaleString(locale);
  const hasExpiry = !isNoExpiry(apiKey.expiration);
  const expiration = hasExpiry
    ? new Date(apiKey.expiration).toLocaleString(locale)
    : t("settings.apiKeys.never");
  const lastSeen = apiKey.lastSeen
    ? new Date(apiKey.lastSeen).toLocaleString(locale)
    : t("settings.apiKeys.never");
  const isExpired = hasExpiry && new Date(apiKey.expiration).getTime() < Date.now();

  return (
    <div className="w-full">
      <Attribute isCopyable name={t("settings.apiKeys.prefix")} value={apiKey.prefix} />
      <Attribute name={t("settings.apiKeys.created")} value={createdAt} />
      <Attribute name={t("settings.apiKeys.expiration")} value={expiration} />
      <Attribute name={t("settings.apiKeys.lastSeen")} value={lastSeen} />
      {!isExpired && (
        <div className="mt-2" suppressHydrationWarning>
          <ExpireApiKey apiKey={apiKey} />
        </div>
      )}
    </div>
  );
}
