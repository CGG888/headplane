import { type } from "arktype";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";

const userSchema = type({
  user: "string > 0",
});

interface AddUserProps {
  users: string[];
  isDisabled?: boolean;
}

export default function AddUser({ users, isDisabled }: AddUserProps) {
  const { t } = useI18n();
  const form = useForm({
    schema: userSchema,
    validate: (values) => {
      const user = (values.user as string).trim();
      if (user.length === 0) return undefined;

      if (users.includes(user)) {
        return { user: t("settings.addUser.duplicate") };
      }

      return undefined;
    },
  });

  return (
    <Dialog>
      <Button disabled={isDisabled}>{t("settings.addUser.button")}</Button>
      <DialogPanel>
        <Title>{t("settings.addUser.title")}</Title>
        <Text className="mb-4">{t("settings.addUser.body")}</Text>
        <input name="action_id" type="hidden" value="add_user" />
        <Input
          {...form.field("user")}
          description={t("settings.addUser.description")}
          required
          label={t("settings.addUser.label")}
          placeholder={t("settings.addUser.placeholder")}
        />
      </DialogPanel>
    </Dialog>
  );
}
