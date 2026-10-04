import { Activity } from "lucide-react";

import { SettingsCollapsible } from "~/components/settings-nav";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import {
  parseDerpRegionId,
  regionLabel,
  type DerpEmbeddedServer,
} from "~/routes/machines/derp-info";

import type { DerpRelayRow } from "../derp-status";

interface DerpStatusProps {
  agentEnabled: boolean;
  /** Headscale's embedded DERP configuration, when it could be read. */
  embedded: DerpEmbeddedServer | undefined;
  /** Manual region id -> name mapping from Headplane's data directory. */
  regionNames: Record<string, string>;
  rows: DerpRelayRow[];
}

function Region({
  embedded,
  fallback,
  names,
  region,
}: {
  embedded: DerpEmbeddedServer | undefined;
  fallback: string;
  names: Record<string, string>;
  region: number | undefined;
}) {
  if (region === undefined) {
    return <span className="opacity-60">{fallback}</span>;
  }

  return <span className="font-mono">{regionLabel(region, embedded, fallback, names).label}</span>;
}

/** The agent reports latency keys as strings, so numeric ones are labelled. */
function latencyLabel(
  region: string,
  embedded: DerpEmbeddedServer | undefined,
  names: Record<string, string>,
  fallback: string,
): string {
  const id = parseDerpRegionId(region);
  return id === undefined ? region : regionLabel(id, embedded, fallback, names).label;
}

export default function DerpStatus({ agentEnabled, embedded, regionNames, rows }: DerpStatusProps) {
  const { t } = useI18n();
  const fallback = t("settings.headscale.derp.unknown");

  return (
    <SettingsCollapsible
      description={t("settings.headscale.derp.statusBody")}
      icon={Activity}
      status={{
        tone: !agentEnabled ? "warn" : rows.length > 0 ? "ok" : "neutral",
        label: agentEnabled
          ? t("settings.headscale.derp.relayMachineCount", { count: rows.length })
          : t("settings.headscale.statusAgentRequired"),
      }}
      title={t("settings.headscale.derp.statusTitle")}
    >
      {!agentEnabled ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {t("settings.headscale.derp.statusAgentRequired")}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm opacity-70">{t("settings.headscale.derp.statusEmpty")}</p>
      ) : (
        <TableList>
          <TableList.Item className="text-sm font-semibold opacity-70">
            <span className="w-1/3">{t("settings.headscale.derp.machine")}</span>
            <span className="w-1/5">{t("settings.headscale.derp.homeRegion")}</span>
            <span className="w-1/5">{t("settings.headscale.derp.preferredRegion")}</span>
            <span className="w-1/4 text-right">{t("settings.headscale.derp.latency")}</span>
          </TableList.Item>
          {rows.map((row) => (
            <TableList.Item key={row.nodeKey}>
              <span className="w-1/3 truncate text-sm">{row.name}</span>
              <span className="w-1/5 text-sm">
                <Region
                  embedded={embedded}
                  fallback={fallback}
                  names={regionNames}
                  region={row.homeRegion}
                />
              </span>
              <span className="w-1/5 text-sm">
                <Region
                  embedded={embedded}
                  fallback={fallback}
                  names={regionNames}
                  region={row.preferredRegion}
                />
              </span>
              <span className="w-1/4 text-right font-mono text-sm">
                {row.latency
                  ? `${latencyLabel(row.latency.region, embedded, regionNames, fallback)} · ${Math.round(row.latency.seconds * 1000)}ms`
                  : t("settings.headscale.derp.noLatency")}
              </span>
            </TableList.Item>
          ))}
        </TableList>
      )}
    </SettingsCollapsible>
  );
}
