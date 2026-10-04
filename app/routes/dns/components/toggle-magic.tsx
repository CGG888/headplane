import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";

interface Props {
  isEnabled: boolean;
  isDisabled: boolean;
}

export default function Modal({ isEnabled, isDisabled }: Props) {
  const { t } = useI18n();
  const label = isEnabled ? t("dns.magicToggle.disable") : t("dns.magicToggle.enable");

  return (
    <Dialog>
      <Button disabled={isDisabled}>{label}</Button>
      <DialogPanel isDisabled={isDisabled}>
        <Title>{label}</Title>
        <Text>{t("dns.magicToggle.body")}</Text>
        <input type="hidden" name="action_id" value="toggle_magic" />
        <input type="hidden" name="new_state" value={isEnabled ? "disabled" : "enabled"} />
      </DialogPanel>
    </Dialog>
  );
}
