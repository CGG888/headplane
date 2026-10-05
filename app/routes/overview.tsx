import {
  Activity,
  Bot,
  Cable,
  Camera,
  CircleAlert,
  Globe,
  HeartPulse,
  LayoutDashboard,
  Network,
  Radar,
  Server,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { data } from "react-router";

import Code from "~/components/code";
import { ErrorBanner } from "~/components/error-banner";
import Link from "~/components/link";
import { SettingsPage, SettingsStatus, type SettingsStatusTone } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { FleetTrendBar } from "~/routes/machines/components/history-bar";
import RelayResolver from "~/routes/machines/components/relay-resolver";
import {
  relayAddressLines,
  relayResolutionBlamesSystemResolver,
  type RelayAddressLine,
} from "~/routes/machines/relay-verdicts";
import {
  agentsContext,
  appConfigContext,
  auditContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  nodeHistoryContext,
  requestApiContext,
  snapshotContext,
} from "~/server/context";
import type { HeadscaleClient } from "~/server/headscale/api";
import { isDataUnauthorizedError } from "~/server/headscale/api/error-client";
import { formatServerVersion } from "~/server/headscale/api/server-version";
import { computeFleetTrend, type FleetTrend } from "~/server/history/timeline";
import type { AgentManager } from "~/server/hp-agent";
import {
  buildRelayView,
  loadSharedRelayResolution,
  type RelayAddressFamily,
  type RelayAddressVerdict,
} from "~/server/relay-dns";
import { Capabilities } from "~/server/web/roles";
import type { Key, Machine, PreAuthKey, User } from "~/types";
import cn from "~/utils/cn";

import type { Route } from "./+types/overview";
import {
  type CheckStatus,
  type CheckTally,
  countNodeStatus,
  countNodesHomedInRegion,
  declaredDerpAddresses,
  type DeclaredDerpAddress,
  formatByteSize,
  hasIpv6StunWarning,
  readExtraRecordsPath,
  type RelayReason,
  summarizeFleetTrend,
  tallyChecks,
  tallyEntries,
  textOrReason,
} from "./overview-helpers";
import {
  classifyDerpRelaySource,
  deriveDerpPublicEndpoint,
  type DerpRelaySource,
} from "./settings/headscale/derp-settings";
import { loadConfigChecks, readHeadscaleConfig } from "./settings/system/config-probe";
import {
  computeDiagnostics,
  isBehindProxy,
  isNewerVersion,
  type ApiKeyStatus,
  type OidcStatus,
} from "./settings/system/diagnostics";
import type { MetricsReport } from "./settings/system/metrics";
import { loadMetrics } from "./settings/system/metrics-probe";
import { headplaneReleaseChecker, headscaleReleaseChecker } from "./settings/system/release-check";
import { selfUpdateNotice } from "./settings/system/self-update";

/**
 * The Overview dashboard: a read-only, fail-soft answer to "what am I running,
 * and is it healthy?".
 *
 * Everything the page shows is either already in memory or behind one of the
 * existing, self-degrading readers (the cached release checkers, the config
 * checks, the metrics probe, the stores). Nothing here writes, and every lookup
 * that can fail is turned into "unknown" instead of an error page, so a broken
 * Headscale or an unreadable configuration still renders a useful dashboard.
 */

const RELAY_SOURCE_KEYS: Record<DerpRelaySource, TranslationKey> = {
  "embedded-only": "overview.derp.relaySourceEmbeddedOnly",
  "embedded-and-map": "overview.derp.relaySourceEmbeddedAndMap",
  "map-only": "overview.derp.relaySourceMapOnly",
  none: "overview.derp.relaySourceNone",
};

/** Why a resolved family has no address, as a short clause after the em dash. */
const RELAY_REASON_KEYS: Record<RelayReason, TranslationKey> = {
  "no-records": "overview.derp.relayReasonNoRecords",
  timeout: "overview.derp.relayReasonTimeout",
  "resolver-error": "overview.derp.relayReasonResolverError",
  "host-missing": "overview.derp.relayReasonHostMissing",
  "invalid-host": "overview.derp.relayReasonInvalidHost",
  unavailable: "overview.derp.relayReasonUnavailable",
};

/** What a declared relay address and the resolved records say to each other. */
const RELAY_VERDICT_KEYS: Record<RelayAddressVerdict, TranslationKey> = {
  matches: "overview.derp.relayVerdictMatch",
  "declared-but-not-resolved": "overview.derp.relayVerdictMismatch",
  "no-records": "overview.derp.relayVerdictNoRecords",
  "resolver-unavailable": "overview.derp.relayVerdictUnavailable",
  "host-missing": "overview.derp.relayVerdictHostMissing",
  literal: "overview.derp.relayVerdictLiteral",
};

/** The one-line fix for a declared address clients cannot actually reach. */
const RELAY_FIX_KEYS: Record<
  RelayAddressFamily,
  Partial<Record<RelayAddressVerdict, TranslationKey>>
> = {
  ipv4: {
    "declared-but-not-resolved": "overview.derp.relayFixIpv4",
    "no-records": "overview.derp.relayFixIpv4",
  },
  ipv6: {
    "declared-but-not-resolved": "overview.derp.relayFixIpv6",
    "no-records": "overview.derp.relayFixIpv6NoRecords",
  },
};

const METRICS_STATE_KEYS: Record<MetricsReport["state"], TranslationKey> = {
  ok: "overview.service.metricsOk",
  unreachable: "overview.service.metricsUnreachable",
  disabled: "overview.service.metricsDisabled",
  invalid: "overview.service.metricsInvalid",
  unknown: "overview.service.metricsUnknown",
};

const METRICS_STATE_TONES: Record<MetricsReport["state"], SettingsStatusTone> = {
  ok: "ok",
  unreachable: "warn",
  disabled: "neutral",
  invalid: "warn",
  unknown: "neutral",
};

/** The chip label of one check status, and the tone it reads with when non-zero. */
const TALLY_KEYS: Record<CheckStatus, TranslationKey> = {
  pass: "overview.health.passCount",
  warning: "overview.health.warningCount",
  fail: "overview.health.failCount",
};

const TALLY_TONES: Record<CheckStatus, SettingsStatusTone> = {
  pass: "ok",
  warning: "warn",
  fail: "error",
};

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Headscale only exposes a global pre-auth key list on 0.28 and newer. */
function listAllPreAuthKeys(api: HeadscaleClient): Promise<PreAuthKey[] | undefined> {
  const listAll = api.preAuthKeys.listAll;
  return listAll ? listAll() : Promise.resolve(undefined);
}

interface ApiSnapshot {
  /** Whether the configured API key answered the key list. */
  apiKey: ApiKeyStatus;
  nodes?: Machine[];
  users?: User[];
  preAuthKeys?: PreAuthKey[];
  preAuthKeysSupported: boolean;
  apiKeys?: Key[];
  /** Machines whose reported home relay is the embedded DERP region. */
  homedInRegion?: number;
}

interface AgentSnapshot {
  enabled: boolean;
  /** Why the agent is not running, as reported by the feature context. */
  reason?: string;
  version?: string;
  syncedAt?: string;
  nodeCount?: number;
  error?: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
  const appConfig = context.get(appConfigContext);
  const audit = context.get(auditContext);
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const integration = context.get(integrationContext);
  const nodeHistory = context.get(nodeHistoryContext);
  const getRequestApi = context.get(requestApiContext);
  const snapshots = context.get(snapshotContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.ui_access)) {
    throw data({ localized: { key: "errors.permission.view" } }, { status: 403 });
  }

  const agents = agentsFeature.state === "enabled" ? agentsFeature.value : undefined;
  const configPath = appConfig.headscale.config_path;

  const derp = headscaleConfig.getDERPSettings();
  const dns = headscaleConfig.getDNSConfig();
  const serverOverview = headscaleConfig.getServerOverview();
  const { policyMode, trustedProxies } = headscaleConfig.getTailnetSettings();

  // The API-backed counts share one client and are all optional: each failed
  // call leaves its row as an em dash rather than failing the page.
  const apiLookup = (async (): Promise<ApiSnapshot> => {
    const snapshot: ApiSnapshot = { apiKey: "unknown", preAuthKeysSupported: false };

    let api: HeadscaleClient;
    try {
      ({ api } = await getRequestApi(request));
    } catch {
      return snapshot;
    }

    snapshot.preAuthKeysSupported = api.preAuthKeys.listAll !== undefined;

    const [nodes, users, preAuthKeys, apiKeys] = await Promise.all([
      attempt(() => api.nodes.list()),
      attempt(() => api.users.list()),
      attempt(() => listAllPreAuthKeys(api)),
      attempt(() => api.apiKeys.list()),
    ]);

    snapshot.apiKey = apiKeys.ok
      ? "valid"
      : isDataUnauthorizedError(apiKeys.error)
        ? "invalid"
        : "unknown";

    if (nodes.ok) {
      snapshot.nodes = nodes.value;
    }
    if (users.ok) {
      snapshot.users = users.value;
    }
    if (preAuthKeys.ok && preAuthKeys.value !== undefined) {
      snapshot.preAuthKeys = preAuthKeys.value;
    }
    if (apiKeys.ok) {
      snapshot.apiKeys = apiKeys.value;
    }

    if (agents && derp.server.enabled && nodes.ok) {
      snapshot.homedInRegion = await countHomedInRegion(agents, nodes.value, derp.server.regionId);
    }

    return snapshot;
  })();

  const agentLookup = (async (): Promise<AgentSnapshot> => {
    if (agentsFeature.state !== "enabled") {
      return { enabled: false, reason: agentsFeature.reason };
    }

    const sync = agentsFeature.value.lastSync();
    const snapshot: AgentSnapshot = {
      enabled: true,
      syncedAt: sync.syncedAt?.toISOString(),
      nodeCount: sync.nodeCount,
      error: sync.error,
    };

    const nodeKey = agentsFeature.value.agentNodeKey();
    if (nodeKey) {
      try {
        const info = (await agentsFeature.value.lookup([nodeKey]))[nodeKey];
        const version = info?.IPNVersion?.trim();
        if (version) {
          snapshot.version = version;
        }
      } catch {
        // Host info is a cache; a miss only leaves the version unknown.
      }
    }

    return snapshot;
  })();

  // The fleet trend comes from Headplane's own sampler, not from Headscale: a
  // store that has never been written simply leaves the card on its em dash.
  const historyLookup = attempt(async (): Promise<FleetTrend> => {
    await nodeHistory.ready();
    return computeFleetTrend(nodeHistory.document(), "7d", Date.now());
  });

  const [
    api,
    agent,
    reachable,
    latestHeadscale,
    latestHeadplane,
    configChecks,
    metrics,
    rawConfig,
    auditEntries,
    snapshotList,
    history,
  ] = await Promise.all([
    apiLookup,
    agentLookup,
    headscale.health(),
    headscaleReleaseChecker.latest(),
    headplaneReleaseChecker.latest(),
    loadConfigChecks(configPath),
    loadMetrics(configPath, appConfig.headscale.url),
    attempt(() => readHeadscaleConfig(configPath)),
    attempt(() => audit.count()),
    attempt(() => snapshots.list()),
    historyLookup,
  ]);

  const serverVersion = headscale.version;
  const updateAvailable =
    latestHeadscale !== undefined && isNewerVersion(serverVersion, latestHeadscale);
  // Reused so a custom build that reports its own version is never nagged.
  const selfUpdate = selfUpdateNotice(__VERSION__, latestHeadplane);

  const configReadable = headscaleConfig.readable();
  // An unreadable config says nothing about OIDC, so that stays unknown.
  const oidc: OidcStatus = configReadable
    ? headscaleConfig.getOIDCSettings()
      ? "configured"
      : "missing"
    : "unknown";

  const diagnostics = computeDiagnostics({
    reachable,
    apiKey: api.apiKey,
    version: serverVersion,
    configReadable,
    configWritable: headscaleConfig.writable(),
    policyMode,
    oidc,
    trustedProxies: trustedProxies.length,
    behindProxy: isBehindProxy(request.headers),
    integrationName: integration?.name,
  });

  const nodeCounts = api.nodes ? countNodeStatus(api.nodes) : undefined;
  const snapshotSize = snapshotList.ok
    ? formatByteSize(
        snapshotList.value.reduce(
          (total, entry) => total + (Number.isFinite(entry.totalSize) ? entry.totalSize : 0),
          0,
        ),
      )
    : undefined;

  // The relay's real addresses come from DNS, not from the configuration. The
  // lookup is cached for minutes and fail-soft, so a relay card never delays or
  // breaks the dashboard because a name did not resolve.
  const relayEndpoint = deriveDerpPublicEndpoint(derp.serverUrl);
  const relayResolution = await loadSharedRelayResolution(relayEndpoint?.host);
  const relayView = buildRelayView(relayEndpoint, relayResolution, derp.server);

  return {
    versions: {
      headplane: {
        version: __VERSION__,
        latest: latestHeadplane ? formatServerVersion(latestHeadplane) : undefined,
        updateAvailable: selfUpdate !== undefined,
      },
      headscale: {
        version: formatServerVersion(serverVersion),
        latest: latestHeadscale ? formatServerVersion(latestHeadscale) : undefined,
        updateAvailable,
      },
      agent,
    },
    derp: {
      enabled: derp.server.enabled,
      regionId: derp.server.regionId,
      regionCode: derp.server.regionCode,
      regionName: derp.server.regionName,
      relaySource: classifyDerpRelaySource({
        serverEnabled: derp.server.enabled,
        urls: derp.urls,
      }),
      urlCount: derp.urls.length,
      pathCount: derp.paths.length,
      relay: {
        endpoint: relayView.host?.endpoint,
        host: relayView.host?.hostname,
        // One line per family: the address `derp.server` declares when it sets
        // one, the lookup's own A/AAAA answer otherwise, so the card never asks
        // an operator to compare a declared block against a resolved one. The
        // lines are flattened to plain values here, because the card must not
        // import a module that reaches Node-only code (see `./relay-verdicts`).
        lines: relayAddressLines(derp.server, relayResolution),
        // Which resolver produced this answer, and whether this viewer may ask
        // for a fresh one; the card shows both under the addresses.
        resolution: relayResolution,
        canRefresh: auth.can(principal, Capabilities.configure_iam),
        suggestsConfigured: relayResolutionBlamesSystemResolver(relayResolution),
      },
      declared: declaredDerpAddresses(derp.server),
      stunListenAddr: derp.server.stunListenAddr,
      ipv6StunWarning: hasIpv6StunWarning({
        enabled: derp.server.enabled,
        ipv6: derp.server.ipv6,
        stunListenAddr: derp.server.stunListenAddr,
      }),
      machinesInRegion: api.homedInRegion,
    },
    service: {
      url: appConfig.headscale.url,
      reachable,
      baseDomain: dns.baseDomain,
      policyMode,
      magicDns: dns.magicDns,
      overrideDns: dns.overrideDns,
      extraRecordsPath: rawConfig.ok ? readExtraRecordsPath(rawConfig.value) : undefined,
      metrics: { address: serverOverview.metricsListenAddr, state: metrics.state },
      trustedProxies: trustedProxies.length,
    },
    counts: {
      nodes: nodeCounts,
      users: api.users?.length,
      preAuthKeys: api.preAuthKeys?.length,
      preAuthKeysSupported: api.preAuthKeysSupported,
      apiKeys: api.apiKeys?.length,
      auditEntries: auditEntries.ok ? auditEntries.value : undefined,
      snapshots: snapshotList.ok
        ? { count: snapshotList.value.length, size: snapshotSize }
        : undefined,
    },
    health: {
      configChecks: configChecks.length > 0 ? tallyChecks(configChecks) : undefined,
      diagnostics: tallyChecks(diagnostics),
    },
    history: {
      trend: history.ok ? history.value : undefined,
    },
  };
}

