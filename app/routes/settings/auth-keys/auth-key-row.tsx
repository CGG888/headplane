import Attribute from "~/components/attribute";
import { useI18n } from "~/i18n/provider";
import type { PreAuthKey, User } from "~/types";
import { getUserDisplayName } from "~/utils/user";

import DeleteAuthKey from "./dialogs/delete-auth-key";
import ExpireAuthKey from "./dialogs/expire-auth-key";
import { isPreAuthKeyExpired } from "./filters";
import SelectCheckbox from "./select-checkbox";

interface Props {
  authKey: PreAuthKey;
  user: User | null;
  /**
   * Whether this Headscale server can delete a pre-auth key at all. The
   * endpoint and the stable key id it takes both start at 0.28, so older
   * servers get no delete control instead of one that cannot work.
   */
  canDelete?: boolean;
  /** Omit to render the row without a selection box. */
  onSelectedChange?: (selected: boolean) => void;
  selected?: boolean;
}

export default function AuthKeyRow({
  authKey,
  user,
  canDelete = false,
  onSelectedChange,
  selected = false,
}: Props) {
  const { t, locale } = useI18n();
  const createdAt = new Date(authKey.createdAt).toLocaleString(locale);
  const expiration = new Date(authKey.expiration).toLocaleString(locale);
  const isExpired = isPreAuthKeyExpired(authKey);
  const userDisplay = user
    ? getUserDisplayName(user, t("machines.common.tagOwned"))
    : t("settings.authKeyRow.tagOnly");

  // Expiring a spent or already-expired key is a no-op, and a tag-only key has
  // no owner for the expire endpoint; deleting is the one action that applies
  // to both, which is why it is not gated the same way.
  const showExpire = !isExpired && user !== null;

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
      <div className="w-full min-w-0">
        {/* Two field columns on a wide page: each label keeps its own narrow
            column instead of being spread across the whole row. */}
        <div className="grid gap-x-8 gap-y-0.5 lg:grid-cols-2">
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
        </div>
        {showExpire || canDelete ? (
          <div className="mt-2 flex flex-wrap items-center gap-2" suppressHydrationWarning>
            {showExpire && user ? <ExpireAuthKey authKey={authKey} user={user} /> : null}
            {canDelete ? <DeleteAuthKey authKey={authKey} userId={user?.id ?? null} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
