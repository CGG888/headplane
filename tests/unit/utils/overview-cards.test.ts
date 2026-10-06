import { describe, expect, test } from "vitest";

import {
  alertingOverviewCards,
  browserOverviewCardStorage,
  clearHiddenOverviewCards,
  effectiveHiddenOverviewCards,
  isAlertOverviewCard,
  isOverviewCardId,
  OVERVIEW_ALERT_CARD_IDS,
  OVERVIEW_CARDS_STORAGE_KEY,
  OVERVIEW_CARDS_STORAGE_VERSION,
  OVERVIEW_CARD_IDS,
  overviewCardsStorageKey,
  parseHiddenOverviewCards,
  readHiddenOverviewCards,
  withOverviewCardHidden,
  writeHiddenOverviewCards,
  type OverviewCardId,
  type OverviewCardStorage,
} from "~/utils/overview-cards";

/** A `localStorage` stand-in, so every rule is tested without a browser. */
class FakeStorage implements OverviewCardStorage {
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
const unavailableStorage: OverviewCardStorage = {
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

describe("overview card visibility key", () => {
  test("is versioned and scoped to one user", () => {
    const key = overviewCardsStorageKey(USER);
    expect(key).toBe(`${OVERVIEW_CARDS_STORAGE_KEY}.${OVERVIEW_CARDS_STORAGE_VERSION}.${USER}`);
    expect(overviewCardsStorageKey(OTHER_USER)).not.toBe(key);
    expect(overviewCardsStorageKey("")).not.toBe(key);
  });

  test("escapes an identity that would otherwise change the key shape", () => {
    expect(overviewCardsStorageKey("a.b/c")).not.toContain("a.b/c");
  });
});

describe("parseHiddenOverviewCards", () => {
  test("reads a valid payload, dropping unknown ids and duplicates", () => {
    expect(parseHiddenOverviewCards(JSON.stringify(["derp-nodes", "derp-nodes", "nope"]))).toEqual([
      "derp-nodes",
    ]);
    expect(parseHiddenOverviewCards(JSON.stringify(["health-summary", "derp-nodes"]))).toEqual([
      "health-summary",
      "derp-nodes",
    ]);
  });

  test("treats an absent or malformed payload as everything visible", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "   ",
      "not json",
      "{}",
      "42",
      "[1, 2]",
      '[{"id":1}]',
    ]) {
      expect(parseHiddenOverviewCards(raw), String(raw)).toEqual([]);
    }
  });
});

describe("readHiddenOverviewCards", () => {
  test("defaults to everything visible without any stored choice", () => {
    expect(readHiddenOverviewCards(new FakeStorage(), USER)).toEqual([]);
  });

  test("reads back the choice stored for the same user", () => {
    const storage = new FakeStorage({
      [overviewCardsStorageKey(USER)]: JSON.stringify(["counts-history"]),
    });

    expect(readHiddenOverviewCards(storage, USER)).toEqual(["counts-history"]);
  });

  test("does not share a choice between two accounts on one browser", () => {
    const storage = new FakeStorage({
      [overviewCardsStorageKey(USER)]: JSON.stringify(["counts-history"]),
    });

    expect(readHiddenOverviewCards(storage, OTHER_USER)).toEqual([]);
  });

  test("falls back to everything visible when storage is unavailable", () => {
    expect(readHiddenOverviewCards(null, USER)).toEqual([]);
    expect(readHiddenOverviewCards(undefined, USER)).toEqual([]);
    expect(readHiddenOverviewCards(unavailableStorage, USER)).toEqual([]);
  });

  test("ignores a payload written by another build", () => {
    const storage = new FakeStorage({
      [`${OVERVIEW_CARDS_STORAGE_KEY}.v0.${USER}`]: JSON.stringify(["counts-history"]),
      [overviewCardsStorageKey(USER)]: JSON.stringify(["derp-nodes", "future-card"]),
    });

    expect(readHiddenOverviewCards(storage, USER)).toEqual(["derp-nodes"]);
  });

  test("keeps an alerting card visible even when it is stored as hidden", () => {
    const storage = new FakeStorage({
      [overviewCardsStorageKey(USER)]: JSON.stringify(["service-server", "counts-history"]),
    });

    expect(readHiddenOverviewCards(storage, USER, ["service-server"])).toEqual(["counts-history"]);
  });

  test("lets the health summary stay hidden while it reports a problem", () => {
    // The summary is not an alert in its own right: a failing check still
    // reaches the operator through the notification webhooks, so the operator's
    // own choice wins here.
    const storage = new FakeStorage({
      [overviewCardsStorageKey(USER)]: JSON.stringify(["health-summary"]),
    });

    expect(readHiddenOverviewCards(storage, USER, ["health-summary"])).toEqual(["health-summary"]);
  });
});

