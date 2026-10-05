import { data } from "react-router";

import {
  ALERT_COOLDOWN_MAX_SECONDS,
  ALERT_COOLDOWN_MIN_SECONDS,
  ALERT_EXPIRY_WINDOW_MAX_DAYS,
  ALERT_EXPIRY_WINDOW_MIN_DAYS,
  ALERT_INTERVAL_MAX_SECONDS,
  ALERT_INTERVAL_MIN_SECONDS,
  isAlertEventId,
  isValidAlertWebhookUrl,
} from "~/server/alerts/settings";
import type { AlertEventId } from "~/server/alerts/types";
import { alertsContext, authContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import type { AlertActionErrorCode } from "./error-keys";

export type AlertActionResult =
  | { success: true; kind: "save" }
  | { success: true; kind: "test"; ok: boolean; status: number | null; error: string | null }
  | { success: false; errorCode: AlertActionErrorCode };

function failure(errorCode: AlertActionErrorCode, status: number) {
  return data({ success: false, errorCode } satisfies AlertActionResult, { status });
}

function readNumber(formData: FormData, name: string): number | undefined {
  const raw = formData.get(name)?.toString().trim();
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Values outside the bounds are rejected rather than clamped: a silently
 * changed interval is worse than telling the operator what the limits are.
 */
function inRange(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && value >= min && value <= max;
}

export async function alertsAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const alerts = context.get(alertsContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  await alerts.ready();

  const formData = await request.formData();
  switch (formData.get("action_id")?.toString()) {
    case "save_channel": {
      const enabled = formData.get("enabled")?.toString() === "true";
      const webhookUrl = formData.get("webhook_url")?.toString().trim() ?? "";
      const secret = formData.get("secret")?.toString() ?? "";

      if (webhookUrl.length > 0 && !isValidAlertWebhookUrl(webhookUrl)) {
        return failure("invalidUrl", 400);
      }
      if (enabled && !isValidAlertWebhookUrl(webhookUrl)) {
        return failure("notConfigured", 400);
      }

      const result = await alerts.update({ enabled, webhookUrl, secret });
      return result.success
        ? data({ success: true, kind: "save" } satisfies AlertActionResult)
        : failure("writeFailed", 500);
    }

    case "save_events": {
      const events = formData
        .getAll("events")
        .map((value) => value.toString())
        .filter(isAlertEventId) as AlertEventId[];
      const interval = readNumber(formData, "interval");
      const cooldown = readNumber(formData, "cooldown");
      const expiry = readNumber(formData, "api_key_expiry_days");

      if (!inRange(interval, ALERT_INTERVAL_MIN_SECONDS, ALERT_INTERVAL_MAX_SECONDS)) {
        return failure("invalidInterval", 400);
      }
      if (!inRange(cooldown, ALERT_COOLDOWN_MIN_SECONDS, ALERT_COOLDOWN_MAX_SECONDS)) {
        return failure("invalidCooldown", 400);
      }
      if (!inRange(expiry, ALERT_EXPIRY_WINDOW_MIN_DAYS, ALERT_EXPIRY_WINDOW_MAX_DAYS)) {
        return failure("invalidExpiry", 400);
      }
      if (events.length === 0) {
        return failure("noEvents", 400);
      }

      const result = await alerts.update({
        events,
        intervalSeconds: interval,
        cooldownSeconds: cooldown,
        apiKeyExpiryDays: expiry,
      });

      return result.success
        ? data({ success: true, kind: "save" } satisfies AlertActionResult)
        : failure("writeFailed", 500);
    }

    case "test": {
      // Unsaved edits in the form are what the operator wants to try, so the
      // posted channel values win over the stored ones when they are present.
      const postedUrl = formData.get("webhook_url")?.toString().trim() ?? "";
      const postedSecret = formData.get("secret")?.toString();
      const stored = alerts.settings();

      const webhookUrl = postedUrl.length > 0 ? postedUrl : stored.webhookUrl;
      if (!isValidAlertWebhookUrl(webhookUrl)) {
        return failure("notConfigured", 400);
      }

      const outcome = await alerts.test({
        webhookUrl,
        secret: postedUrl.length > 0 ? (postedSecret ?? stored.secret) : stored.secret,
      });

      return data(
        {
          success: true,
          kind: "test",
          ok: outcome.ok,
          status: outcome.status,
          error: outcome.error,
        } satisfies AlertActionResult,
        { status: outcome.ok ? 200 : 502 },
      );
    }

    default: {
      return failure("invalidAction", 400);
    }
  }
}
