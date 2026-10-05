import Attribute from "~/components/attribute";
import { useI18n } from "~/i18n/provider";
import type { PreAuthKey, User } from "~/types";
import { getUserDisplayName } from "~/utils/user";

import ExpireAuthKey from "./dialogs/expire-auth-key";
import { isPreAuthKeyExpired } from "./filters";
import SelectCheckbox from "./select-checkbox";

interface Props {
  authKey: PreAuthKey;
  user: User | null;
  /** Omit to render the row without a selection box. */
  onSelectedChange?: (selected: boolean) => void;
  selected?: boolean;
}

export default function AuthKeyRow({ authKey, user, onSelectedChange, selected = false }: Props) {
  const { t, locale } = useI18n();
  const createdAt = new Date(authKey.createdAt).toLocaleString(locale);
  const expiration = new Date(authKey.expiration).toLocaleString(locale);
  const isExpired = isPreAuthKeyExpired(authKey);
  const userDisplay = user
    ? getUserDisplayName(user, t("machines.common.tagOwned"))
    : t("settings.authKeyRow.tagOnly");

  return (
    <div className="flex w-full items-start gap-3">
      {onSelectedChange ? (
        <SelectCheckbox
          aria-label={t("settings.authKeys.selectKey", { key: authKey.key })}
          checked={selected}
          className="mt-1"
          disabled={isExpired || user === null}
          onChange={onSelectedChange}
        />
      ) : null}
      <div className="w-full">
        <Attribute name={t("settings.authKeyRow.key")} value={authKey.key} />
        <Attribute name={t("settings.authKeyRow.user")} value={userDisplay} />
        <Attribute
          name={t("settings.authKeyRow.reusable")}
          value={authKey.reusable ? t("settings.authKeyRow.yes") : t("settings.authKeyRow.no")}
        />
        <Attribute
          name={t("settings.authKeyRow.ephemeral")}
          value={authKey.ephemeral ? t("settings.authKeyRow.yes") : t("settings.authKeyRow.no")}
        />
        <Attribute
          name={t("settings.authKeyRow.used")}
          value={authKey.used ? t("settings.authKeyRow.yes") : t("settings.authKeyRow.no")}
        />
        <Attribute name={t("settings.authKeyRow.created")} value={createdAt} />
        <Attribute name={t("settings.authKeyRow.expiration")} value={expiration} />
        {isExpired ? (
          // Headscale keeps expired and used keys in its list; say why there is
          // no delete action next to the record it applies to.
          <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
            {t("settings.authKeyRow.expiredNote")}
          </p>
        ) : user ? (
          <div className="mt-2" suppressHydrationWarning>
            <ExpireAuthKey authKey={authKey} user={user} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
