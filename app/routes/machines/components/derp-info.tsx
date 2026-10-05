import { Radio } from "lucide-react";

import Link from "~/components/link";
import { SettingsStatus } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import {
  type RelayAddressFamily,
  type RelayAddressVerdict,
  type RelayHostView,
  type RelayResolution,
} from "~/server/relay-dns";
import type { HostInfo } from "~/types";
import cn from "~/utils/cn";

import {
  buildDerpInfo,
  embeddedDerpRegion,
  formatDerpLatency,
  resolveDerpRegionLabel,
  type DerpEmbeddedServer,
  type DerpRegionLabel,
  type DerpRegionLabelSources,
  type DerpRegionNameData,
} from "../derp-info";
import { type RelayAddressLine, type RelayFamilyReason } from "../relay-verdicts";
import MachineAttribute from "./attribute";
import CopyValue from "./copy-value";
import MachineCard from "./machine-card";
import RelayResolver from "./relay-resolver";

interface DerpInfoProps {
  /** Whether the Headplane Agent feature is enabled at all. */
  agentEnabled: boolean;
  /** Whether this viewer may re-resolve the relay hostname; see the relay DNS settings. */
  canRefresh: boolean;
  /** Region names the loader resolved: the manual mapping and the configured maps. */
  regions: DerpRegionNameData;
  /** Headscale's embedded DERP configuration, when it could be read. */
  server: DerpEmbeddedServer | undefined;
  /** The agent's host info for this machine, when it reported any. */
  stats: HostInfo | undefined;
  /** The host and port clients dial, derived from Headscale's server_url. */
  relay: RelayHostView | undefined;
  /** The relay hostname's A and AAAA records, when the lookup ran. */
  relayResolution: RelayResolution | undefined;
  /** Per-family address lines, prepared by the loader. */
  relayLines: readonly RelayAddressLine[];
  /** Whether an empty family is only the host's own resolver speaking. */
  relaySuggestsConfigured: boolean;
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

/** The one-line fix for a declared address clients cannot actually reach. */
const RELAY_FIX_KEYS: Record<
  RelayAddressFamily,
  Partial<Record<RelayAddressVerdict, TranslationKey>>
> = {
  ipv4: {
    "declared-but-not-resolved": "machines.detail.derp.relayFixIpv4",
    "no-records": "machines.detail.derp.relayFixIpv4",
  },
  ipv6: {
    "declared-but-not-resolved": "machines.detail.derp.relayFixIpv6",
    "no-records": "machines.detail.derp.relayFixIpv6NoRecords",
  },
};

/**
 * The verdict printed under one address line: only what the address cannot say
 * itself, so a family the lookup merely confirmed is never announced twice.
 *
 * The verdict is prepared by the loader, so the client bundle never imports the
 * server relay module that decides it. `host` is the resolved hostname, so a
 * hint can quote the exact `dig` command an operator has to run instead of
 * describing it.
 */
function RelayVerdict({ line, host }: { line: RelayAddressLine; host?: string }) {
  const { t } = useI18n();
  if (line.verdict === undefined || line.addresses.length === 0) {
    return undefined;
  }

  const verdict = line.verdict;
  const fix = RELAY_FIX_KEYS[line.family][verdict];
  const needsAttention = verdict === "declared-but-not-resolved" || verdict === "no-records";
  const address = line.addresses[0] ?? "";

  return (
    <span
      className={cn(
        "text-xs",
        needsAttention ? "text-amber-700 dark:text-amber-300" : "text-mist-500 dark:text-mist-400",
      )}
    >
      {t(RELAY_VERDICT_KEYS[verdict], { address })}
      {fix ? ` · ${t(fix, { host: host ?? "", address })}` : undefined}
    </span>
  );
}

export default function DerpInfo({
  agentEnabled,
  canRefresh,
  regions,
  server,
  stats,
  relay,
  relayResolution,
  relayLines,
  relaySuggestsConfigured,
}: DerpInfoProps) {
  const { t } = useI18n();
  const unknown = t("machines.detail.derp.unknown");
  const embedded = embeddedDerpRegion(server);
  const sources: DerpRegionLabelSources = { ...regions, embedded };
  const view = buildDerpInfo(stats, server, unknown, regions);

  const latency = view.latencies.rows
    .map((row) => `${row.label} · ${formatDerpLatency(row.seconds)}`)
    .join("\n");

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
                        value={address}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-mist-500 dark:text-mist-400">
                      {emptyLine(line)}
                    </span>
                  )}
                  <RelayVerdict host={relayResolution?.host} line={line} />
                </div>
              ))}
            </div>
            <RelayResolver
              canRefresh={canRefresh}
              className="mt-1"
              resolution={relayResolution}
              suggestsConfigured={relaySuggestsConfigured}
            />
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
