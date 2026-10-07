import { describe, expect, test } from "vitest";

import {
  detectAlertEvents,
  emptyAlertState,
  pruneSentAlerts,
  sameAlertState,
} from "~/server/alerts/events";
import { DEFAULT_ALERT_SETTINGS } from "~/server/alerts/settings";
import type { AlertSettings, AlertSnapshot } from "~/server/alerts/types";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function settings(overrides: Partial<AlertSettings> = {}): AlertSettings {
  return {
    ...DEFAULT_ALERT_SETTINGS,
    enabled: true,
    webhookUrl: "https://example.com/hook",
    ...overrides,
  };
}

function snapshot(overrides: Partial<AlertSnapshot> = {}): AlertSnapshot {
  return {
    reachable: true,
    nodesAvailable: true,
    nodes: [],
    apiKeysAvailable: true,
    apiKeys: [],
    configChecks: { available: true, failing: [] },
    ...overrides,
  };
}

function ids(events: { id: string }[]): string[] {
  return events.map((event) => event.id);
}

function at(seconds: number): Date {
  return new Date(NOW.getTime() + seconds * 1000);
}

describe("headscale reachability", () => {
  test("fires once when Headscale drops and once when it comes back", () => {
    const down = detectAlertEvents(
      emptyAlertState(),
      snapshot({ reachable: false }),
      settings(),
      NOW,
    );
    expect(ids(down.events)).toEqual(["headscaleUnreachable"]);
    expect(down.events[0].severity).toBe("critical");

    const stillDown = detectAlertEvents(
      down.state,
      snapshot({ reachable: false }),
      settings(),
      at(60),
    );
    expect(stillDown.events).toEqual([]);

    const back = detectAlertEvents(stillDown.state, snapshot(), settings(), at(120));
    expect(ids(back.events)).toEqual(["headscaleRecovered"]);
    expect(back.events[0].severity).toBe("info");
  });

  test("a second unreachable tick does not repeat the alert", () => {
    const first = detectAlertEvents(
      emptyAlertState(),
      snapshot({ reachable: false }),
      settings(),
      NOW,
    );
    const second = detectAlertEvents(
      first.state,
      snapshot({ reachable: false }),
      settings(),
      at(600),
    );
    expect(second.events).toEqual([]);
    expect(second.state.reachable).toBe(false);
  });
});

describe("node availability", () => {
  test("reports a node going offline once and coming back once", () => {
    const offline = snapshot({ nodes: [{ id: "n1", name: "alpha", online: false }] });

    const first = detectAlertEvents(emptyAlertState(), offline, settings(), NOW);
    expect(ids(first.events)).toEqual(["nodeOffline"]);
    expect(first.events[0].target).toBe("alpha");
    expect(first.state.offlineNodes).toEqual(["n1"]);

    const repeat = detectAlertEvents(first.state, offline, settings(), at(60));
    expect(repeat.events).toEqual([]);

    const online = snapshot({ nodes: [{ id: "n1", name: "alpha", online: true }] });
    const recovered = detectAlertEvents(
      repeat.state,
      online,
      settings({ cooldownSeconds: 30 }),
      at(120),
    );
    expect(ids(recovered.events)).toEqual(["nodeOnline"]);
    expect(recovered.state.offlineNodes).toEqual([]);
  });

  test("an unavailable node list preserves the previous state", () => {
    const offline = snapshot({ nodes: [{ id: "n1", name: "alpha", online: false }] });
    const first = detectAlertEvents(emptyAlertState(), offline, settings(), NOW);

    const unavailable = snapshot({ nodesAvailable: false, nodes: [] });
    const next = detectAlertEvents(first.state, unavailable, settings(), at(60));

    expect(next.events).toEqual([]);
    expect(next.state.offlineNodes).toEqual(["n1"]);
  });

  test("a removed node is reported as back online by id", () => {
    const offline = snapshot({ nodes: [{ id: "n1", name: "alpha", online: false }] });
    const first = detectAlertEvents(emptyAlertState(), offline, settings(), NOW);

    const gone = snapshot({ nodes: [] });
    const next = detectAlertEvents(first.state, gone, settings({ cooldownSeconds: 30 }), at(120));

    expect(ids(next.events)).toEqual(["nodeOnline"]);
    expect(next.events[0].target).toBe("n1");
  });
});

