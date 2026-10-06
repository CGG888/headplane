import { describe, expect, test } from "vitest";

import { translate } from "~/i18n";
import {
  alertMessageKeys,
  DERP_MIRROR_TARGET_PREFIX,
} from "~/routes/settings/notifications/alert-message";
import { buildAlertPayload, buildTestAlertPayload } from "~/server/alerts/payload";
import { ALERT_EVENT_IDS, type AlertEvent, type AlertHistoryEventId } from "~/server/alerts/types";
import { LOCALES } from "~/utils/locale";

const AT = "2026-01-01T00:00:00.000Z";

/** Every message the notifier (or the Test button) can produce. */
const ALL_EVENT_IDS: AlertHistoryEventId[] = [...ALERT_EVENT_IDS, "test"];

function event(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return { id: "headscaleUnreachable", severity: "critical", at: AT, ...overrides };
}

/** The event with every structured detail it normally carries. */
function fullEvent(id: AlertHistoryEventId): AlertEvent {
  return event({
    id: id === "test" ? "headscaleUnreachable" : id,
    target: "node-a",
    threshold: 7,
  });
}

function payloadFor(id: AlertHistoryEventId, locale?: (typeof LOCALES)[number]) {
  return id === "test"
    ? buildTestAlertPayload("1.0.0", new Date(AT), locale)
    : buildAlertPayload(fullEvent(id), "1.0.0", locale);
}

describe("buildAlertPayload", () => {
  test("produces the documented compact shape", () => {
    const payload = buildAlertPayload(event(), "0.19.0", "en");

    expect(Object.keys(payload).sort()).toEqual([
      "details",
      "event",
      "severity",
      "summary",
      "timestamp",
      "title",
      "version",
    ]);
    expect(payload.event).toBe("headscaleUnreachable");
    expect(payload.severity).toBe("critical");
    expect(payload.details).toEqual({});
    expect(payload.timestamp).toBe(AT);
    expect(payload.version).toBe("0.19.0");
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.summary.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain("\n");
  });

  test("keeps the target and threshold in details, not just in the prose", () => {
    const payload = buildAlertPayload(
      event({ id: "apiKeyExpiring", severity: "warning", target: "hskey-abcd", threshold: 7 }),
      "0.19.0",
      "zh-Hans",
    );

    expect(payload.details).toEqual({ target: "hskey-abcd", threshold: 7 });
    expect(payload.event).toBe("apiKeyExpiring");
    expect(payload.severity).toBe("warning");
  });

  test("writes the title and summary in the requested language", () => {
    for (const locale of LOCALES) {
      const source = event({ id: "nodeOffline", severity: "warning", target: "alpha" });
      const payload = buildAlertPayload(source, "1.2.3", locale);
      const keys = alertMessageKeys(source);

      expect(payload.title, locale).toBe(translate(locale, keys.title, { target: "alpha" }));
      expect(payload.summary, locale).toBe(translate(locale, keys.body, { target: "alpha" }));
    }

    // The localization is real: the Chinese payloads differ from the English one.
    const english = buildAlertPayload(
      event({ id: "nodeOffline", severity: "warning", target: "alpha" }),
      "1.2.3",
      "en",
    );
    for (const locale of ["zh-Hans", "zh-Hant"] as const) {
      const localized = buildAlertPayload(
        event({ id: "nodeOffline", severity: "warning", target: "alpha" }),
        "1.2.3",
        locale,
      );
      expect(localized.title, locale).not.toBe(english.title);
      expect(localized.summary, locale).not.toBe(english.summary);
    }
  });

  test("defaults to the application locale, not to a hardcoded language", () => {
    const source = event({ id: "headscaleUnreachable", severity: "critical" });
    const fallback = buildAlertPayload(source, "1.2.3");
    const english = buildAlertPayload(source, "1.2.3", "en");

    expect(fallback).toEqual(english);
  });

  test("words the region mirror apart from the address sync", () => {
    const sync = buildAlertPayload(
      event({ id: "derpSyncFailed", severity: "warning", target: "detection-unusable" }),
      "1.0.0",
      "zh-Hans",
    );
    const mirror = buildAlertPayload(
      event({
        id: "derpSyncFailed",
        severity: "warning",
        target: `${DERP_MIRROR_TARGET_PREFIX}reload-failed`,
      }),
      "1.0.0",
      "zh-Hans",
    );

    expect(mirror.title).not.toBe(sync.title);
    expect(mirror.summary).not.toBe(sync.summary);
    // The tag stays machine-readable even though it is out of the prose.
    expect(mirror.details).toEqual({ target: `${DERP_MIRROR_TARGET_PREFIX}reload-failed` });
    expect(mirror.event).toBe("derpSyncFailed");
  });

  test("never sends the old brand in any human-readable string", () => {
    // The payload is machine-readable, but its titles and summaries are read by
    // whoever the webhook lands in, so every event names the product HeadplaneCN.
    for (const id of ALL_EVENT_IDS) {
      for (const locale of LOCALES) {
        const payload = payloadFor(id, locale);
        expect(JSON.stringify(payload), `${locale}:${id}`).not.toMatch(/Headplane(?!CN)/);
      }
    }
  });
});

