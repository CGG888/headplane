import { Radio } from "lucide-react";

import Link from "~/components/link";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type { RelayHostView, RelayResolution, RelayResolutionReason } from "~/server/relay-dns";
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
  /** The host and port clients dial, derived from Headscale's server_url. */
  relay: RelayHostView | undefined;
  /** The relay hostname's A and AAAA records, when the lookup ran. */
  relayResolution: RelayResolution | undefined;
}

/** `#999 · headscale (embedded DERP)` so the operator sees their own relay. */
function markedLabel(label: DerpRegionLabel, marker: string) {
  return label.isEmbedded ? `${label.label} (${marker})` : label.label;
}

/** Why the relay hostname has no address, as a short clause after the em dash. */
const RELAY_UNAVAILABLE_KEYS: Record<RelayResolutionReason, TranslationKey> = {
  "no-records": "machines.detail.derp.relayReasonNoRecords",
  timeout: "machines.detail.derp.relayReasonTimeout",
  "resolver-error": "machines.detail.derp.relayReasonResolverError",
  "host-missing": "machines.detail.derp.relayReasonHostMissing",
  "invalid-host": "machines.detail.derp.relayReasonInvalidHost",
};

/** One line of a relay block: a muted label over the address clients dial. */
function RelayLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-mist-500 dark:text-mist-400">{label}</span>
      <span className="font-mono text-xs break-all text-mist-900 dark:text-mist-50">{value}</span>
    </div>
  );
}

export default function DerpInfo({
  agentEnabled,
  regionNames,
  server,
  stats,
  relay,
  relayResolution,
}: DerpInfoProps) {
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

  // One reason per hostname: the resolver reports why neither family produced an
  // address, and only one of the two can ever explain the other's absence.
  const relayUnavailable =
    relayResolution === undefined || relayResolution.reason === undefined
      ? t("machines.detail.derp.relayResolvedUnavailable")
      : t(RELAY_UNAVAILABLE_KEYS[relayResolution.reason]);

  const relayRows: { label: string; addresses: string[] }[] = [
    {
      label: t("machines.detail.derp.relayResolvedIpv4"),
      addresses: relayResolution?.ipv4 ?? [],
    },
    {
      label: t("machines.detail.derp.relayResolvedIpv6"),
      addresses: relayResolution?.ipv6 ?? [],
    },
  ];

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
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
          {t("machines.detail.derp.relayAddressTitle")}
        </span>
        {relay ? (
          <div className="flex flex-col gap-1.5">
            <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
              <RelayLine label={t("machines.detail.derp.relayHostname")} value={relay.hostname} />
              <RelayLine label={t("machines.detail.derp.relayPort")} value={String(relay.port)} />
            </div>
            <p className="text-xs text-mist-500 dark:text-mist-400">
              {t("machines.detail.derp.relayResolvedNote")}
            </p>
            <span className="text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
              {t("machines.detail.derp.relayResolvedTitle")}
            </span>
            <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
              {relayRows.map((row) => (
                <div className="flex flex-col gap-0.5" key={row.label}>
                  <span className="text-xs text-mist-500 dark:text-mist-400">{row.label}</span>
                  {row.addresses.length > 0 ? (
                    row.addresses.map((address) => (
                      <span
                        className="font-mono text-xs break-all text-mist-900 dark:text-mist-50"
                        key={address}
                      >
                        {address}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-mist-500 dark:text-mist-400">
                      {relayUnavailable}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-mist-500 dark:text-mist-400">
            {t("machines.detail.derp.relayUnavailable")}
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-mist-100 pt-2.5 dark:border-mist-800">
        {embeddedNote}
      </div>

      <div className="mt-3 border-t border-mist-100 pt-2.5 dark:border-mist-800">
        <span className="text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
          {t("machines.detail.derp.relayMachineTitle")}
        </span>
        {!agentEnabled ? (
          <p className="mt-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {t("machines.detail.derp.agentRequired")}
          </p>
        ) : !view.hasRelayData ? (
          <p className="mt-1 text-sm text-mist-500 dark:text-mist-400">
            {t("machines.detail.derp.empty")}
          </p>
        ) : (
          <div className="mt-1">
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
          </div>
        )}
      </div>
    </MachineCard>
  );
}
