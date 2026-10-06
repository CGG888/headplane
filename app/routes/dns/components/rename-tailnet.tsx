import Button from "~/components/button";
import Code from "~/components/code";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";

import DnsSection from "./dns-section";

interface Props {
  name: string;
  isDisabled: boolean;
}

export default function RenameTailnet({ name, isDisabled }: Props) {
  const { t, tr } = useI18n();

  return (
    <DnsSection
      description={tr("dns.rename.body", {
        code: <Code>[device].{name}</Code>,
      })}
      title={t("dns.rename.title")}
    >
      <div className="flex flex-col gap-4">
        <Input
          className="w-full text-sm font-medium sm:max-w-md"
          readOnly
          label={t("dns.rename.label")}
          labelHidden
          onFocus={(event) => {
            (event.target as HTMLInputElement).select();
          }}
          value={name}
        />
        <Dialog>
          <Button disabled={isDisabled}>{t("dns.rename.button")}</Button>
          <DialogPanel isDisabled={isDisabled}>
            <Title>{t("dns.rename.button")}</Title>
            <Text className="mb-8">{t("dns.rename.dialogBody")}</Text>
            <input name="action_id" type="hidden" value="rename_tailnet" />
            <Input
              defaultValue={name}
              required
              label={t("dns.rename.label")}
              name="new_name"
              placeholder={t("dns.rename.placeholder")}
            />
          </DialogPanel>
        </Dialog>
      </div>
    </DnsSection>
  );
}
