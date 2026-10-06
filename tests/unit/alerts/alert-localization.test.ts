import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { translate } from "~/i18n";
import {
  alertMessage,
  alertMessageKeys,
  DERP_MIRROR_TARGET_PREFIX,
} from "~/routes/settings/notifications/alert-message";
import { createAlertService, type AlertService } from "~/server/alerts/service.server";
import {
  isAlertLanguage,
  normalizeAlertSettings,
  resolveAlertLanguage,
} from "~/server/alerts/settings";
import { ALERT_LANGUAGE_IDS } from "~/server/alerts/types";
import type { Headscale } from "~/server/headscale/api";
import type { LiveStore } from "~/server/headscale/live-store";
import { DEFAULT_LOCALE, LOCALES } from "~/utils/locale";

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

const ENABLED = {
  enabled: true,
  webhookUrl: "https://hooks.example.com/headplane",
};

function postedPayload(fetchImpl: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const [, init] = fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("delivery history localization", () => {
  test("a stored delivery keeps no text, so it re-renders in the interface locale", () => {
    // This is exactly what the history row holds: an event id and its
    // structured detail. Nothing is baked in English at delivery time.
    const stored = { id: "nodeOffline" as const, target: "alpha" };

    const simplified = alertMessage("zh-Hans", stored);
    const traditional = alertMessage("zh-Hant", stored);
    const english = alertMessage("en", stored);

    expect(simplified.title).not.toBe(english.title);
    expect(traditional.title).not.toBe(english.title);
    expect(simplified.title).not.toBe(traditional.title);
    expect(simplified.title).toContain("alpha");
    expect(simplified.body).toBe(
      translate("zh-Hans", alertMessageKeys(stored).body, { target: "alpha" }),
    );
  });
});

describe("notification language resolution", () => {
  test("`default` follows the application default", () => {
    expect(resolveAlertLanguage("default")).toBe(DEFAULT_LOCALE);
    for (const locale of LOCALES) {
      expect(resolveAlertLanguage(locale), locale).toBe(locale);
    }
  });

  test("only the offered languages are accepted", () => {
    for (const value of ALERT_LANGUAGE_IDS) {
      expect(isAlertLanguage(value), value).toBe(true);
    }

    for (const value of ["zh", "", "EN", null, 7]) {
      expect(isAlertLanguage(value), String(value)).toBe(false);
    }
  });

  test("normalizing keeps a supported language and drops anything else", () => {
    expect(normalizeAlertSettings({ notificationLanguage: "zh-Hant" }).notificationLanguage).toBe(
      "zh-Hant",
    );
    expect(normalizeAlertSettings({ notificationLanguage: "zh-CN" }).notificationLanguage).toBe(
      "default",
    );
  });
});

describe("localized webhook deliveries", () => {
  let dir: string;
  let service: AlertService | undefined;

  function build(): { alerts: AlertService; fetchImpl: ReturnType<typeof vi.fn> } {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const instance = createAlertService({
      dataPath: dir,
      headscale: {} as unknown as Headscale,
      hsLive: {} as unknown as LiveStore,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date(BASE),
    });

    service = instance;
    return { alerts: instance, fetchImpl };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-alert-language-"));
    service = undefined;
  });

  afterEach(async () => {
    service?.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test("the address-sync message is written in the selected language", async () => {
    const { alerts, fetchImpl } = build();
    await alerts.update({ ...ENABLED, notificationLanguage: "zh-Hant" });

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    const payload = postedPayload(fetchImpl);
    const keys = alertMessageKeys({ id: "derpSyncFailed" });
    expect(payload.event).toBe("derpSyncFailed");
    expect(payload.title).toBe(translate("zh-Hant", keys.title));
    expect(payload.summary).toBe(translate("zh-Hant", keys.body));
    // The machine-readable half is untouched by the language choice.
    expect(payload.severity).toBe("warning");
    expect(payload.details).toEqual({ target: "detection-unusable" });
    expect(alerts.settings().notificationLanguage).toBe("zh-Hant");
  });

  test("a region-mirror failure gets the mirror wording", async () => {
    const { alerts, fetchImpl } = build();
    await alerts.update({ ...ENABLED, notificationLanguage: "zh-Hans" });

    await alerts.reportDerpSync({
      failed: true,
      reason: `${DERP_MIRROR_TARGET_PREFIX}reload-failed`,
    });

    const payload = postedPayload(fetchImpl);
    const mirror = alertMessageKeys({
      id: "derpSyncFailed",
      target: `${DERP_MIRROR_TARGET_PREFIX}x`,
    });
    const sync = alertMessageKeys({ id: "derpSyncFailed" });

    expect(payload.title).toBe(translate("zh-Hans", mirror.title));
    expect(payload.summary).toBe(translate("zh-Hans", mirror.body));
    expect(payload.title).not.toBe(translate("zh-Hans", sync.title));
    expect(payload.details).toEqual({ target: `${DERP_MIRROR_TARGET_PREFIX}reload-failed` });
  });

  test("the test notification follows the language picked on the page", async () => {
    const { alerts, fetchImpl } = build();

    const outcome = await alerts.test({
      webhookUrl: ENABLED.webhookUrl,
      secret: "",
      notificationLanguage: "zh-Hans",
    });

    expect(outcome.ok).toBe(true);
    const payload = postedPayload(fetchImpl);
    expect(payload.event).toBe("test");
    expect(payload.severity).toBe("info");
    expect(String(payload.title)).toContain("测试通知");
    expect(String(payload.summary)).toContain("测试通知");
    // Trying the channel out does not pin the stored language.
    expect(alerts.settings().notificationLanguage).toBe("default");
  });

  test("switching the language does not reopen a condition that already fired", async () => {
    const { alerts, fetchImpl } = build();
    await alerts.update({ ...ENABLED, notificationLanguage: "en" });

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });
    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await alerts.update({ notificationLanguage: "zh-Hans" });
    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(postedPayload(fetchImpl).title)).toContain("DERP");
  });
});
