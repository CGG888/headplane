import { dirname } from "node:path";

import {
  KeyRound,
  Network,
  Scale,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
} from "lucide-react";
import { useState } from "react";
import { data } from "react-router";
import type { ShouldRevalidateFunction, ShouldRevalidateFunctionArgs } from "react-router";

import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import {
  SettingsCollapsible,
  SettingsPage,
  SettingsPanel,
  SettingsStatus,
  SettingsTab,
  SettingsTabList,
  SettingsTabs,
} from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  authContext,
  derpMirrorContext,
  derpSyncContext,
  headscaleConfigContext,
  headscaleLiveStoreContext,
  requestApiContext,
  snapshotContext,
} from "~/server/context";
import {
  assignRegionNumbers,
  EMBEDDED_REGION_ID,
  MIRROR_NUMBER_FIRST_RANKED,
} from "~/server/derp-mirror/generate";
import {
  locallyMeasuredRegionLatencies,
  officialRegionLatencies,
} from "~/server/derp-mirror/latency";
import { chineseRegionName } from "~/server/derp-mirror/names";
import { isMirrorPathListed } from "~/server/derp-mirror/paths";
import { DERP_MIRROR_PASTE_MAX_BYTES } from "~/server/derp-mirror/settings";
import {
  PASTED_MAP_SOURCE,
  parseDerpMapBody,
  resolveMirrorSourceChain,
} from "~/server/derp-mirror/sources";
import { getLastDerpRefresh } from "~/server/derp-refresh";
import { inspectDerpMapFiles } from "~/server/headscale/derp-map-files";
import type { DerpMapRegionDetail } from "~/server/headscale/derp-map-nodes";
import {
  loadRemoteDerpMapOutcome,
  readRemoteDerpMapCache,
} from "~/server/headscale/derp-map-remote";
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { nodesResource } from "~/server/headscale/live-store";
import {
  DEFAULT_HOST_ECHO_URL,
  FALLBACK_HOST_ECHO_URLS,
  readHostEchoSettings,
} from "~/server/host-echo";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { headscaleSettingsAction } from "./actions";
import AdvancedSettings from "./components/advanced-settings";
import DerpMapFreshness from "./components/derp-map-freshness";
import DerpRegionMirror from "./components/derp-region-mirror";
import DerpRegionNames from "./components/derp-region-names";
import DerpSettings from "./components/derp-settings";
import DerpStatus from "./components/derp-status";
import DerpSyncSettings from "./components/derp-sync";
import OidcSettings from "./components/oidc-settings";
import PolicyModeSettings from "./components/policy-mode";
import ServerOverview from "./components/server-overview";
import TrustedProxies from "./components/trusted-proxies";
import { findFatalOidcKeys } from "./config-warnings";
import type {
  MirrorNumbering,
  MirrorRegionRow,
  MirrorSourceAttemptView,
  MirrorSourceView,
} from "./derp-mirror";
import { MIRROR_PROBE_STATUS_ACTION_ID, mirrorRegionLatency } from "./derp-mirror";
import {
  classifyDerpRelaySource,
  defaultDerpPrivateKeyPath,
  type DerpRelaySource,
} from "./derp-settings";
import { buildDerpRelayRows, type DerpRelayRow } from "./derp-status";
import { derpRefreshFailureKey } from "./error-keys";

/** The wording for each place the DERP relays can come from. */
const RELAY_SOURCE_KEYS: Record<DerpRelaySource, TranslationKey> = {
  "embedded-only": "settings.headscale.derp.relaySourceEmbeddedOnly",
  "embedded-and-map": "settings.headscale.derp.relaySourceEmbeddedAndMap",
  "map-only": "settings.headscale.derp.relaySourceMapOnly",
  none: "settings.headscale.derp.relaySourceNone",
};

/**
 * What the last DERP write says about whether the change is live: the outcome
 * names the mechanism, and the page does not have to guess from the change kind.
 */
