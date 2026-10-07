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

const WEBHOOK_URL = "https://hooks.example.com/headplane";

const ENABLED: Partial<AlertSettings> = {
  enabled: true,
  webhookUrl: WEBHOOK_URL,
};

/**
 * A tick spends its time waiting on Headscale. These tests hold that wait open
 * and let the other writers of the same document — the Test button and the DERP
 * sync report — land in the middle of it.
 */
describe("alert ticks against concurrent writers", () => {
  let dir: string;
  let service: AlertService | undefined;
  let healthCalls = 0;
  let release: () => void = () => undefined;
  let gate: Promise<void> = Promise.resolve();

  function build(options: { healthy: boolean }): AlertService {
    healthCalls = 0;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const instance = createAlertService({
      dataPath: dir,
      headscale: {
        health: async () => {
          healthCalls += 1;
          await gate;
          return options.healthy;
        },
      } as unknown as Headscale,
      hsLive: {} as unknown as LiveStore,
      fetchImpl: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
      now: () => new Date(BASE),
    });

    service = instance;
    return instance;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-alert-race-"));
    service = undefined;
  });

  afterEach(async () => {
    release();
    service?.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test("a tick keeps the delivery the Test button appended while it waited", async () => {
    const alerts = build({ healthy: true });
    await alerts.update(ENABLED);

    const tick = alerts.runOnce();
    await vi.waitFor(() => expect(healthCalls).toBe(1));

    await alerts.test({ webhookUrl: WEBHOOK_URL, secret: "", notificationLanguage: "en" });
    expect(alerts.history().map((delivery) => delivery.event)).toEqual(["test"]);

    release();
    await tick;

    // The tick read an empty history before the test delivery landed; committing
    // that snapshot would have wiped it from the page.
    expect(alerts.history().map((delivery) => delivery.event)).toEqual(["test"]);
  });

  test("a tick does not discard a DERP failure reported while it waited", async () => {
    const alerts = build({ healthy: false });
    await alerts.update(ENABLED);

    const tick = alerts.runOnce();
    await vi.waitFor(() => expect(healthCalls).toBe(1));

    await alerts.reportDerpSync({ failed: true, reason: "detection-unusable" });

    release();
    await tick;

    // The tick saw an unreachable Headscale, so it commits and persists. The
    // reporter's own flag and delivery have to survive that commit.
    const document = await readAlertsDocument(dir);
    expect(document.state.reachable).toBe(false);
    expect(document.state.derpSyncFailed).toBe(true);
    expect(document.history.map((delivery) => delivery.event).sort()).toEqual([
      "derpSyncFailed",
      "headscaleUnreachable",
    ]);
  });
});
