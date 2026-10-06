import { describe, expect, test } from "vitest";

import {
  ADDRESS_MASK,
  ADDRESS_VISIBILITY_STORAGE_KEY,
  ADDRESS_VISIBILITY_STORAGE_VERSION,
  addressVisibilityStorageKey,
  browserAddressStorage,
  canRevealAddresses,
  DEFAULT_ADDRESS_VISIBILITY,
  isAddressMasked,
  maskAddress,
  parseHiddenAddresses,
  readHiddenAddresses,
  toggleRevealedAddress,
  withAddressesHidden,
  withAllAddressesRevealed,
  writeHiddenAddresses,
  type AddressVisibilityStorage,
} from "~/utils/address-visibility";

/** A `localStorage` stand-in, so every rule is tested without a browser. */
class FakeStorage implements AddressVisibilityStorage {
  private values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value);
    }
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

const USER = "user-a";
const OTHER_USER = "user-b";

/** Storage that refuses every operation, as a locked-down browser does. */
const unavailableStorage: AddressVisibilityStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

describe("address visibility key", () => {
  test("is versioned and scoped to one user", () => {
    const key = addressVisibilityStorageKey(USER);
    expect(key).toBe(
      `${ADDRESS_VISIBILITY_STORAGE_KEY}.${ADDRESS_VISIBILITY_STORAGE_VERSION}.${USER}`,
    );
    expect(addressVisibilityStorageKey(OTHER_USER)).not.toBe(key);
    expect(addressVisibilityStorageKey("")).not.toBe(key);
  });

  test("escapes an identity that would otherwise change the key shape", () => {
    expect(addressVisibilityStorageKey("a.b/c")).not.toContain("a.b/c");
  });
});

describe("parseHiddenAddresses", () => {
  test("reads a stored choice", () => {
    expect(parseHiddenAddresses(JSON.stringify({ hidden: false }))).toBe(false);
    expect(parseHiddenAddresses(JSON.stringify({ hidden: true }))).toBe(true);
    expect(parseHiddenAddresses("false")).toBe(false);
  });

  test("hides by default when storage is absent or malformed", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "   ",
      "not json",
      "{}",
      "42",
      "[]",
      '{"hidden":"no"}',
      '{"hidden":0}',
    ]) {
      expect(parseHiddenAddresses(raw), String(raw)).toBe(true);
    }
  });
});

describe("readHiddenAddresses", () => {
  test("defaults to hidden without any stored choice", () => {
    expect(readHiddenAddresses(new FakeStorage(), USER)).toBe(true);
  });

  test("reads back the choice stored for the same user", () => {
    const storage = new FakeStorage({
      [addressVisibilityStorageKey(USER)]: JSON.stringify({ hidden: false }),
    });

    expect(readHiddenAddresses(storage, USER)).toBe(false);
  });

  test("does not share a choice between two accounts on one browser", () => {
    const storage = new FakeStorage({
      [addressVisibilityStorageKey(USER)]: JSON.stringify({ hidden: false }),
    });

    expect(readHiddenAddresses(storage, OTHER_USER)).toBe(true);
  });

  test("falls back to hidden when storage is unavailable", () => {
    expect(readHiddenAddresses(null, USER)).toBe(true);
    expect(readHiddenAddresses(undefined, USER)).toBe(true);
    expect(readHiddenAddresses(unavailableStorage, USER)).toBe(true);
  });

  test("ignores a payload written by another build", () => {
    const storage = new FakeStorage({
      [`${ADDRESS_VISIBILITY_STORAGE_KEY}.v0.${USER}`]: JSON.stringify({ hidden: false }),
      [addressVisibilityStorageKey(USER)]: "{",
    });

    expect(readHiddenAddresses(storage, USER)).toBe(true);
  });
});

describe("toggling the preference", () => {
  test("writes, reads back and overrides the stored choice", () => {
    const storage = new FakeStorage();

    writeHiddenAddresses(storage, USER, false);
    expect(readHiddenAddresses(storage, USER)).toBe(false);

    writeHiddenAddresses(storage, USER, true);
    expect(readHiddenAddresses(storage, USER)).toBe(true);
    expect(storage.keys()).toEqual([addressVisibilityStorageKey(USER)]);
  });

  test("never throws when storage refuses to write", () => {
    expect(() => writeHiddenAddresses(unavailableStorage, USER, false)).not.toThrow();
    expect(() => writeHiddenAddresses(null, USER, false)).not.toThrow();
  });

  test("there is no storage on the server", () => {
    expect(browserAddressStorage()).toBeNull();
  });
});

describe("maskAddress", () => {
  test("hides behind one fixed mask that does not follow the value's length", () => {
    expect(maskAddress("100.64.0.1", true)).toBe(ADDRESS_MASK);
    expect(maskAddress("fd7a:115c:a1e0::1", true)).toBe(ADDRESS_MASK);
    expect(maskAddress("node.tailnet.ts.net", true)).toBe(ADDRESS_MASK);
    expect(maskAddress("100.64.0.1", true).length).toBe(maskAddress("a", true).length);
  });

  test("shows the value untouched when nothing is hidden", () => {
    expect(maskAddress("100.64.0.1", false)).toBe("100.64.0.1");
  });
});

describe("reveal all and per-value reveal", () => {
  const shown: ReturnType<typeof withAddressesHidden> = withAddressesHidden(
    DEFAULT_ADDRESS_VISIBILITY,
    false,
  );

  test("hides every value by default", () => {
    expect(DEFAULT_ADDRESS_VISIBILITY.hidden).toBe(true);
    expect(isAddressMasked(DEFAULT_ADDRESS_VISIBILITY, "100.64.0.1")).toBe(true);
    expect(canRevealAddresses(DEFAULT_ADDRESS_VISIBILITY)).toBe(true);
  });

  test("reveals everything at once and re-hides it", () => {
    const all = withAllAddressesRevealed(DEFAULT_ADDRESS_VISIBILITY, true);
    expect(isAddressMasked(all, "100.64.0.1")).toBe(false);
    expect(isAddressMasked(all, "node.tailnet.ts.net")).toBe(false);
    expect(canRevealAddresses(all)).toBe(false);

    const rehidden = withAllAddressesRevealed(all, false);
    expect(isAddressMasked(rehidden, "100.64.0.1")).toBe(true);
  });

  test("shows everything when the preference is turned off", () => {
    expect(isAddressMasked(shown, "100.64.0.1")).toBe(false);
    expect(canRevealAddresses(shown)).toBe(false);
  });

  test("reveals one value without touching another", () => {
    const one = toggleRevealedAddress(DEFAULT_ADDRESS_VISIBILITY, "100.64.0.1");
    expect(isAddressMasked(one, "100.64.0.1")).toBe(false);
    expect(isAddressMasked(one, "100.64.0.2")).toBe(true);

    const again = toggleRevealedAddress(one, "100.64.0.1");
    expect(isAddressMasked(again, "100.64.0.1")).toBe(true);
  });

  test("drops the transient reveals when the preference changes either way", () => {
    const one = toggleRevealedAddress(DEFAULT_ADDRESS_VISIBILITY, "100.64.0.1");
    const all = withAllAddressesRevealed(one, true);
    expect(all.revealed).toEqual([]);

    const off = withAddressesHidden(one, false);
    expect(off.revealed).toEqual([]);
    expect(off.revealAll).toBe(false);

    const on = withAddressesHidden(all, true);
    expect(on.hidden).toBe(true);
    expect(on.revealAll).toBe(false);
    expect(isAddressMasked(on, "100.64.0.1")).toBe(true);
  });
});