/**
 * Counts the machines reporting the embedded region as their home relay. The
 * agent's host info is the only source for that, so a failure leaves the count
 * unknown instead of reporting zero.
 */
async function countHomedInRegion(
  agents: AgentManager,
  nodes: readonly Machine[],
  regionId: number,
): Promise<number | undefined> {
  try {
    const stats = await agents.lookup(nodes.map((node) => node.nodeKey));
    return countNodesHomedInRegion(stats, regionId);
  } catch {
    return undefined;
  }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr, locale } = useI18n();
  const { versions, derp, service, counts, health, history } = loaderData;
  const trendSummary = history.trend ? summarizeFleetTrend(history.trend) : undefined;

  const reason = {
    agent: t("overview.reason.agentDisabled"),
    api: t("overview.reason.apiUnavailable"),
    config: t("overview.reason.configUnreadable"),
    notConfigured: t("overview.reason.notConfigured"),
    notReported: t("overview.reason.notReported"),
    unsupported: t("overview.reason.unsupported"),
  };

  /** "Up to date" is only claimed when a release was actually looked up. */
  const releaseStatus = (latest: string | undefined, hasUpdate: boolean) => {
    if (latest === undefined) {
      return { tone: "neutral" as const, label: t("overview.status.releaseUnknown") };
    }

    return hasUpdate
      ? { tone: "warn" as const, label: t("overview.status.updateAvailable") }
      : { tone: "ok" as const, label: t("overview.status.upToDate") };
  };

  const updateNote = (latest: string | undefined, current: string, hasUpdate: boolean) =>
    hasUpdate && latest ? t("overview.versions.updateNote", { latest, current }) : undefined;

  const apiReadable = counts.nodes !== undefined || counts.users !== undefined;
  const preAuthReason =
    apiReadable && !counts.preAuthKeysSupported ? reason.unsupported : reason.api;
  const machinesReason = !derp.enabled
    ? reason.notConfigured
    : !versions.agent.enabled
      ? reason.agent
      : apiReadable
        ? reason.notReported
        : reason.api;

  const healthTally = health.diagnostics;
  const healthTone: SettingsStatusTone =
    healthTally.fail > 0 ? "error" : healthTally.warning > 0 ? "warn" : "ok";

  const enabled = t("overview.status.enabled");
  const disabled = t("overview.status.disabled");
  const on = t("overview.status.on");
  const off = t("overview.status.off");
  const configured = { tone: "neutral" as const, label: t("overview.status.configured") };
  const derived = { tone: "neutral" as const, label: t("overview.status.derived") };
  const relayReason = (reason: RelayReason) => t(RELAY_REASON_KEYS[reason]);
  const relayFamilyLabel = (family: RelayAddressLine["family"]) =>
    family === "ipv4" ? t("overview.derp.relayIpv4") : t("overview.derp.relayIpv6");
  const relayDeclaredMarker = {
    tone: "neutral" as const,
    label: t("overview.derp.relayDeclaredMarker"),
  };

  /**
   * What a declared relay address and the resolved records say to each other.
   * The line builder already dropped a bare match, which only repeats the
   * address it sits under, so what is left says something the line cannot.
   *
   * `host` is the resolved hostname, so a hint can quote the exact `dig`
   * command an operator has to run instead of describing it.
   */
  const relayVerdictNote = (line: RelayAddressLine, host: string | undefined) => {
    const verdict = line.verdict;
    if (verdict === undefined || line.addresses.length === 0) {
      return undefined;
    }

    const address = line.addresses[0] ?? "";
    const note = t(RELAY_VERDICT_KEYS[verdict], { address });
    const fix = RELAY_FIX_KEYS[line.family][verdict];
    return fix === undefined ? note : `${note} · ${t(fix, { host: host ?? "", address })}`;
  };

  /** The one short line a family with nothing to print reads as. */
  const relayLineText = (line: RelayAddressLine) =>
    line.verdict === undefined
      ? relayReason(line.reason ?? "unavailable")
      : t(RELAY_VERDICT_KEYS[line.verdict], { address: "" });

  return (
    <SettingsPage
      className="md:max-w-5xl"
      description={t("overview.intro")}
      title={t("overview.title")}
    >
      <div className="flex flex-col gap-6">
        <Section title={t("overview.sections.versions")}>
          <Card
            description={t("overview.versions.headplaneBody")}
            icon={LayoutDashboard}
            status={releaseStatus(versions.headplane.latest, versions.headplane.updateAvailable)}
            title={t("overview.versions.headplaneTitle")}
          >
            <Facts>
              <Fact code label={t("overview.versions.running")} text={versions.headplane.version} />
              <Fact
                code
                label={t("overview.versions.latest")}
                note={updateNote(
                  versions.headplane.latest,
                  versions.headplane.version,
                  versions.headplane.updateAvailable,
                )}
                {...textOrReason(versions.headplane.latest, reason.notReported)}
              />
            </Facts>
          </Card>

          <Card
            description={t("overview.versions.headscaleBody")}
            icon={Server}
            status={releaseStatus(versions.headscale.latest, versions.headscale.updateAvailable)}
            title={t("overview.versions.headscaleTitle")}
          >
            <Facts>
              <Fact code label={t("overview.versions.running")} text={versions.headscale.version} />
              <Fact
                code
                label={t("overview.versions.latest")}
                note={updateNote(
                  versions.headscale.latest,
                  versions.headscale.version,
                  versions.headscale.updateAvailable,
                )}
                {...textOrReason(versions.headscale.latest, reason.notReported)}
              />
            </Facts>
          </Card>

          <Card
            description={t("overview.versions.agentBody")}
            icon={Bot}
            status={{
              tone: versions.agent.enabled ? "ok" : "neutral",
              label: versions.agent.enabled ? enabled : disabled,
            }}
            title={t("overview.versions.agentTitle")}
          >
            {versions.agent.enabled ? (
              <Facts>
                <Fact
                  code
                  label={t("overview.versions.agentVersion")}
                  {...textOrReason(versions.agent.version, reason.notReported)}
                />
                <Fact
                  code
                  label={t("overview.versions.agentLastSync")}
                  text={versions.agent.syncedAt ?? t("overview.status.never")}
                />
                <Fact label={t("overview.versions.agentNodes")} text={versions.agent.nodeCount} />
                {versions.agent.error ? (
                  <Fact label={t("overview.versions.agentError")} text={versions.agent.error} />
                ) : undefined}
              </Facts>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-mist-600 dark:text-mist-400">
                  {t("overview.versions.agentDisabledBody")}
                </p>
                {versions.agent.reason ? (
                  <p className="text-xs text-mist-500 dark:text-mist-400">
                    {versions.agent.reason}
                  </p>
                ) : undefined}
              </div>
            )}
          </Card>
        </Section>

        <Section title={t("overview.sections.derp")}>
          <Card
            description={t("overview.derp.regionBody")}
            icon={Network}
            status={{
              tone: derp.enabled ? "ok" : "neutral",
              label: derp.enabled ? enabled : disabled,
            }}
            title={t("overview.derp.regionTitle")}
          >
            <Facts>
              <Fact
                code
                label={t("overview.derp.region")}
                text={t("overview.derp.regionValue", {
                  id: derp.regionId,
                  code: derp.regionCode,
                  name: derp.regionName,
                })}
              />
              <Fact
                label={t("overview.derp.relaySource")}
                note={t("overview.derp.relaySourceNote")}
                source={derived}
                text={t(RELAY_SOURCE_KEYS[derp.relaySource])}
              />
              <Fact
                label={t("overview.derp.urls")}
                source={configured}
                text={
                  derp.urlCount > 0
                    ? t("overview.derp.countConfigured", { count: derp.urlCount })
                    : t("overview.derp.none")
                }
              />
              <Fact
                label={t("overview.derp.paths")}
                source={configured}
                text={
                  derp.pathCount > 0
                    ? t("overview.derp.countFiles", { count: derp.pathCount })
                    : t("overview.derp.none")
                }
              />
              <Fact
                label={t("overview.derp.machines")}
                note={t("overview.derp.machinesNote")}
                reason={machinesReason}
                source={derived}
                text={derp.machinesInRegion}
              />
            </Facts>
          </Card>

          <Card
            description={t("overview.derp.publicBody")}
            icon={Radar}
            status={
              derp.ipv6StunWarning
                ? { tone: "warn", label: t("overview.status.attention") }
                : derived
            }
            title={t("overview.derp.publicTitle")}
          >
            <Facts>
              <Fact
                code
                label={t("overview.derp.relayClientAddress")}
                {...textOrReason(derp.relay.endpoint, t("overview.derp.publicUnavailable"))}
              />
              {derp.relay.lines.map((line) => (
                <Fact
                  key={line.family}
                  label={relayFamilyLabel(line.family)}
                  note={relayVerdictNote(line, derp.relay.host)}
                  source={line.source === "declared" ? relayDeclaredMarker : undefined}
                >
                  {line.addresses.length > 0 ? (
                    <span className="flex flex-col gap-0.5 sm:items-end">
                      {line.addresses.map((address) => (
                        <Code key={address}>{address}</Code>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-mist-500 dark:text-mist-400">
                      {relayLineText(line)}
                    </span>
                  )}
                </Fact>
              ))}
              {derp.stunListenAddr ? (
                <Fact code label={t("overview.derp.stun")} text={derp.stunListenAddr} />
              ) : undefined}
            </Facts>

            <RelayResolver
              canRefresh={derp.relay.canRefresh}
              resolution={derp.relay.resolution}
              suggestsConfigured={derp.relay.suggestsConfigured}
            />

            {derp.ipv6StunWarning ? (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/25 dark:text-amber-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{t("overview.derp.ipv6StunTitle")}</span>
                  <span>
                    {t("overview.derp.ipv6StunBody", {
                      ipv6: declaredAddress(derp.declared, "ipv6") ?? "",
                      stun: derp.stunListenAddr,
                    })}
                  </span>
                </div>
              </div>
            ) : undefined}
          </Card>
        </Section>

        <Section title={t("overview.sections.service")}>
          <Card
            description={t("overview.service.serverBody")}
            icon={Cable}
            status={{
              tone: service.reachable ? "ok" : "error",
              label: service.reachable
                ? t("overview.status.reachable")
                : t("overview.status.unreachable"),
            }}
            title={t("overview.service.title")}
          >
            <Facts>
              <Fact code label={t("overview.service.url")} source={configured} text={service.url} />
              <Fact
                code
                label={t("overview.service.baseDomain")}
                {...textOrReason(service.baseDomain, reason.notConfigured)}
              />
              <Fact
                label={t("overview.service.policyMode")}
                text={
                  service.policyMode === "database"
                    ? t("overview.service.policyModeDatabase")
                    : t("overview.service.policyModeFile")
                }
              />
            </Facts>
          </Card>

          <Card
            description={t("overview.service.dnsBody")}
            icon={Globe}
            status={{
              tone: service.magicDns ? "ok" : "neutral",
              label: service.magicDns ? on : off,
            }}
            title={t("overview.service.dnsTitle")}
          >
            <Facts>
              <Fact label={t("overview.service.magicDns")}>
                <SettingsStatus tone={service.magicDns ? "ok" : "neutral"}>
                  {service.magicDns ? on : off}
                </SettingsStatus>
              </Fact>
              <Fact label={t("overview.service.overrideDns")}>
                <SettingsStatus tone={service.overrideDns ? "ok" : "neutral"}>
                  {service.overrideDns ? on : off}
                </SettingsStatus>
              </Fact>
              <Fact
                code
                label={t("overview.service.extraRecords")}
                note={t("overview.service.extraRecordsNote")}
                {...textOrReason(service.extraRecordsPath, reason.notConfigured)}
              />
            </Facts>
          </Card>

          <Card
            description={t("overview.service.metricsBody")}
            icon={Activity}
            status={{
              tone: METRICS_STATE_TONES[service.metrics.state],
              label: t(METRICS_STATE_KEYS[service.metrics.state]),
            }}
            title={t("overview.service.metricsTitle")}
          >
            <Facts>
              <Fact
                code
                label={t("overview.service.metricsListener")}
                {...textOrReason(service.metrics.address, reason.notConfigured)}
              />
              <Fact label={t("overview.service.metricsEndpoint")}>
                <SettingsStatus tone={METRICS_STATE_TONES[service.metrics.state]}>
                  {t(METRICS_STATE_KEYS[service.metrics.state])}
                </SettingsStatus>
              </Fact>
              <Fact
                label={t("overview.service.trustedProxies")}
                text={t("overview.service.trustedProxiesValue", {
                  count: service.trustedProxies,
                })}
              />
            </Facts>
          </Card>
        </Section>

        <Section title={t("overview.sections.counts")}>
          <Card
            description={t("overview.counts.tailnetBody")}
            icon={Users}
            title={t("overview.counts.tailnetTitle")}
          >
            <dl className="grid grid-cols-2 gap-2">
              <CountTile
                detail={
                  counts.nodes
                    ? t("overview.counts.nodesSplit", {
                        online: counts.nodes.online,
                        offline: counts.nodes.offline,
                      })
                    : undefined
                }
                label={t("overview.counts.nodes")}
                reason={reason.api}
                text={counts.nodes?.total}
              />
              <CountTile
                label={t("overview.counts.users")}
                reason={reason.api}
                text={counts.users}
              />
              <CountTile
                label={t("overview.counts.preAuthKeys")}
                reason={preAuthReason}
                text={counts.preAuthKeys}
              />
              <CountTile
                label={t("overview.counts.apiKeys")}
                reason={reason.api}
                text={counts.apiKeys}
              />
            </dl>
          </Card>

          <Card
            description={t("overview.counts.headplaneBody")}
            icon={Camera}
            title={t("overview.counts.headplaneTitle")}
          >
            <dl className="grid grid-cols-2 gap-2">
              <CountTile
                label={t("overview.counts.audit")}
                reason={reason.api}
                text={counts.auditEntries}
              />
              <CountTile
                detail={
                  counts.snapshots
                    ? t("overview.counts.snapshotsSize", {
                        size: counts.snapshots.size ?? t("overview.reason.notReported"),
                      })
                    : undefined
                }
                label={t("overview.counts.snapshots")}
                reason={reason.api}
                text={counts.snapshots?.count}
              />
            </dl>
          </Card>

          <Card
            description={t("overview.history.body")}
            icon={TrendingUp}
            title={t("overview.history.title")}
          >
            {history.trend !== undefined &&
            trendSummary !== undefined &&
            trendSummary.covered > 0 ? (
              <div className="flex flex-col gap-2">
                <FleetTrendBar
                  buckets={history.trend.buckets}
                  labels={{
                    label: t("overview.history.title"),
                    online: t("overview.history.legendOnline"),
                    offline: t("overview.history.legendOffline"),
                    unknown: t("overview.history.legendUnknown"),
                  }}
                />
                <p className="text-xs text-mist-500 dark:text-mist-400">
                  {t("overview.history.summary", {
                    covered: trendSummary.covered,
                    total: trendSummary.total,
                    peak: trendSummary.peak,
                  })}
                </p>
                {history.trend.partial && history.trend.collectingSince ? (
                  <p className="text-xs text-mist-500 dark:text-mist-400">
                    {t("overview.history.collectingSince", {
                      at: new Date(history.trend.collectingSince).toLocaleString(locale),
                    })}
                  </p>
                ) : undefined}
              </div>
            ) : (
              <p className="text-sm text-mist-400 dark:text-mist-500">
                {t("overview.unavailableReason", { reason: t("overview.history.noData") })}
              </p>
            )}
          </Card>
        </Section>

        <Section title={t("overview.sections.health")}>
          <Card
            description={t("overview.health.body")}
            icon={HeartPulse}
            status={{
              tone: healthTone,
              label:
                healthTone === "ok" ? t("overview.status.healthy") : t("overview.status.attention"),
            }}
            title={t("overview.health.title")}
          >
            <dl className="flex flex-col gap-3">
              <TallyFact
                label={t("overview.health.configChecks")}
                reason={reason.config}
                tally={health.configChecks}
              />
              <TallyFact label={t("overview.health.diagnostics")} tally={healthTally} />
            </dl>
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {tr("overview.health.detailsBody", {
                link: (
                  <Link
                    className="font-medium text-indigo-600 dark:text-indigo-400"
                    to="/settings/system"
                  >
                    {t("overview.health.details")}
                  </Link>
                ),
              })}
            </p>
          </Card>
        </Section>
      </div>
    </SettingsPage>
  );
}

/** Groups related dashboard cards under one small heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-mist-500 dark:text-mist-400">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

interface CardProps {
  icon: LucideIcon;
  title: string;
  /** One line on what the card's facts describe. */
  description: string;
  status?: { tone: SettingsStatusTone; label: string };
  children: ReactNode;
}

/**
 * A card in the dashboard grid. It keeps the settings card geometry (radius,
 * border, padding, icon tile) but has no hover state of its own: only the links
 * and controls that point at another page are navigation targets.
 */
function Card({ icon: Icon, title, description, status, children }: CardProps) {
  return (
    <section
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl border p-4",
        "border-mist-200 bg-white shadow-surface",
        "dark:border-mist-800 dark:bg-mist-950/40",
      )}
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            "bg-mist-100 text-mist-600 dark:bg-mist-800 dark:text-mist-300",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-mist-900 dark:text-mist-50">{title}</span>
            {status ? (
              <SettingsStatus tone={status.tone}>{status.label}</SettingsStatus>
            ) : undefined}
          </span>
          <span className="text-sm text-mist-600 dark:text-mist-400">{description}</span>
        </span>
      </header>

      {children}
    </section>
  );
}

