import { useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Select from "~/components/select";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { Machine, User } from "~/types";
import { getUserDisplayName } from "~/utils/user";

interface MoveProps {
  machine: Machine;
  users: User[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function Move({ machine, users, isOpen, setIsOpen }: MoveProps) {
  const { t } = useI18n();
  const [userId, setUserId] = useState<string | null>(machine.user?.id ?? null);

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel isDisabled={userId === machine.user?.id}>
        <Title>{t("machines.move.title", { name: machine.givenName })}</Title>
        <Text>{t("machines.move.body")}</Text>
        <input name="action_id" type="hidden" value="reassign" />
        <input name="node_id" type="hidden" value={machine.id} />
        <input name="user_id" type="hidden" value={userId?.toString()} />
        <Select
          defaultValue={machine.user?.id}
          required
          label={t("machines.common.ownerLabel")}
          name="user"
          onValueChange={(key) => {
            setUserId(key);
          }}
          placeholder={t("machines.common.selectUser")}
          items={users.map((user) => ({
            value: user.id,
            label: getUserDisplayName(user, t("machines.common.tagOwned")),
          }))}
        />
      </DialogPanel>
    </Dialog>
  );
}
