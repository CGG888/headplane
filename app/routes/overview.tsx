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
import { useEffect, useState, type ReactNode } from "react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Code from "~/components/code";
import { ErrorBanner } from "~/components/error-banner";
import Input from "~/components/input";
import Link from "~/components/link";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsField,
  SettingsPage,
  SettingsStatus,
  type SettingsStatusTone,
} from "~/components/settings-nav";
import Switch from "~/components/switch";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import CopyValue from "~/routes/machines/components/copy-value";
import { FleetTrendBar } from "~/routes/machines/components/history-bar";
import RelayResolver from "~/routes/machines/components/relay-resolver";
import { configuredDerpRegion, resolveDerpRegionLabel } from "~/routes/machines/derp-info";
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
  derpSyncContext,
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
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { loadDerpRegionInventory } from "~/server/headscale/derp-region-sources";
import { computeFleetTrend, type FleetTrend } from "~/server/history/timeline";
import {
  loadHostIpv6Addresses,
  selectRelayIpv6,
  type HostIpv6Stability,
  type HostProbeReason,
  type RelayIpv6Selection,
} from "~/server/host-addresses";
import {
  clearHostEchoCache,
  DEFAULT_HOST_ECHO_URL,
  FALLBACK_HOST_ECHO_URLS,
  loadHostEcho,
  parseHostEchoUrl,
  readHostEchoSettings,
  writeHostEchoSettings,
  type HostEchoResult,
} from "~/server/host-echo";
import {
  buildRelayView,
  loadSharedRelayResolution,
  type RelayAddressFamily,
  type RelayAddressVerdict,
  type RelayResolution,
} from "~/server/relay-dns";
import { Capabilities } from "~/server/web/roles";
import type { Key, Machine, PreAuthKey, User } from "~/types";
import cn from "~/utils/cn";
import { copyToClipboard } from "~/utils/copy";
import toast from "~/utils/toast";