describe("effectiveHiddenOverviewCards", () => {
  test("drops every card that reports a warning, an alert or a failure", () => {
    expect(
      effectiveHiddenOverviewCards(
        ["service-server", "derp-nodes", "counts-tailnet"],
        ["service-server", "counts-tailnet"],
      ),
    ).toEqual(["derp-nodes"]);
  });

  test("never protects the health summary, however unhealthy it is", () => {
    expect(effectiveHiddenOverviewCards(["health-summary"], ["health-summary"])).toEqual([
      "health-summary",
    ]);
    expect(isAlertOverviewCard("health-summary")).toBe(false);
    expect(isAlertOverviewCard("service-server")).toBe(true);
    expect(isAlertOverviewCard("counts-history")).toBe(false);
    expect(new Set(OVERVIEW_ALERT_CARD_IDS).size).toBe(OVERVIEW_ALERT_CARD_IDS.length);
  });

  test("changes nothing when no card is alerting", () => {
    expect(effectiveHiddenOverviewCards(["derp-nodes"], [])).toEqual(["derp-nodes"]);
  });
});

describe("hide, show and restore defaults", () => {
  test("hides and shows one card, keeping the page's card order", () => {
    const hidden = withOverviewCardHidden([], "derp-nodes", true);
    expect(hidden).toEqual(["derp-nodes"]);

    const both = withOverviewCardHidden(hidden, "versions-agent", true);
    expect(both).toEqual(["versions-agent", "derp-nodes"]);

    expect(withOverviewCardHidden(both, "derp-nodes", false)).toEqual(["versions-agent"]);
  });

  test("writes, reads back and clears the stored choice", () => {
    const storage = new FakeStorage();

    writeHiddenOverviewCards(storage, USER, ["derp-nodes", "derp-nodes"]);
    expect(readHiddenOverviewCards(storage, USER)).toEqual(["derp-nodes"]);

    clearHiddenOverviewCards(storage, USER);
    expect(storage.getItem(overviewCardsStorageKey(USER))).toBeNull();
    expect(readHiddenOverviewCards(storage, USER)).toEqual([]);
    expect(storage.keys()).toEqual([]);
  });

  test("never throws when storage refuses to write or clear", () => {
    expect(() => writeHiddenOverviewCards(unavailableStorage, USER, ["derp-nodes"])).not.toThrow();
    expect(() => clearHiddenOverviewCards(unavailableStorage, USER)).not.toThrow();
    expect(() => writeHiddenOverviewCards(null, USER, ["derp-nodes"])).not.toThrow();
  });
});

describe("alertingOverviewCards", () => {
  test("names exactly the cards flagged as reporting a problem, in page order", () => {
    expect(
      alertingOverviewCards({
        "health-summary": true,
        "counts-history": false,
        "derp-relay": true,
      }),
    ).toEqual(["derp-relay", "health-summary"]);
  });

  test("is empty when nothing is flagged", () => {
    expect(alertingOverviewCards({})).toEqual([]);
  });
});

describe("card ids and browser storage", () => {
  test("only known card ids are accepted", () => {
    expect(isOverviewCardId("derp-nodes")).toBe(true);
    expect(isOverviewCardId("derp-map")).toBe(false);
    expect(isOverviewCardId(7)).toBe(false);
    expect(new Set(OVERVIEW_CARD_IDS).size).toBe(OVERVIEW_CARD_IDS.length);
  });

  test("there is no storage on the server", () => {
    expect(browserOverviewCardStorage()).toBeNull();
  });

  test("the visible default is the whole card list", () => {
    const all = [...OVERVIEW_CARD_IDS] as OverviewCardId[];
    expect(effectiveHiddenOverviewCards([], all)).toEqual([]);
  });
});
