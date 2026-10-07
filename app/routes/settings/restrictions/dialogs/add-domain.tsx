import { type } from "arktype";
import { Form } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import { SettingsActions } from "~/components/settings-nav";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";
import {
  DOMAIN_PATTERN,
  isValidRestrictionDomain,
  RESTRICTION_DOMAIN_MAX_LENGTH,
} from "~/utils/restrictions";

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

      // The same rule the action applies (see `~/utils/restrictions`). The
      // previous `URL.hostname` comparison accepted `a_b.com` and refused
      // `EXAMPLE.com`, because the URL parser lower-cases the host.
      if (!isValidRestrictionDomain(domain)) {
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
        maxLength={RESTRICTION_DOMAIN_MAX_LENGTH}
        pattern={DOMAIN_PATTERN}
        required
        label={t("settings.addDomain.label")}
        placeholder={t("settings.addDomain.placeholder")}
      />
      <SettingsActions>
        <Button disabled={isDisabled} type="submit" variant="heavy">
          {t("settings.addDomain.button")}
        </Button>
      </SettingsActions>
    </Form>
  );
}