/** The definition list every card of facts renders into. */
function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="flex flex-col divide-y divide-mist-100 dark:divide-mist-800/60">{children}</dl>
  );
}

interface FactProps {
  label: string;
  /** A "configured" / "derived" chip that says where the value comes from. */
  source?: { tone: SettingsStatusTone; label: string };
  note?: string;
  /** The value; a chip's worth of markup instead when the value is a status. */
  children?: ReactNode;
  code?: boolean;
  text?: string | number;
  reason?: string;
}

/**
 * One fact of a card: a label (with its source chip and explanation) over a
 * value. The pair is stacked on a phone and put on one line from `sm` up, so a
 * long path or URL truncates inside the card instead of overflowing it.
 */
function Fact({ label, source, note, children, code = false, text, reason }: FactProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="flex min-w-0 flex-col gap-0.5 text-sm text-mist-600 sm:max-w-[55%] dark:text-mist-400">
        <span className="flex flex-wrap items-center gap-1.5">
          {label}
          {source ? <SettingsStatus tone={source.tone}>{source.label}</SettingsStatus> : undefined}
        </span>
        {note ? (
          <span className="text-xs text-mist-500 dark:text-mist-400">{note}</span>
        ) : undefined}
      </dt>
      <dd className="min-w-0 sm:flex-1 sm:text-right">
        {children ??
          (text === undefined ? (
            <span className="text-sm text-mist-400 dark:text-mist-500">
              {reason ? t("overview.unavailableReason", { reason }) : t("overview.unavailable")}
            </span>
          ) : (
            <span
              className="block truncate text-sm font-medium text-mist-900 dark:text-mist-50"
              title={String(text)}
            >
              {code ? <Code>{String(text)}</Code> : String(text)}
            </span>
          ))}
      </dd>
    </div>
  );
}

