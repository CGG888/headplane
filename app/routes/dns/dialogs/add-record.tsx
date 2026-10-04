import { type } from "arktype";

import Button from "~/components/button";
import Code from "~/components/code";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Select from "~/components/select";
import Text from "~/components/text";
import Title from "~/components/title";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";

const recordSchema = type({
  record_type: "'A' | 'AAAA'",
  record_name: "string > 0",
  record_value: "string > 0",
});

interface Props {
  records: { name: string; type: "A" | "AAAA" | string; value: string }[];
}

export default function AddRecord({ records }: Props) {
  const { t, tr } = useI18n();
  const form = useForm({
    schema: recordSchema,
    defaultValues: { record_type: "A" },
    validate: (values) => {
      const name = values.record_name as string;
      const ip = values.record_value as string;
      if (name.length === 0 || ip.length === 0) return undefined;

      const lookup = records.find((r) => r.name === name);
      if (lookup?.value === ip) {
        return {
          record_name: t("dns.records.duplicateField"),
          record_value: t("dns.records.duplicateField"),
        };
      }

      return undefined;
    },
  });
  const name = form.values.record_name as string;
  const ip = form.values.record_value as string;
  const recordType = form.values.record_type as string;
  // Computed from the record list rather than the (localized) error text.
  const isDuplicate =
    name.length > 0 && ip.length > 0 && records.some((r) => r.name === name && r.value === ip);

  return (
    <Dialog>
      <Button>{t("dns.records.add")}</Button>
      <DialogPanel onSubmit={() => form.reset()}>
        <Title>{t("dns.records.add")}</Title>
        <Text>{t("dns.records.addBody")}</Text>
        <div className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="action_id" value="add_record" />
          <Select
            required
            label={t("dns.records.typeLabel")}
            name="record_type"
            defaultValue={recordType}
            onValueChange={(v) => {
              if (v) form.setValue("record_type", v);
            }}
            items={[
              { value: "A", label: "A" },
              { value: "AAAA", label: "AAAA" },
            ]}
          />
          <Input
            {...form.field("record_name")}
            required
            label={t("dns.records.domainLabel")}
            placeholder={t("dns.records.domainPlaceholder")}
          />
          <Input
            {...form.field("record_value")}
            required
            label={t("dns.records.ipLabel")}
            placeholder={recordType === "AAAA" ? "2001:db8::ff00:42:8329" : "101.101.101.101"}
          />
          {isDuplicate ? (
            <p className="text-sm opacity-50">
              {tr("dns.records.duplicateBody", {
                name: <Code>{name}</Code>,
                ip: <Code>{ip}</Code>,
              })}
            </p>
          ) : undefined}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
