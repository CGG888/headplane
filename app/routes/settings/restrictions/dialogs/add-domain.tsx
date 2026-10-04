import { type } from "arktype";
import { Form } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";

const domainSchema = type({
  domain: "string > 0",
});

interface AddDomainProps {
  domains: string[];
  isDisabled?: boolean;
}

export default function AddDomain({ domains, isDisabled }: AddDomainProps) {
  const { t } = useI18n();
  const form = useForm({
    schema: domainSchema,
    validate: (values) => {
      const domain = (values.domain as string).trim();
      if (domain.length === 0) return undefined;

      if (domains.includes(domain)) {
        return { domain: t("settings.addDomain.duplicate") };
      }

      try {
        const url = new URL(`http://${domain}`);
        if (url.hostname !== domain) {
          return { domain: t("settings.addDomain.invalid") };
        }
      } catch {
        return { domain: t("settings.addDomain.invalid") };
      }

      return undefined;
    },
  });
  const domain = (form.values.domain as string).trim();

  return (
    <Form className="flex flex-col gap-4" method="POST">
      <input name="action_id" type="hidden" value="add_domain" />
      <Input
        {...form.field("domain")}
        description={
          domain.length > 0
            ? t("settings.addDomain.descriptionWithDomain", { domain })
            : t("settings.addDomain.description")
        }
        disabled={isDisabled}
        required
        label={t("settings.addDomain.label")}
        placeholder={t("settings.addDomain.placeholder")}
      />
      <Button disabled={isDisabled} type="submit" variant="heavy">
        {t("settings.addDomain.button")}
      </Button>
    </Form>
  );
}
