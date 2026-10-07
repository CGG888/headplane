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

const groupSchema = type({
  group: "string > 0",
});

interface AddGroupProps {
  groups: string[];
  isDisabled?: boolean;
}

export default function AddGroup({ groups, isDisabled }: AddGroupProps) {
  const { t } = useI18n();
  const form = useForm({
    schema: groupSchema,
    validate: (values) => {
      const group = (values.group as string).trim();
      if (group.length === 0) return undefined;

      if (groups.includes(group)) {
        return { group: t("settings.addGroup.duplicate") };
      }

      // The action rejects whitespace, control characters and anything over
      // 255 characters (see `~/utils/restrictions`), so the dialog does too.
      if (!isValidRestrictionName(group)) {
        return { group: t("settings.addGroup.invalid") };
      }

      return undefined;
    },
  });

  return (
    <Form className="flex flex-col gap-4" method="POST">
      <input name="action_id" type="hidden" value="add_group" />
      <Input
        {...form.field("group")}
        description={t("settings.addGroup.description")}
        disabled={isDisabled}
        maxLength={RESTRICTION_STRING_MAX_LENGTH}
        pattern={RESTRICTION_NAME_PATTERN}
        required
        label={t("settings.addGroup.label")}
        placeholder={t("settings.addGroup.placeholder")}
      />
      <SettingsActions>
        <Button disabled={isDisabled} type="submit" variant="heavy">
          {t("settings.addGroup.button")}
        </Button>
      </SettingsActions>
    </Form>
  );
}
