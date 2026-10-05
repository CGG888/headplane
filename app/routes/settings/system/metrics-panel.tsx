import { Activity, FileText } from "lucide-react";

import Code from "~/components/code";
import Notice from "~/components/notice";
import { SettingsCollapsible } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

import {
  formatMetricValue,
  type MetricsGroupId,
  type MetricsReport,
  type MetricsSummary,
} from "./metrics";

const GROUP_LABELS: Record<MetricsGroupId, TranslationKey> = {
  nodes: "settings.system.metrics.groups.nodes",
  users: "settings.system.metrics.groups.users",
  relay: "settings.system.metrics.groups.relay",
  policy: "settings.system.metrics.groups.policy",
  process: "settings.system.metrics.groups.process",
};

/**
 * The read-only metrics tab. Headscale's metrics listener is frequently bound
 * to loopback, which Headplane cannot dial from another container, so every
 * failure renders as an explanation with the derived address rather than an
 * error.
 */
export default function MetricsPanel({ metrics }: { metrics: MetricsReport }) {
  const { t } = useI18n();

  if (metrics.state === "unknown") {
    return (
      <p className="text-sm text-mist-600 dark:text-mist-400">
        {t("settings.system.metrics.unknown")}
      </p>
    );
  }

  if (metrics.state === "disabled") {
    return (
      <p className="text-sm text-mist-600 dark:text-mist-400">
        {t("settings.system.metrics.disabled")}
      </p>
    );
  }

  if (metrics.state === "invalid") {
    return (
      <p className="text-sm text-mist-600 dark:text-mist-400">
        {t("settings.system.metrics.invalid", { value: metrics.raw })}
      </p>
    );
  }

  if (metrics.state === "unreachable") {
    return (
      <Notice title={t("settings.system.metrics.unreachableTitle")} variant="warning">
        {t("settings.system.metrics.unreachable", {
          address: metrics.address,
          url: metrics.url,
        })}
      </Notice>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{t("settings.system.metrics.addressLabel")}:</span>
        <Code>{metrics.address}</Code>
      </div>

      <Summary summary={metrics.summary} />

      <SettingsCollapsible
        description={t("settings.system.metrics.rawDescription")}
        icon={FileText}
        nested
        title={t("settings.system.metrics.rawTitle")}
      >
        <pre className="max-h-96 overflow-auto rounded-lg bg-mist-100 p-3 text-xs whitespace-pre dark:bg-mist-950">
          {metrics.raw}
        </pre>
        {metrics.truncated ? (
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.system.metrics.rawTruncated", { chars: metrics.raw.length })}
          </p>
        ) : undefined}
      </SettingsCollapsible>
    </>
  );
}

/** The curated numbers: process basics first, then the metric families. */
function Summary({ summary }: { summary: MetricsSummary }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      {summary.goroutines !== undefined || summary.uptimeSeconds !== undefined ? (
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {summary.uptimeSeconds !== undefined ? (
            <Metric
              label={t("settings.system.metrics.uptimeLabel")}
              value={formatUptime(t, summary.uptimeSeconds)}
            />
          ) : undefined}
          {summary.goroutines !== undefined ? (
            <Metric
              label={t("settings.system.metrics.goroutinesLabel")}
              value={formatMetricValue(summary.goroutines)}
            />
          ) : undefined}
        </div>
      ) : undefined}

      {summary.groups.map((group) => (
        <div className="flex flex-col gap-2" key={group.id}>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-mist-500 dark:text-mist-400" />
            {t(GROUP_LABELS[group.id])}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {group.families.map((family) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                key={family.name}
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <Code>{family.name}</Code>
                  {family.series > 1 ? (
                    <span className="text-xs text-mist-600 dark:text-mist-400">
                      {t("settings.system.metrics.seriesLabel", { count: family.series })}
                    </span>
                  ) : undefined}
                </span>
                <span className="font-medium tabular-nums">{formatMetricValue(family.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-mist-600 dark:text-mist-400">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function formatUptime(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  seconds: number,
) {
  return t("settings.system.metrics.uptimeValue", {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
  });
}
