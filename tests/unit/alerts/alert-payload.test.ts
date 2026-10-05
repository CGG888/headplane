import { describe, expect, test } from "vitest";

import { buildAlertPayload, buildTestAlertPayload } from "~/server/alerts/payload";
import type { AlertEvent } from "~/server/alerts/types";

const AT = "2026-01-01T00:00:00.000Z";

function event(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return { id: "headscaleUnreachable", severity: "critical", at: AT, ...overrides };
}

describe("buildAlertPayload", () => {
  test("produces the documented compact shape", () => {
    const payload = buildAlertPayload(event(), "0.19.0");

    expect(Object.keys(payload).sort()).toEqual([
      "details",
      "event",
      "severity",
      "summary",
      "timestamp",
      "title",
      "version",
    ]);
    expect(payload).toEqual({
      event: "headscaleUnreachable",
      title: "Headscale is unreachable",
      severity: "critical",
      summary: "Headplane could not reach the Headscale API.",
      details: {},
      timestamp: AT,
      version: "0.19.0",
    });
    expect(JSON.stringify(payload)).not.toContain("\n");
  });

  test("interpolates the target and threshold into summary and details", () => {
    const payload = buildAlertPayload(
      event({ id: "apiKeyExpiring", severity: "warning", target: "hskey-abcd", threshold: 7 }),
      "0.19.0",
    );

    expect(payload.summary).toBe("API key hskey-abcd expires within 7 days.");
    expect(payload.details).toEqual({ target: "hskey-abcd", threshold: 7 });
    expect(payload.event).toBe("apiKeyExpiring");
  });

  test("carries the node name for node events", () => {
    const payload = buildAlertPayload(
      event({ id: "nodeOffline", severity: "warning", target: "alpha" }),
      "1.2.3",
    );

    expect(payload.summary).toBe("alpha is no longer connected to the tailnet.");
    expect(payload.details).toEqual({ target: "alpha" });
    expect(payload.version).toBe("1.2.3");
    expect(payload.timestamp).toBe(AT);
  });
});

describe("buildTestAlertPayload", () => {
  test("is a well-formed sample with no details", () => {
    const now = new Date(AT);
    const payload = buildTestAlertPayload("0.19.0", now);

    expect(payload).toEqual({
      event: "test",
      title: "Test notification",
      severity: "info",
      summary: "This is a test notification from Headplane.",
      details: {},
      timestamp: AT,
      version: "0.19.0",
    });
  });
});
