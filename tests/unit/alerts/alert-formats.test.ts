// Tests for the platform message formats.
//
// The real payload an operator received is the fixture: a test notification at
// 08:52:55Z, which in the server's Asia/Shanghai zone is 16:52:55 local. Every
// platform has to carry the title, the summary, the object line, that local
// time and the version, while the generic format stays byte for byte what it
// has always been.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { translate } from "~/i18n";
import {
  alertPresentation,
  formatAlertLocalTime,
  SEVERITY_ICONS,
} from "~/routes/settings/notifications/alert-presentation";
import {
  ALERT_FORMAT_ITEM_KEYS,
  ALERT_FORMAT_ORDER,
} from "~/routes/settings/notifications/formats";
import { emptyAlertState } from "~/server/alerts/events";
import {
  alertRequestBody,
  alertRequestBodyForSettings,
  WECOM_CONTENT_LIMIT,
} from "~/server/alerts/format";
import { postAlertPayload } from "~/server/alerts/notifier";
import {
  buildAlertPayload,
  buildTestAlertPayload,
  type AlertPayload,
} from "~/server/alerts/payload";
import { createAlertService, type AlertService } from "~/server/alerts/service.server";
import {
  DEFAULT_ALERT_SETTINGS,
  isAlertWebhookFormat,
  normalizeAlertSettings,
} from "~/server/alerts/settings";
import { parseAlertsDocument, serializeAlertsDocument } from "~/server/alerts/store";
import {
  ALERT_WEBHOOK_FORMATS,
  type AlertSeverity,
  type AlertSettings,
  type AlertWebhookFormat,
} from "~/server/alerts/types";
import type { Headscale } from "~/server/headscale/api";
import type { LiveStore } from "~/server/headscale/live-store";
import { LOCALES, type Locale } from "~/utils/locale";

/** The timestamp from the payload the operator actually received. */
const AT = "2026-10-06T08:52:55.886Z";
const LOCAL_TIME = "16:52:55";
const UTC_TIME = "08:52:55";
const VERSION = "0.22.14";
const ZONE = "Asia/Shanghai";
const BASE_URL = "https://headplane.example.com";
const LOCALE: Locale = "zh-Hans";

/** Every format except the untouched generic payload. */
const RENDERED_FORMATS = ALERT_WEBHOOK_FORMATS.filter((format) => format !== "generic");

type Json = Record<string, any>;

function testPayload(locale: Locale = LOCALE): AlertPayload {
  return buildTestAlertPayload(VERSION, new Date(AT), locale);
}

/** An event that carries the subject and the numeric detail a line is built from. */
function eventPayload(severity: AlertSeverity = "warning", locale: Locale = LOCALE): AlertPayload {
  return buildAlertPayload(
    { id: "nodeOffline", severity, target: "alpha", at: AT },
    VERSION,
    locale,
  );
}

function render(
  format: AlertWebhookFormat,
  payload: AlertPayload,
  options: { baseUrl?: string; timeZone?: string; locale?: Locale } = {},
): Json {
  return alertRequestBody(format, payload, {
    locale: LOCALE,
    baseUrl: BASE_URL,
    timeZone: ZONE,
    ...options,
  }) as Json;
}

