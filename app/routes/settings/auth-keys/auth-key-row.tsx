import Attribute from "~/components/attribute";
import { useI18n } from "~/i18n/provider";
import type { PreAuthKey, User } from "~/types";
import { getUserDisplayName } from "~/utils/user";

import ExpireAuthKey from "./dialogs/expire-auth-key";

interface Props {
  authKey: PreAuthKey;
  user: User | null;
}

export default function AuthKeyRow({ authKey, user }: Props) {
  const { t, locale } = useI18n();
  const createdAt = new Date(authKey.createdAt).toLocaleString(locale);
  const expiration = new Date(authKey.expiration).toLocaleString(locale);
  const isExpired =
    (authKey.used && !authKey.reusable) || new Date(authKey.expiration) < new Date();
  const userDisplay = user
    ? getUserDisplayName(user, t("machines.common.tagOwned"))
    : t("settings.authKeyRow.tagOnly");

  return (
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
      {!isExpired && user && (
        <div className="mt-2" suppressHydrationWarning>
          <ExpireAuthKey authKey={authKey} user={user} />
        </div>
      )}
    </div>
  );
}
