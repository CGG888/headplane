import type { TranslationKey } from "~/i18n";
// Type-only, so the browser bundle never pulls a server module in.
import type { AlertEventId } from "~/server/alerts/types";

/** The order the events card lists them in; must match the server's event ids. */
export const ALERT_EVENT_ORDER = [
  "headscaleUnreachable",
  "headscaleRecovered",
  "nodeOffline",
  "nodeOnline",
  "apiKeyExpiring",
  "configCheckFailed",
  "derpSyncFailed",
] as const satisfies readonly AlertEventId[];

/**
 * Localized label for every reportable event. A Test delivery is not a
 * reportable event and is labelled by its alert message instead.
 */
export const ALERT_EVENT_KEYS: Record<AlertEventId, TranslationKey> = {
  headscaleUnreachable: "settings.notifications.eventHeadscaleUnreachable",
  headscaleRecovered: "settings.notifications.eventHeadscaleRecovered",
  nodeOffline: "settings.notifications.eventNodeOffline",
  nodeOnline: "settings.notifications.eventNodeOnline",
  apiKeyExpiring: "settings.notifications.eventApiKeyExpiring",
  configCheckFailed: "settings.notifications.eventConfigCheckFailed",
  derpSyncFailed: "settings.notifications.eventDerpSyncFailed",
};
