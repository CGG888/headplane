// MARK: Alert notifications
//
// Shared types for the notification store, the pure event detector and the
// webhook notifier. Alerts report *transitions* — Headscale going down, a node
// dropping offline, a key about to expire — so detection is a pure function of
// the current snapshot plus the state the previous tick left behind. Nothing in
// this module performs I/O, which keeps every rule unit testable.

/** Every event the notifier can report, in the order the settings page lists them. */
export const ALERT_EVENT_IDS = [
  "headscaleUnreachable",
  "headscaleRecovered",
  "nodeOffline",
  "nodeOnline",
  "apiKeyExpiring",
  "configCheckFailed",
] as const;

export type AlertEventId = (typeof ALERT_EVENT_IDS)[number];

/**
 * The Test button posts a sample payload. It is not a reportable event, so it
 * only ever appears in the delivery history.
 */
export type AlertHistoryEventId = AlertEventId | "test";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertSettings {
  enabled: boolean;
  /** Webhook endpoint receiving a JSON POST. Empty means "not configured". */
  webhookUrl: string;
  /** Optional shared secret sent as the `X-Headplane-Secret` header. */
  secret: string;
  /** Events to report; anything not listed is detected but never sent. */
  events: AlertEventId[];
  /** How often the scheduler looks for transitions, in seconds. */
  intervalSeconds: number;
  /** Minimum time before the same condition may be reported again, in seconds. */
  cooldownSeconds: number;
  /** How far ahead an API key's expiry is worth reporting, in days. */
  apiKeyExpiryDays: number;
}

/** One detected transition, before it becomes a webhook payload. */
export interface AlertEvent {
  id: AlertEventId;
  severity: AlertSeverity;
  /** Subject of the event: a node name, an API key prefix, or a check id. */
  target?: string;
  /** Numeric detail, e.g. the expiry window in days. */
  threshold?: number;
  /** ISO timestamp the transition was observed at. */
  at: string;
}

/** One webhook attempt, kept so the page can show what was delivered. */
export interface AlertDelivery {
  id: string;
  /** ISO timestamp of the attempt. */
  at: string;
  event: AlertHistoryEventId;
  ok: boolean;
  /** HTTP status, or null when the request never produced a response. */
  status: number | null;
  /** Truncated diagnostic detail; technical text, never translated prose. */
  error: string | null;
  target?: string;
  threshold?: number;
}

export interface AlertNodeSnapshot {
  id: string;
  name: string;
  online: boolean;
}

export interface AlertApiKeySnapshot {
  id: string;
  prefix: string;
  /** ISO timestamp; the detector compares it against the configured window. */
  expiration: string;
}

export interface AlertConfigChecksSnapshot {
  /**
   * False when the checks could not run at all (no configuration file, or one
   * nobody could read). Failures are never invented from an unreadable config.
   */
  available: boolean;
  failing: string[];
}

/** Everything one tick observes, gathered outside the detector. */
export interface AlertSnapshot {
  reachable: boolean;
  /** False when the node list could not be fetched, so node state is preserved. */
  nodesAvailable: boolean;
  nodes: AlertNodeSnapshot[];
  /** False when the API key list could not be fetched. */
  apiKeysAvailable: boolean;
  apiKeys: AlertApiKeySnapshot[];
  configChecks: AlertConfigChecksSnapshot;
}

/** The previous tick's conclusions, persisted so restarts do not re-report. */
export interface AlertState {
  reachable: boolean;
  offlineNodes: string[];
  expiringKeys: string[];
  failingChecks: string[];
  /** Condition key to the ISO time it was last reported at, for the cooldown. */
  sent: Record<string, string>;
}
