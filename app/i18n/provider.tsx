import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "~/utils/locale";

import { translate, translateRich, type RichVars, type TranslationKey, type Vars } from "./index";

export interface I18nValue {
  locale: Locale;
  t: (key: TranslationKey, vars?: Vars) => string;
  tr: (key: TranslationKey, vars: RichVars) => ReactNode;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

function createValue(locale: Locale): I18nValue {
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    tr: (key, vars) => translateRich(locale, key, vars),
  };
}

// Used when a component renders outside of the provider (for example a root
// error boundary that lost its loader data). Falling back to English keeps the
// UI readable instead of throwing.
const fallback = createValue(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  const value = useMemo(() => createValue(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? fallback;
}

/** Convenience hook for components that only need the translate function. */
export function useT() {
  return useI18n().t;
}