describe("alert wording", () => {
  test("every event has a title and a body in every language, with no missing keys", () => {
    for (const id of ALL_EVENT_IDS) {
      for (const locale of LOCALES) {
        const payload = payloadFor(id, locale);
        const label = `${locale}:${id}`;

        expect(payload.title.trim(), label).not.toBe("");
        expect(payload.summary.trim(), label).not.toBe("");
        // A key that failed to resolve is returned verbatim by `translate`.
        expect(payload.title, label).not.toContain("settings.notifications");
        expect(payload.summary, label).not.toContain("settings.notifications");
      }
    }
  });

  test("no placeholder is ever left unfilled", () => {
    for (const id of ALL_EVENT_IDS) {
      for (const locale of LOCALES) {
        const payload = payloadFor(id, locale);
        const text = `${payload.title}\n${payload.summary}`;

        expect(text, `${locale}:${id}`).not.toMatch(/\{[^}]+\}/);
      }
    }
  });

  test("every event says something different", () => {
    for (const locale of LOCALES) {
      const summaries = ALL_EVENT_IDS.map((id) => payloadFor(id, locale).summary);
      const titles = ALL_EVENT_IDS.map((id) => payloadFor(id, locale).title);

      expect(new Set(summaries).size, locale).toBe(ALL_EVENT_IDS.length);
      expect(new Set(titles).size, locale).toBe(ALL_EVENT_IDS.length);
    }
  });

  test("the events that are about an object name it", () => {
    const cases: AlertHistoryEventId[] = [
      "nodeOffline",
      "nodeOnline",
      "apiKeyExpiring",
      "configCheckFailed",
    ];

    for (const id of cases) {
      for (const locale of LOCALES) {
        const payload = payloadFor(id, locale);
        const text = `${payload.title} ${payload.summary}`;

        expect(text, `${locale}:${id}`).toContain("node-a");
      }
    }
  });

  test("every body reads as a full explanation, not a fragment", () => {
    // Light heuristic: a sentence that says what happened and what to do is
    // longer than a label, and ends in a full stop rather than a code.
    for (const id of ALL_EVENT_IDS) {
      for (const locale of LOCALES) {
        const body = payloadFor(id, locale).summary;

        expect(body.length, `${locale}:${id}`).toBeGreaterThan(30);
        expect(body, `${locale}:${id}`).toMatch(/[.。]$/);
        expect(body, `${locale}:${id}`).not.toMatch(/[{}]/);
      }
    }
  });

  test("the test notification reads like a message a person would send", () => {
    const zhHans = buildTestAlertPayload("1.0.0", new Date(AT), "zh-Hans");
    expect(zhHans.summary).toContain("测试通知");
    expect(zhHans.summary).toContain("Webhook");
    expect(zhHans.summary).toMatch(/微信|钉钉|飞书/);

    const zhHant = buildTestAlertPayload("1.0.0", new Date(AT), "zh-Hant");
    expect(zhHant.summary).toContain("測試通知");
    expect(zhHant.summary).toMatch(/微信|釘釘|飛書/);

    const english = buildTestAlertPayload("1.0.0", new Date(AT), "en");
    expect(english.summary).toContain("test notification");
    expect(english.summary).toMatch(/WeChat|DingTalk|Feishu/);
  });
});

describe("buildTestAlertPayload", () => {
  test("is a well-formed sample with no details", () => {
    const now = new Date(AT);
    const payload = buildTestAlertPayload("0.19.0", now);

    expect(payload.event).toBe("test");
    expect(payload.severity).toBe("info");
    expect(payload.details).toEqual({});
    expect(payload.timestamp).toBe(AT);
    expect(payload.version).toBe("0.19.0");
  });
});
