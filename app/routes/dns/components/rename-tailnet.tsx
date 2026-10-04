import Button from "~/components/button";
import Code from "~/components/code";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";

interface Props {
  name: string;
  isDisabled: boolean;
}

export default function RenameTailnet({ name, isDisabled }: Props) {
  const { t, tr } = useI18n();

  return (
    <div className="flex w-full flex-col gap-y-4 sm:w-2/3">
      <h1 className="mb-2 text-2xl font-medium">{t("dns.rename.title")}</h1>
      <p>
        {tr("dns.rename.body", {
          code: <Code>[device].{name}</Code>,
        })}
      </p>
      <Input
        className="w-3/5 text-sm font-medium"
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
  );
}
