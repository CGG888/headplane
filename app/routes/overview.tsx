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
import {
  agentsContext,
  appConfigContext,
  auditContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  requestApiContext,
  snapshotContext,
} from "~/server/context";
import type { HeadscaleClient } from "~/server/headscale/api";
import { isDataUnauthorizedError } from "~/server/headscale/api/error-client";
import { formatServerVersion } from "~/server/headscale/api/server-version";
import type { AgentManager } from "~/server/hp-agent";
import { Capabilities } from "~/server/web/roles";
import type { Key, Machine, PreAuthKey, User } from "~/types";
import cn from "~/utils/cn";

import type { Route } from "./+types/overview";
import {
  countNodeStatus,
  countNodesHomedInRegion,
  declaredDerpAddresses,
  type DeclaredDerpAddress,
  derpEndpointSummary,
  formatByteSize,
  hasIpv6StunWarning,
  readExtraRecordsPath,
  tallyChecks,
  textOrReason,
} from "./overview-helpers";
import { classifyDerpRelaySource, type DerpRelaySource } from "./settings/headscale/derp-settings";
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
      publicEndpoint: derpEndpointSummary(derp.serverUrl),
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
  const { t, tr } = useI18n();
  const { versions, derp, service, counts, health } = loaderData;

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

  const nodesText = counts.nodes
    ? t("overview.counts.nodesValue", {
        total: counts.nodes.total,
        online: counts.nodes.online,
        offline: counts.nodes.offline,
      })
    : undefined;

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

  return (
    <SettingsPage
      className="md:max-w-5xl"
      description={t("overview.intro")}
      title={t("overview.title")}
    >
      <div className="flex flex-col gap-6">
        <Section title={t("overview.sections.versions")}>
          <Card
            icon={LayoutDashboard}
            status={releaseStatus(versions.headplane.latest, versions.headplane.updateAvailable)}
            title={t("overview.versions.headplaneTitle")}
          >
            <Row label={t("overview.versions.running")}>
              <Value code text={versions.headplane.version} />
            </Row>
            <Row
              label={t("overview.versions.latest")}
              note={updateNote(
                versions.headplane.latest,
                versions.headplane.version,
                versions.headplane.updateAvailable,
              )}
            >
              <Value {...textOrReason(versions.headplane.latest, reason.notReported)} code />
            </Row>
          </Card>

          <Card
            icon={Server}
            status={releaseStatus(versions.headscale.latest, versions.headscale.updateAvailable)}
            title={t("overview.versions.headscaleTitle")}
          >
            <Row label={t("overview.versions.running")}>
              <Value code text={versions.headscale.version} />
            </Row>
            <Row
              label={t("overview.versions.latest")}
              note={updateNote(
                versions.headscale.latest,
                versions.headscale.version,
                versions.headscale.updateAvailable,
              )}
            >
              <Value {...textOrReason(versions.headscale.latest, reason.notReported)} code />
            </Row>
          </Card>

          <Card
            icon={Bot}
            status={{
              tone: versions.agent.enabled ? "ok" : "neutral",
              label: versions.agent.enabled
                ? t("overview.status.enabled")
                : t("overview.status.disabled"),
            }}
            title={t("overview.versions.agentTitle")}
          >
            {versions.agent.enabled ? (
              <>
                <Row label={t("overview.versions.agentVersion")}>
                  <Value {...textOrReason(versions.agent.version, reason.notReported)} code />
                </Row>
                <Row label={t("overview.versions.agentLastSync")}>
                  <Value code text={versions.agent.syncedAt ?? t("overview.status.never")} />
                </Row>
                <Row label={t("overview.versions.agentNodes")}>
                  <Value text={versions.agent.nodeCount} />
                </Row>
                {versions.agent.error ? (
                  <Row label={t("overview.versions.agentError")}>
                    <Value text={versions.agent.error} />
                  </Row>
                ) : undefined}
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-mist-600 dark:text-mist-400">
                  {t("overview.versions.agentDisabledBody")}
                </span>
                {versions.agent.reason ? (
                  <span className="text-xs text-mist-500 dark:text-mist-400">
                    {versions.agent.reason}
                  </span>
                ) : undefined}
              </div>
            )}
          </Card>
        </Section>

        <Section title={t("overview.sections.derp")}>
          <Card
            icon={Network}
            status={{
              tone: derp.enabled ? "ok" : "neutral",
              label: derp.enabled ? t("overview.status.enabled") : t("overview.status.disabled"),
            }}
            title={t("overview.derp.regionTitle")}
          >
            <Row label={t("overview.derp.region")}>
              <Value
                code
                text={t("overview.derp.regionValue", {
                  id: derp.regionId,
                  code: derp.regionCode,
                  name: derp.regionName,
                })}
              />
            </Row>
            <Row label={t("overview.derp.relaySource")} note={t("overview.derp.relaySourceNote")}>
              <Value text={t(RELAY_SOURCE_KEYS[derp.relaySource])} />
            </Row>
            <Row label={t("overview.derp.urls")}>
              <Value
                text={
                  derp.urlCount > 0
                    ? t("overview.derp.countConfigured", { count: derp.urlCount })
                    : t("overview.derp.none")
                }
              />
            </Row>
            <Row label={t("overview.derp.paths")}>
              <Value
                text={
                  derp.pathCount > 0
                    ? t("overview.derp.countFiles", { count: derp.pathCount })
                    : t("overview.derp.none")
                }
              />
            </Row>
            <Row label={t("overview.derp.machines")} note={t("overview.derp.machinesNote")}>
              <Value text={derp.machinesInRegion} reason={machinesReason} />
            </Row>
          </Card>

          <Card
            icon={Radar}
            status={
              derp.ipv6StunWarning
                ? { tone: "warn", label: t("overview.status.attention") }
                : { tone: "neutral", label: t("overview.status.derived") }
            }
            title={t("overview.derp.publicTitle")}
          >
            <Row
              label={t("overview.derp.publicEndpoint")}
              note={t("overview.derp.publicEndpointNote")}
              status={{ tone: "neutral", label: t("overview.status.derived") }}
            >
              <Value
                {...textOrReason(derp.publicEndpoint, t("overview.derp.publicUnavailable"))}
                code
              />
            </Row>
            <Row
              label={t("overview.derp.declaredIpv4")}
              status={{ tone: "neutral", label: t("overview.status.configured") }}
            >
              <Value
                {...textOrReason(declaredAddress(derp.declared, "ipv4"), reason.notConfigured)}
                code
              />
            </Row>
            <Row
              label={t("overview.derp.declaredIpv6")}
              note={t("overview.derp.declaredNote")}
              status={{ tone: "neutral", label: t("overview.status.configured") }}
            >
              <Value
                {...textOrReason(declaredAddress(derp.declared, "ipv6"), reason.notConfigured)}
                code
              />
            </Row>
            <Row
              label={t("overview.derp.stun")}
              note={t("overview.derp.stunNote")}
              status={{ tone: "neutral", label: t("overview.status.configured") }}
            >
              <Value {...textOrReason(derp.stunListenAddr, reason.notConfigured)} code />
            </Row>

            {derp.ipv6StunWarning ? (
              <div className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex flex-col gap-1">
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
            icon={Cable}
            status={{
              tone: service.reachable ? "ok" : "error",
              label: service.reachable
                ? t("overview.status.reachable")
                : t("overview.status.unreachable"),
            }}
            title={t("overview.service.title")}
          >
            <Row
              label={t("overview.service.url")}
              status={{ tone: "neutral", label: t("overview.status.configured") }}
            >
              <Value code text={service.url} />
            </Row>
            <Row label={t("overview.service.baseDomain")}>
              <Value {...textOrReason(service.baseDomain, reason.notConfigured)} code />
            </Row>
            <Row label={t("overview.service.policyMode")}>
              <Value
                text={
                  service.policyMode === "database"
                    ? t("overview.service.policyModeDatabase")
                    : t("overview.service.policyModeFile")
                }
              />
            </Row>
          </Card>

          <Card
            icon={Globe}
            status={{
              tone: service.magicDns ? "ok" : "neutral",
              label: service.magicDns ? t("overview.status.on") : t("overview.status.off"),
            }}
            title={t("overview.service.dnsTitle")}
          >
            <Row label={t("overview.service.magicDns")}>
              <Value text={service.magicDns ? t("overview.status.on") : t("overview.status.off")} />
            </Row>
            <Row label={t("overview.service.overrideDns")}>
              <Value
                text={service.overrideDns ? t("overview.status.on") : t("overview.status.off")}
              />
            </Row>
            <Row
              label={t("overview.service.extraRecords")}
              note={t("overview.service.extraRecordsNote")}
            >
              <Value {...textOrReason(service.extraRecordsPath, reason.notConfigured)} code />
            </Row>
          </Card>

          <Card
            icon={Activity}
            status={{
              tone: METRICS_STATE_TONES[service.metrics.state],
              label: t(METRICS_STATE_KEYS[service.metrics.state]),
            }}
            title={t("overview.service.metricsTitle")}
          >
            <Row label={t("overview.service.metricsListener")}>
              <Value {...textOrReason(service.metrics.address, reason.notConfigured)} code />
            </Row>
            <Row label={t("overview.service.metricsEndpoint")}>
              <Value text={t(METRICS_STATE_KEYS[service.metrics.state])} />
            </Row>
            <Row label={t("overview.service.trustedProxies")}>
              <Value
                text={t("overview.service.trustedProxiesValue", {
                  count: service.trustedProxies,
                })}
              />
            </Row>
          </Card>
        </Section>

        <Section title={t("overview.sections.counts")}>
          <Card icon={Users} title={t("overview.counts.tailnetTitle")}>
            <Row label={t("overview.counts.nodes")}>
              <Value text={nodesText} reason={reason.api} />
            </Row>
            <Row label={t("overview.counts.users")}>
              <Value text={counts.users} reason={reason.api} />
            </Row>
            <Row label={t("overview.counts.preAuthKeys")}>
              <Value text={counts.preAuthKeys} reason={preAuthReason} />
            </Row>
            <Row label={t("overview.counts.apiKeys")}>
              <Value text={counts.apiKeys} reason={reason.api} />
            </Row>
          </Card>

          <Card icon={Camera} title={t("overview.counts.headplaneTitle")}>
            <Row label={t("overview.counts.audit")}>
              <Value text={counts.auditEntries} reason={reason.api} />
            </Row>
            <Row label={t("overview.counts.snapshots")}>
              <Value
                text={
                  counts.snapshots
                    ? t("overview.counts.snapshotsValue", {
                        count: counts.snapshots.count,
                        size: counts.snapshots.size ?? t("overview.reason.notReported"),
                      })
                    : undefined
                }
                reason={reason.api}
              />
            </Row>
          </Card>
        </Section>

        <Section title={t("overview.sections.health")}>
          <Card
            icon={HeartPulse}
            status={{
              tone: healthTone,
              label:
                healthTone === "ok" ? t("overview.status.healthy") : t("overview.status.attention"),
            }}
            title={t("overview.health.title")}
          >
            <Row label={t("overview.health.configChecks")}>
              <Value
                text={
                  health.configChecks ? t("overview.health.tally", health.configChecks) : undefined
                }
                reason={reason.config}
              />
            </Row>
            <Row label={t("overview.health.diagnostics")}>
              <Value text={t("overview.health.tally", healthTally)} />
            </Row>
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
  status?: { tone: SettingsStatusTone; label: string };
  children: ReactNode;
}

/**
 * A read-only card in the dashboard grid. It mirrors the settings cards, minus
 * the link: nothing on this page is a navigation target except the one line
 * that points at the system status page.
 */
function Card({ icon: Icon, title, status, children }: CardProps) {
  return (
    <section
      className={cn(
        "flex h-full flex-col gap-3 rounded-xl border p-4",
        "border-mist-200 bg-white shadow-surface",
        "dark:border-mist-800 dark:bg-mist-950/40",
      )}
    >
      <span className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            "bg-mist-100 text-mist-600 dark:bg-mist-800 dark:text-mist-300",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1 font-medium text-mist-900 dark:text-mist-50">{title}</span>
        {status ? <SettingsStatus tone={status.tone}>{status.label}</SettingsStatus> : undefined}
      </span>

      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

interface RowProps {
  label: string;
  /** A "configured" / "derived" chip that says where the value comes from. */
  status?: { tone: SettingsStatusTone; label: string };
  note?: string;
  children: ReactNode;
}

/** One label/value line, with an optional source chip and explanation. */
function Row({ label, status, note, children }: RowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 border-t border-mist-100 pt-2 first:border-t-0 first:pt-0",
        "dark:border-mist-800/60",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-mist-600 dark:text-mist-400">
          {label}
          {status ? <SettingsStatus tone={status.tone}>{status.label}</SettingsStatus> : undefined}
        </span>
        <span className="min-w-0 text-right text-sm font-medium break-words">{children}</span>
      </div>
      {note ? <span className="text-xs text-mist-500 dark:text-mist-400">{note}</span> : undefined}
    </div>
  );
}

/**
 * The value half of a row. A missing value renders as an em dash with the
 * caller's short reason, so an unreadable setting is never mistaken for an
 * empty one.
 */
function Value({
  text,
  reason,
  code = false,
}: {
  text?: string | number;
  reason?: string;
  code?: boolean;
}) {
  const { t } = useI18n();

  if (text === undefined) {
    return (
      <span className="text-mist-400 dark:text-mist-500">
        {reason ? t("overview.unavailableReason", { reason }) : t("overview.unavailable")}
      </span>
    );
  }

  const rendered = String(text);
  return code ? <Code>{rendered}</Code> : <span>{rendered}</span>;
}

function declaredAddress(declared: DeclaredDerpAddress[], family: "ipv4" | "ipv6") {
  return declared.find((entry) => entry.family === family)?.value;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorBanner className="max-w-2xl" error={error} />;
}