interface CountTileProps {
  label: string;
  /** The count itself, shown large; an em dash when it could not be read. */
  text?: number | string;
  reason?: string;
  /** A small line under the number, e.g. how the total splits. */
  detail?: string;
}

/** One number of a counts card: a large value with a small label under it. */
function CountTile({ label, text, reason, detail }: CountTileProps) {
  const { t } = useI18n();
  const missing = text === undefined;
  // Reversed so the value is on top while the label still reads first to a
  // screen reader, and so a missing count keeps its em dash and reason.
  const sub = missing ? reason : detail;

  return (
    <div className="flex min-w-0 flex-col-reverse gap-1 rounded-lg border border-mist-100 bg-mist-50/60 p-3 dark:border-mist-800 dark:bg-mist-900/50">
      <dt className="truncate text-xs text-mist-500 dark:text-mist-400">{label}</dt>
      <dd className="min-w-0">
        <span
          className={cn(
            "block truncate text-2xl leading-none font-semibold tabular-nums",
            missing ? "text-mist-400 dark:text-mist-500" : "text-mist-900 dark:text-mist-50",
          )}
          title={missing ? undefined : String(text)}
        >
          {missing ? t("overview.unavailable") : String(text)}
        </span>
        {sub ? (
          <span
            className="mt-1 block truncate text-xs text-mist-500 dark:text-mist-400"
            title={sub}
          >
            {sub}
          </span>
        ) : undefined}
      </dd>
    </div>
  );
}

interface TallyFactProps {
  label: string;
  tally?: CheckTally;
  reason?: string;
}

/**
 * One check tally as a row of pass/warning/fail chips. A status nobody hit
 * stays visible but reads neutral, so "0 fail" never looks like a failure.
 */
function TallyFact({ label, tally, reason }: TallyFactProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-sm text-mist-600 dark:text-mist-400">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        {tally === undefined ? (
          <span className="text-sm text-mist-400 dark:text-mist-500">
            {reason ? t("overview.unavailableReason", { reason }) : t("overview.unavailable")}
          </span>
        ) : (
          tallyEntries(tally).map((entry) => (
            <SettingsStatus
              key={entry.status}
              tone={entry.count > 0 ? TALLY_TONES[entry.status] : "neutral"}
            >
              {t(TALLY_KEYS[entry.status], { count: entry.count })}
            </SettingsStatus>
          ))
        )}
      </dd>
    </div>
  );
}

function declaredAddress(declared: DeclaredDerpAddress[], family: "ipv4" | "ipv6") {
  return declared.find((entry) => entry.family === family)?.value;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorBanner className="max-w-2xl" error={error} />;
}
