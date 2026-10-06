// MARK: Address visibility
//
// Whether IP addresses and hostnames are masked is a personal, browser-local
// choice: it is remembered in `localStorage`, never in Headplane's database,
// and it changes presentation only — no loader reads it, and nothing about
// fetching, permissions or data depends on it.
//
// The key is versioned and scoped to the person the browser is signed in as
// (the Headplane account subject the app layout loader reports), so two accounts
// on one browser never read each other's choice. Anything malformed, absent or
// unreadable falls back to the *masked* default, so a payload this build cannot
// read can only ever hide more, never leak more. Everything here is a plain
// function over an injected storage and a plain state value, so the rules stay
// unit-testable.

/** The versioned `localStorage` key namespace for the masking preference. */
export const ADDRESS_VISIBILITY_STORAGE_KEY = "headplane.addresses.hidden";

/**
 * The storage shape version. Bump it when the value changes meaning; an older
 * payload then simply fails to parse and the masked default applies again.
 */
export const ADDRESS_VISIBILITY_STORAGE_VERSION = "v1";

/**
 * The fixed mask every hidden value renders as. It is deliberately one constant
 * for every value: a mask whose length followed the value would leak how long
 * the address or hostname is.
 */
export const ADDRESS_MASK = "••••••••";

/**
 * The storage key of one user's preference. `userKey` is the current user's
 * identity — the app layout reports it as `user.subject` — so an account switch
 * on the same browser reads a different key. A blank identity still gets a key
 * of its own instead of sharing the unversioned namespace.
 */
export function addressVisibilityStorageKey(userKey: string): string {
  const identity = userKey.trim();
  return `${ADDRESS_VISIBILITY_STORAGE_KEY}.${ADDRESS_VISIBILITY_STORAGE_VERSION}.${
    identity.length > 0 ? encodeURIComponent(identity) : "anonymous"
  }`;
}

/**
 * The hidden-by-default preference a stored payload carries. Anything absent or
 * malformed — `null`, empty, not JSON, an object without a boolean `hidden` —
 * answers `true`, because "hidden" is the safe answer when nothing can be read.
 */
export function parseHiddenAddresses(raw: string | null | undefined): boolean {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }

  if (typeof parsed === "boolean") {
    return parsed;
  }

  if (typeof parsed === "object" && parsed !== null) {
    const hidden = (parsed as { hidden?: unknown }).hidden;
    if (typeof hidden === "boolean") {
      return hidden;
    }
  }

  return true;
}

/** The slice of the Web Storage API this preference needs (tests pass a fake). */
export interface AddressVisibilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Whether this user asked for addresses to stay hidden. Reading never throws: a
 * browser that refuses `localStorage`, or one holding a payload this build
 * cannot read, keeps addresses hidden.
 */
export function readHiddenAddresses(
  storage: AddressVisibilityStorage | null | undefined,
  userKey: string,
): boolean {
  if (storage === null || storage === undefined) {
    return true;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(addressVisibilityStorageKey(userKey));
  } catch {
    // Storage can be blocked entirely (private mode, iframe policy).
    return true;
  }

  return parseHiddenAddresses(raw);
}

/**
 * Remembers whether this user wants addresses hidden. A storage that refuses
 * the write (quota, private mode) is ignored: the choice still governs this
 * session.
 */
export function writeHiddenAddresses(
  storage: AddressVisibilityStorage | null | undefined,
  userKey: string,
  hidden: boolean,
): void {
  if (storage === null || storage === undefined) {
    return;
  }

  try {
    storage.setItem(addressVisibilityStorageKey(userKey), JSON.stringify({ hidden }));
  } catch {
    // Ignored: losing the record only costs the preference across reloads.
  }
}

/**
 * `localStorage` in a browser, or `null` on the server and when the browser
 * refuses access. Both are answered with "hidden" by the reader above, so a
 * caller never has to guard this itself.
 */
export function browserAddressStorage(): AddressVisibilityStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The whole masking state of one page session.
 *
 * `hidden` is the remembered preference (masked by default), `revealAll` is the
 * momentary "show everything" a reader asked for without changing that
 * preference, and `revealed` names the individual values revealed one badge at
 * a time. Only `hidden` is ever written to storage.
 */
export interface AddressVisibilityState {
  hidden: boolean;
  revealAll: boolean;
  revealed: readonly string[];
}

/** What the server and the first client render agree on: every value masked. */
export const DEFAULT_ADDRESS_VISIBILITY: AddressVisibilityState = {
  hidden: true,
  revealAll: false,
  revealed: [],
};

/**
 * The text one value renders as. Hiding always answers the same fixed mask, so
 * the rendered width says nothing about what is behind it.
 */
export function maskAddress(value: string, hidden: boolean): string {
  return hidden ? ADDRESS_MASK : value;
}

/** Whether this value is hidden right now. */
export function isAddressMasked(state: AddressVisibilityState, value: string): boolean {
  return state.hidden && !state.revealAll && !state.revealed.includes(value);
}

/**
 * Whether a reveal badge makes sense at all: with the preference off, or with
 * "show all" on, there is nothing behind a badge to reveal.
 */
export function canRevealAddresses(state: AddressVisibilityState): boolean {
  return state.hidden && !state.revealAll;
}

/**
 * The preference turned on or off. Either way the transient reveals are dropped,
 * so turning masking back on re-hides every value the reader had revealed.
 */
export function withAddressesHidden(
  state: AddressVisibilityState,
  hidden: boolean,
): AddressVisibilityState {
  return { hidden, revealAll: false, revealed: [] };
}

/** "Show all" / "Hide all": everything revealed at once, and undone the same way. */
export function withAllAddressesRevealed(
  state: AddressVisibilityState,
  revealAll: boolean,
): AddressVisibilityState {
  return { ...state, revealAll, revealed: [] };
}

/** Reveals or re-hides one value, without touching the others. */
export function toggleRevealedAddress(
  state: AddressVisibilityState,
  value: string,
): AddressVisibilityState {
  const revealed = state.revealed.includes(value)
    ? state.revealed.filter((entry) => entry !== value)
    : [...state.revealed, value];

  return { ...state, revealed };
}
