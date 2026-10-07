import { createElement, Fragment, type ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "~/utils/locale";

import type { Catalog, TranslationKey } from "./catalog";
import en from "./locales/en";
import zhHans from "./locales/zh-Hans";
import zhHant from "./locales/zh-Hant";

export type { Catalog, TranslationKey } from "./catalog";

export type Vars = Record<string, string | number>;
export type RichVars = Record<string, ReactNode>;

const catalogs: Record<Locale, Catalog> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

const PLACEHOLDER = /\{(\w+)\}/g;

function lookup(catalog: Catalog | undefined, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc != null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[part];
    }

    return undefined;
  }, catalog);
}

/**
 * A catalog entry is only usable as a plural when *both* forms are strings.
 * Checking just `one` used to be enough for the catalogs we ship, but a
 * half-filled entry would then render `undefined` in the UI instead of falling
 * back to the key.
 */
export function isPlural(value: unknown): value is { one: string; other: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "one" in value &&
    "other" in value &&
    typeof (value as { one: unknown }).one === "string" &&
    typeof (value as { other: unknown }).other === "string"
  );
}

function template(locale: Locale, key: string, vars?: Record<string, unknown>) {
  // Falls back to English so a missing translation degrades to readable text
  // instead of an empty string or a raw key in the UI.
  const value = lookup(catalogs[locale], key) ?? lookup(catalogs[DEFAULT_LOCALE], key);

  if (typeof value === "string") {
    return value;
  }

  if (isPlural(value)) {
    const count = typeof vars?.count === "number" ? vars.count : 1;
    return count === 1 ? value.one : value.other;
  }

  return undefined;
}

/**
 * Translates a key into a plain string. Unknown keys return the key itself so
 * a missing translation is obvious during development without crashing.
 */
export function translate(locale: Locale, key: TranslationKey, vars?: Vars): string {
  const found = template(locale, key, vars);
  if (found === undefined) {
    return key;
  }

  if (!vars) {
    return found;
  }

  return found.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Translates a key that embeds JSX (inline code, links, bold values) and
 * returns the interpolated node list so word order can differ per language.
 */
export function translateRich(locale: Locale, key: TranslationKey, vars: RichVars): ReactNode {
  const found = template(locale, key, vars);
  if (found === undefined) {
    return key;
  }

  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of found.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(found.slice(last, index));
    }

    const name = match[1];
    // Wrapped in a keyed fragment so React never warns about list children.
    nodes.push(createElement(Fragment, { key: name }, vars[name] ?? match[0]));
    last = index + match[0].length;
  }

  if (last < found.length) {
    nodes.push(found.slice(last));
  }

  return nodes;
}
