// MARK: Overview card visibility
//
// Which cards the Overview dashboard shows is a personal, browser-local choice:
// it is remembered in `localStorage`, never in Headplane's database, and it
// changes presentation only — the loader keeps reading exactly what it read
// before.
//
// The key is versioned and scoped to the person the browser is signed in as
// (the Headplane account subject the app layout loader reports), so two accounts
// on one browser never read each other's choice. Everything here is a plain
// function over an injected storage, so the rules stay unit-testable.

/** The versioned `localStorage` key namespace for hidden Overview cards. */
export const OVERVIEW_CARDS_STORAGE_KEY = "headplane.overview.hidden-cards";

/**
 * The storage shape version. Bump it when the value changes meaning; an older
 * payload then simply fails to parse and everything shows again.
 */
export const OVERVIEW_CARDS_STORAGE_VERSION = "v1";

/**
 * The storage key of one user's preference. `userKey` is the current user's
 * identity — the app layout reports it as `user.subject` — so an account switch
 * on the same browser reads a different key. A blank identity still gets a key
 * of its own instead of sharing the unversioned namespace.
 */
export function overviewCardsStorageKey(userKey: string): string {
  const identity = userKey.trim();
  return `${OVERVIEW_CARDS_STORAGE_KEY}.${OVERVIEW_CARDS_STORAGE_VERSION}.${
    identity.length > 0 ? encodeURIComponent(identity) : "anonymous"
  }`;
}

/**
 * Every card that may be hidden, in the order the dashboard lists them. The
 * management panel renders this list, so a hidden card stays reachable even
 * while its card is not on the page.
 */
export const OVERVIEW_CARD_IDS = [
  "versions-headplane",
  "versions-headscale",
  "versions-agent",
  "derp-region",
  "derp-relay",
  "derp-nodes",
  "service-server",
  "service-dns",
  "service-metrics",
  "counts-tailnet",
  "counts-headplane",
  "counts-history",
  "health-summary",
] as const;

export type OverviewCardId = (typeof OVERVIEW_CARD_IDS)[number];

const OVERVIEW_CARD_ID_SET: ReadonlySet<string> = new Set(OVERVIEW_CARD_IDS);

/** Whether a stored value names a card this build knows about. */
export function isOverviewCardId(value: unknown): value is OverviewCardId {
  return typeof value === "string" && OVERVIEW_CARD_ID_SET.has(value);
}

/**
 * The hidden cards a stored payload names. Anything malformed — absent, empty,
 * not JSON, not an array, an unknown id, a duplicate, a non-string entry — is
 * dropped rather than thrown, so a payload this build cannot read leaves every
 * card visible instead of breaking the page.
 */
export function parseHiddenOverviewCards(raw: string | null | undefined): OverviewCardId[] {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const hidden: OverviewCardId[] = [];
  for (const entry of parsed) {
    if (isOverviewCardId(entry) && !hidden.includes(entry)) {
      hidden.push(entry);
    }
  }

  return hidden;
}

/**
 * The hidden set as it may actually be applied.
 *
 * A card that carries a warning, an alert or a failure is never hidden: it is
 * dropped from the set here, in the one place every reader goes through, so a
 * stored payload — including one written before the card started reporting a
 * problem — can never make an operator miss it.
 */
export function effectiveHiddenOverviewCards(
  hidden: readonly OverviewCardId[],
  alerting: readonly OverviewCardId[] = [],
): OverviewCardId[] {
  const protectedIds = new Set(alerting);
  return hidden.filter((id) => !protectedIds.has(id));
}

/** The same set with one card hidden or shown, kept in the card list's order. */
export function withOverviewCardHidden(
  hidden: readonly OverviewCardId[],
  id: OverviewCardId,
  isHidden: boolean,
): OverviewCardId[] {
  const next = new Set(hidden);
  if (isHidden) {
    next.add(id);
  } else {
    next.delete(id);
  }

  return OVERVIEW_CARD_IDS.filter((card) => next.has(card));
}

/** The cards that report a problem right now, taken from plain page facts. */
export function alertingOverviewCards(
  flags: Partial<Record<OverviewCardId, boolean>>,
): OverviewCardId[] {
  return OVERVIEW_CARD_IDS.filter((id) => flags[id] === true);
}

/** The slice of the Web Storage API this preference needs (tests pass a fake). */
export interface OverviewCardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The hidden cards this user stored, or an empty set when storage is absent,
 * unreadable or malformed. Reading never throws: a browser that refuses
 * `localStorage` simply shows everything.
 */
export function readHiddenOverviewCards(
  storage: OverviewCardStorage | null | undefined,
  userKey: string,
  alerting: readonly OverviewCardId[] = [],
): OverviewCardId[] {
  if (storage === null || storage === undefined) {
    return [];
  }

  let raw: string | null;
  try {
    raw = storage.getItem(overviewCardsStorageKey(userKey));
  } catch {
    // Storage can be blocked entirely (private mode, iframe policy).
    return [];
  }

  return effectiveHiddenOverviewCards(parseHiddenOverviewCards(raw), alerting);
}

/**
 * Remembers the hidden cards for this user. A storage that refuses the write
 * (quota, private mode) is ignored: the choice still governs this session.
 */
export function writeHiddenOverviewCards(
  storage: OverviewCardStorage | null | undefined,
  userKey: string,
  hidden: readonly OverviewCardId[],
): void {
  if (storage === null || storage === undefined) {
    return;
  }

  const canonical = OVERVIEW_CARD_IDS.filter((id) => hidden.includes(id));
  try {
    storage.setItem(overviewCardsStorageKey(userKey), JSON.stringify(canonical));
  } catch {
    // Ignored: losing the record only costs the preference across reloads.
  }
}

/** Forgets this user's preference, which is what "restore defaults" means. */
export function clearHiddenOverviewCards(
  storage: OverviewCardStorage | null | undefined,
  userKey: string,
): void {
  if (storage === null || storage === undefined) {
    return;
  }

  try {
    storage.removeItem(overviewCardsStorageKey(userKey));
  } catch {
    // Nothing to do; the next read simply starts from the defaults again.
  }
}

/**
 * `localStorage` in a browser, or `null` on the server and when the browser
 * refuses access. Both are answered with "everything visible" by the readers
 * above, so a caller never has to guard this itself.
 */
export function browserOverviewCardStorage(): OverviewCardStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
