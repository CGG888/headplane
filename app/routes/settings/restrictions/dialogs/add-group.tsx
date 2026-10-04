import { type } from "arktype";
import { Form } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";

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

      return undefined;
    },
  });

  return (
    <Form className="flex flex-col gap-4" method="POST">
      <Title className="text-lg font-medium">{t("settings.addGroup.title")}</Title>
      <Text>{t("settings.addGroup.body")}</Text>
      <input name="action_id" type="hidden" value="add_group" />
      <Input
        {...form.field("group")}
        description={t("settings.addGroup.description")}
        disabled={isDisabled}
        required
        label={t("settings.addGroup.label")}
        placeholder={t("settings.addGroup.placeholder")}
      />
      <Button disabled={isDisabled} type="submit" variant="heavy">
        {t("settings.addGroup.button")}
      </Button>
    </Form>
  );
}
