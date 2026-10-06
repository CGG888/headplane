// MARK: Alert payloads
//
// The JSON body POSTed to a webhook. The machine-readable fields — the event
// id, the severity, the target/threshold details, the timestamps and the
// version — never change with language, so existing automations keep working.
// Only the human-readable `title` and `summary` are localized, built from the
// same catalogs the interface uses and in the language the operator selected
// (`settings.notificationLanguage`).

import { alertMessage } from "~/routes/settings/notifications/alert-message";

import { resolveAlertLanguage } from "./settings";
import type { AlertEvent, AlertHistoryEventId, AlertLanguage, AlertSeverity } from "./types";

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

export function buildAlertPayload(
  event: AlertEvent,
  version: string,
  language: AlertLanguage = "default",
): AlertPayload {
  const message = alertMessage(resolveAlertLanguage(language), event);

  return {
    event: event.id,
    title: message.title,
    severity: event.severity,
    summary: message.body,
    details: detailsOf(event),
    timestamp: event.at,
    version,
  };
}

export function buildTestAlertPayload(
  version: string,
  now: Date = new Date(),
  language: AlertLanguage = "default",
): AlertPayload {
  const message = alertMessage(resolveAlertLanguage(language), { id: "test" });

  return {
    event: "test",
    title: message.title,
    severity: "info",
    summary: message.body,
    details: {},
    timestamp: now.toISOString(),
    version,
  };
}
