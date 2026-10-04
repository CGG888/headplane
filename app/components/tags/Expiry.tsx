import { useI18n } from "~/i18n/provider";

import Chip from "../chip";
import Tooltip from "../tooltip";

export interface ExpiryTagProps {
  variant: "expired" | "no-expiry";
  expiry?: string;
}

export function ExpiryTag({ variant, expiry }: ExpiryTagProps) {
  const { t, locale } = useI18n();
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Tooltip
      content={
        variant === "expired" ? (
          <>{t("machines.chip.expiredTooltip")}</>
        ) : (
          <>{t("machines.chip.noExpiryTooltip")}</>
        )
      }
    >
      <Chip
        text={
          variant === "expired"
            ? t("machines.chip.expiredOn", { date: formatter.format(new Date(expiry!)) })
            : t("machines.chip.noExpiry")
        }
        className="bg-mist-200 text-mist-800 dark:bg-mist-800 dark:text-mist-200"
      />
    </Tooltip>
  );
}