const DERP_REFRESH_NOTICE_KEYS = {
  "not-needed": "settings.headscale.derp.refreshNotice.notNeeded",
  ticker: "settings.headscale.derp.refreshNotice.ticker",
  triggered: "settings.headscale.derp.refreshNotice.triggered",
  manual: "settings.headscale.derp.refreshNotice.manual",
  failed: "settings.headscale.derp.refreshNotice.failed",
} as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
  const auth = context.get(authContext);
  const derpMirror = context.get(derpMirrorContext);
  const derpSync = context.get(derpSyncContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const appConfig = context.get(appConfigContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  if (!headscaleConfig.readable()) {
    throw new Error("No configuration is available");
  }

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.read_users);
  if (!check) {
    // Not authorized to view this page
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  // Relay data comes from the Headplane Agent, so it is only read when the
  // agent is running and the viewer may see machines.
  const agents = agentsFeature.state === "enabled" ? agentsFeature.value : undefined;
  let derpRelay: DerpRelayRow[] = [];
  if (agents && auth.can(principal, Capabilities.read_machines)) {
    try {
      const { api } = await getRequestApi(request);
      const nodesSnap = await headscaleLiveStore.get(nodesResource, api);
      const stats = await agents.lookup(nodesSnap.data.map((node) => node.nodeKey));
      derpRelay = buildDerpRelayRows(nodesSnap.data, stats);
    } catch {
      // Best-effort: an unreachable agent or API leaves the table empty.
      derpRelay = [];
    }
  }

  const { policyMode, policyPath, trustedProxies } = headscaleConfig.getTailnetSettings();
  const derp = headscaleConfig.getDERPSettings();
  // The DERP tab can edit each configured map file, so the same loader reads
  // them once and reports what it found: existence, permissions, and whether the
  // content is a map Headscale would accept.
  const derpMapFiles = await inspectDerpMapFiles(derp.paths, {
    // A relative derp.paths entry is relative to Headscale's own config file.
    baseDir: appConfig.headscale.config_path ? dirname(appConfig.headscale.config_path) : undefined,
    snapshots: context.get(snapshotContext),
  });

  // The address sync's settings and newest run are read from Headplane's own
  // data directory, so the page can render them even when Headscale's
  // configuration file is read-only. The external IPv6 echo, which the sync
  // consumes, is read from the same place.
  await derpSync.ready();
  const hostEcho = await readHostEchoSettings(appConfig.server.data_path);

  // The official region mirror keeps its settings in Headplane's own data
  // directory and reads Tailscale's map through the same cached fetcher a run
  // uses. The table needs that map, the latency the agent measured and the order
  // the server's numbering rule produces: the rule itself is neither
  // re-implemented here nor in the browser, the component only filters an order
  // the server already ranked.
  await derpMirror.ready();
  const mirrorSettings = derpMirror.settings();

  let mirrorLatencies: Record<string, number> = {};
  // Whether the agent is reporting at all: the feature being enabled is not
  // enough, because an agent that has never synced (or whose newest sync failed)
  // measures nothing either. The card says which of the two cases left the
  // latency column empty instead of leaving it blank.
  let agentAvailable = false;
  if (agents) {
    try {
      const sync = agents.lastSync();
      agentAvailable = sync.syncedAt !== null && sync.error === undefined;
    } catch {
      agentAvailable = false;
    }
  }

  if (agents) {
    try {
      mirrorLatencies = officialRegionLatencies(await agents.hostRecords());
    } catch {
      // Best-effort: without measurements nothing is ranked, and the table says so.
      mirrorLatencies = {};
    }
  }

  // The latencies this server probed itself, which is the only source that can
  // measure Tailscale's official regions on a mirrored setup — a client only
  // knows the map Headscale handed it. They win over the reported values, and
  // each row is labelled with the source it actually came from.
  const measuredLatencies = locallyMeasuredRegionLatencies(mirrorSettings.latency);

  let officialRegions: DerpMapRegionDetail[] = [];
  // The sources the mirror would read right now, and — when none of them could
  // be read — why each one failed. The table shows the same map the next run
  // would mirror, and the card can name every endpoint it tried instead of
  // printing one bare reason.
  const mirrorSourceChain = resolveMirrorSourceChain(mirrorSettings, derp.urls);
  const mirrorSources: MirrorSourceView[] = mirrorSourceChain.map((source) => ({
    url: source.url,
    kind: source.kind,
  }));
  const mirrorSourceAttempts: MirrorSourceAttemptView[] = [];
  try {
    if (mirrorSettings.pastedMap !== undefined) {
      const read = parseDerpMapBody(mirrorSettings.pastedMap.body);
      if (read.regions !== undefined) {
        officialRegions = read.regions;
        mirrorSourceAttempts.push({ url: PASTED_MAP_SOURCE });
      } else {
        mirrorSourceAttempts.push({
          url: PASTED_MAP_SOURCE,
          reason: read.reason ?? "unreadable",
        });
      }
    } else {
      const cache = {
        autoUpdateEnabled: derp.autoUpdateEnabled,
        updateFrequency: derp.updateFrequency,
      };
      // The service reads the same chain in the same order, so the table shows
      // exactly the source a run would mirror from.
      for (const source of mirrorSourceChain) {
        const outcome = await loadRemoteDerpMapOutcome(source.url, cache);
        if (outcome.regions !== undefined && outcome.regions.length > 0) {
          officialRegions = outcome.regions;
          mirrorSourceAttempts.push({ url: source.url });
          break;
        }

        mirrorSourceAttempts.push({
          url: source.url,
          ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        });
      }
    }
  } catch {
    officialRegions = [];
    mirrorSourceAttempts.push({
      url:
        mirrorSettings.pastedMap === undefined
          ? (mirrorSourceChain[0]?.url ?? "")
          : PASTED_MAP_SOURCE,
      reason: "network",
    });
  }

  const mirrorRegionsError =
    officialRegions.length > 0
      ? undefined
      : mirrorSourceAttempts.find((attempt) => attempt.reason !== undefined)?.reason;

  const mirrorRegions: MirrorRegionRow[] = officialRegions.map((region) => {
    const latency = mirrorRegionLatency(measuredLatencies, mirrorLatencies, region.regionId);

    return {
      officialId: region.regionId,
      code: region.code,
      officialName: region.name,
      // The name the mirrored file will carry, so the column and the file agree.
      chineseName: chineseRegionName(region.code, region.name),
      nodeCount: region.nodes.length,
      latencyMs: latency.latencyMs,
      ...(latency.source === undefined ? {} : { latencySource: latency.source }),
      storedNumber: mirrorSettings.assignment[String(region.regionId)],
    };
  });

  // One call to the server's rule over every official region yields the ranking
  // order: the region a fresh ranking makes 901 comes first, and ticking a subset
  // only filters that order, which is why the preview matches the numbers a fresh
  // ranking assigns to it. The local measurements are handed over separately so
  // the rule can prefer them.
  const ranked = assignRegionNumbers(
    mirrorRegions.map((region) => String(region.officialId)),
    mirrorLatencies,
    undefined,
    measuredLatencies,
  );
  const orderedIds = Object.entries(ranked.assignment)
    .map(([id, number]) => ({ officialId: Number(id), number }))
    .toSorted((a, b) => a.number - b.number || a.officialId - b.officialId)
    .map((entry) => entry.officialId);
  const mirrorNumbering: MirrorNumbering = {
    firstFreeNumber: MIRROR_NUMBER_FIRST_RANKED,
    order: orderedIds,
    // The only number the rule never hands to a ranked region: Headscale's own
    // embedded id. The preview needs it to drop a stored number the server would
    // refuse.
    reserved: [EMBEDDED_REGION_ID],
  };

  return {
    access: auth.can(principal, Capabilities.configure_iam),
    writable: headscaleConfig.writable(),
    // The last DERP write this process performed, so the page can say whether
    // Headscale's running process has picked it up or still needs a restart.
    derpRefresh: getLastDerpRefresh() ?? null,
    derpSync: {
      settings: derpSync.settings(),
      last: derpSync.last(),
      // Plain values only, so the card never imports a module that opens a
      // socket just to render the endpoint it is configured with.
      hostEcho: {
        enabled: hostEcho.enabled,
        url: hostEcho.url,
        defaultUrl: DEFAULT_HOST_ECHO_URL,
        fallbacks: [...FALLBACK_HOST_ECHO_URLS],
      },
    },
    mirror: {
      settings: {
        enabled: mirrorSettings.enabled,
        targetPath: mirrorSettings.targetPath,
        intervalHours: mirrorSettings.intervalHours,
        autoReload: mirrorSettings.autoReload,
        // The store keeps region ids as decimal strings; the checkboxes compare
        // numbers, and the action validates whatever comes back anyway.
        selectedIds: mirrorSettings.officialRegionIds
          .map((id) => Number(id))
          .filter((id) => Number.isSafeInteger(id)),
        rankedAt: mirrorSettings.assignmentRankedAt,
        // The source list as stored, and the chain it resolves to, so the card
        // can show what the next run would dial without resolving it itself.
        sourceUrls: [...mirrorSettings.sourceUrls],
        sources: mirrorSources,
        ...(mirrorSettings.pastedMap === undefined
          ? {}
          : {
              paste: {
                at: mirrorSettings.pastedMap.at,
                regions: mirrorSettings.pastedMap.regions,
                bytes: Buffer.byteLength(mirrorSettings.pastedMap.body, "utf8"),
              },
            }),
      },
      last: derpMirror.last(),
      numbering: mirrorNumbering,
      regions: mirrorRegions,
      // A stable code, not a message: the card localizes it. The attempts below
      // carry the same codes per source, which is what makes a blocked endpoint
      // readable instead of looking like an empty map.
      regionsError: mirrorRegionsError,
      sourceAttempts: mirrorSourceAttempts,
      pasteLimitBytes: DERP_MIRROR_PASTE_MAX_BYTES,
      // The newest local probe, as plain values: when it ran and how it ended,
      // so the card can show progress, say when a run found nothing, and decide
      // whether a stale measurement is worth refreshing when it opens.
      probe: {
        measuredAt: mirrorSettings.latency?.measuredAt,
        outcome: mirrorSettings.latency?.outcome,
      },
      // The run in flight, if there is one, so a card opened in the middle of a
      // latency test starts from the progress already made instead of waiting
      // for the next poll. Read from memory, like the settings above.
      probeStatus: derpMirror.latencyProbeStatus(),
      // Whether Headscale already loads the file the mirror writes, compared
      // the way every DERP card compares a configured path, plus the entries it
      // lists right now for the card's hint. Both are plain values from the
      // configuration the page has already read.
      pathListed: isMirrorPathListed(
        derp.paths,
        mirrorSettings.targetPath,
        appConfig.headscale.config_path ? dirname(appConfig.headscale.config_path) : undefined,
      ),
      paths: [...derp.paths],
    },
    // What this process has cached for every configured remote map, so the DERP
    // tab can date the map it is showing and fetch it again on demand. A URL
    // nothing has fetched yet has no entry, and a write clears the answers until
    // the next lookup fills them in.
    mapFreshness: derp.urls.map((url) => {
      const cache = readRemoteDerpMapCache(url);
      return cache === undefined ? { url } : { url, cache };
    }),
    oidc: headscaleConfig.getOIDCSettings() ?? null,
    advanced: headscaleConfig.getAdvancedSettings(),
    derp,
    derpMapFiles,
    // Everything below is read-only: Headplane deliberately never writes it.
    overview: headscaleConfig.getServerOverview(),
    // Manual names for the regions Headscale cannot name itself, plus the
    // documented key location the embedded-server preset prefills.
    derpRegionNames: await readDerpRegionNames(appConfig.server.data_path),
    derpPrivateKeyDefault: defaultDerpPrivateKeyPath(appConfig.headscale.config_path),
    derpRelay,
    agentEnabled: agents !== undefined,
    // Whether the agent is actually reporting; the mirror card explains an empty
    // latency column with it.
    agentAvailable,
    policyMode,
    policyPath,
    trustedProxies,
    fatalOidcKeys: await findFatalOidcKeys(appConfig.headscale.config_path),
  };
}

export const action = headscaleSettingsAction;

/**
 * Revalidation policy for the DERP tab.
 *
 * The latency status is a read: it reports how far the run in flight has got,
 * and the card asks for it about once a second while the run is going. React
 * Router cannot know that — any fetcher submission revalidates every loader of
 * the current route by default — so answering a poll would re-read the agent
 * records, the official map and every DERP file once per second for data that
 * has not changed. The run's own completion is what refreshes the page, and the
 * card revalidates explicitly when it sees the run finish.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) => {
  if (formData?.get("action_id") === MIRROR_PROBE_STATUS_ACTION_ID) {
    return false;
  }

  return defaultShouldRevalidate;
};

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const {
    access,
    writable,
    derpSync,
    mirror,
    oidc,
    advanced,
    derp,
    derpMapFiles,
    mapFreshness,
    overview,
    derpRegionNames,
    derpPrivateKeyDefault,
    derpRelay,
    agentEnabled,
    agentAvailable,
    policyMode,
    policyPath,
    trustedProxies,
    fatalOidcKeys,
  } = loaderData;
  const isDisabled = writable ? !access : true;

  // The cards below hold their forms, and a card's children only mount while it
  // is open. The failures those forms render are therefore reported up here, so
  // the card itself can still open on one: the flag is a boolean, the message
  // stays where it was always printed, and a card with nothing to report starts
  // closed like every other card on the page.
  const [oidcError, setOidcError] = useState(false);
  const [trustedProxiesError, setTrustedProxiesError] = useState(false);
  const [policyError, setPolicyError] = useState(false);
  const [regionNamesError, setRegionNamesError] = useState(false);

  // Which relays clients are handed, shown above the DERP blocks so it is
  // readable without opening any of them.
  const relaySource = classifyDerpRelaySource({
    serverEnabled: derp.server.enabled,
    urls: derp.urls,
  });
  const relaySourceSummary = t("settings.headscale.derp.relaySourceLabel", {
    source: t(RELAY_SOURCE_KEYS[relaySource]),
  });
  const relaySourceStatus: { tone: "ok" | "warn"; label: string } = {
    tone: relaySource === "none" ? "warn" : "ok",
    label: t(RELAY_SOURCE_KEYS[relaySource]),
  };

  const oidcConfigured = oidc !== null && oidc.issuer.length > 0;

  return (
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.headscale.breadcrumb")}
        </>
      }
      description={t("settings.headscale.body")}
      notices={
        <>
          {!writable ? (
            <Notice title={t("settings.headscale.notWritableTitle")} variant="error">
              {tr("settings.headscale.notWritableBody", { file: <Code>config.yaml</Code> })}
            </Notice>
          ) : !access ? (
            <Notice title={t("settings.headscale.readOnlyTitle")} variant="warning">
              {t("errors.permission.modifyIam")}
            </Notice>
          ) : undefined}
          {fatalOidcKeys.length > 0 ? (
            <Notice title={t("settings.headscale.fatalTitle")} variant="error">
              {tr("settings.headscale.fatalBody", {
                keys: <Code>{fatalOidcKeys.join(", ")}</Code>,
                setting: <Code>node.expiry</Code>,
              })}
            </Notice>
          ) : undefined}
          {loaderData.derpRefresh ? (
            <Notice
              title={t(DERP_REFRESH_NOTICE_KEYS[loaderData.derpRefresh.outcome])}
              variant={loaderData.derpRefresh.pendingRestart ? "warning" : undefined}
            >
              {loaderData.derpRefresh.failure
                ? t(derpRefreshFailureKey(loaderData.derpRefresh.failure))
                : t("settings.headscale.derp.refreshNoticeBody")}
            </Notice>
          ) : undefined}
        </>
      }
      title={t("settings.headscale.title")}
    >
      <SettingsTabs defaultValue="oidc" label={t("settings.headscale.title")}>
        <SettingsTabList>
          <SettingsTab className="shrink-0" icon={KeyRound} value="oidc">
            {t("settings.headscale.oidcTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={ShieldCheck} value="trusted-proxies">
            {t("settings.headscale.trustedProxiesTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Scale} value="policy">
            {t("settings.headscale.policyTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={SlidersHorizontal} value="advanced">
            {t("settings.headscale.advancedTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Network} value="derp">
            {t("settings.headscale.derp.title")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Tags} value="derp-regions">
            {t("settings.headscale.derp.regionNamesTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Server} value="overview">
            {t("settings.headscale.overviewTab")}
          </SettingsTab>
        </SettingsTabList>

        <SettingsPanel value="oidc">
          <SettingsCollapsible
            hasError={oidcError}
            icon={KeyRound}
            status={{
              tone: oidcConfigured ? "ok" : "warn",
              label: oidcConfigured
                ? t("settings.headscale.statusConfigured")
                : t("settings.headscale.summaryNotConfigured"),
            }}
            summary={
              oidcConfigured
                ? t("settings.headscale.summaryIssuer", { issuer: oidc?.issuer ?? "" })
                : undefined
            }
            title={t("settings.headscale.oidcTitle")}
          >
            <OidcSettings
              canTest={access}
              isDisabled={isDisabled}
              oidc={oidc}
              onErrorChange={setOidcError}
            />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="trusted-proxies">
          <SettingsCollapsible
            description={t("settings.headscale.trustedProxiesBody")}
            hasError={trustedProxiesError}
            icon={ShieldCheck}
            status={{
              tone: trustedProxies.length > 0 ? "ok" : "neutral",
              label: t("settings.headscale.trustedProxiesSummary", {
                count: trustedProxies.length,
              }),
            }}
            title={t("settings.headscale.trustedProxiesTitle")}
          >
            <TrustedProxies
              isDisabled={isDisabled}
              onErrorChange={setTrustedProxiesError}
              proxies={trustedProxies}
            />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="policy">
          <SettingsCollapsible
            description={t("settings.headscale.policyBody")}
            hasError={policyError}
            icon={Scale}
            status={{
              tone: policyMode === "database" ? "ok" : "neutral",
              label:
                policyMode === "database"
                  ? t("settings.headscale.policyModeDatabase")
                  : t("settings.headscale.policyModeFile"),
            }}
            summary={t("settings.headscale.policySummary", { mode: policyMode })}
            title={t("settings.headscale.policyTitle")}
          >
            <PolicyModeSettings
              isDisabled={isDisabled}
              mode={policyMode}
              onErrorChange={setPolicyError}
              path={policyPath}
            />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="advanced">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {t("settings.headscale.advancedSummary", {
                expiry: advanced.nodeExpiry,
                level: advanced.logLevel,
              })}
            </p>
            {/* Intro copy keeps a readable measure now that the page is wide. */}
            <p className="max-w-3xl text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.advancedBody")}
            </p>
          </div>
          <AdvancedSettings isDisabled={isDisabled} settings={advanced} />
        </SettingsPanel>

        <SettingsPanel value="derp">
          <p className="max-w-3xl text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.body")}
          </p>
          <DerpSettings
            isDisabled={isDisabled}
            mapFiles={derpMapFiles}
            privateKeyDefault={derpPrivateKeyDefault}
            relaySourceStatus={relaySourceStatus}
            relaySourceSummary={relaySourceSummary}
            settings={derp}
          />
          <DerpMapFreshness entries={mapFreshness} isDisabled={!access} />
          <DerpSyncSettings
            echo={derpSync.hostEcho}
            isDisabled={isDisabled}
            last={derpSync.last}
            settings={derpSync.settings}
          />
          <DerpRegionMirror
            agentAvailable={agentAvailable}
            configWritable={writable}
            isDisabled={!access}
            last={mirror.last}
            numbering={mirror.numbering}
            pasteLimitBytes={mirror.pasteLimitBytes}
            pathListed={mirror.pathListed}
            paths={mirror.paths}
            probe={mirror.probe}
            probeStatus={mirror.probeStatus}
            regionAttempts={mirror.sourceAttempts}
            regionError={mirror.regionsError}
            regions={mirror.regions}
            settings={mirror.settings}
          />
          <DerpStatus
            agentEnabled={agentEnabled}
            embedded={derp.server}
            regionNames={derpRegionNames}
            rows={derpRelay}
          />
        </SettingsPanel>

        <SettingsPanel value="derp-regions">
          <SettingsCollapsible
            description={t("settings.headscale.derp.regionNamesBody")}
            hasError={regionNamesError}
            icon={Tags}
            status={{
              tone: Object.keys(derpRegionNames).length > 0 ? "ok" : "neutral",
              label: t("settings.headscale.derp.regionNamesSummary", {
                count: Object.keys(derpRegionNames).length,
              }),
            }}
            title={t("settings.headscale.derp.regionNamesTitle")}
          >
            <DerpRegionNames
              isDisabled={isDisabled}
              names={derpRegionNames}
              onErrorChange={setRegionNamesError}
            />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="overview">
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {t("settings.headscale.overviewTitle")}
              <SettingsStatus tone="neutral">
                {t("settings.headscale.overviewDisplayOnly")}
              </SettingsStatus>
            </p>
            <p className="max-w-3xl text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.overviewBody")}
            </p>
          </div>
          <ServerOverview overview={overview} />
        </SettingsPanel>
      </SettingsTabs>
    </SettingsPage>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
