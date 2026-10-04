import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import { User } from "~/types";
import { USERNAME_PATTERN } from "~/utils/user";

interface RenameProps {
  user: User;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function RenameUser({ user, isOpen, setIsOpen }: RenameProps) {
  const { t } = useI18n();
  const name = user.name || user.displayName || user.id;
  const usernameRule = t("users.create.usernameRule");

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel>
        <Title>{t("users.rename.title", { name })}</Title>
        <Text className="mb-6">{t("users.rename.body", { name })}</Text>
        <input name="action_id" type="hidden" value="rename_user" />
        <input name="headscale_user_id" type="hidden" value={user.id} />
        <Input
          defaultValue={user.name}
          description={usernameRule}
          minLength={2}
          pattern={USERNAME_PATTERN}
          required
          title={usernameRule}
          label={t("users.create.username")}
          name="new_name"
          placeholder={t("users.rename.placeholder")}
        />
      </DialogPanel>
    </Dialog>
  );
}
