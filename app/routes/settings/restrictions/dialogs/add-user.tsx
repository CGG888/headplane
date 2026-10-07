import { type } from "arktype";
import { Form } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import { SettingsActions } from "~/components/settings-nav";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";
import {
  isValidRestrictionName,
  RESTRICTION_NAME_PATTERN,
  RESTRICTION_STRING_MAX_LENGTH,
} from "~/utils/restrictions";

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

      // The action rejects whitespace, control characters and anything over
      // 255 characters (see `~/utils/restrictions`), so the dialog does too.
      if (!isValidRestrictionName(user)) {
        return { user: t("settings.addUser.invalid") };
      }

      return undefined;
    },
  });

  return (
    <Form className="flex flex-col gap-4" method="POST">
      <input name="action_id" type="hidden" value="add_user" />
      <Input
        {...form.field("user")}
        description={t("settings.addUser.description")}
        disabled={isDisabled}
        maxLength={RESTRICTION_STRING_MAX_LENGTH}
        pattern={RESTRICTION_NAME_PATTERN}
        required
        label={t("settings.addUser.label")}
        placeholder={t("settings.addUser.placeholder")}
      />
      <SettingsActions>
        <Button disabled={isDisabled} type="submit" variant="heavy">
          {t("settings.addUser.button")}
        </Button>
      </SettingsActions>
    </Form>
  );
}
