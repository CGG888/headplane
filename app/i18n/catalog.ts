import type en from "./locales/en";

/** A key whose English text depends on a count (used only where a language needs it). */
export interface Plural {
  one: string;
  other: string;
}

type Leaf = string | Plural;

/**
 * Widens the literal types of the English catalog so translations only need to
 * match the *shape* of the catalog, not its exact strings.
 */
type DeepWiden<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? Plural : DeepWiden<T[K]>;
};

export type Catalog = DeepWiden<typeof en>;

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Dot-separated key of every translatable string, e.g. `header.tabs.machines`. */
export type TranslationKey = Paths<Catalog>;
