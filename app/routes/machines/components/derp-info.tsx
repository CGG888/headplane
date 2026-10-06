import { Radio } from "lucide-react";

import Link from "~/components/link";
import { SettingsStatus } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type { DerpNodeSourceKind } from "~/routes/overview-helpers";
import { type RelayAddressVerdict, type RelayHostView } from "~/server/relay-dns";
import type { HostInfo } from "~/types";

import {
  buildDerpInfo,
  buildMachineRelayUse,
  embeddedDerpRegion,
  resolveDerpRegionLabel,
  type DerpEmbeddedServer,
  type DerpRegionLabel,
  type DerpRegionLabelSources,
  type DerpRegionNameData,
  type MachineRelayUse,
} from "../derp-info";
import { type RelayAddressLine, type RelayFamilyReason } from "../relay-verdicts";
import MachineAttribute from "./attribute";
import CopyValue from "./copy-value";
import MachineCard from "./machine-card";

interface DerpInfoProps {
  /** Whether the Headplane Agent feature is enabled at all. */
  agentEnabled: boolean;
  /** Region names the loader resolved: the manual mapping and the configured maps. */
  regions: DerpRegionNameData;
  /** Which configured source serves each region, prepared by the loader. */
  relaySources: Readonly<Record<string, DerpNodeSourceKind>>;
  /** Headscale's embedded DERP configuration, when it could be read. */
  server: DerpEmbeddedServer | undefined;
  /** The agent's host info for this machine, when it reported any. */
  stats: HostInfo | undefined;
  /** The host and port clients dial, derived from Headscale's server_url. */
  relay: RelayHostView | undefined;
  /** Per-family address lines, prepared by the loader. */
  relayLines: readonly RelayAddressLine[];
}

/** `#999 · headscale (embedded DERP)` so the operator sees their own relay. */
function markedLabel(label: DerpRegionLabel, marker: string) {
  return label.isEmbedded ? `${label.label} (${marker})` : label.label;
}

/** Why a family has no address, as the one short line its row reads as. */
const RELAY_REASON_KEYS: Record<RelayFamilyReason, TranslationKey> = {
  "no-records": "machines.detail.derp.relayReasonNoRecords",
  timeout: "machines.detail.derp.relayReasonTimeout",
  "resolver-error": "machines.detail.derp.relayReasonResolverError",
  "host-missing": "machines.detail.derp.relayReasonHostMissing",
  "invalid-host": "machines.detail.derp.relayReasonInvalidHost",
  unavailable: "machines.detail.derp.relayResolvedUnavailable",
};

/** What the declared address and the resolved records say to each other. */
const RELAY_VERDICT_KEYS: Record<RelayAddressVerdict, TranslationKey> = {
  matches: "machines.detail.derp.relayVerdictMatch",
  "declared-but-not-resolved": "machines.detail.derp.relayVerdictMismatch",
  "no-records": "machines.detail.derp.relayVerdictNoRecords",
  "resolver-unavailable": "machines.detail.derp.relayVerdictUnavailable",
  "host-missing": "machines.detail.derp.relayVerdictHostMissing",
  literal: "machines.detail.derp.relayVerdictLiteral",
};

/** Which configured source serves a relay, worded like the Overview node card. */
const RELAY_SOURCE_KEYS: Record<DerpNodeSourceKind, TranslationKey> = {
  embedded: "machines.detail.derp.relaySourceEmbedded",
  local: "machines.detail.derp.relaySourceLocal",
  mirror: "machines.detail.derp.relaySourceMirror",
  official: "machines.detail.derp.relaySourceOfficial",
};

