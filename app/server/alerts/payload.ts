// MARK: Alert payloads
//
// The JSON body POSTed to a webhook. Webhooks are consumed by automation and
// chat relays, not by the UI, so the copy here is English and lives outside the
// translation catalogs; the settings page renders its own localized labels from
// the structured history entry instead of showing this text.

import type { AlertEvent, AlertHistoryEventId, AlertSeverity } from "./types";

export interface AlertPayload {
  event: AlertHistoryEventId;
  title: string;
  severity: AlertSeverity;
  summary: string;
  details: Record<string, string | number>;
  /** ISO timestamp of the observation, not of the delivery attempt. */
  timestamp: string;
  /** The Headplane build that sent the notification. */
  version: string;
}

const EVENT_TEXT: Record<AlertHistoryEventId, { title: string; summary: string }> = {
  headscaleUnreachable: {
    title: "Headscale is unreachable",
    summary: "Headplane could not reach the Headscale API.",
  },
  headscaleRecovered: {
    title: "Headscale is reachable again",
    summary: "Headplane can reach the Headscale API again.",
  },
  nodeOffline: {
    title: "Node went offline",
    summary: "{target} is no longer connected to the tailnet.",
  },
  nodeOnline: {
    title: "Node is back online",
    summary: "{target} is connected to the tailnet again.",
  },
  apiKeyExpiring: {
    title: "API key expiring soon",
    summary: "API key {target} expires within {threshold} days.",
  },
  configCheckFailed: {
    title: "Configuration check failing",
    summary: "The Headscale configuration check {target} is failing.",
  },
  derpSyncFailed: {
    title: "DERP address sync failed",
    summary: "The embedded DERP address sync failed ({target}).",
  },
  test: {
    title: "Test notification",
    summary: "This is a test notification from Headplane.",
  },
};

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] === undefined ? match : String(vars[name]),
  );
}

function detailsOf(
  event: Pick<AlertEvent, "target" | "threshold">,
): Record<string, string | number> {
  const details: Record<string, string | number> = {};
  if (event.target !== undefined) {
    details.target = event.target;
  }
  if (event.threshold !== undefined) {
    details.threshold = event.threshold;
  }
  return details;
}

export function buildAlertPayload(event: AlertEvent, version: string): AlertPayload {
  const text = EVENT_TEXT[event.id];
  const vars = detailsOf(event);

  return {
    event: event.id,
    title: text.title,
    severity: event.severity,
    summary: interpolate(text.summary, vars),
    details: vars,
    timestamp: event.at,
    version,
  };
}

export function buildTestAlertPayload(version: string, now: Date = new Date()): AlertPayload {
  return {
    event: "test",
    title: EVENT_TEXT.test.title,
    severity: "info",
    summary: EVENT_TEXT.test.summary,
    details: {},
    timestamp: now.toISOString(),
    version,
  };
}
