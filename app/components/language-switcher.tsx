import { Check, Languages } from "lucide-react";
import { useLocation, useSubmit } from "react-router";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/menu";
import { useI18n } from "~/i18n/provider";
import { LOCALES, type Locale } from "~/utils/locale";

const LABELS = {
  en: "language.en",
  "zh-Hans": "language.zh-Hans",
  "zh-Hant": "language.zh-Hant",
} as const satisfies Record<Locale, string>;

/**
 * Submits the new locale to `/api/locale`, which persists it in a cookie and
 * redirects back to the current page so the loader re-runs with the new
 * language. Mirrors the color scheme switcher in the header.
 */
export function useLocaleSubmit() {
  const submit = useSubmit();
  const location = useLocation();
  const returnTo = location.pathname + location.search;

  return (locale: Locale) =>
    submit({ locale, returnTo }, { action: "/api/locale", method: "POST" });
}

/** Language entries rendered inside an existing dropdown menu. */
export function LanguageMenuItems() {
  const { t, locale } = useI18n();
  const changeLocale = useLocaleSubmit();

  return (
    <>
      {LOCALES.map((value) => (
        <MenuItem key={value} onClick={() => changeLocale(value)}>
          <div className="flex items-center gap-x-2">
            <span className="flex-1">{t(LABELS[value])}</span>
            {locale === value && <Check className="size-4" />}
          </div>
        </MenuItem>
      ))}
    </>
  );
}

/** Standalone switcher for pages that do not render the header (login). */
export function LanguageSwitcher({ className }: { readonly className?: string }) {
  const { t } = useI18n();

  return (
    <Menu>
      <MenuTrigger
        aria-label={t("language.label")}
        className={
          "size-9 rounded-full p-1.5 text-mist-600 hover:bg-mist-300/50 dark:text-mist-300 dark:hover:bg-mist-800 " +
          (className ?? "")
        }
      >
        <Languages className="size-5" />
      </MenuTrigger>
      <MenuContent align="end">
        <LanguageMenuItems />
      </MenuContent>
    </Menu>
  );
}
