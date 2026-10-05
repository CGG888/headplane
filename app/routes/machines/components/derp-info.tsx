import { Radio } from "lucide-react";

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
import MachineAttribute from "./attribute";
import MachineCard from "./machine-card";

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

  const embeddedNote = (
    <p className="text-sm text-mist-600 dark:text-mist-400">
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
  );

  return (
    <MachineCard
      description={t("machines.detail.derp.body")}
      icon={Radio}
      title={t("machines.detail.derp.title")}
    >
      {!agentEnabled ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {t("machines.detail.derp.agentRequired")}
        </p>
      ) : !view.hasRelayData ? (
        <p className="text-sm text-mist-500 dark:text-mist-400">
          {t("machines.detail.derp.empty")}
        </p>
      ) : (
        <>
          <dl className="flex flex-col">
            <MachineAttribute
              name={t("machines.detail.derp.homeRegion")}
              value={markedLabel(view.home, t("machines.detail.derp.embeddedMarker"))}
            />
            <MachineAttribute
              name={t("machines.detail.derp.preferredRegion")}
              value={markedLabel(view.preferred, t("machines.detail.derp.embeddedMarker"))}
            />
            <MachineAttribute
              isCode
              name={t("machines.detail.derp.latency")}
              value={
                view.latencies.rows.length === 0 ? t("machines.detail.derp.noLatency") : latency
              }
            />
          </dl>
          {view.latencies.hidden > 0 ? (
            <p className="mt-1 text-sm text-mist-500 dark:text-mist-400">
              {t("machines.detail.derp.latencyMore", { count: view.latencies.hidden })}
            </p>
          ) : undefined}
          {view.hasIdOnlyRegions ? (
            <p className="mt-1 text-sm text-mist-500 dark:text-mist-400">
              {t("machines.detail.derp.idsOnly")}
            </p>
          ) : undefined}
        </>
      )}
      <div className="mt-2 border-t border-mist-100 pt-2.5 dark:border-mist-800">
        {embeddedNote}
      </div>
    </MachineCard>
  );
}
