// MARK: Alert messages
//
// The human-readable half of a notification: which catalog entries carry an
// event's title and body, and how the structured `target`/`threshold` become
// `{placeholders}`. There is no English prose in here, and no server import, so
// the webhook payload and the delivery history render the same sentences in
// whatever language the reader or the operator selected.

import { translate, type TranslationKey, type Vars } from "~/i18n";
// Type-only, so the browser bundle never pulls a server module in.
import type { AlertHistoryEventId } from "~/server/alerts/types";
import type { Locale } from "~/utils/locale";

export interface AlertMessageKeys {
  title: TranslationKey;
  body: TranslationKey;
}

/**
 * The DERP region mirror reports through the address-sync event with a tagged
 * reason, because both write the same DERP map files. The tag is the only thing
 * that tells the two runs apart, and it is a stable part of the stored target.
 */
export const DERP_MIRROR_TARGET_PREFIX = "derp-region-mirror:";

const MIRROR_MESSAGE_KEYS: AlertMessageKeys = {
  title: "settings.notifications.alert.derpMirrorFailed.title",
  body: "settings.notifications.alert.derpMirrorFailed.body",
};

const SYNC_MESSAGE_KEYS: AlertMessageKeys = {
  title: "settings.notifications.alert.derpSyncFailed.title",
  body: "settings.notifications.alert.derpSyncFailed.body",
};

const MESSAGE_KEYS: Record<AlertHistoryEventId, AlertMessageKeys> = {
  headscaleUnreachable: {
    title: "settings.notifications.alert.headscaleUnreachable.title",
    body: "settings.notifications.alert.headscaleUnreachable.body",
  },
  headscaleRecovered: {
    title: "settings.notifications.alert.headscaleRecovered.title",
    body: "settings.notifications.alert.headscaleRecovered.body",
  },
  nodeOffline: {
    title: "settings.notifications.alert.nodeOffline.title",
    body: "settings.notifications.alert.nodeOffline.body",
  },
  nodeOnline: {
    title: "settings.notifications.alert.nodeOnline.title",
    body: "settings.notifications.alert.nodeOnline.body",
  },
  apiKeyExpiring: {
    title: "settings.notifications.alert.apiKeyExpiring.title",
    body: "settings.notifications.alert.apiKeyExpiring.body",
  },
  configCheckFailed: {
    title: "settings.notifications.alert.configCheckFailed.title",
    body: "settings.notifications.alert.configCheckFailed.body",
  },
  derpSyncFailed: SYNC_MESSAGE_KEYS,
  test: {
    title: "settings.notifications.alert.test.title",
    body: "settings.notifications.alert.test.body",
  },
};

/** The event an alert message is about, with whatever structured detail it has. */
export interface AlertMessageEvent {
  id: AlertHistoryEventId;
  /** A node name, an API key prefix, a check id, or a tagged failure reason. */
  target?: string;
  /** Numeric detail, e.g. the expiry window in days. */
  threshold?: number;
}

/** The catalog entries one event's message is built from. */
export function alertMessageKeys(
  event: Pick<AlertMessageEvent, "id" | "target">,
): AlertMessageKeys {
  if (
    event.id === "derpSyncFailed" &&
    event.target !== undefined &&
    event.target.startsWith(DERP_MIRROR_TARGET_PREFIX)
  ) {
    return MIRROR_MESSAGE_KEYS;
  }

  return MESSAGE_KEYS[event.id];
}

/** The `{placeholders}` a message may interpolate, taken from the event itself. */
export function alertMessageVars(event: Pick<AlertMessageEvent, "target" | "threshold">): Vars {
  const vars: Vars = {};
  if (event.target !== undefined) {
    vars.target = event.target;
  }
  if (event.threshold !== undefined) {
    vars.threshold = event.threshold;
  }

  return vars;
}

export interface AlertMessage {
  title: string;
  body: string;
}

/** The localized title and body for one event, in the requested locale. */
export function alertMessage(locale: Locale, event: AlertMessageEvent): AlertMessage {
  const keys = alertMessageKeys(event);
  const vars = alertMessageVars(event);

  return {
    title: translate(locale, keys.title, vars),
    body: translate(locale, keys.body, vars),
  };
}
