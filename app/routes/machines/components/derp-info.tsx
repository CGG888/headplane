import { Radio } from "lucide-react";
import type { ReactNode } from "react";

import Link from "~/components/link";
import MaskedText from "~/components/masked-text";
import { SettingsStatus } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type { DerpNodeSourceKind } from "~/routes/overview-helpers";
import { type RelayAddressVerdict, type RelayHostView } from "~/server/relay-dns";
import type { HostInfo } from "~/types";
import cn from "~/utils/cn";

import {
  buildDerpInfo,
  buildMachineLatencyRows,
  buildMachineRelayUse,
  embeddedDerpRegion,
  resolveDerpRegionLabel,
  type DerpEmbeddedServer,
  type DerpRegionLabel,
  type DerpRegionLabelSources,
  type DerpRegionNameData,
  type MachineLatencyInventory,
  type MachineLatencySource,
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
  /** The regions this deployment serves, and the latencies the server measured. */
  inventory: MachineLatencyInventory;
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

/** Where one latency row's number came from, as its own column reads it. */
const LATENCY_SOURCE_KEYS: Record<MachineLatencySource, TranslationKey> = {
  reported: "machines.detail.derp.latencySourceReported",
  measured: "machines.detail.derp.latencySourceMeasured",
};

/**
 * The keyboard ring the latency list's scroll box carries, the same one the
 * Overview nodes card uses: the box takes focus so the rows a bounded height
 * hides stay reachable without a pointer.
 */
const LATENCY_SCROLL_RING =
  "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1 dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900";

/**
 * Five rows, and not a pixel more: a row is a 20px line (both `text-sm` and the
 * badges read 1.25rem) plus `py-1.5`, so a row past the first is 33px with its
 * divider, the first is 28px because it trims its top padding and the fifth of a
 * longer list is 33px too — 28 + 4 × 33 = 160px, exactly `max-h-40`. The bound
 * therefore shows five whole rows and cuts the sixth off clean (never a row half
 * in view), and when the deployment serves five regions or fewer the box is only
 * as tall as its rows: no scrollbar and no reserved space.
 */
const LATENCY_SCROLL_HEIGHT = "max-h-40";

/**
 * One fact of the relay-address grid: the page's own label/value columns, so the
 * endpoint, IPv4 and IPv6 rows line up with every other definition row. The
 * value is the caller's, because each row is masked and copied by the control
 * that fits it.
 */
function RelayRow({
  label,
  badges,
  children,
}: {
  label: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-mist-600 dark:text-mist-400">
        <span className="min-w-0">{label}</span>
        {badges}
      </dt>
      <dd className="flex min-w-0 flex-col gap-y-0.5">{children}</dd>
    </div>
  );
}

export default function DerpInfo({
  agentEnabled,
  regions,
  relaySources,
  server,
  stats,
  relay,
  relayLines,
  inventory,
}: DerpInfoProps) {
  const { t } = useI18n();
  const unknown = t("machines.detail.derp.unknown");
  const embedded = embeddedDerpRegion(server);
  const sources: DerpRegionLabelSources = { ...regions, embedded };
  const view = buildDerpInfo(stats, server, unknown, regions);
  const usage = buildMachineRelayUse(stats, view, relaySources);
  const latencies = buildMachineLatencyRows({
    info: stats,
    inventory,
    relaySources,
    sources,
    unknown,
  });
  const embeddedMarker = t("machines.detail.derp.embeddedMarker");
  const measuredRegions = latencies.summary.reported + latencies.summary.measured;

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

  const embeddedNote = server?.enabled ? (
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
  );

  return (
    <MachineCard
      // One page-grid column, so the card is exactly as wide as the pair of
      // cards above it; below `lg` it is simply the next full-width row.
      className="lg:col-span-2"
      description={t("machines.detail.derp.body")}
      icon={Radio}
      title={t("machines.detail.derp.title")}
    >
      {/* Two halves, like the pair above: what clients dial on the left, what
          this machine uses on the right. They stack again below `lg`. */}
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col">
          <dl className="flex flex-col">
            <RelayRow label={t("machines.detail.derp.relayAddressTitle")}>
              {relay ? (
                // The client connect address is a hostname and port, so it is
                // masked like every other address until the reader reveals it.
                <MaskedText
                  className="font-mono text-xs text-mist-900 dark:text-mist-50"
                  value={relay.endpoint}
                />
              ) : (
                <span className="text-sm text-mist-500 dark:text-mist-400">
                  {t("machines.detail.derp.relayUnavailable")}
                </span>
              )}
            </RelayRow>

            {relay
              ? relayLines.map((line) => (
                  <RelayRow
                    badges={
                      line.source === "declared" ? (
                        <SettingsStatus tone="neutral">
                          {t("machines.detail.derp.relayDeclaredMarker")}
                        </SettingsStatus>
                      ) : undefined
                    }
                    key={line.family}
                    label={familyLabel(line.family)}
                  >
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
                  </RelayRow>
                ))
              : undefined}
          </dl>

          <p className="mt-2.5 border-t border-mist-100 pt-2.5 text-sm text-mist-600 dark:border-mist-800 dark:text-mist-400">
            {embeddedNote}
          </p>
        </section>

        <section className="flex min-w-0 flex-col lg:border-l lg:border-mist-100 lg:pl-8 dark:lg:border-mist-800/80">
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
            <div className="mt-1 flex flex-col gap-2.5">
              {/* The relay in use leads, then the region this machine calls
                  home; both keep the badges that say what serves them. */}
              <dl className="flex flex-col">
                <MachineAttribute
                  badges={relayBadges(usage.preferred)}
                  name={t("machines.detail.derp.preferredRegion")}
                  value={markedLabel(view.preferred, embeddedMarker)}
                />
                <MachineAttribute
                  badges={relayBadges(usage.home)}
                  name={t("machines.detail.derp.homeRegion")}
                  value={markedLabel(view.home, embeddedMarker)}
                />
              </dl>

              <div className="flex min-w-0 flex-col">
                {/* The head of the list stays out of the scroller below, so the
                    region/source/latency columns keep their names while the rows
                    move: the label on the left, the tally on the right. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
                    {t("machines.detail.derp.latency")}
                  </span>
                  {latencies.rows.length === 0 ? undefined : (
                    // Measured over listed, split by where each number came from.
                    <span className="text-xs text-mist-500 dark:text-mist-400">
                      {t("machines.detail.derp.latencySummary", {
                        local: latencies.summary.measured,
                        measured: measuredRegions,
                        reported: latencies.summary.reported,
                        total: latencies.summary.total,
                      })}
                    </span>
                  )}
                </div>

                {latencies.rows.length === 0 ? (
                  <p className="mt-1 text-sm text-mist-500 dark:text-mist-400">
                    {t("machines.detail.derp.noLatency")}
                  </p>
                ) : (
                  // One region per row: its name and badges, where the number
                  // came from, and the number itself in a fixed right-aligned
                  // column, so the values line up down the table. A deployment
                  // that serves more than five regions scrolls in place inside
                  // the bound instead of stretching the card past the pair of
                  // cards above it; the rows themselves are untouched.
                  <div
                    aria-label={t("machines.detail.derp.latency")}
                    className={cn(
                      "mt-1 min-h-0 overflow-y-auto rounded-lg",
                      LATENCY_SCROLL_HEIGHT,
                      LATENCY_SCROLL_RING,
                    )}
                    role="group"
                    tabIndex={0}
                  >
                    <ul className="flex flex-col">
                      {latencies.rows.map((row) => (
                        <li
                          className="flex items-center gap-x-3 border-t border-mist-100 py-1.5 first:border-t-0 first:pt-0.5 last:pb-0.5 dark:border-mist-800/60"
                          key={row.key}
                        >
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            <span
                              className="min-w-0 truncate text-sm text-mist-900 dark:text-mist-50"
                              title={row.label}
                            >
                              {row.label}
                            </span>
                            {relayBadges(row)}
                          </span>
                          <span className="w-24 shrink-0 truncate text-right text-xs text-mist-500 dark:text-mist-400">
                            {row.latencySource === undefined
                              ? undefined
                              : t(LATENCY_SOURCE_KEYS[row.latencySource])}
                          </span>
                          {row.latency === undefined ? (
                            <span
                              className="w-20 shrink-0 truncate text-right text-xs text-mist-400 dark:text-mist-500"
                              title={t("machines.detail.derp.latencyUnmeasured")}
                            >
                              {t("machines.detail.derp.latencyUnmeasured")}
                            </span>
                          ) : (
                            <span className="w-20 shrink-0 text-right font-mono text-xs text-mist-700 tabular-nums dark:text-mist-200">
                              {row.latency}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {view.hasIdOnlyRegions ? (
                <p className="text-xs text-mist-500 dark:text-mist-400">
                  {t("machines.detail.derp.idsOnly")}
                </p>
              ) : undefined}
            </div>
          )}
        </section>
      </div>
    </MachineCard>
  );
}
