import { describe, expect, test, vi } from "vitest";

import {
  ALERT_ERROR_MAX_LENGTH,
  createAlertDelivery,
  notifyAlert,
  postAlertPayload,
} from "~/server/alerts/notifier";
import { buildAlertPayload, buildTestAlertPayload } from "~/server/alerts/payload";
import { DEFAULT_ALERT_SETTINGS } from "~/server/alerts/settings";
import { ALERT_HISTORY_LIMIT } from "~/server/alerts/store";
import type { AlertDelivery, AlertEvent, AlertSettings } from "~/server/alerts/types";

const AT = new Date("2026-01-01T00:00:00.000Z");

function settings(overrides: Partial<AlertSettings> = {}): AlertSettings {
  return {
    ...DEFAULT_ALERT_SETTINGS,
    enabled: true,
    webhookUrl: "https://example.com/hook",
    ...overrides,
  };
}

function event(): AlertEvent {
  return { id: "nodeOffline", severity: "warning", target: "alpha", at: AT.toISOString() };
}

describe("postAlertPayload", () => {
  test("posts compact JSON with the secret header", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const payload = buildAlertPayload(event(), "0.19.0");

    const outcome = await postAlertPayload(settings({ secret: "s3cret" }), payload, { fetchImpl });

    expect(outcome).toEqual({ ok: true, status: 204, error: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Headplane-Secret": "s3cret",
    });
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  test("omits the secret header when no secret is configured", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));

    await postAlertPayload(settings(), buildTestAlertPayload("0.19.0", AT), { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("X-Headplane-Secret");
  });

  test("a rejected request is reported, not thrown", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));

    const outcome = await postAlertPayload(settings(), buildTestAlertPayload("0.19.0", AT), {
      fetchImpl,
    });

    expect(outcome).toEqual({ ok: false, status: 500, error: "HTTP 500" });
  });

  test("a network failure is reported, not thrown", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const outcome = await postAlertPayload(settings(), buildTestAlertPayload("0.19.0", AT), {
      fetchImpl,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBeNull();
    expect(outcome.error).toContain("ECONNREFUSED");
  });

  test("a missing URL is a failed delivery, not a request", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));

    const outcome = await postAlertPayload(
      settings({ webhookUrl: "" }),
      buildTestAlertPayload("0.19.0", AT),
      {
        fetchImpl,
      },
    );

    expect(outcome.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("notifyAlert", () => {
  test("records a failed delivery in the history instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));

    const { delivery, history } = await notifyAlert({
      settings: settings(),
      payload: buildAlertPayload(event(), "0.19.0"),
      history: [],
      event: "nodeOffline",
      target: "alpha",
      at: AT,
      id: "delivery-1",
      fetchImpl,
    });

    expect(delivery).toEqual({
      id: "delivery-1",
      at: AT.toISOString(),
      event: "nodeOffline",
      ok: false,
      status: 503,
      error: "HTTP 503",
      target: "alpha",
    });
    expect(history).toEqual([delivery]);
  });

  test("a throwing fetch still produces a history entry", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    const { delivery, history } = await notifyAlert({
      settings: settings(),
      payload: buildAlertPayload(event(), "0.19.0"),
      history: [],
      event: "nodeOffline",
      at: AT,
      fetchImpl,
    });

    expect(delivery.ok).toBe(false);
    expect(delivery.error).toContain("socket hang up");
    expect(history[0]).toBe(delivery);
  });

  test("keeps the history capped", async () => {
    const existing: AlertDelivery[] = Array.from({ length: ALERT_HISTORY_LIMIT }, (_, index) =>
      createAlertDelivery({
        event: "test",
        outcome: { ok: true, status: 200, error: null },
        at: AT,
        id: `old-${index}`,
      }),
    );

    const { history } = await notifyAlert({
      settings: settings(),
      payload: buildTestAlertPayload("0.19.0", AT),
      history: existing,
      event: "test",
      at: AT,
      id: "newest",
      fetchImpl: vi.fn(async () => new Response("", { status: 200 })),
    });

    expect(history).toHaveLength(ALERT_HISTORY_LIMIT);
    expect(history[0].id).toBe("newest");
  });

  test("truncates a very long error message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("x".repeat(1000));
    });

    const { delivery } = await notifyAlert({
      settings: settings(),
      payload: buildTestAlertPayload("0.19.0", AT),
      history: [],
      event: "test",
      at: AT,
      fetchImpl,
    });

    expect(delivery.error?.length).toBeLessThanOrEqual(ALERT_ERROR_MAX_LENGTH + 1);
  });
});