import type { Route } from "./+types/overview";
import {
  type CheckStatus,
  type CheckTally,
  capDerpNodeLines,
  capDerpRegionLines,
  countNodeStatus,
  declaredDerpAddresses,
  type DeclaredDerpAddress,
  DERP_NODE_RESOLVE_LIMIT,
  type DerpNodeSummary,
  derpRegionSummaries,
  type DerpRegionSummary,
  formatByteSize,
  hasIpv6StunWarning,
  type HostEchoActionResult,
  type HostEchoErrorCode,
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

/** How the ranking classified one of the machine's own addresses. */
const IPV6_STABILITY_KEYS: Record<HostIpv6Stability, TranslationKey> = {
  stable: "overview.derp.candidateStable",
  unknown: "overview.derp.candidateUnknown",
  temporary: "overview.derp.candidateTemporary",
};

const IPV6_STABILITY_TONES: Record<HostIpv6Stability, SettingsStatusTone> = {
  stable: "ok",
  unknown: "neutral",
  temporary: "warn",
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

/** Stable codes the echo form turns into a sentence in the page's language. */
const HOST_ECHO_ERROR_KEYS: Record<HostEchoErrorCode, TranslationKey> = {
  invalidUrl: "overview.derp.echoInvalidUrl",
  writeFailed: "overview.derp.echoWriteFailed",
  invalidAction: "overview.derp.echoInvalidAction",
};

/** What the loader hands the echo card, so the card imports no server module. */
type HostEchoData = Route.ComponentProps["loaderData"]["hostEcho"];

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
  const hostEchoLookup = (async () => {
    const settings = await readHostEchoSettings(dataPath);
    const result: HostEchoResult = settings.enabled
      ? await loadHostEcho(settings)
      : { reason: "disabled", attempted: [] };
    return { settings, result };
  })();

  const [relayResolution, regionNames, mapInventory, hostAddresses, hostEcho] = await Promise.all([
    loadSharedRelayResolution(relayEndpoint?.host),
    readDerpRegionNames(dataPath),
    loadDerpRegionInventory({
      paths: derp.paths,
      urls: derp.urls,
      autoUpdateEnabled: derp.autoUpdateEnabled,
      updateFrequency: derp.updateFrequency,
      baseDir: configPath ? dirname(configPath) : undefined,
    }),
    hostAddressLookup,
    hostEchoLookup,
  ]);
  const relayView = buildRelayView(relayEndpoint, relayResolution, derp.server);
  // The echo answer is only worth reporting when it is a real one: a disabled
  // probe and a probe that failed both leave the row to the local sources, with
  // the failure recorded as a reason rather than as a missing address.
  const echoAddress = hostEcho.result.address;
  const probeReasons: HostProbeReason[] = [
    ...(hostAddresses?.reasons ?? []),
    ...(hostEcho.result.reason === undefined || hostEcho.result.reason === "disabled"
      ? []
      : [hostEcho.result.reason]),
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
                  ...(hostEcho.result.url === undefined ? {} : { url: hostEcho.result.url }),
                },
              }),
        });

  // Every hostname the configured maps list, resolved through the shared relay
  // cache the address block above already uses: one batch, at most
  // DERP_NODE_RESOLVE_LIMIT distinct names, so a map with dozens of nodes cannot
  // turn one render into dozens of DNS queries. A name that fails, or one the
  // limit left out, simply has no resolved address — the same "not resolved"
  // line an empty family under the address block reads as.
  const nodeHostnames = [
    ...new Set(
      mapInventory.regions
        .flatMap((region) => region.nodes.map((node) => node.hostname.trim().toLowerCase()))
        .filter((hostname) => hostname.length > 0),
    ),
  ];
  const resolvedHostnames = nodeHostnames.slice(0, DERP_NODE_RESOLVE_LIMIT);
  const nodeResolutions: Record<string, RelayResolution | undefined> = Object.fromEntries(
    await Promise.all(
      resolvedHostnames.map(
        async (hostname) => [hostname, await loadSharedRelayResolution(hostname)] as const,
      ),
    ),
  );

  // The embedded-DERP address sync's newest run. Only a run that actually
  // changed an address reaches the relay card: a check that found nothing to do
  // stays on the settings page, where the schedule is configured.
  await derpSync.ready();
  const syncRun = derpSync.last();
  const addressSync =
    syncRun?.outcome === "changed" && syncRun.changes.length > 0 ? { at: syncRun.at } : undefined;

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
        local: mapInventory.local,
        remote: mapInventory.remote,
      },
      // What the configured maps actually describe, so an operator can read a
      // local map file without opening the settings page. Plain values only:
      // the card formats them and never imports a module that reads a file.
      maps: {
        regions: mapInventory.regions,
        files: mapInventory.files,
        remoteUnavailable: mapInventory.remoteUnavailable,
        resolutions: nodeResolutions,
        unresolved: nodeHostnames.length - resolvedHostnames.length,
      },
      relaySource: classifyDerpRelaySource({
        serverEnabled: derp.server.enabled,
        urls: derp.urls,
      }),
      urlCount: derp.urls.length,
      pathCount: derp.paths.length,
      // Set only when the last address sync wrote something, so the card can
      // say so without opening the DERP settings page.
      addressSync,
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
    },
    // The optional external echo: what it is set to right now, what the default
    // endpoint is, and whether this viewer may change it. Plain values only, so
    // the card never imports a module that opens a socket.
    hostEcho: {
      enabled: hostEcho.settings.enabled,
      url: hostEcho.settings.url,
      defaultUrl: DEFAULT_HOST_ECHO_URL,
      fallbacks: [...FALLBACK_HOST_ECHO_URLS],
      canEdit: auth.can(principal, Capabilities.configure_iam),
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
 * The one write the dashboard has: the optional external IPv6 echo. It is
 * Headplane state stored under `data_path` (like the relay DNS servers), not
 * Headscale configuration, so it needs no config write and works with a
 * read-only Headscale configuration file. The same capability the other
 * settings writes require is required here, and the response carries a stable
 * code instead of English so the form can word it in the page's language.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  const form = await request.formData();
  if (form.get("action_id")?.toString() !== "save_host_echo") {
    return data({ ok: false, errorCode: "invalidAction" } satisfies HostEchoActionResult, {
      status: 400,
    });
  }

  const url = parseHostEchoUrl(form.get("host_echo_url")?.toString() ?? "");
  if (url === undefined) {
    return data({ ok: false, errorCode: "invalidUrl" } satisfies HostEchoActionResult, {
      status: 400,
    });
  }

  const dataPath = context.get(appConfigContext).server.data_path;
  const saved = await writeHostEchoSettings(dataPath, {
    enabled: form.get("host_echo_enabled")?.toString() === "true",
    url,
  });

  if (!saved) {
    return data({ ok: false, errorCode: "writeFailed" } satisfies HostEchoActionResult, {
      status: 400,
    });
  }

  // The setting decides which endpoint is asked, so a cached answer from the
  // previous one must not survive the save.
  clearHostEchoCache();
  return data({ ok: true } satisfies HostEchoActionResult);
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr, locale } = useI18n();
  const { versions, derp, service, counts, health, history, hostEcho } = loaderData;
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

  // The IPv6 half of the address block, prepared by the loader: the address
  // `derp.server` declares, the machine's own address cross-checked against the
  // domain's AAAA, or the DNS answer labelled unverified. It is absent only when
  // there was no hostname to derive from, which is exactly when the line above
  // words the row on its own.
  const relayIpv6 = derp.relay.ipv6;
  const ipv6LegacyLine = derp.relay.lines.find((line) => line.family === "ipv6");

  /** Where a derived IPv6 address came from, as the chip next to the label. */
  const ipv6SourceChip = (selection: RelayIpv6Selection) => {
    if (selection.source === "declared") {
      return relayDeclaredMarker;
    }

    if (selection.source === "echo") {
      return { tone: "neutral" as const, label: t("overview.derp.relaySourceEcho") };
    }

    if (selection.source === "host") {
      return selection.unconfirmed
        ? { tone: "warn" as const, label: t("overview.derp.relaySourceHostUnconfirmed") }
        : { tone: "neutral" as const, label: t("overview.derp.relaySourceHost") };
    }

    if (selection.source === "dns") {
      return { tone: "neutral" as const, label: t("overview.derp.relaySourceDnsUnverified") };
    }

    return undefined;
  };

  /**
   * The one line under the IPv6 row. Which note wins is decided by
   * {@link relayIpv6NoteKind}, so the precedence is testable; this only words
   * it. A declared address keeps the verdict note the row printed before, and
   * a contradiction gets its own amber block below the row.
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
        return t("overview.derp.ipv6EchoMatches", { address: note.address });
      case "echo-forwarded":
        return t("overview.derp.ipv6EchoForwarded", { address: note.address });
      case "unconfirmed":
        return note.namespace === "isolated"
          ? t("overview.derp.ipv6UnconfirmedIsolated")
          : t("overview.derp.ipv6UnconfirmedUnknown");
      case "unverified":
        return t("overview.derp.ipv6UnverifiedNote");
      case "dns-fallback":
        return t("overview.derp.ipv6NoneBody");
      case "temporary":
        return t("overview.derp.ipv6TemporaryNote");
      case "probe":
        return note.reasons.map((entry) => t(IPV6_REASON_KEYS[entry])).join(" ");
      case "alternates":
        return t("overview.derp.ipv6Alternates", { addresses: note.addresses.join(", ") });
    }
  };

  /** The sentence a derived IPv6 row with nothing to print reads as. */
  const ipv6StateText = (selection: RelayIpv6Selection) =>
    selection.state === "no-host-address"
      ? t("overview.derp.ipv6NoneBody")
      : relayReason(selection.state ?? "unavailable");

  // The configured maps as the box lists them; the labels go through the same
  // chain the region row above uses, so both cards word a region identically.
  const mapRegions = derpRegionSummaries({
    regions: derp.maps.regions,
    manual: derp.regions.manual,
    embedded: derp.region,
    resolutions: derp.maps.resolutions,
    unknown: t("machines.detail.derp.unknown"),
  });
  const mapNodeCount = mapRegions.reduce((total, region) => total + region.nodeCount, 0);
  // What the collapsed box lists: the first few regions by name, then a count.
  const mapRegionLines = capDerpRegionLines(mapRegions);
  const hasMapSources = derp.pathCount > 0 || derp.urlCount > 0;

  /** Where a region's name came from: the operator, or the first map that has it. */
  const mapSourceLabel = (region: DerpRegionSummary) =>
    region.nameSource === "manual"
      ? t("overview.derp.mapsSourceManual")
      : t(
          region.map.kind === "local"
            ? "overview.derp.mapsSourceLocal"
            : "overview.derp.mapsSourceRemote",
        );

  /** Why a configured map file contributed nothing, in one short sentence. */
  const mapFileNotice = (state: "ok" | "unreadable" | "invalid" | "empty", path: string) => {
    switch (state) {
      case "unreadable":
        return t("overview.derp.mapsFileUnreadable", { path });
      case "invalid":
        return t("overview.derp.mapsFileInvalid", { path });
      default:
        return t("overview.derp.mapsFileEmpty", { path });
    }
  };

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
              {derp.relay.lines.map((line) => {
                const selection = line.family === "ipv6" ? relayIpv6 : undefined;
                return (
                  <Fact
                    key={line.family}
                    label={relayFamilyLabel(line.family)}
                    note={
                      selection === undefined
                        ? relayVerdictNote(line, derp.relay.host)
                        : ipv6Note(selection)
                    }
                    source={
                      selection === undefined
                        ? line.source === "declared"
                          ? relayDeclaredMarker
                          : undefined
                        : ipv6SourceChip(selection)
                    }
                  >
                    {selection !== undefined ? (
                      selection.addresses.length > 0 ? (
                        <span className="flex flex-col gap-0.5 sm:items-end">
                          {selection.addresses.map((address) => (
                            <Code key={address}>{address}</Code>
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-mist-500 dark:text-mist-400">
                          {ipv6StateText(selection)}
                        </span>
                      )
                    ) : line.addresses.length > 0 ? (
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
                );
              })}
              {derp.stunListenAddr ? (
                <Fact code label={t("overview.derp.stun")} text={derp.stunListenAddr} />
              ) : undefined}
            </Facts>

            <RelayResolver
              canRefresh={derp.relay.canRefresh}
              resolution={derp.relay.resolution}
              suggestsConfigured={derp.relay.suggestsConfigured}
            />

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
                        declared: relayIpv6.contradiction.declared,
                        detected: relayIpv6.contradiction.detected,
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
                      dns: relayIpv6.dns.join(", "),
                      host: relayIpv6.copy,
                    })}
                  </span>
                  <CopyAddress address={relayIpv6.copy} />
                </div>
              </div>
            ) : undefined}

            {/* Every address that was found, and why each one was or was not the
                one chosen: the alternates list alone cannot explain a ranking. */}
            {relayIpv6 !== undefined && relayIpv6.candidates.length > 0 ? (
              <SettingsCollapsible
                description={t("overview.derp.candidatesBody")}
                summary={t("overview.derp.candidatesSummary", {
                  count: relayIpv6.candidates.length,
                })}
                title={t("overview.derp.candidatesTitle")}
              >
                <ul className="flex flex-col gap-2">
                  {relayIpv6.candidates.map((candidate) => (
                    <li
                      className="flex flex-col gap-0.5"
                      key={`${candidate.interfaceName}:${candidate.address}`}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Code>{candidate.address}</Code>
                        {candidate.chosen ? (
                          <SettingsStatus tone="ok">
                            {t("overview.derp.candidateChosen")}
                          </SettingsStatus>
                        ) : undefined}
                        <SettingsStatus tone={IPV6_STABILITY_TONES[candidate.stability]}>
                          {t(IPV6_STABILITY_KEYS[candidate.stability])}
                        </SettingsStatus>
                        {candidate.fromDns ? (
                          <SettingsStatus tone="neutral">
                            {t("overview.derp.candidateDns")}
                          </SettingsStatus>
                        ) : undefined}
                        {candidate.fromEcho ? (
                          <SettingsStatus tone="ok">
                            {t("overview.derp.candidateEcho")}
                          </SettingsStatus>
                        ) : undefined}
                      </span>
                      <span className="text-xs text-mist-500 dark:text-mist-400">
                        {t(
                          candidate.realNic
                            ? "overview.derp.candidateRealNic"
                            : "overview.derp.candidateVirtualNic",
                          { interface: candidate.interfaceName },
                        )}
                        {" · "}
                        {t("overview.derp.candidateSources", {
                          sources: candidate.origins.join(", "),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>

                {relayIpv6.excluded.length > 0 ? (
                  <p className="text-xs text-mist-500 dark:text-mist-400">
                    {t("overview.derp.candidatesExcluded", { count: relayIpv6.excluded.length })}
                  </p>
                ) : undefined}

                {relayIpv6.probeReasons.length > 0 ? (
                  <p className="text-xs text-mist-500 dark:text-mist-400">
                    {relayIpv6.probeReasons.map((entry) => t(IPV6_REASON_KEYS[entry])).join(" ")}
                  </p>
                ) : undefined}
              </SettingsCollapsible>
            ) : undefined}

            <HostEchoSettings echo={hostEcho} />

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

            {/* One short line, only after a sync that changed an address. */}
            {derp.addressSync ? (
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("overview.derp.syncChangedAt", {
                  at: new Date(derp.addressSync.at).toLocaleString(locale),
                })}
              </p>
            ) : undefined}
          </Card>

          <Card
            description={t("overview.derp.mapsBody")}
            icon={MapPinned}
            status={{
              tone: "neutral",
              label:
                mapRegions.length > 0
                  ? t("overview.derp.mapsSummary", {
                      regions: mapRegions.length,
                      nodes: mapNodeCount,
                    })
                  : t("overview.derp.none"),
            }}
            title={t("overview.derp.mapsTitle")}
          >
            {mapRegions.length === 0 ? (
              <p className="text-sm text-mist-600 dark:text-mist-400">
                {hasMapSources ? t("overview.derp.mapsEmpty") : t("overview.derp.mapsNoMaps")}
              </p>
            ) : (
              <SettingsCollapsible
                description={t("overview.derp.mapsDetailBody")}
                summary={
                  // The collapsed row names its regions instead of only counting
                  // them, so a reader does not have to expand the box to learn
                  // what is inside. It caps the list, because the box keeps the
                  // geometry of its siblings and must not grow without bound.
                  <span className="flex flex-col gap-0.5">
                    {mapRegionLines.lines.map((region) => (
                      <span className="flex flex-wrap items-center gap-1.5" key={region.regionId}>
                        <span className="truncate" title={region.label}>
                          {region.label}
                        </span>
                        <span className="whitespace-nowrap">
                          {t("overview.derp.mapsRegionNodes", { count: region.nodeCount })}
                        </span>
                        <SettingsStatus tone="neutral">{mapSourceLabel(region)}</SettingsStatus>
                      </span>
                    ))}
                    {mapRegionLines.hidden > 0 ? (
                      <span className="text-mist-500 dark:text-mist-400">
                        {t("overview.derp.mapsMoreRegions", { count: mapRegionLines.hidden })}
                      </span>
                    ) : undefined}
                  </span>
                }
                title={t("overview.derp.mapsDetailTitle")}
              >
                {/* Flat: each region and its nodes are inline, so one
                    expansion shows the relays instead of two nested ones. */}
                <ul className="flex flex-col gap-4">
                  {mapRegions.map((region) => {
                    const nodes = capDerpNodeLines(region.nodes);

                    return (
                      <li className="flex flex-col gap-1" key={region.regionId}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-mist-900 dark:text-mist-50">
                            {region.label}
                          </span>
                          <span className="text-xs text-mist-500 dark:text-mist-400">
                            {t("overview.derp.mapsRegionNodes", { count: region.nodeCount })}
                          </span>
                          <SettingsStatus tone="neutral">{mapSourceLabel(region)}</SettingsStatus>
                        </div>
                        {region.nodes.length === 0 ? (
                          <p className="text-sm text-mist-600 dark:text-mist-400">
                            {t("overview.derp.mapsRegionNoNodes")}
                          </p>
                        ) : (
                          <ul className="flex flex-col">
                            {nodes.lines.map((node) => (
                              <DerpMapNode key={`${node.name}:${node.endpoint}`} node={node} />
                            ))}
                          </ul>
                        )}
                        {nodes.hidden > 0 ? (
                          <p className="text-xs text-mist-500 dark:text-mist-400">
                            {t("overview.derp.mapsMoreNodes", { count: nodes.hidden })}
                          </p>
                        ) : undefined}
                      </li>
                    );
                  })}
                </ul>
              </SettingsCollapsible>
            )}

            {derp.maps.files
              .filter((file) => file.state !== "ok")
              .map((file) => (
                <p className="text-xs text-mist-500 dark:text-mist-400" key={file.path}>
                  {mapFileNotice(file.state, file.path)}
                </p>
              ))}

            {derp.maps.remoteUnavailable ? (
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("overview.derp.mapsRemoteUnavailable")}
              </p>
            ) : undefined}

            {derp.maps.unresolved > 0 ? (
              <p className="text-xs text-mist-500 dark:text-mist-400">
                {t("overview.derp.mapsResolveTruncated", { count: derp.maps.unresolved })}
              </p>
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

/**
 * One node of a configured DERP map, as flat definition rows: the name and the
 * endpoint a client dials, the STUN port the map puts on it, and the addresses
 * it declares next to the ones DNS returns for the same hostname. Nothing here
 * opens: the region it belongs to is already inline, so a node adds rows rather
 * than another collapsible.
 */
function DerpMapNode({ node }: { node: DerpNodeSummary }) {
  const { t } = useI18n();

  return (
    <li className="flex flex-col border-t border-mist-100 py-2 first:border-t-0 first:pt-0 last:pb-0 dark:border-mist-800/60">
      <Facts>
        <Fact
          label={node.name}
          source={
            node.stunOnly
              ? { tone: "neutral" as const, label: t("overview.derp.mapsStunOnly") }
              : undefined
          }
        >
          <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            <CopyValue
              className="w-auto pointer-coarse:[&>svg]:opacity-100"
              copiedMessage={t("common.copied")}
              value={node.endpoint}
            />
            {node.portDefaulted ? (
              <span className="text-xs text-mist-500 dark:text-mist-400">
                {t("overview.derp.mapsDefault")}
              </span>
            ) : undefined}
          </span>
        </Fact>
        <Fact label={t("overview.derp.mapsStun")}>
          {node.stunEndpoint === undefined ? (
            <span className="text-xs text-mist-500 dark:text-mist-400">
              {t("overview.derp.mapsStunNone")}
            </span>
          ) : (
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <CopyValue
                className="w-auto pointer-coarse:[&>svg]:opacity-100"
                copiedMessage={t("common.copied")}
                value={node.stunEndpoint}
              />
              {node.stunPortDefaulted ? (
                <span className="text-xs text-mist-500 dark:text-mist-400">
                  {t("overview.derp.mapsDefault")}
                </span>
              ) : undefined}
            </span>
          )}
        </Fact>
        <Fact label={t("overview.derp.relayIpv4")}>
          <DerpMapAddress
            declared={node.ipv4}
            display={node.resolved.ipv4}
            reason={node.resolved.ipv4Reason}
          />
        </Fact>
        <Fact label={t("overview.derp.relayIpv6")}>
          <DerpMapAddress
            declared={node.ipv6}
            display={node.resolved.ipv6}
            reason={node.resolved.ipv6Reason}
          />
        </Fact>
      </Facts>
    </li>
  );
}

/**
 * One address family of a node: what the map declares, marked as such, then
 * every record the shared lookup returned. With neither, the resolver's own
 * reason stands where the addresses would be — never an empty row.
 */
function DerpMapAddress({
  declared,
  display,
  reason,
}: {
  declared?: string;
  display?: string;
  reason?: RelayReason;
}) {
  const { t } = useI18n();
  const resolved = (display ?? "").split("\n").filter((address) => address.length > 0);
  const missing = (
    <span className="text-xs text-mist-500 dark:text-mist-400">
      {t(RELAY_REASON_KEYS[reason ?? "unavailable"])}
    </span>
  );

  if (declared === undefined && resolved.length === 0) {
    return missing;
  }

  return (
    <span className="flex flex-col gap-0.5 sm:items-end">
      {declared === undefined ? undefined : (
        <span className="flex flex-wrap items-center gap-1.5">
          <CopyValue
            className="w-auto pointer-coarse:[&>svg]:opacity-100"
            copiedMessage={t("common.copied")}
            value={declared}
          />
          <SettingsStatus tone="neutral">{t("overview.derp.mapsDeclared")}</SettingsStatus>
        </span>
      )}
      {resolved.map((address) => (
        <CopyValue
          key={address}
          className="w-auto pointer-coarse:[&>svg]:opacity-100"
          copiedMessage={t("common.copied")}
          value={address}
        />
      ))}
      {resolved.length === 0 ? missing : undefined}
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

/**
 * The optional external echo: what it is for, the switch, and the endpoint.
 *
 * Off by default and stored in Headplane's data directory, never in Headscale's
 * configuration, so it works with a read-only Headscale config file. The whole
 * block is a form of its own, so saving the URL can never enable the probe and
 * enabling the probe can never silently change the endpoint.
 */
function HostEchoSettings({ echo }: { echo: HostEchoData }) {
  const { t } = useI18n();
  const fetcher = useFetcher<HostEchoActionResult>();
  const [enabled, setEnabled] = useState(echo.enabled);
  const [url, setUrl] = useState(echo.url);

  const busy = fetcher.state !== "idle";
  const saved = fetcher.state === "idle" && fetcher.data?.ok === true;
  const error =
    fetcher.data !== undefined && !fetcher.data.ok
      ? t(HOST_ECHO_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;

  // Once a save lands, the loader revalidates with the stored (normalized)
  // values, so the form follows the file rather than the text that was typed.
  useEffect(() => {
    if (fetcher.state !== "idle") {
      return;
    }

    setEnabled(echo.enabled);
    setUrl(echo.url);
  }, [echo.enabled, echo.url, fetcher.state]);

  const disabled = !echo.canEdit || busy;

  return (
    <SettingsCollapsible
      description={t("overview.derp.echoBody")}
      icon={Globe}
      status={{
        tone: echo.enabled ? "ok" : "neutral",
        label: echo.enabled ? t("overview.status.on") : t("overview.status.off"),
      }}
      summary={echo.enabled ? t("overview.derp.echoSummary", { url: echo.url }) : undefined}
      title={t("overview.derp.echoTitle")}
    >
      <fetcher.Form className="flex flex-col gap-5" method="post">
        <input name="action_id" type="hidden" value="save_host_echo" />

        <SettingsField
          description={t("overview.derp.echoEnabledDescription")}
          label={t("overview.derp.echoEnabledLabel")}
        >
          <Switch
            checked={enabled}
            disabled={disabled}
            label={t("overview.derp.echoEnabledLabel")}
            onCheckedChange={setEnabled}
          />
        </SettingsField>
        <input name="host_echo_enabled" type="hidden" value={enabled ? "true" : "false"} />

        <SettingsField
          description={t("overview.derp.echoUrlDescription")}
          label={t("overview.derp.echoUrlLabel")}
        >
          <Input
            disabled={disabled}
            label={t("overview.derp.echoUrlLabel")}
            labelHidden
            name="host_echo_url"
            onChange={setUrl}
            placeholder={echo.defaultUrl}
            value={url}
          />
        </SettingsField>

        <p className="rounded-lg bg-mist-100 p-3 text-sm text-mist-600 dark:bg-mist-800/50 dark:text-mist-300">
          {t("overview.derp.echoNote", { urls: echo.fallbacks.join(", ") })}
        </p>

        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : undefined}

        <SettingsActions>
          {saved ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              {t("overview.derp.echoSaved")}
            </span>
          ) : undefined}
          <Button disabled={disabled} type="submit" variant="heavy">
            {t("overview.derp.echoSave")}
          </Button>
        </SettingsActions>
      </fetcher.Form>
    </SettingsCollapsible>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorBanner className="max-w-2xl" error={error} />;
}
