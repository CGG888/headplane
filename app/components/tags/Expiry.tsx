import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import Chip from "../chip";
import Tooltip from "../tooltip";

export interface ExpiryTagProps {
  variant: "expired" | "expiring" | "no-expiry";
  expiry?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left on the key, never below one morning. */
function daysUntil(expiry: string) {
  return Math.max(1, Math.ceil((new Date(expiry).getTime() - Date.now()) / DAY_MS));
}

/**
 * The key-expiry chip. Expired and expiring keys use the status palette so they
 * stand out, while "no expiry" is deliberately quiet: on most tailnets it is
 * the normal state and should read as a note, not an alert.
 */
export function ExpiryTag({ variant, expiry }: ExpiryTagProps) {
  const { t, locale } = useI18n();
  // Pinned to UTC: the server renders this in its own zone while the browser
  // formats in the visitor's, so an unpinned formatter produced a different
  // calendar day on each side and hydration never matched.
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Tooltip
      content={
        variant === "expired" ? (
          <>{t("machines.chip.expiredTooltip")}</>
        ) : variant === "expiring" ? (
          <>{t("machines.chip.expiringSoonTooltip")}</>
        ) : (
          <>{t("machines.chip.noExpiryTooltip")}</>
        )
      }
    >
      <Chip
        text={
          variant === "expired"
            ? t("machines.chip.expiredOn", { date: formatter.format(new Date(expiry!)) })
            : variant === "expiring"
              ? t("machines.chip.expiringSoon", { count: daysUntil(expiry!) })
              : t("machines.chip.noExpiry")
        }
        className={cn(
          variant === "expired" && "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
          variant === "expiring" &&
            "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
          variant === "no-expiry" &&
            cn(
              "border border-mist-200 bg-transparent text-mist-500",
              "dark:border-mist-700 dark:bg-transparent dark:text-mist-400",
            ),
        )}
      />
    </Tooltip>
  );
}
