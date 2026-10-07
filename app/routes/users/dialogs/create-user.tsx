import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import { USERNAME_PATTERN, USER_STRING_MAX_LENGTH } from "~/utils/user";

interface CreateUserProps {
  isOidc?: boolean;
  isDisabled?: boolean;
}

export default function CreateUser({ isOidc, isDisabled }: CreateUserProps) {
  const { t } = useI18n();
  const usernameRule = t("users.create.usernameRule");

  return (
    <Dialog>
      <Button disabled={isDisabled}>{t("users.create.addUser")}</Button>
      <DialogPanel>
        <Title>{t("users.create.title")}</Title>
        <Text className="mb-6">{isOidc ? t("users.create.bodyOidc") : t("users.create.body")}</Text>
        <input name="action_id" type="hidden" value="create_user" />
        <div className="flex flex-col gap-4">
          <Input
            description={usernameRule}
            maxLength={USER_STRING_MAX_LENGTH}
            minLength={2}
            pattern={USERNAME_PATTERN}
            required
            title={usernameRule}
            label={t("users.create.username")}
            name="username"
            placeholder={t("users.create.placeholderUsername")}
            type="text"
          />
          <Input
            label={t("users.create.displayName")}
            maxLength={USER_STRING_MAX_LENGTH}
            name="display_name"
            placeholder={t("users.create.placeholderDisplayName")}
            type="text"
          />
          <Input
            label={t("users.create.email")}
            maxLength={USER_STRING_MAX_LENGTH}
            name="email"
            placeholder={t("users.create.placeholderEmail")}
            type="email"
          />
        </div>
      </DialogPanel>
    </Dialog>
  );
}
