import Attribute from "~/components/attribute";
import Card from "~/components/card";
import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import type { HostInfo } from "~/types";

import {
  buildDerpInfo,
  embeddedDerpRegion,
  formatDerpLatency,
  regionLabel,
  type DerpEmbeddedServer,
  type DerpRegionLabel,
  type DerpRegionNames,
} from "../derp-info";

interface DerpInfoProps {
  /** Whether the Headplane Agent feature is enabled at all. */
  agentEnabled: boolean;
  /** Manual region id -> name mapping from Headplane's data directory. */
  regionNames: DerpRegionNames;
  /** Headscale's embedded DERP configuration, when it could be read. */
  server: DerpEmbeddedServer | undefined;
  /** The agent's host info for this machine, when it reported any. */
  stats: HostInfo | undefined;
}

/** `#999 · headscale (embedded DERP)` so the operator sees their own relay. */
function markedLabel(label: DerpRegionLabel, marker: string) {
  return label.isEmbedded ? `${label.label} (${marker})` : label.label;
}

export default function DerpInfo({ agentEnabled, regionNames, server, stats }: DerpInfoProps) {
  const { t } = useI18n();
  const unknown = t("machines.detail.derp.unknown");
  const embedded = embeddedDerpRegion(server);
  const view = buildDerpInfo(stats, server, unknown, regionNames);

  const latency = view.latencies.rows
    .map(
      (row) =>
        `${regionLabel(row.regionId, embedded, unknown, regionNames).label} · ${formatDerpLatency(row.seconds)}`,
    )
    .join("\n");

  return (
    <section>
      <h2 className="mt-8 text-xl font-medium">{t("machines.detail.derp.title")}</h2>
      <p className="mb-4">{t("machines.detail.derp.body")}</p>
      {!agentEnabled ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {t("machines.detail.derp.agentRequired")}
        </p>
      ) : !view.hasRelayData ? (
        <p className="py-2 text-sm opacity-70">{t("machines.detail.derp.empty")}</p>
      ) : (
        <Card
          className="grid w-full max-w-full grid-cols-1 gap-y-2 sm:gap-x-12 lg:grid-cols-2"
          variant="flat"
        >
          <div className="flex flex-col gap-1">
            <Attribute
              name={t("machines.detail.derp.homeRegion")}
              value={markedLabel(view.home, t("machines.detail.derp.embeddedMarker"))}
            />
            <Attribute
              name={t("machines.detail.derp.preferredRegion")}
              value={markedLabel(view.preferred, t("machines.detail.derp.embeddedMarker"))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Attribute
              name={t("machines.detail.derp.latency")}
              value={
                view.latencies.rows.length === 0 ? t("machines.detail.derp.noLatency") : latency
              }
            />
            {view.latencies.hidden > 0 ? (
              <p className="text-sm opacity-70">
                {t("machines.detail.derp.latencyMore", { count: view.latencies.hidden })}
              </p>
            ) : undefined}
            {view.hasIdOnlyRegions ? (
              <p className="text-sm opacity-70">{t("machines.detail.derp.idsOnly")}</p>
            ) : undefined}
          </div>
        </Card>
      )}
      <p className="mt-2 text-sm text-mist-600 dark:text-mist-300">
        {server?.enabled ? (
          t("machines.detail.derp.embeddedEnabled", {
            region: regionLabel(server.regionId, embedded, unknown, regionNames).label,
          })
        ) : (
          <>
            {t("machines.detail.derp.embeddedDisabled")}{" "}
            <Link className="font-medium" to="/settings/headscale">
              {t("machines.detail.derp.embeddedSettingsLink")}
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
