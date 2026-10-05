// MARK: Alert notifier
//
// Delivery is deliberately dull: one JSON POST with a short timeout, and an
// outcome record — never an exception. A webhook that is down, slow, or
// rejecting must not break the scheduler loop, and it must not break the
// settings request that triggered a Test either, so every failure path turns
// into `{ ok: false }` plus a truncated diagnostic instead of a throw.

import { ulid } from "ulidx";

import type { AlertPayload } from "./payload";
import { appendDelivery } from "./store";
import type { AlertDelivery, AlertHistoryEventId, AlertSettings } from "./types";

/** Short on purpose: a stalled webhook must not hold a scheduler tick open. */
export const ALERT_TIMEOUT_MS = 5_000;
export const ALERT_ERROR_MAX_LENGTH = 240;

export interface AlertDeliveryOutcome {
  ok: boolean;
  /** HTTP status, or null when no response was produced. */
  status: number | null;
  error: string | null;
}

export interface AlertDeliveryOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function truncate(value: string): string {
  const text = value.trim();
  return text.length > ALERT_ERROR_MAX_LENGTH ? `${text.slice(0, ALERT_ERROR_MAX_LENGTH)}…` : text;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/** POSTs one payload. Never throws: every outcome is a return value. */
export async function postAlertPayload(
  settings: AlertSettings,
  payload: AlertPayload,
  options: AlertDeliveryOptions = {},
): Promise<AlertDeliveryOutcome> {
  const url = settings.webhookUrl.trim();
  if (url.length === 0) {
    return { ok: false, status: null, error: "missing webhook URL" };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ALERT_TIMEOUT_MS;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = settings.secret.trim();
  if (secret.length > 0) {
    headers["X-Headplane-Secret"] = secret;
  }

  try {
    const response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : truncate(`HTTP ${response.status}`),
    };
  } catch (error) {
    return { ok: false, status: null, error: truncate(errorText(error)) };
  }
}

/** Builds the history entry for one attempt. */
export function createAlertDelivery(options: {
  event: AlertHistoryEventId;
  outcome: AlertDeliveryOutcome;
  at?: Date;
  id?: string;
  target?: string;
  threshold?: number;
}): AlertDelivery {
  const at = options.at ?? new Date();
  return {
    id: options.id ?? ulid(),
    at: at.toISOString(),
    event: options.event,
    ok: options.outcome.ok,
    status: options.outcome.status,
    error: options.outcome.error,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
  };
}

export interface AlertNotifyOptions extends AlertDeliveryOptions {
  settings: AlertSettings;
  payload: AlertPayload;
  history: readonly AlertDelivery[];
  event: AlertHistoryEventId;
  target?: string;
  threshold?: number;
  at?: Date;
  id?: string;
}

/**
 * Posts one payload and returns the updated history. Callers persist both; this
 * function performs no filesystem work and, like {@link postAlertPayload},
 * never throws.
 */
export async function notifyAlert(
  options: AlertNotifyOptions,
): Promise<{ delivery: AlertDelivery; history: AlertDelivery[] }> {
  const outcome = await postAlertPayload(options.settings, options.payload, options);
  const delivery = createAlertDelivery({
    event: options.event,
    outcome,
    at: options.at,
    id: options.id,
    target: options.target,
    threshold: options.threshold,
  });

  return { delivery, history: appendDelivery(options.history, delivery) };
}
