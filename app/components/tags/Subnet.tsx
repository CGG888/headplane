import { Info } from "lucide-react";

import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import Chip from "../chip";
import Tooltip from "../tooltip";

export interface SubnetTagProps {
  isEnabled?: boolean;
}

export function SubnetTag({ isEnabled }: SubnetTagProps) {
  const { t } = useI18n();

  return (
    <Tooltip
      content={
        isEnabled ? (
          <>{t("machines.chip.subnetEnabled")}</>
        ) : (
          <>{t("machines.chip.subnetPending")}</>
        )
      }
    >
      <Chip
        text={t("machines.chip.subnets")}
        className={cn("bg-blue-300 text-blue-900 dark:bg-blue-900 dark:text-blue-300")}
        rightIcon={isEnabled ? undefined : <Info className="h-full w-fit" />}
      />
    </Tooltip>
  );
}
