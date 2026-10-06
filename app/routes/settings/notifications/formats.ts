// MARK: Alert webhook formats (page)
//
// The choices the notifications page offers. The values mirror the server's
// `ALERT_WEBHOOK_FORMATS`; only the type is imported from it, so the form stays
// free of server modules.

import type { TranslationKey } from "~/i18n";
// Type-only, so the browser bundle never pulls a server module in.
import type { AlertWebhookFormat } from "~/server/alerts/types";

/** The order the format selector lists them in; must match the server's list. */
export const ALERT_FORMAT_ORDER = [
  "generic",
  "dingtalk",
  "wecom",
  "feishu",
  "slack",
  "discord",
] as const satisfies readonly AlertWebhookFormat[];

export const ALERT_FORMAT_ITEM_KEYS: Record<AlertWebhookFormat, TranslationKey> = {
  generic: "settings.notifications.webhookFormatGeneric",
  dingtalk: "settings.notifications.webhookFormatDingtalk",
  wecom: "settings.notifications.webhookFormatWecom",
  feishu: "settings.notifications.webhookFormatFeishu",
  slack: "settings.notifications.webhookFormatSlack",
  discord: "settings.notifications.webhookFormatDiscord",
};