export default function DerpInfo({
  agentEnabled,
  regions,
  relaySources,
  server,
  stats,
  relay,
  relayLines,
}: DerpInfoProps) {
  const { t } = useI18n();
  const unknown = t("machines.detail.derp.unknown");
  const embedded = embeddedDerpRegion(server);
  const sources: DerpRegionLabelSources = { ...regions, embedded };
  const view = buildDerpInfo(stats, server, unknown, regions);
  const usage = buildMachineRelayUse(stats, view, relaySources);
  const embeddedMarker = t("machines.detail.derp.embeddedMarker");

  // The verdict of a declared address is hover text now, never a sentence under
  // the row: the address is what the row is for, and a value the lookup could
  // not confirm still has to read as the address the configuration declares.
  const addressTitle = (line: RelayAddressLine) =>
    line.verdict === undefined || line.addresses.length === 0
      ? undefined
      : t(RELAY_VERDICT_KEYS[line.verdict], { address: line.addresses[0] ?? "" });

  const sourceBadge = (source: DerpNodeSourceKind | undefined) =>
    source === undefined ? undefined : (
      <SettingsStatus tone={source === "official" ? "warn" : "neutral"}>
        {t(RELAY_SOURCE_KEYS[source])}
      </SettingsStatus>
    );

  /** The badges of one relay row: what serves it, and whether it is the used one. */
  const relayBadges = (row: MachineRelayUse) => {
    const source = sourceBadge(row.source);
    if (source === undefined && !row.inUse) {
      return undefined;
    }

    return (
      <>
        {row.inUse ? (
          <SettingsStatus tone="ok">{t("machines.detail.derp.relayInUse")}</SettingsStatus>
        ) : undefined}
        {source}
      </>
    );
  };

  // Both families are one line each, exactly as the loader prepared them: the
  // address `derp.server` declares when it sets one, the lookup's own answer
  // otherwise, and — when neither exists — the single short reason why.
  const familyLabel = (family: RelayAddressLine["family"]) =>
    family === "ipv4" ? t("machines.detail.derp.relayIpv4") : t("machines.detail.derp.relayIpv6");

  const emptyLine = (line: RelayAddressLine) =>
    line.verdict === undefined
      ? t(RELAY_REASON_KEYS[line.reason ?? "unavailable"])
      : t(RELAY_VERDICT_KEYS[line.verdict], { address: line.addresses[0] ?? "" });

  const embeddedNote = (
    <p className="text-sm text-mist-600 dark:text-mist-400">
      {server?.enabled ? (
        t("machines.detail.derp.embeddedEnabled", {
          region: resolveDerpRegionLabel(server.regionId, sources, unknown).label,
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
            <span className="font-mono text-xs break-all text-mist-900 dark:text-mist-50">
              {relay.endpoint}
            </span>
            <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
              {relayLines.map((line) => (
                <div className="flex flex-col gap-0.5" key={line.family}>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-mist-500 dark:text-mist-400">
                    {familyLabel(line.family)}
                    {line.source === "declared" ? (
                      <SettingsStatus tone="neutral">
                        {t("machines.detail.derp.relayDeclaredMarker")}
                      </SettingsStatus>
                    ) : undefined}
                  </span>
                  {line.addresses.length > 0 ? (
                    line.addresses.map((address) => (
                      <CopyValue
                        className="w-auto"
                        copiedMessage={t("common.copied")}
                        key={address}
                        reveal="always"
                        title={addressTitle(line)}
                        value={address}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-mist-500 dark:text-mist-400">
                      {emptyLine(line)}
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
                badges={relayBadges(usage.home)}
                name={t("machines.detail.derp.homeRegion")}
                value={markedLabel(view.home, embeddedMarker)}
              />
              <MachineAttribute
                badges={relayBadges(usage.preferred)}
                name={t("machines.detail.derp.preferredRegion")}
                value={markedLabel(view.preferred, embeddedMarker)}
              />
              <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className="text-mist-600 dark:text-mist-400">
                  {t("machines.detail.derp.latency")}
                </dt>
                <dd className="min-w-0">
                  {usage.latencies.length === 0 ? (
                    <span className="text-mist-500 dark:text-mist-400">
                      {t("machines.detail.derp.noLatency")}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {usage.latencies.map((row) => (
                        <li
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                          key={row.key}
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span
                              className="min-w-0 truncate text-mist-900 dark:text-mist-50"
                              title={row.label}
                            >
                              {row.label}
                            </span>
                            {relayBadges(row)}
                          </span>
                          {row.latency === undefined ? undefined : (
                            <span className="font-mono text-xs text-mist-500 tabular-nums dark:text-mist-400">
                              {row.latency}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
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
