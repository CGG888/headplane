import Attribute from "~/components/attribute";
import { useI18n } from "~/i18n/provider";
import type { Key } from "~/types";
import { isNoExpiry } from "~/utils/node-info";

import ExpireApiKey from "./dialogs/expire-api-key";
import { isApiKeyExpired } from "./filters";
import SelectCheckbox from "./select-checkbox";

interface ApiKeyRowProps {
  apiKey: Key;
  /** Omit to render the row without a selection box. */
  onSelectedChange?: (selected: boolean) => void;
  selected?: boolean;
}

export default function ApiKeyRow({ apiKey, onSelectedChange, selected = false }: ApiKeyRowProps) {
  const { t, locale } = useI18n();
  const createdAt = new Date(apiKey.createdAt).toLocaleString(locale);
  const hasExpiry = !isNoExpiry(apiKey.expiration);
  const expiration = hasExpiry
    ? new Date(apiKey.expiration).toLocaleString(locale)
    : t("settings.apiKeys.never");
  const lastSeen = apiKey.lastSeen
    ? new Date(apiKey.lastSeen).toLocaleString(locale)
    : t("settings.apiKeys.never");
  const isExpired = isApiKeyExpired(apiKey);

  return (
    <div className="flex w-full items-start gap-3">
      {onSelectedChange ? (
        <SelectCheckbox
          aria-label={t("settings.apiKeys.selectKey", { prefix: apiKey.prefix })}
          checked={selected}
          className="mt-1"
          disabled={isExpired}
          onChange={onSelectedChange}
        />
      ) : null}
      <div className="w-full min-w-0">
        {/* Four short fields read as two columns on a wide page, so the values
            stay close to their labels instead of drifting to the far edge. */}
        <div className="grid gap-x-8 gap-y-0.5 lg:grid-cols-2">
          <Attribute isCopyable name={t("settings.apiKeys.prefix")} value={apiKey.prefix} />
          <Attribute name={t("settings.apiKeys.created")} value={createdAt} />
          <Attribute name={t("settings.apiKeys.expiration")} value={expiration} />
          <Attribute name={t("settings.apiKeys.lastSeen")} value={lastSeen} />
        </div>
        {isExpired ? (
          // Headscale keeps expired keys in its list; say why there is no
          // delete action next to the record it applies to.
          <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
            {t("settings.apiKeys.expiredNote")}
          </p>
        ) : (
          <div className="mt-2" suppressHydrationWarning>
            <ExpireApiKey apiKey={apiKey} />
          </div>
        )}
      </div>
    </div>
  );
}
