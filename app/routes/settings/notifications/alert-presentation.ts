// MARK: Alert presentation
//
// The human-facing half of a webhook delivery, as a platform-neutral model: an
// accent icon, the localized title and summary, one short labelled line per
// structured detail, a context line carrying the operator's local time and the
// build, and — when Headplane knows its own URL — a link back to the page that
// fixes the situation.
//
// Nothing here formats a chat platform and nothing here touches the filesystem,
// so the same model feeds DingTalk, WeCom, Feishu, Slack, Discord and the
// plain-text fallback, and every sentence still comes from the catalogs. The
// only import from `~/server` is a type, so a component may use this module
// without pulling a server module into the browser bundle.

import { translate, type TranslationKey } from "~/i18n";
// Type-only, so the browser bundle never pulls a server module in.
import type { AlertPayload } from "~/server/alerts/payload";
import type { AlertHistoryEventId, AlertSeverity } from "~/server/alerts/types";
import type { Locale } from "~/utils/locale";

/**
 * The accent each severity is drawn with. Symbols, not prose: they are the same
 * in every language, and the platforms take the colour from the same severity.
 */
export const SEVERITY_ICONS: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "❌",
};

const SEVERITY_NAME_KEYS: Record<AlertSeverity, TranslationKey> = {
  info: "settings.notifications.alert.severityInfo",
  warning: "settings.notifications.alert.severityWarning",
  critical: "settings.notifications.alert.severityCritical",
};

/**
 * What the event's `target` actually names, so the line reads as "Node: alpha"
 * rather than as the raw field on a payload.
 */
const TARGET_LABEL_KEYS: Record<AlertHistoryEventId, TranslationKey> = {
  headscaleUnreachable: "settings.notifications.alert.lineTarget",
  headscaleRecovered: "settings.notifications.alert.lineTarget",
  nodeOffline: "settings.notifications.alert.lineNode",
  nodeOnline: "settings.notifications.alert.lineNode",
  apiKeyExpiring: "settings.notifications.alert.lineApiKey",
  configCheckFailed: "settings.notifications.alert.lineCheck",
  derpSyncFailed: "settings.notifications.alert.lineReason",
  test: "settings.notifications.alert.lineTarget",
};

/** The other structured detail names the payload can carry. */
const DETAIL_LABEL_KEYS: Record<string, TranslationKey> = {
  threshold: "settings.notifications.alert.lineThreshold",
  severity: "settings.notifications.alert.lineSeverity",
};

/** Where a reader has to go to act on each event. */
const LINK_PATHS: Record<AlertHistoryEventId, string> = {
  headscaleUnreachable: "/settings/notifications",
  headscaleRecovered: "/settings/notifications",
  nodeOffline: "/machines",
  nodeOnline: "/machines",
  apiKeyExpiring: "/settings/api-keys",
  configCheckFailed: "/settings/system",
  derpSyncFailed: "/settings/headscale",
  test: "/settings/notifications",
};

/** The fallback when a platform truncates, and for anything unexpected. */
const FALLBACK_DETAIL_KEY: TranslationKey = "settings.notifications.alert.lineDetail";

export interface AlertPresentationLine {
  /** Localized label, e.g. the node label. */
  label: string;
  /** The value as the event reported it. */
  value: string;
}

export interface AlertPresentation {
  /** Accent for the severity, e.g. ⚠️. */
  icon: string;
  /** The severity the accent, the icon and the platform colour are chosen by. */
  severity: AlertSeverity;
  /** Localized title, already wording the event's subject. */
  title: string;
  /** Localized explanation of what happened and what to do. */
  summary: string;
  /** The short labelled lines: severity, the subject, the numeric detail. */
  lines: AlertPresentationLine[];
  /** The observation time in the server's time zone, e.g. `2026/10/06 16:52:55 GMT+8`. */
  time: string;
  /** The build that sent the notification. */
  version: string;
  /** The single-line context string the platforms put last, or in a footer. */
  context: string;
  /** The absolute page that fixes the situation; absent without a base URL. */
  link?: { label: string; url: string };
  /** The whole message as plain text, for platforms that accept a fallback. */
  text: string;
}

export interface AlertPresentationOptions {
  /** Headplane's own base URL. Without it the message simply carries no link. */
  baseUrl?: string;
  /** IANA zone for the human-facing time; defaults to the server's own zone. */
  timeZone?: string;
}

/**
 * Formats an ISO timestamp in the server's time zone. An unusable zone (a
 * hand-edited setting, an odd container) degrades to the runtime's zone instead
 * of throwing, and the raw ISO timestamp stays machine-readable elsewhere.
 */
export function formatAlertLocalTime(iso: string, locale: Locale, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }

  const base: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  };

  try {
    return new Intl.DateTimeFormat(locale, {
      ...base,
      ...(timeZone === undefined || timeZone.length === 0 ? {} : { timeZone }),
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat(locale, base).format(at);
  }
}

/** Joins a base URL and a route path, tolerating a trailing slash on either. */
function alertLinkUrl(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}${__PREFIX__}${path}`;
}

function detailLines(locale: Locale, payload: AlertPayload): AlertPresentationLine[] {
  const lines: AlertPresentationLine[] = [
    {
      label: translate(locale, "settings.notifications.alert.lineSeverity"),
      value: translate(locale, SEVERITY_NAME_KEYS[payload.severity]),
    },
  ];

  for (const [name, value] of Object.entries(payload.details)) {
    const labelKey =
      name === "target"
        ? TARGET_LABEL_KEYS[payload.event]
        : (DETAIL_LABEL_KEYS[name] ?? FALLBACK_DETAIL_KEY);

    lines.push({
      label: translate(locale, labelKey),
      value:
        name === "threshold" && payload.event === "apiKeyExpiring"
          ? translate(locale, "settings.notifications.alert.thresholdDays", { threshold: value })
          : String(value),
    });
  }

  return lines;
}

/**
 * Renders one payload for a human reader: accent, title, summary, one line per
 * detail, the local time and the build, and — with a base URL — a link.
 */
export function alertPresentation(
  payload: AlertPayload,
  locale: Locale,
  options: AlertPresentationOptions = {},
): AlertPresentation {
  const icon = SEVERITY_ICONS[payload.severity];
  const lines = detailLines(locale, payload);
  const time = formatAlertLocalTime(payload.timestamp, locale, options.timeZone);
  const context = translate(locale, "settings.notifications.alert.context", {
    time,
    version: payload.version,
  });

  const baseUrl = options.baseUrl?.trim() ?? "";
  const link =
    baseUrl.length === 0
      ? undefined
      : {
          label: translate(locale, "settings.notifications.alert.linkLabel"),
          url: alertLinkUrl(baseUrl, LINK_PATHS[payload.event]),
        };

  const text = [
    `${icon} ${payload.title}`,
    payload.summary,
    ...lines.map((line) => `${line.label}: ${line.value}`),
    context,
    ...(link === undefined ? [] : [`${link.label}: ${link.url}`]),
  ].join("\n");

  return {
    icon,
    severity: payload.severity,
    title: payload.title,
    summary: payload.summary,
    lines,
    time,
    version: payload.version,
    context,
    ...(link === undefined ? {} : { link }),
    text,
  };
}
