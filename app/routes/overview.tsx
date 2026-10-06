import { dirname } from "node:path";

import {
  Activity,
  Bot,
  Cable,
  Camera,
  Check,
  CircleAlert,
  Copy,
  Globe,
  HeartPulse,
  LayoutDashboard,
  MapPinned,
  Network,
  Radar,
  Server,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { data, unstable_useRoute as useRoute } from "react-router";

import { AddressVisibilityMenu, useAddressVisibility } from "~/components/address-visibility";
import Button from "~/components/button";
import Code from "~/components/code";
import { ErrorBanner } from "~/components/error-banner";
import Link from "~/components/link";
import MaskedText from "~/components/masked-text";
import {
  OverviewCardHideButton,
  OverviewCardManager,
  useOverviewCardVisible,
  useOverviewCardsScope,
} from "~/components/overview-card-manager";
import { SettingsPage, SettingsStatus, type SettingsStatusTone } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import CopyValue from "~/routes/machines/components/copy-value";
import { FleetTrendBar } from "~/routes/machines/components/history-bar";
import { configuredDerpRegion, resolveDerpRegionLabel } from "~/routes/machines/derp-info";
import { relayAddressLines, type RelayAddressLine } from "~/routes/machines/relay-verdicts";
import {
  agentsContext,
  appConfigContext,
  auditContext,
  authContext,
  derpMirrorContext,
  derpSyncContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  nodeHistoryContext,
  requestApiContext,
  snapshotContext,
} from "~/server/context";
// Type-only: `derp-sync/types` also exports a value, which must not reach the
// component through this route module.
import type { DerpSyncOutcome } from "~/server/derp-sync/types";
import type { HeadscaleClient } from "~/server/headscale/api";
import { isDataUnauthorizedError } from "~/server/headscale/api/error-client";
import { formatServerVersion } from "~/server/headscale/api/server-version";
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { loadDerpNodeInventory } from "~/server/headscale/derp-region-sources";
import { computeFleetTrend, type FleetTrend } from "~/server/history/timeline";
import {
  loadHostIpv6Addresses,
  selectRelayIpv6,
  type HostProbeReason,
  type RelayIpv6Selection,
} from "~/server/host-addresses";
import { loadHostEcho, readHostEchoSettings, type HostEchoResult } from "~/server/host-echo";
import {
  buildRelayView,
  loadSharedRelayResolution,
  type RelayAddressFamily,
  type RelayAddressVerdict,
} from "~/server/relay-dns";
import { Capabilities } from "~/server/web/roles";
import type { Key, Machine, PreAuthKey, User } from "~/types";
import { maskAddress } from "~/utils/address-visibility";
import cn from "~/utils/cn";
import { copyToClipboard } from "~/utils/copy";
import { alertingOverviewCards, type OverviewCardId } from "~/utils/overview-cards";
import toast from "~/utils/toast";

import type { Route } from "./+types/overview";
import {
  type CheckStatus,
  type CheckTally,
  countNodeStatus,
  declaredDerpAddresses,
  type DeclaredDerpAddress,
  derpNodeSources,
  type DerpNodeSource,
  type DerpNodeSourceGap,
  type DerpNodeSourceKind,
  type DerpNodeSourceMap,
  type DerpNodeSourceState,
  formatByteSize,
  hasIpv6StunWarning,
  readExtraRecordsPath,
  type RelayReason,
  relayIpv6NoteKind,
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

/** Why a source had nothing to say; each is a note, never a failure. */
const IPV6_REASON_KEYS: Record<HostProbeReason, TranslationKey> = {
  "os-unreadable": "overview.derp.ipv6ReasonOsUnreadable",
  "proc-unreadable": "overview.derp.ipv6ReasonProcUnreadable",
  "sys-unreadable": "overview.derp.ipv6ReasonSysUnreadable",
  disabled: "overview.derp.ipv6ReasonEchoDisabled",
  timeout: "overview.derp.ipv6ReasonEchoTimeout",
  unreachable: "overview.derp.ipv6ReasonEchoUnreachable",
  invalid: "overview.derp.ipv6ReasonEchoInvalid",
};

/** The one line that says what the last address sync or check did, and when. */
const SYNC_STATUS_KEYS: Record<DerpSyncOutcome, TranslationKey> = {
  changed: "overview.derp.syncChangedAt",
  unchanged: "overview.derp.syncUnchangedAt",
  skipped: "overview.derp.syncSkippedAt",
  failed: "overview.derp.syncFailedAt",
};

/** Where a node of the DERP nodes card comes from, as its row is titled. */
const NODE_SOURCE_KEYS: Record<DerpNodeSourceKind, TranslationKey> = {
  embedded: "overview.derp.nodesSourceEmbedded",
  local: "overview.derp.nodesSourceLocal",
  mirror: "overview.derp.nodesSourceMirror",
  official: "overview.derp.nodesSourceOfficial",
};

/**
 * The hover text of one source row: what that source is for, kept off the card
 * body so a row stays a title and its count.
 */
const NODE_SOURCE_HINT_KEYS: Record<DerpNodeSourceKind, TranslationKey> = {
  embedded: "overview.derp.nodesSourceEmbeddedHint",
  local: "overview.derp.nodesSourceLocalHint",
  mirror: "overview.derp.nodesSourceMirrorHint",
  official: "overview.derp.nodesSourceOfficialHint",
};

/**
 * The one chip a source row shows, as the state the configuration derives: this
 * machine serves it, it is configured but not loaded yet, Tailscale serves it
 * upstream, or nothing is configured for it at all.
 */
const NODE_SOURCE_STATE_KEYS: Record<DerpNodeSourceState, TranslationKey> = {
  served: "overview.derp.nodesServedHere",
  pending: "overview.derp.nodesPendingUnlisted",
  upstream: "overview.derp.nodesProvidedUpstream",
  off: "overview.derp.nodesNotEnabled",
};

/** How loud that chip is: only "configured but not in effect" asks for a look. */
const NODE_SOURCE_STATE_TONES: Record<DerpNodeSourceState, SettingsStatusTone> = {
  served: "ok",
  pending: "warn",
  upstream: "neutral",
  off: "neutral",
};

/**
 * The keyboard ring the DERP nodes card's scrolling box reads with. Nothing in
 * the card collapses any more, so the box shares its height budget across every
 * source: it takes focus so the overflow a bounded height hides stays reachable
 * without a pointer.
 */
const SCROLL_BOX_RING =
  "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1 dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900";

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
  const derpMirror = context.get(derpMirrorContext);
  const derpSync = context.get(derpSyncContext);
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
  // breaks the dashboard because a name did not resolve. Region names come from
  // the same chain the machine page uses, so the two cards cannot word a region
  // differently: the manual mapping first, then the configured DERP maps.
  //
  // IPv6 has no NAT in the usual case, so the address lives on the machine
  // itself; the host probe is therefore always read, even when `derp.server.ipv6`
  // is declared, because the two disagreeing is exactly what the operator has to
  // see. That probe is cached, and the optional external echo — off unless an
  // operator turned it on — adds the address the internet actually sees, which
  // is the only source that is right behind NAT66. Both run inside the same
  // parallel batch as everything else on this page.
  const dataPath = appConfig.server.data_path;
  const relayEndpoint = deriveDerpPublicEndpoint(derp.serverUrl);
  const hostAddressLookup = loadHostIpv6Addresses();
  // Read-only, like everything else on this page: the switch and the endpoint
  // are edited in the DERP sync card (`Settings → Headscale`), so this only
  // reads them to decide whether to ask an endpoint at all, and the answer it
  // gets back is what the IPv6 row shows.
  const hostEchoLookup = (async (): Promise<HostEchoResult> => {
    const settings = await readHostEchoSettings(dataPath);
    return settings.enabled ? await loadHostEcho(settings) : { reason: "disabled", attempted: [] };
  })();

  // Headplane's own DERP state, read once and in the same batch: the region
  // filter's target path is what tells its file apart from a plain local map
  // file, and the address sync's newest run is one line on the relay card. Only
  // a run that actually changed an address reaches it; a check that found
  // nothing to do stays on the settings page, where the schedule is configured.
  const mirrorSettingsLookup = (async () => {
    await derpMirror.ready();
    return derpMirror.settings();
  })();
  const syncRunLookup = (async () => {
    await derpSync.ready();
    return derpSync.last();
  })();

  // The configured maps, held apart by source. This is the same read the region
  // names come from — one pass per local file through the cached reader, one
  // fetch per URL through the shared remote cache — so the node card costs the
  // page nothing beyond the documents it already reads. The filter's own file is
  // read here even while `derp.paths` leaves it out, which is why the switch is
  // handed over with its path.
  const nodeInventoryLookup = (async () => {
    const mirror = await mirrorSettingsLookup;
    return loadDerpNodeInventory({
      paths: derp.paths,
      urls: derp.urls,
      autoUpdateEnabled: derp.autoUpdateEnabled,
      updateFrequency: derp.updateFrequency,
      baseDir: configPath ? dirname(configPath) : undefined,
      mirrorPath: mirror.targetPath,
      mirrorEnabled: mirror.enabled,
    });
  })();

  const [
    relayResolution,
    regionNames,
    nodeInventory,
    hostAddresses,
    hostEcho,
    mirrorSettings,
    syncRun,
  ] = await Promise.all([
    loadSharedRelayResolution(relayEndpoint?.host),
    readDerpRegionNames(dataPath),
    nodeInventoryLookup,
    hostAddressLookup,
    hostEchoLookup,
    mirrorSettingsLookup,
    syncRunLookup,
  ]);
  const relayView = buildRelayView(relayEndpoint, relayResolution, derp.server);
  // The echo answer is only worth reporting when it is a real one: a disabled
  // probe and a probe that failed both leave the row to the local sources, with
  // the failure recorded as a reason rather than as a missing address.
  const echoAddress = hostEcho.address;
  const probeReasons: HostProbeReason[] = [
    ...(hostAddresses?.reasons ?? []),
    ...(hostEcho.reason === undefined || hostEcho.reason === "disabled" ? [] : [hostEcho.reason]),
  ];

  // A literal endpoint is its own address, and an unusable `server_url` has no
  // hostname to compare against: both keep the row exactly as it read before.
  const relayIpv6 =
    relayView.host === undefined || relayResolution?.kind === "literal"
      ? undefined
      : selectRelayIpv6({
          declared: derp.server.ipv6,
          candidates: hostAddresses?.candidates,
          namespace: hostAddresses?.namespace,
          dns: relayResolution?.ipv6,
          reason: relayResolution?.reason,
          probeReasons,
          excluded: hostAddresses?.excluded,
          ...(echoAddress === undefined
            ? {}
            : {
                echo: {
                  address: echoAddress,
                  ...(hostEcho.url === undefined ? {} : { url: hostEcho.url }),
                },
              }),
        });

  // Every node the configuration describes, grouped by the source that
  // describes it: the embedded relay, the `derp.paths` files, the file the
  // official-region filter maintains, and the regions a configured `derp.urls`
  // map adds that this machine does not serve itself. The counts are the real
  // ones — a region an earlier source described is not counted twice — and no
  // name is resolved over DNS here: the card prints the region names and the
  // addresses the maps declare, so a map with dozens of nodes cannot turn one
  // render into dozens of lookups. The manual mapping is handed over with them,
  // because it is the name the operator chose for a region.
  const nodeSources = derpNodeSources({
    embedded: {
      enabled: derp.server.enabled,
      regionId: derp.server.regionId,
      code: derp.server.regionCode,
      name: derp.server.regionName,
      ...(relayView.host?.endpoint === undefined ? {} : { endpoint: relayView.host.endpoint }),
    },
    groups: nodeInventory.groups,
    mirrorEnabled: mirrorSettings.enabled,
    manual: regionNames,
  });

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
      // The region `derp.server` configures, plus every source that can name a
      // region; the card runs them through the shared label helper, so this row
      // reads exactly like a region on the machine page.
      region: configuredDerpRegion(derp.server),
      regions: {
        manual: regionNames,
        local: nodeInventory.local,
        remote: nodeInventory.remote,
      },
      // What the configured maps, the embedded relay and the official map add up
      // to, one entry per source, derived here so the card only formats values.
      // Plain values only: the card never imports a module that reads a file.
      nodes: nodeSources,
      relaySource: classifyDerpRelaySource({
        serverEnabled: derp.server.enabled,
        urls: derp.urls,
      }),
      urlCount: derp.urls.length,
      pathCount: derp.paths.length,
      // The newest address sync or check, whatever it did: the card shows one
      // line with its result and time, so a healthy schedule can be told from
      // one that never ran. Plain values only.
      sync: syncRun === undefined ? undefined : { at: syncRun.at, outcome: syncRun.outcome },
      relay: {
        endpoint: relayView.host?.endpoint,
        host: relayView.host?.hostname,
        // One line per family: the address `derp.server` declares when it sets
        // one, the lookup's own A/AAAA answer otherwise, so the card never asks
        // an operator to compare a declared block against a resolved one. The
        // lines are flattened to plain values here, because the card must not
        // import a module that reaches Node-only code (see `./relay-verdicts`).
        lines: relayAddressLines(derp.server, relayResolution),
        // The IPv6 row reads its own selection instead: the address
        // `derp.server` declares, the machine's own global unicast address
        // cross-checked against the domain's AAAA, or the DNS answer labelled
        // unverified. `undefined` means there was no hostname to derive from at
        // all (a literal endpoint, or an unusable `server_url`), which is the
        // one case the line above already words on its own.
        ipv6: relayIpv6,
      },
      declared: declaredDerpAddresses(derp.server),
      stunListenAddr: derp.server.stunListenAddr,
      ipv6StunWarning: hasIpv6StunWarning({
        enabled: derp.server.enabled,
        ipv6: derp.server.ipv6,
        stunListenAddr: derp.server.stunListenAddr,
      }),
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

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr, locale } = useI18n();
  const { versions, derp, service, counts, health, history } = loaderData;
  const layout = useRoute("layout/app");
  const trendSummary = history.trend ? summarizeFleetTrend(history.trend) : undefined;

  // Addresses and hostnames are masked by default. The address rows mask
  // themselves through `CopyValue`; the sentences and hover texts that quote an
  // address have to ask, so they interpolate the same fixed mask instead.
  const { hidden, revealAll } = useAddressVisibility();
  const addressesHidden = hidden && !revealAll;
  const masked = (value: string) => maskAddress(value, addressesHidden);

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

  const healthTally = health.diagnostics;
  const healthTone: SettingsStatusTone =
    healthTally.fail > 0 ? "error" : healthTally.warning > 0 ? "warn" : "ok";

  // The cards whose own content is an alert, so they must stay visible whatever
  // the stored choice says. The health summary is deliberately absent: it is a
  // summary, not an alert, and the operator asked to be able to hide it even
  // while it is not perfectly healthy — a failing check still reaches them
  // through the notification webhooks. The helper drops the listed cards from
  // the hidden set, so nothing else has to remember to show them again.
  const alertingCards = alertingOverviewCards({
    "versions-headplane": versions.headplane.updateAvailable,
    "versions-headscale": versions.headscale.updateAvailable,
    "versions-agent": versions.agent.error !== undefined,
    "derp-relay":
      derp.ipv6StunWarning ||
      derp.sync?.outcome === "failed" ||
      derp.relay.ipv6?.contradiction !== undefined ||
      derp.relay.ipv6?.mismatch === true,
    "derp-nodes": derp.nodes.sources.some((source) => source.gap === "unreadable"),
    "service-server": !service.reachable,
    "service-metrics":
      service.metrics.state === "unreachable" || service.metrics.state === "invalid",
    "counts-tailnet": counts.nodes === undefined,
    "counts-headplane": counts.auditEntries === undefined || counts.snapshots === undefined,
  });

  // The card visibility preference belongs to whoever is looking, so the page
  // has to say who that is: the app layout reports the identity the header
  // shows. Binding it here reads the stored choice once, after mount.
  useOverviewCardsScope(layout?.loaderData?.user.subject ?? "", alertingCards);

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

    const address = masked(line.addresses[0] ?? "");
    const note = t(RELAY_VERDICT_KEYS[verdict], { address });
    const fix = RELAY_FIX_KEYS[line.family][verdict];
    return fix === undefined ? note : `${note} · ${t(fix, { address, host: masked(host ?? "") })}`;
  };

  /** The one short line a family with nothing to print reads as. */
  const relayLineText = (line: RelayAddressLine) =>
    line.verdict === undefined
      ? relayReason(line.reason ?? "unavailable")
      : t(RELAY_VERDICT_KEYS[line.verdict], { address: "" });

  // The IPv6 half of the address block, prepared by the loader: the address
  // `derp.server` declares, the machine's own address cross-checked against the
  // domain's AAAA, or the DNS answer labelled unverified. It is absent only when
  // there was no hostname to derive from, which is exactly when the line above
  // words the row on its own.
  const relayIpv6 = derp.relay.ipv6;
  const ipv6LegacyLine = derp.relay.lines.find((line) => line.family === "ipv6");

  /**
   * Where a derived IPv6 address came from, as the chip next to the label.
   *
   * A namespace that could not be confirmed gets no chip at all: "Host" would
   * be a claim the probe cannot back, and the "Host (unconfirmed)" wording that
   * used to sit here explained itself with the very Docker bridges a Docker
   * host always shows. Silence is the honest option.
   */
  const ipv6SourceChip = (selection: RelayIpv6Selection) => {
    if (selection.source === "declared") {
      return relayDeclaredMarker;
    }

    if (selection.source === "echo") {
      return { tone: "neutral" as const, label: t("overview.derp.relaySourceEcho") };
    }

    if (selection.source === "host") {
      return selection.unconfirmed
        ? undefined
        : { tone: "neutral" as const, label: t("overview.derp.relaySourceHost") };
    }

    if (selection.source === "dns") {
      return { tone: "neutral" as const, label: t("overview.derp.relaySourceDnsUnverified") };
    }

    return undefined;
  };

  /**
   * The hover text of the IPv6 row. Which note wins is decided by
   * {@link relayIpv6NoteKind}, so the precedence is testable; this only words
   * it. It never reaches the card body: the row is the value and its copy
   * affordance, and an explanation that still has to exist lives in the title.
   */
  const ipv6Note = (selection: RelayIpv6Selection) => {
    const note = relayIpv6NoteKind(selection);
    switch (note?.kind) {
      case undefined:
        return undefined;
      case "declared":
        return ipv6LegacyLine === undefined
          ? undefined
          : relayVerdictNote(ipv6LegacyLine, derp.relay.host);
      case "echo-match":
        return t("overview.derp.ipv6EchoMatches", { address: masked(note.address) });
      case "echo-forwarded":
        return t("overview.derp.ipv6EchoForwarded", { address: masked(note.address) });
      case "unverified":
        return t("overview.derp.ipv6UnverifiedNote");
      case "dns-fallback":
        return t("overview.derp.ipv6NoneBody");
      case "probe":
        return note.reasons.map((entry) => t(IPV6_REASON_KEYS[entry])).join(" ");
      case "alternates":
        return t("overview.derp.ipv6Alternates", {
          addresses: masked(note.addresses.join(", ")),
        });
    }
  };

  /** The sentence a derived IPv6 row with nothing to print reads as. */
  const ipv6StateText = (selection: RelayIpv6Selection) =>
    selection.state === "no-host-address"
      ? t("overview.derp.ipv6NoneBody")
      : relayReason(selection.state ?? "unavailable");

  // The node inventory the loader derived, as one row per source. The card only
  // formats these values: the counts came from the configuration this render
  // read, and no row claims a node the configuration does not describe.
  const nodeSources = derp.nodes.sources;

  /** The name of one source, as the card's rows and the empty copy read it. */
  const nodeSourceLabel = (kind: DerpNodeSourceKind) => t(NODE_SOURCE_KEYS[kind]);

  /**
   * Why a source with no node reads as it does. Every one is a reason, never an
   * error: a relay that is switched off, a source nothing is configured for,
   * files nobody could read, a map that lists no node, a filtered file that is
   * not one of the maps Headscale loads, and an upstream this machine already
   * covers completely. Each is one short line: the row is a title and a count,
   * and the reason it needs to state has to fit beside them.
   */
  const nodeSourceGap = (kind: DerpNodeSourceKind, gap: DerpNodeSourceGap) => {
    if (kind === "embedded") {
      return t("overview.derp.nodesEmbeddedOff");
    }

    if (kind === "mirror") {
      if (gap === "unlisted") {
        return t("overview.derp.nodesMirrorUnlisted");
      }
      if (gap === "unconfigured") {
        return t("overview.derp.nodesMirrorOff");
      }
    }

    if (kind === "official" && gap === "covered") {
      return t("overview.derp.nodesOfficialCovered");
    }

    switch (gap) {
      case "unconfigured":
        return kind === "official"
          ? t("overview.derp.nodesOfficialNoUrls")
          : t("overview.derp.nodesLocalNone");
      case "unreadable":
        return t("overview.derp.nodesUnreadable");
      default:
        return t("overview.derp.nodesEmpty");
    }
  };

  /**
   * The one short hint a closed row shows, or `undefined` when the row, its
   * count and its state chip already say everything: why the source lists no
   * node. A source that *does* list nodes needs no hint any more — the chip
   * names who serves them.
   */
  const nodeSourceHint = (source: DerpNodeSource) =>
    source.gap === undefined ? undefined : nodeSourceGap(source.kind, source.gap);

  /** Why one map of a source contributed nothing, in one short sentence. */
  const nodeMapNotice = (kind: DerpNodeSourceKind, map: DerpNodeSourceMap) => {
    // A URL that could not be read is a fetch, not a mount: the two read as
    // different sentences because the fix is different.
    const remote = kind === "official";
    switch (map.state) {
      case "unreadable":
        return remote
          ? t("overview.derp.nodesUrlUnreadable", { url: map.source })
          : t("overview.derp.nodesFileUnreadable", { path: map.source });
      case "invalid":
        return t("overview.derp.nodesFileInvalid", { path: map.source });
      default:
        return remote
          ? t("overview.derp.nodesUrlEmpty", { url: map.source })
          : t("overview.derp.nodesFileEmpty", { path: map.source });
    }
  };

  return (
    <SettingsPage
      // The dashboard is a grid of cards, not a form: it takes the page width
      // every other page has. `SettingsPage` caps itself at `md:max-w-4xl` for
      // the settings forms, so the one class is overridden here (and on the
      // settings hub) to the shell's own `container` width — the same right
      // edge the header's controls and the machines list share.
      className="md:max-w-none"
      description={t("overview.intro")}
      title={t("overview.title")}
    >
      {/* Personal, presentation-only: which cards this browser shows, and
          whether the addresses on them stay masked. */}
      <div className="flex flex-wrap justify-end gap-2">
        <AddressVisibilityMenu />
        <OverviewCardManager />
      </div>
      {/* One continuous grid: the cards are not grouped by anything the page
          prints, so the headings that used to sit between the rows are gone and
          a hidden card simply closes its own gap.

          The column count comes from the content, not from a fixed four. A
          track is `24rem` because that is the narrowest card the widest content
          fits in: the counts cards hold two tiles side by side and their longest
          split line ("12 online · 3 offline" / "12 在线 · 3 离线") measures
          ~21.5rem inside them, and a relay card has to show a full IPv6 address
          with its copy and reveal controls (~19rem) beside its label. `auto-fit`
          then fits as many of those tracks as the container allows, so a row
          holds as many cards as fit without clipping — three of them on a
          1536px display, where a fixed four left 327px cards — and `items-stretch`
          with the cards' own `h-full` keeps every card in a row the same height. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(24rem,1fr))] items-stretch gap-3">
        <Card
          cardId="versions-headplane"
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
          cardId="versions-headscale"
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
          cardId="versions-agent"
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
                <p className="text-xs text-mist-500 dark:text-mist-400">{versions.agent.reason}</p>
              ) : undefined}
            </div>
          )}
        </Card>
        <Card
          cardId="derp-region"
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
              text={
                resolveDerpRegionLabel(
                  derp.region?.regionId,
                  { ...derp.regions, embedded: derp.region },
                  t("machines.detail.derp.unknown"),
                ).label
              }
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
          </Facts>
        </Card>

        <Card
          cardId="derp-relay"
          description={t("overview.derp.publicBody")}
          icon={Radar}
          status={
            derp.ipv6StunWarning ? { tone: "warn", label: t("overview.status.attention") } : derived
          }
          title={t("overview.derp.publicTitle")}
        >
          <Facts>
            <Fact
              code
              label={t("overview.derp.relayClientAddress")}
              reason={t("overview.derp.publicUnavailable")}
            >
              {derp.relay.endpoint === undefined ? undefined : (
                <MaskedText
                  className="font-mono text-xs text-mist-900 dark:text-mist-50"
                  value={derp.relay.endpoint}
                />
              )}
            </Fact>
            {derp.relay.lines.map((line) => {
              const selection = line.family === "ipv6" ? relayIpv6 : undefined;
              const addresses = selection?.addresses ?? line.addresses;

              return (
                <Fact
                  key={line.family}
                  hint={
                    selection === undefined
                      ? relayVerdictNote(line, derp.relay.host)
                      : ipv6Note(selection)
                  }
                  label={relayFamilyLabel(line.family)}
                  source={
                    selection === undefined
                      ? line.source === "declared"
                        ? relayDeclaredMarker
                        : undefined
                      : ipv6SourceChip(selection)
                  }
                >
                  {addresses.length > 0 ? (
                    <RelayAddresses addresses={addresses} />
                  ) : (
                    <span className="text-xs text-mist-500 dark:text-mist-400">
                      {selection === undefined ? relayLineText(line) : ipv6StateText(selection)}
                    </span>
                  )}
                </Fact>
              );
            })}
            {derp.stunListenAddr ? (
              <Fact code label={t("overview.derp.stun")}>
                <MaskedText
                  className="font-mono text-xs text-mist-900 dark:text-mist-50"
                  value={derp.stunListenAddr}
                />
              </Fact>
            ) : undefined}
          </Facts>

          {/* A declared address that no source agrees with: the operator has to
                see both values, and the one clients should use is one click away. */}
          {relayIpv6?.contradiction !== undefined && relayIpv6.copy !== undefined ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/25 dark:text-amber-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="font-medium">{t("overview.derp.ipv6ContradictionTitle")}</span>
                <span>
                  {t(
                    relayIpv6.contradiction.source === "echo"
                      ? "overview.derp.ipv6ContradictionEcho"
                      : "overview.derp.ipv6ContradictionHost",
                    {
                      declared: masked(relayIpv6.contradiction.declared),
                      detected: masked(relayIpv6.contradiction.detected),
                    },
                  )}
                </span>
                <CopyAddress
                  address={relayIpv6.copy}
                  label={t("overview.derp.ipv6ContradictionCopy")}
                />
              </div>
            </div>
          ) : undefined}

          {relayIpv6?.mismatch && relayIpv6.copy !== undefined ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/25 dark:text-amber-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="font-medium">{t("overview.derp.ipv6MismatchTitle")}</span>
                <span>
                  {t("overview.derp.ipv6MismatchBody", {
                    dns: masked(relayIpv6.dns.join(", ")),
                    host: masked(relayIpv6.copy),
                  })}
                </span>
                <CopyAddress address={relayIpv6.copy} />
              </div>
            </div>
          ) : undefined}

          {derp.ipv6StunWarning ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-500/25 dark:text-amber-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{t("overview.derp.ipv6StunTitle")}</span>
                <span>
                  {t("overview.derp.ipv6StunBody", {
                    ipv6: masked(declaredAddress(derp.declared, "ipv6") ?? ""),
                    stun: masked(derp.stunListenAddr),
                  })}
                </span>
              </div>
            </div>
          ) : undefined}

          {/* One short line: what the last address sync or check did, and when.
                The switch that changes any of this lives in the settings card,
                which is what the link under it points at. */}
          <div className="flex flex-col gap-1 text-xs text-mist-500 dark:text-mist-400">
            <p>
              {derp.sync === undefined
                ? t("overview.derp.syncNever")
                : t(SYNC_STATUS_KEYS[derp.sync.outcome], {
                    at: new Date(derp.sync.at).toLocaleString(locale),
                  })}
            </p>
            <p>
              {tr("overview.derp.relaySetup", {
                link: (
                  <Link
                    className="font-medium text-indigo-600 dark:text-indigo-400"
                    to="/settings/headscale"
                  >
                    {t("overview.derp.relaySetupLink")}
                  </Link>
                ),
              })}
            </p>
          </div>
        </Card>

        <Card
          cardId="derp-nodes"
          description={t("overview.derp.nodesBody")}
          icon={MapPinned}
          status={{
            tone: "neutral",
            label: t("overview.derp.nodesSummary", {
              served: derp.nodes.served,
              total: derp.nodes.total,
            }),
          }}
          title={t("overview.derp.nodesTitle")}
        >
          {/* One group per source, with its regions listed straight away — no
                row collapses, so the card reads top to bottom: the embedded
                relay first, then the two files this machine loads, then the
                official map that only the clients reach. Each line is the region
                id, the name it is known by and how many nodes that source
                contributes to it; the endpoints a node declares stay in the
                row's hover text, so the body stays one line per region. The box
                keeps a bounded height and scrolls in place, which is what keeps
                this card from growing past its two siblings; it takes focus, so
                nothing the bound hides is out of reach of a keyboard. */}
          <div
            aria-label={t("overview.derp.nodesSourcesLabel")}
            className={cn(
              "flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg",
              SCROLL_BOX_RING,
            )}
            role="group"
            tabIndex={0}
          >
            {nodeSources.map((source) => (
              <section className="flex flex-col gap-1" key={source.kind}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-mist-900 dark:text-mist-50"
                    title={t(NODE_SOURCE_HINT_KEYS[source.kind])}
                  >
                    {nodeSourceLabel(source.kind)}
                    <SettingsStatus tone={NODE_SOURCE_STATE_TONES[source.state]}>
                      {t(NODE_SOURCE_STATE_KEYS[source.state])}
                    </SettingsStatus>
                  </span>
                  <SettingsStatus tone={source.state === "served" ? "neutral" : "warn"}>
                    {t("overview.derp.nodesCount", { count: source.nodes.length })}
                  </SettingsStatus>
                </div>

                {source.regions.length === 0 ? (
                  <p className="text-xs text-mist-600 dark:text-mist-400">
                    {nodeSourceHint(source) ?? t("overview.derp.nodesEmpty")}
                  </p>
                ) : (
                  <ul className="flex flex-col">
                    {source.regions.map((region) => {
                      // The row is one line: the addresses live in its title.
                      const endpoints = region.endpoints.join(", ");

                      return (
                        <li
                          className="flex flex-wrap items-center justify-between gap-2 border-t border-mist-100 py-1 first:border-t-0 first:pt-0 last:pb-0 dark:border-mist-800/60"
                          key={region.regionId}
                        >
                          <span
                            className="flex min-w-0 items-center gap-1.5"
                            // The endpoints are addresses, so the hover text
                            // is dropped while addresses are hidden.
                            title={
                              addressesHidden || endpoints.length === 0 ? undefined : endpoints
                            }
                          >
                            <span className="font-mono text-xs text-mist-500 dark:text-mist-400">
                              #{region.regionId}
                            </span>
                            {region.name === undefined ? undefined : (
                              <span className="min-w-0 truncate text-xs text-mist-900 dark:text-mist-50">
                                {region.name}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-mist-500 dark:text-mist-400">
                            {t("overview.derp.nodesCount", { count: region.nodeCount })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* The maps behind the source, and the reason a map nobody
                      could read contributed nothing: one short line each, never
                      an error. */}
                {source.maps
                  .filter((map) => map.state !== "ok")
                  .map((map) => (
                    <p className="text-xs text-mist-500 dark:text-mist-400" key={map.source}>
                      {nodeMapNotice(source.kind, map)}
                    </p>
                  ))}
              </section>
            ))}
          </div>

          {/* Where a node is actually defined: Headscale's embedded relay and
                every file under `derp.paths` are edited in the DERP settings, so
                this card links there instead of growing a form of its own. */}
          <p className="text-xs text-mist-500 dark:text-mist-400">
            <Link
              className="font-medium text-indigo-600 dark:text-indigo-400"
              to="/settings/headscale"
            >
              {t("overview.derp.nodesAddLink")}
            </Link>
          </p>
        </Card>
        <Card
          cardId="service-server"
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
            <Fact label={t("overview.service.url")} source={configured}>
              <MaskedText
                className="font-mono text-xs text-mist-900 dark:text-mist-50"
                value={service.url}
              />
            </Fact>
            <Fact
              label={t("overview.service.baseDomain")}
              reason={reason.notConfigured}
              source={configured}
            >
              {service.baseDomain ? (
                <MaskedText
                  className="font-mono text-xs text-mist-900 dark:text-mist-50"
                  value={service.baseDomain}
                />
              ) : undefined}
            </Fact>
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
          cardId="service-dns"
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
          cardId="service-metrics"
          description={t("overview.service.metricsBody")}
          icon={Activity}
          status={{
            tone: METRICS_STATE_TONES[service.metrics.state],
            label: t(METRICS_STATE_KEYS[service.metrics.state]),
          }}
          title={t("overview.service.metricsTitle")}
        >
          <Facts>
            <Fact code label={t("overview.service.metricsListener")} reason={reason.notConfigured}>
              {service.metrics.address ? (
                <MaskedText
                  className="font-mono text-xs text-mist-900 dark:text-mist-50"
                  value={service.metrics.address}
                />
              ) : undefined}
            </Fact>
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
        <Card
          cardId="counts-tailnet"
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
            <CountTile label={t("overview.counts.users")} reason={reason.api} text={counts.users} />
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
          cardId="counts-headplane"
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
          cardId="counts-history"
          description={t("overview.history.body")}
          icon={TrendingUp}
          title={t("overview.history.title")}
        >
          {history.trend !== undefined && trendSummary !== undefined && trendSummary.covered > 0 ? (
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
        <Card
          cardId="health-summary"
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
      </div>
    </SettingsPage>
  );
}

interface CardProps {
  icon: LucideIcon;
  title: string;
  /** Which hideable card this is, so the manager and the header control agree. */
  cardId: OverviewCardId;
  /** One line on what the card's facts describe. */
  description: string;
  status?: { tone: SettingsStatusTone; label: string };
  children: ReactNode;
}

/**
 * A card in the dashboard grid. It keeps the settings card geometry (radius,
 * border, padding, icon tile) but has no hover state of its own: only the links
 * and controls that point at another page are navigation targets.
 *
 * A hidden card renders nothing at all, so the grid closes the gap instead of
 * leaving a hole; hiding is presentation only and never touches the loader.
 */
function Card({ cardId, icon: Icon, title, description, status, children }: CardProps) {
  const visible = useOverviewCardVisible(cardId);
  if (!visible) {
    return undefined;
  }

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
        <OverviewCardHideButton cardId={cardId} />
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
  /**
   * An explanation kept for whoever hovers the row. Anything that would have
   * been a paragraph under the label goes here instead, so the card body stays
   * the values an operator acts on.
   */
  hint?: string;
  /** The value; a chip's worth of markup instead when the value is a status. */
  children?: ReactNode;
  code?: boolean;
  text?: string | number;
  reason?: string;
}

/**
 * One fact of a card: a label (with its source chip and explanation) over a
 * value. The pair is stacked on a phone and put on one line from `sm` up.
 *
 * The value is what the card is read for, so it is never the part that gives
 * way: on a wide card the two share a line, but the value always keeps at least
 * `14rem` — the widest value a card prints ("Embedded server and DERP map" next
 * to its label) — and when a long label or its note would eat into that, the
 * value drops to a line of its own instead of being clipped to an ellipsis. It
 * still truncates, with its full text in the title, in the one case nothing can
 * help: a value longer than the whole row.
 */
function Fact({ label, source, note, hint, children, code = false, text, reason }: FactProps) {
  const { t } = useI18n();

  return (
    <div
      className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-4"
      title={hint}
    >
      <dt className="flex min-w-0 flex-col gap-0.5 text-sm text-mist-600 sm:max-w-[55%] dark:text-mist-400">
        <span className="flex flex-wrap items-center gap-1.5">
          {label}
          {source ? <SettingsStatus tone={source.tone}>{source.label}</SettingsStatus> : undefined}
        </span>
        {note ? (
          <span className="text-xs text-mist-500 dark:text-mist-400">{note}</span>
        ) : undefined}
      </dt>
      <dd className="min-w-0 sm:min-w-[14rem] sm:flex-1 sm:text-right">
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
      {/* The grid's own track never gets narrower than `24rem`, so the tile
          takes the comfortable padding above instead of the smaller one a fixed
          four-per-row used to force. A label that still has to wrap does, rather
          than truncating: a count whose name is cut off tells the operator
          nothing. */}
      <dt className="text-xs break-words text-mist-500 dark:text-mist-400">{label}</dt>
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

/**
 * The value of one relay address row: the address itself and the copy glyph the
 * rest of the dashboard uses, one under the other when a family has several.
 * Nothing else is rendered next to it — the row is the address, and the copy
 * click is the whole interaction.
 */
function RelayAddresses({ addresses }: { addresses: readonly string[] }) {
  const { t } = useI18n();

  return (
    <span className="flex flex-col gap-0.5 sm:items-end">
      {addresses.map((address) => (
        <CopyValue
          key={address}
          className="w-auto"
          copiedMessage={t("common.copied")}
          reveal="always"
          value={address}
        />
      ))}
    </span>
  );
}

/**
 * The copy affordance under an IPv6 warning. One click puts the address that
 * should be used on the clipboard; a copy the browser refuses is reported as a
 * toast, never as an error page.
 */
function CopyAddress({ address, label }: { address: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!(await copyToClipboard(address))) {
      toast(t("common.copyFailed"));
      return;
    }

    toast(t("common.copied"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  };

  return (
    <Button className="self-start" onClick={onCopy} type="button">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {label ?? t("overview.derp.ipv6HostCopy")}
    </Button>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorBanner className="max-w-2xl" error={error} />;
}
