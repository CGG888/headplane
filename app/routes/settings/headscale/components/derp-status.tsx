import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";

import type { DerpRelayRow } from "../derp-status";

interface DerpStatusProps {
  agentEnabled: boolean;
  rows: DerpRelayRow[];
}

function Region({ region, fallback }: { region: number | undefined; fallback: string }) {
  if (region === undefined) {
    return <span className="opacity-60">{fallback}</span>;
  }

  return <span className="font-mono">#{region}</span>;
}

export default function DerpStatus({ agentEnabled, rows }: DerpStatusProps) {
  const { t } = useI18n();

  return (
    <section className="w-full sm:w-2/3">
      <h2 className="mt-8 text-2xl font-medium">{t("settings.headscale.derp.statusTitle")}</h2>
      <p className="my-2">{t("settings.headscale.derp.statusBody")}</p>

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
                <Region fallback={t("settings.headscale.derp.unknown")} region={row.homeRegion} />
              </span>
              <span className="w-1/5 text-sm">
                <Region
                  fallback={t("settings.headscale.derp.unknown")}
                  region={row.preferredRegion}
                />
              </span>
              <span className="w-1/4 text-right font-mono text-sm">
                {row.latency
                  ? `${row.latency.region} · ${Math.round(row.latency.seconds * 1000)}ms`
                  : t("settings.headscale.derp.noLatency")}
              </span>
            </TableList.Item>
          ))}
        </TableList>
      )}
    </section>
  );
}
