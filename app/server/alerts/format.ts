// MARK: Alert webhook formats
//
// Turns one alert payload into the JSON body a chat platform documents. The
// payload itself is the source of truth: the generic format returns it
// untouched (so existing consumers keep receiving exactly what they receive
// today), and every other format wraps the same title, summary, details,
// timestamp and version in that platform's message shape.
//
// The renderers are pure and take the localized presentation alongside the raw
// payload, so no English prose lives here and the notification-language setting
// reaches every format. No dependency is used: each shape is built by hand from
// the platform's documented wire format.

import { translate } from "~/i18n";
import {
  alertPresentation,
  type AlertPresentation,
  type AlertPresentationOptions,
} from "~/routes/settings/notifications/alert-presentation";
import type { Locale } from "~/utils/locale";

import type { AlertPayload } from "./payload";
import { resolveAlertLanguage } from "./settings";
import type { AlertSettings, AlertSeverity, AlertWebhookFormat } from "./types";

/** Feishu card header colours, one per severity so the card reads at a glance. */
const FEISHU_TEMPLATES: Record<AlertSeverity, string> = {
  info: "blue",
  warning: "orange",
  critical: "red",
};

/** Discord embed colours, as decimal RGB. */
const DISCORD_COLORS: Record<AlertSeverity, number> = {
  info: 0x3498db,
  warning: 0xe67e22,
  critical: 0xed4245,
};

/**
 * WeCom truncates long messages, so the markdown stays a set of short lines and
 * is cut — with an ellipsis — before the platform would drop it wholesale.
 */
export const WECOM_CONTENT_LIMIT = 600;

export interface AlertFormatContext extends AlertPresentationOptions {
  /** The locale the payload was written in; the rendered body uses the same. */
  locale: Locale;
}

/** The `title` a platform shows in its own notification list. */
function headline(presentation: AlertPresentation): string {
  return `${presentation.icon} ${presentation.title}`;
}

/** `**Label**: value` lines, which every markdown platform renders compactly. */
function labelledLines(presentation: AlertPresentation): string[] {
  return presentation.lines.map((line) => `**${line.label}**: ${line.value}`);
}

function markdownLink(presentation: AlertPresentation): string[] {
  return presentation.link === undefined
    ? []
    : [`[${presentation.link.label}](${presentation.link.url})`];
}

/**
 * DingTalk robot markdown: a `title` for the notification preview and a `text`
 * body that renders a heading, a blockquote and emoji. No actionCard is used —
 * the message has to stay readable without buttons.
 */
function dingtalkRequest(presentation: AlertPresentation): unknown {
  const text = [
    `### ${headline(presentation)}`,
    `> ${presentation.summary}`,
    labelledLines(presentation).join("\n"),
    presentation.context,
    markdownLink(presentation).join("\n"),
  ]
    .filter((block) => block.length > 0)
    .join("\n\n");

  return {
    msgtype: "markdown",
    markdown: {
      title: headline(presentation),
      text,
    },
  };
}

/**
 * WeCom group robot markdown: the body lives in `content`, one short line per
 * fact, because the platform truncates long messages.
 */
function wecomRequest(presentation: AlertPresentation): unknown {
  const content = [
    `## ${headline(presentation)}`,
    presentation.summary,
    labelledLines(presentation).join("\n"),
    presentation.context,
    markdownLink(presentation).join("\n"),
  ]
    .filter((block) => block.length > 0)
    .join("\n");

  return {
    msgtype: "markdown",
    markdown: {
      content:
        content.length > WECOM_CONTENT_LIMIT
          ? `${content.slice(0, WECOM_CONTENT_LIMIT - 1)}…`
          : content,
    },
  };
}

/**
 * Feishu custom-bot interactive card: a header coloured by severity, a body
 * element with one line per fact, and a note for the context line.
 */
function feishuRequest(presentation: AlertPresentation): unknown {
  const body = [
    presentation.summary,
    ...labelledLines(presentation),
    ...markdownLink(presentation),
  ].join("\n");

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: FEISHU_TEMPLATES[presentation.severity],
        title: { tag: "plain_text", content: headline(presentation) },
      },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: body } },
        {
          tag: "note",
          elements: [{ tag: "plain_text", content: presentation.context }],
        },
      ],
    },
  };
}

/** Slack: a plain-text fallback plus the header/section/context blocks. */
function slackRequest(presentation: AlertPresentation): unknown {
  const details = [
    presentation.summary,
    ...labelledLines(presentation),
    ...(presentation.link === undefined
      ? []
      : [`<${presentation.link.url}|${presentation.link.label}>`]),
  ].join("\n");

  return {
    text: presentation.text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: headline(presentation), emoji: true },
      },
      { type: "section", text: { type: "mrkdwn", text: details } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: presentation.context }],
      },
    ],
  };
}

/**
 * Discord: `content` for the preview, one embed with fields for the facts. Its
 * Time and Version fields are the context line, which is the shape its own
 * webhook documents.
 */
function discordRequest(presentation: AlertPresentation, locale: Locale): unknown {
  const fields = [
    ...presentation.lines.map((line) => ({
      name: line.label,
      value: line.value,
      inline: true,
    })),
    {
      name: translate(locale, "settings.notifications.alert.lineTime"),
      value: presentation.time,
      inline: true,
    },
    {
      name: translate(locale, "settings.notifications.alert.lineVersion"),
      value: presentation.version,
      inline: true,
    },
    ...(presentation.link === undefined
      ? []
      : [
          {
            name: translate(locale, "settings.notifications.alert.lineLink"),
            value: `[${presentation.link.label}](${presentation.link.url})`,
            inline: false,
          },
        ]),
  ];

  return {
    content: headline(presentation),
    embeds: [
      {
        title: headline(presentation),
        description: presentation.summary,
        color: DISCORD_COLORS[presentation.severity],
        fields,
      },
    ],
  };
}

/**
 * The JSON body one alert is POSTed as. `generic` is the payload itself, so
 * `JSON.stringify` produces the same bytes as before this setting existed.
 */
export function alertRequestBody(
  format: AlertWebhookFormat,
  payload: AlertPayload,
  context: AlertFormatContext,
): unknown {
  if (format === "generic") {
    return payload;
  }

  const presentation = alertPresentation(payload, context.locale, context);

  switch (format) {
    case "dingtalk": {
      return dingtalkRequest(presentation);
    }
    case "wecom": {
      return wecomRequest(presentation);
    }
    case "feishu": {
      return feishuRequest(presentation);
    }
    case "slack": {
      return slackRequest(presentation);
    }
    case "discord": {
      return discordRequest(presentation, context.locale);
    }
    default: {
      // A format that is not one of the known ones — an older stored document,
      // a hand-edited store — must still produce a body. The receiver gets the
      // generic payload instead of the literal `undefined`.
      return payload;
    }
  }
}

/** The body for the channel's stored format, in the channel's own language. */
export function alertRequestBodyForSettings(
  settings: AlertSettings,
  payload: AlertPayload,
  options: AlertPresentationOptions = {},
): unknown {
  return alertRequestBody(settings.webhookFormat, payload, {
    ...options,
    locale: resolveAlertLanguage(settings.notificationLanguage),
  });
}
