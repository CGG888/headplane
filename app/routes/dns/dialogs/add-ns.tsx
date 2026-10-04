import { type } from "arktype";
import { Split } from "lucide-react";

import Button from "~/components/button";
import Chip from "~/components/chip";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Switch from "~/components/switch";
import Text from "~/components/text";
import Title from "~/components/title";
import Tooltip from "~/components/tooltip";
import { useForm } from "~/hooks/use-form";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

const nsSchema = type({
  ns: "string.ip",
  split_name: "string > 0",
});

interface Props {
  nameservers: Record<string, string[]>;
}

export default function AddNameserver({ nameservers }: Props) {
  const { t } = useI18n();
  const form = useForm({
    schema: nsSchema,
    defaultValues: { split_name: "global" },
    validate: (values) => {
      const ns = values.ns as string;
      const domain = values.split_name as string;
      if (!ns) return undefined;

      const isSplit = domain !== "global";
      const isDuplicate = isSplit
        ? nameservers[domain]?.includes(ns)
        : Object.values(nameservers).some((nsList) => nsList.includes(ns));

      if (isDuplicate) {
        return { ns: t("dns.ns.duplicate") };
      }

      return undefined;
    },
  });
  const split = (form.values.split_name as string) !== "global";

  return (
    <Dialog>
      <Button>{t("dns.ns.add")}</Button>
      <DialogPanel>
        <Title className="mb-4">{t("dns.ns.add")}</Title>
        <input name="action_id" type="hidden" value="add_ns" />
        <Input
          {...form.field("ns")}
          description={t("dns.ns.description")}
          required
          label={t("dns.ns.label")}
          placeholder={t("dns.ns.placeholder")}
        />
        <div className="mt-8 flex items-center justify-between">
          <div className="block">
            <div className="inline-flex items-center gap-2">
              <Text className="font-semibold">{t("dns.ns.restrictTitle")}</Text>
              <Tooltip content={t("dns.ns.splitTooltip")}>
                <Chip
                  className={cn("inline-flex items-center")}
                  leftIcon={<Split className="mr-0.5 h-3 w-3" />}
                  text={t("dns.ns.splitDns")}
                />
              </Tooltip>
            </div>
            <Text className="text-sm">{t("dns.ns.splitBody")}</Text>
          </div>
          <Switch
            label={t("dns.ns.splitDns")}
            onCheckedChange={(checked) => {
              form.setValue("split_name", checked ? "" : "global");
            }}
          />
        </div>
        {split ? (
          <>
            <Text className="mt-8 font-semibold">{t("dns.ns.domainLabel")}</Text>
            <Input
              {...form.field("split_name")}
              required
              label={t("dns.ns.domainLabel")}
              placeholder={t("dns.ns.domainPlaceholder")}
            />
            <Text className="text-sm">{t("dns.ns.domainBody")}</Text>
          </>
        ) : (
          <input name="split_name" type="hidden" value="global" />
        )}
      </DialogPanel>
    </Dialog>
  );
}