/** Every string a body carries, so a shape can be searched without knowing it. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(stringsOf);
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsOf);
  }

  return [];
}

function bodyText(body: unknown): string {
  return stringsOf(body).join("\n");
}

describe("webhook format setting", () => {
  test("defaults to the generic payload and accepts only the offered formats", () => {
    expect(DEFAULT_ALERT_SETTINGS.webhookFormat).toBe("generic");
    expect([...ALERT_WEBHOOK_FORMATS]).toEqual([...ALERT_FORMAT_ORDER]);

    for (const format of ALERT_WEBHOOK_FORMATS) {
      expect(isAlertWebhookFormat(format), format).toBe(true);
    }

    for (const value of ["", "telegram", "GENERIC", "generic ", null, 3]) {
      expect(isAlertWebhookFormat(value), String(value)).toBe(false);
    }
  });

  test("a stored choice survives, an unknown one falls back to generic", () => {
    expect(normalizeAlertSettings({ webhookFormat: "slack" }).webhookFormat).toBe("slack");
    expect(normalizeAlertSettings({ webhookFormat: "telegram" }).webhookFormat).toBe("generic");
    expect(normalizeAlertSettings({}).webhookFormat).toBe("generic");

    const document = {
      settings: { ...DEFAULT_ALERT_SETTINGS, webhookFormat: "discord" as const },
      history: [],
      state: emptyAlertState(),
    };
    expect(parseAlertsDocument(serializeAlertsDocument(document)).settings.webhookFormat).toBe(
      "discord",
    );
  });

  test("every format has a label in every language", () => {
    for (const format of ALERT_WEBHOOK_FORMATS) {
      for (const locale of LOCALES) {
        const label = translate(locale, ALERT_FORMAT_ITEM_KEYS[format]);
        expect(label, `${locale}:${format}`).not.toContain("settings.notifications");
        expect(label.trim(), `${locale}:${format}`).not.toBe("");
      }
    }
  });
});

describe("generic format", () => {
  test("is byte-compatible with the payload sent today", () => {
    const payload = testPayload();
    const body = alertRequestBody("generic", payload, { locale: LOCALE });

    // The same object, so `JSON.stringify` produces the same bytes, in the same
    // key order, with the raw ISO timestamp untouched.
    expect(body).toBe(payload);
    expect(JSON.stringify(body)).toBe(JSON.stringify(payload));
    expect(Object.keys(body as object)).toEqual([
      "event",
      "title",
      "severity",
      "summary",
      "details",
      "timestamp",
      "version",
    ]);
    expect(payload.timestamp).toBe(AT);
    expect(bodyText(body)).not.toContain("headplane.example.com");
  });

  test("is what the notifier POSTs while the format stays generic", async () => {
    const payload = eventPayload();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const settings: AlertSettings = {
      ...DEFAULT_ALERT_SETTINGS,
      enabled: true,
      webhookUrl: "https://example.com/hook",
    };

    await postAlertPayload(settings, payload, { fetchImpl, baseUrl: BASE_URL, timeZone: ZONE });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });
});

describe("platform shapes", () => {
  test("dingtalk posts robot markdown with a title and a text body", () => {
    const body = render("dingtalk", eventPayload());

    expect(Object.keys(body)).toEqual(["msgtype", "markdown"]);
    expect(body.msgtype).toBe("markdown");
    expect(Object.keys(body.markdown)).toEqual(["title", "text"]);
    expect(body.markdown.text).toContain("###");
    expect(body.markdown.text).toContain(">");
  });

  test("wecom posts markdown content and truncates long messages", () => {
    const body = render("wecom", eventPayload());

    expect(Object.keys(body)).toEqual(["msgtype", "markdown"]);
    expect(body.msgtype).toBe("markdown");
    expect(Object.keys(body.markdown)).toEqual(["content"]);

    const long = buildAlertPayload(
      { id: "nodeOffline", severity: "warning", target: "x".repeat(900), at: AT },
      VERSION,
      "en",
    );
    const content = render("wecom", long).markdown.content as string;
    expect(content.length).toBeLessThanOrEqual(WECOM_CONTENT_LIMIT);
  });

  test("feishu posts an interactive card with a header and body elements", () => {
    const body = render("feishu", eventPayload());

    expect(Object.keys(body)).toEqual(["msg_type", "card"]);
    expect(body.msg_type).toBe("interactive");
    expect(Object.keys(body.card)).toEqual(["config", "header", "elements"]);
    expect(body.card.header.title.tag).toBe("plain_text");
    expect(body.card.elements[0].tag).toBe("div");
    expect(body.card.elements[0].text.tag).toBe("lark_md");
    expect(body.card.elements[1].tag).toBe("note");
  });

  test("slack posts a plain-text fallback plus header, section and context blocks", () => {
    const body = render("slack", eventPayload());

    expect(Object.keys(body)).toEqual(["text", "blocks"]);
    expect(typeof body.text).toBe("string");
    expect(body.blocks.map((block: Json) => block.type)).toEqual(["header", "section", "context"]);
    expect(body.blocks[0].text.type).toBe("plain_text");
    expect(body.blocks[1].text.type).toBe("mrkdwn");
    expect(body.blocks[2].elements[0].text).toContain(LOCAL_TIME);
  });

  test("discord posts content plus one embed with fields", () => {
    const body = render("discord", eventPayload());

    expect(Object.keys(body)).toEqual(["content", "embeds"]);
    expect(body.embeds).toHaveLength(1);
    expect(Object.keys(body.embeds[0])).toEqual(["title", "description", "color", "fields"]);
    expect(body.embeds[0].title).toBe(body.content);
    expect(body.embeds[0].description).toBe(eventPayload().summary);

    const names = body.embeds[0].fields.map((field: Json) => field.name);
    expect(names).toContain(translate(LOCALE, "settings.notifications.alert.lineNode"));
    expect(names).toContain(translate(LOCALE, "settings.notifications.alert.lineTime"));
    expect(names).toContain(translate(LOCALE, "settings.notifications.alert.lineVersion"));
  });
});

describe("what every rendered message carries", () => {
  test("the title, the summary, the object line, the local time and the version", () => {
    const payload = eventPayload();
    const expected = [
      payload.title,
      payload.summary,
      "alpha",
      translate(LOCALE, "settings.notifications.alert.lineNode"),
      LOCAL_TIME,
      VERSION,
      BASE_URL,
    ];

    for (const format of RENDERED_FORMATS) {
      const text = bodyText(render(format, payload));
      for (const needle of expected) {
        expect(text, `${format} is missing ${needle}`).toContain(needle);
      }

      // The operator's own payload has no details, and still renders.
      const test = bodyText(render(format, testPayload()));
      expect(test, format).toContain(testPayload().title);
      expect(test, format).toContain(testPayload().summary);
      expect(test, format).toContain(LOCAL_TIME);
      expect(test, format).toContain(VERSION);
      expect(test, format).not.toContain("settings.notifications");
    }
  });

  test("the context line carries the local time and the version", () => {
    // Discord states the same context as its Time and Version fields, which is
    // the shape its webhook documents; every other platform takes a footer line.
    for (const format of RENDERED_FORMATS.filter((value) => value !== "discord")) {
      const presentation = alertPresentation(testPayload(), LOCALE, { timeZone: ZONE });
      expect(bodyText(render(format, testPayload())), format).toContain(presentation.context);
      expect(presentation.context, format).toContain(`v${VERSION}`);
    }

    const fields = render("discord", testPayload()).embeds[0].fields as Json[];
    expect(fields.map((field) => field.value)).toContain(VERSION);
    expect(fields.map((field) => field.value).join(" ")).toContain(LOCAL_TIME);
  });

  test("the human time is the server's local time, not raw UTC", () => {
    const payload = testPayload();
    const presentation = alertPresentation(payload, LOCALE, { timeZone: ZONE });

    expect(presentation.time).toContain(LOCAL_TIME);
    expect(presentation.time).not.toContain(UTC_TIME);
    expect(presentation.context).toContain(`v${VERSION}`);

    // The machine-readable timestamp is untouched by the rendering.
    expect(JSON.stringify(render("generic", payload)).includes(AT)).toBe(true);

    // An unusable zone degrades instead of throwing.
    expect(formatAlertLocalTime(AT, "en", "Not/AZone")).toContain("2026");
    expect(formatAlertLocalTime("not-a-date", "en", ZONE)).toBe("not-a-date");
  });

  test("the server's zone is the default, so no zone is required", () => {
    const payload = testPayload();
    const local = alertPresentation(payload, LOCALE);
    const pinned = alertPresentation(payload, LOCALE, { timeZone: ZONE });

    expect(local.time.length).toBeGreaterThan(0);
    expect(pinned.time).toContain(LOCAL_TIME);
  });

  test("every severity is drawn with its own accent", () => {
    const accents = (["info", "warning", "critical"] as AlertSeverity[]).map((severity) => {
      const payload = eventPayload(severity, "en");
      const dingtalk = render("dingtalk", payload);
      const feishu = render("feishu", payload);
      const discord = render("discord", payload);
      const slack = render("slack", payload);

      return {
        icon: SEVERITY_ICONS[severity],
        headline: dingtalk.markdown.title as string,
        template: feishu.card.header.template as string,
        color: discord.embeds[0].color as number,
        slackHeader: slack.blocks[0].text.text as string,
      };
    });

    expect(new Set(accents.map((accent) => accent.icon)).size).toBe(3);
    expect(new Set(accents.map((accent) => accent.headline)).size).toBe(3);
    expect(new Set(accents.map((accent) => accent.template)).size).toBe(3);
    expect(new Set(accents.map((accent) => accent.color)).size).toBe(3);
    expect(new Set(accents.map((accent) => accent.slackHeader)).size).toBe(3);
    expect(accents[0].headline).toBe(`${SEVERITY_ICONS.info} ${eventPayload("info", "en").title}`);
  });

  test("the notification language reaches the labels as well as the text", () => {
    for (const format of RENDERED_FORMATS) {
      const english = bodyText(render(format, eventPayload("warning", "en"), { locale: "en" }));
      const simplified = bodyText(render(format, eventPayload("warning", "zh-Hans"), {}));
      const traditional = bodyText(
        render(format, eventPayload("warning", "zh-Hant"), { locale: "zh-Hant" }),
      );

      expect(english, format).not.toBe(simplified);
      expect(traditional, format).not.toBe(simplified);
      expect(english, format).toContain(translate("en", "settings.notifications.alert.lineNode"));
      expect(simplified, format).toContain(
        translate("zh-Hans", "settings.notifications.alert.lineNode"),
      );
      expect(traditional, format).toContain(
        translate("zh-Hant", "settings.notifications.alert.lineNode"),
      );
      expect(simplified, format).toContain(
        translate("zh-Hans", "settings.notifications.alert.severityWarning"),
      );
    }
  });

  test("a missing base URL simply omits the link", () => {
    const payload = eventPayload();
    const path = "/admin/machines";

    for (const format of RENDERED_FORMATS) {
      expect(bodyText(render(format, payload)), format).toContain(`${BASE_URL}${path}`);
      expect(bodyText(render(format, payload, { baseUrl: "" })), format).not.toContain(path);
      expect(bodyText(render(format, payload, { baseUrl: "   " })), format).not.toContain(path);
    }

    // A trailing slash on the base URL never doubles up in the link.
    expect(bodyText(render("slack", payload, { baseUrl: `${BASE_URL}/` }))).toContain(
      `${BASE_URL}${path}`,
    );
  });
});

describe("delivering a formatted message", () => {
  let dir: string;
  let service: AlertService | undefined;

  function build(options: { baseUrl?: string } = {}): {
    alerts: AlertService;
    fetchImpl: ReturnType<typeof vi.fn>;
  } {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const instance = createAlertService({
      dataPath: dir,
      headscale: {} as unknown as Headscale,
      hsLive: {} as unknown as LiveStore,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date(AT),
      baseUrl: options.baseUrl,
      timeZone: ZONE,
    });

    service = instance;
    return { alerts: instance, fetchImpl };
  }

  function posted(fetchImpl: ReturnType<typeof vi.fn>, index = 0): Json {
    const [, init] = fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
    return JSON.parse(String(init.body)) as Json;
  }

  const ENABLED = {
    enabled: true,
    webhookUrl: "https://hooks.example.com/headplane",
    secret: "s3cret",
    notificationLanguage: "zh-Hans",
  } as const;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-alert-format-"));
    service = undefined;
  });

  afterEach(async () => {
    service?.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test("the test notification is posted in the selected format and language", async () => {
    const { alerts, fetchImpl } = build({ baseUrl: BASE_URL });
    await alerts.update({ ...ENABLED, webhookFormat: "dingtalk" });

    const outcome = await alerts.test({
      webhookUrl: ENABLED.webhookUrl,
      secret: ENABLED.secret,
      notificationLanguage: "zh-Hans",
      webhookFormat: "wecom",
    });

    expect(outcome.ok).toBe(true);
    // The Test button posts what the form shows, exactly like the language.
    const body = posted(fetchImpl);
    expect(body.msgtype).toBe("markdown");
    expect(Object.keys(body.markdown)).toEqual(["content"]);
    expect(body.markdown.content).toContain(
      translate("zh-Hans", "settings.notifications.alert.test.title"),
    );
    expect(body.markdown.content).toContain(LOCAL_TIME);
    expect(body.markdown.content).toContain(`${BASE_URL}/admin/settings/notifications`);
    // Trying the channel out does not pin the stored format.
    expect(alerts.settings().webhookFormat).toBe("dingtalk");
  });

  test("the secret header, the history and the cooldown are unaffected", async () => {
    const { alerts, fetchImpl } = build();
    await alerts.update({ ...ENABLED, webhookFormat: "feishu" });

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });
    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Headplane-Secret": "s3cret",
    });

    const body = posted(fetchImpl);
    expect(body.msg_type).toBe("interactive");
    expect(body.card.header.template).toBe("orange");
    expect(alerts.history()).toHaveLength(1);
    expect(alerts.history()[0].event).toBe("derpSyncFailed");
    expect(alerts.history()[0].ok).toBe(true);
  });

  test("the stored format is what the scheduler uses", async () => {
    const { alerts, fetchImpl } = build();
    await alerts.update({ ...ENABLED, webhookFormat: "discord" });

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    const body = posted(fetchImpl);
    expect(Object.keys(body)).toEqual(["content", "embeds"]);
    expect(body.embeds[0].fields.length).toBeGreaterThan(1);
    expect(alerts.settings().webhookFormat).toBe("discord");

    // The same settings-driven entry point the service calls.
    const payload = buildAlertPayload(
      { id: "nodeOffline", severity: "warning", target: "alpha", at: AT },
      VERSION,
      "zh-Hans",
    );
    const rendered = alertRequestBodyForSettings(alerts.settings(), payload, {
      baseUrl: BASE_URL,
      timeZone: ZONE,
    }) as Json;
    expect(rendered.embeds[0].description).toBe(payload.summary);
  });
});

describe("unknown webhook format", () => {
  test("still produces the generic body instead of nothing", () => {
    const payload = testPayload();

    // A stored document from an older build, or a hand-edited store, can name a
    // format this build does not know; the receiver must never get an
    // `undefined` body because the switch had no default.
    const body = alertRequestBody("telegram" as AlertWebhookFormat, payload, { locale: LOCALE });

    expect(body).toBe(payload);
    expect(JSON.stringify(body)).toBe(JSON.stringify(payload));
  });
});
