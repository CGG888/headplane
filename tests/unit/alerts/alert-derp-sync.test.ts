import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createAlertService, type AlertService } from "~/server/alerts/service.server";
import { readAlertsDocument } from "~/server/alerts/store";
import type { AlertSettings } from "~/server/alerts/types";
import type { Headscale } from "~/server/headscale/api";
import type { LiveStore } from "~/server/headscale/live-store";

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

const ENABLED: Partial<AlertSettings> = {
  enabled: true,
  webhookUrl: "https://hooks.example.com/headplane",
};

describe("DERP sync failure alerts", () => {
  let dir: string;
  let service: AlertService | undefined;
  let clock = BASE;

  function build(): { service: AlertService; fetchImpl: ReturnType<typeof vi.fn> } {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const instance = createAlertService({
      dataPath: dir,
      headscale: {} as unknown as Headscale,
      hsLive: {} as unknown as LiveStore,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date(clock),
    });

    service = instance;
    return { service: instance, fetchImpl };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-alert-derp-sync-"));
    service = undefined;
    clock = BASE;
  });

  afterEach(async () => {
    service?.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test("a failing run delivers one payload and lands in the history", async () => {
    const { service: alerts, fetchImpl } = build();
    await alerts.update(ENABLED);

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENABLED.webhookUrl);
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.event).toBe("derpSyncFailed");
    expect(payload.severity).toBe("warning");
    expect(payload.title).toBe("DERP address sync failed");
    expect(payload.details).toEqual({ target: "detection-unusable" });

    const history = alerts.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      event: "derpSyncFailed",
      ok: true,
      status: 204,
      target: "detection-unusable",
    });
  });

  test("a run that keeps failing alerts only once", async () => {
    const { service: alerts, fetchImpl } = build();
    await alerts.update(ENABLED);

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });
    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(alerts.history()).toHaveLength(1);
  });

  test("a successful run clears the failure without sending anything", async () => {
    const { service: alerts, fetchImpl } = build();
    await alerts.update(ENABLED);

    await alerts.reportDerpSync({ failed: true, reason: "reload-failed" });
    // A run that changed nothing reports success, and must never alert.
    await alerts.reportDerpSync({ failed: false });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await readAlertsDocument(dir)).state.derpSyncFailed).toBe(false);
  });

  test("a later failure alerts again once the cooldown has passed", async () => {
    const { service: alerts, fetchImpl } = build();
    await alerts.update(ENABLED);

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });
    await alerts.reportDerpSync({ failed: false });

    // Still inside the 300 second cooldown: the transition is remembered but
    // the delivery is suppressed.
    clock += 60_000;
    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 300_000;
    await alerts.reportDerpSync({ failed: false });
    clock += 1;
    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(alerts.history()).toHaveLength(2);
  });

  test("nothing is recorded while notifications are disabled", async () => {
    const { service: alerts, fetchImpl } = build();

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await readAlertsDocument(dir)).state.derpSyncFailed).toBe(false);
  });
});