describe("api key expiry", () => {
  const key = (id: string, expiresInDays: number) => ({
    id,
    prefix: `hskey-${id}`,
    expiration: new Date(NOW.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
  });

  test("reports a key inside the window with the threshold in the payload", () => {
    const first = detectAlertEvents(
      emptyAlertState(),
      snapshot({ apiKeys: [key("k1", 3)] }),
      settings({ apiKeyExpiryDays: 7 }),
      NOW,
    );

    expect(ids(first.events)).toEqual(["apiKeyExpiring"]);
    expect(first.events[0].target).toBe("hskey-k1");
    expect(first.events[0].threshold).toBe(7);

    const repeat = detectAlertEvents(
      first.state,
      snapshot({ apiKeys: [key("k1", 3)] }),
      settings({ apiKeyExpiryDays: 7 }),
      at(60),
    );
    expect(repeat.events).toEqual([]);
  });

  test("ignores keys outside the window, expired keys and unparseable dates", () => {
    const result = detectAlertEvents(
      emptyAlertState(),
      snapshot({
        apiKeys: [
          key("k1", 30),
          { id: "k2", prefix: "hskey-k2", expiration: "not-a-date" },
          {
            id: "k3",
            prefix: "hskey-k3",
            expiration: new Date(NOW.getTime() - 1000).toISOString(),
          },
        ],
      }),
      settings({ apiKeyExpiryDays: 7 }),
      NOW,
    );

    expect(result.events).toEqual([]);
    expect(result.state.expiringKeys).toEqual([]);
  });

  test("an unavailable key list preserves the previous state", () => {
    const first = detectAlertEvents(
      emptyAlertState(),
      snapshot({ apiKeys: [key("k1", 1)] }),
      settings(),
      NOW,
    );

    const next = detectAlertEvents(
      first.state,
      snapshot({ apiKeysAvailable: false, apiKeys: [] }),
      settings(),
      at(60),
    );

    expect(next.events).toEqual([]);
    expect(next.state.expiringKeys).toEqual(["k1"]);
  });
});

describe("configuration checks", () => {
  test("reports a newly failing check once", () => {
    const failing = snapshot({ configChecks: { available: true, failing: ["configTls"] } });

    const first = detectAlertEvents(emptyAlertState(), failing, settings(), NOW);
    expect(ids(first.events)).toEqual(["configCheckFailed"]);
    expect(first.events[0].target).toBe("configTls");

    const repeat = detectAlertEvents(first.state, failing, settings(), at(60));
    expect(repeat.events).toEqual([]);
  });

  test("checks that cannot run never produce an alert and keep the state", () => {
    const failing = snapshot({ configChecks: { available: true, failing: ["configOidc"] } });
    const first = detectAlertEvents(emptyAlertState(), failing, settings(), NOW);

    const unreadable = snapshot({ configChecks: { available: false, failing: [] } });
    const next = detectAlertEvents(first.state, unreadable, settings(), at(60));

    expect(next.events).toEqual([]);
    expect(next.state.failingChecks).toEqual(["configOidc"]);
  });
});

describe("settings gates", () => {
  test("stays silent while disabled but still tracks state", () => {
    const disabled = settings({ enabled: false });
    const down = detectAlertEvents(
      emptyAlertState(),
      snapshot({ reachable: false, nodes: [{ id: "n1", name: "alpha", online: false }] }),
      disabled,
      NOW,
    );

    expect(down.events).toEqual([]);
    expect(down.state.reachable).toBe(false);
    expect(down.state.offlineNodes).toEqual(["n1"]);
  });

  test("never emits an event that is not selected", () => {
    const result = detectAlertEvents(
      emptyAlertState(),
      snapshot({ reachable: false }),
      settings({ events: ["nodeOffline"] }),
      NOW,
    );

    expect(result.events).toEqual([]);
  });

  test("the cooldown suppresses a condition that flaps inside the window", () => {
    const rules = settings({ cooldownSeconds: 300 });
    const offline = snapshot({ nodes: [{ id: "n1", name: "alpha", online: false }] });
    const online = snapshot({ nodes: [{ id: "n1", name: "alpha", online: true }] });

    const first = detectAlertEvents(emptyAlertState(), offline, rules, NOW);
    expect(ids(first.events)).toEqual(["nodeOffline"]);

    const back = detectAlertEvents(first.state, online, rules, at(10));
    expect(ids(back.events)).toEqual(["nodeOnline"]);

    const flapped = detectAlertEvents(back.state, offline, rules, at(20));
    expect(flapped.events).toEqual([]);

    const later = detectAlertEvents(flapped.state, online, rules, at(310));
    const afterCooldown = detectAlertEvents(later.state, offline, rules, at(320));
    expect(ids(afterCooldown.events)).toEqual(["nodeOffline"]);
  });
});

describe("sameAlertState", () => {
  test("ignores ordering but notices every tracked change", () => {
    const base = emptyAlertState();
    expect(sameAlertState(base, { ...base, offlineNodes: ["b", "a"] })).toBe(false);
    expect(
      sameAlertState({ ...base, offlineNodes: ["a", "b"] }, { ...base, offlineNodes: ["b", "a"] }),
    ).toBe(true);
    expect(sameAlertState(base, { ...base, reachable: false })).toBe(false);
    expect(sameAlertState(base, { ...base, sent: { nodeOffline: NOW.toISOString() } })).toBe(false);
  });
});

describe("sent alert table", () => {
  test("forgets an entry that can no longer suppress anything", () => {
    // Without this the table holds one entry per condition ever seen — a node
    // that went offline once, a key that expired last year — and every writer
    // serializes the whole map into the store.
    const sent = {
      "nodeOffline:gone": new Date(NOW.getTime() - 7_200_000).toISOString(),
      "nodeOffline:alpha": NOW.toISOString(),
    };

    expect(pruneSentAlerts(sent, settings({ cooldownSeconds: 3600 }), NOW)).toEqual({
      "nodeOffline:alpha": NOW.toISOString(),
    });
    // The input map belongs to the caller and is left alone.
    expect(Object.keys(sent)).toHaveLength(2);
  });

  test("drops an entry whose timestamp cannot be read", () => {
    expect(
      pruneSentAlerts({ broken: "whenever" }, settings({ cooldownSeconds: 86_400 }), NOW),
    ).toEqual({});
  });

  test("the state a tick returns carries only live cooldown entries", () => {
    const state = {
      ...emptyAlertState(),
      sent: { stale: new Date(NOW.getTime() - 86_400_000).toISOString() },
    };

    const result = detectAlertEvents(state, snapshot(), settings({ cooldownSeconds: 3600 }), NOW);

    expect(result.state.sent).toEqual({});
  });
});
