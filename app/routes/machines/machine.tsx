import { dirname } from "node:path";

import {
  Activity,
  Bug,
  CalendarClock,
  ChartColumn,
  Info,
  Network,
  Route as RouteIcon,
  Tags as TagsIcon,
  Trash2,
  TriangleAlert,
  UserCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { data, type ShouldRevalidateFunction } from "react-router";

import { AddressVisibilityMenu } from "~/components/address-visibility";
import Button from "~/components/button";
import Chip from "~/components/chip";
import Link from "~/components/link";
import { SettingsStatus } from "~/components/settings-nav";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  authContext,
  derpMirrorContext,
  headscaleConfigContext,
  headscaleContext,
  headscaleLiveStoreContext,
  nodeHistoryContext,
  requestApiContext,
} from "~/server/context";
import { locallyMeasuredRegionLatencies } from "~/server/derp-mirror/latency";
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { loadDerpNodeInventory } from "~/server/headscale/derp-region-sources";
import { nodesResource, usersResource } from "~/server/headscale/live-store";
import { computeNodeTimeline, uptimePercent, type NodeTimeline } from "~/server/history/timeline";
import type { NodeHistoryDocument } from "~/server/history/types";
import { buildRelayView, loadSharedRelayResolution } from "~/server/relay-dns";
import { Capabilities } from "~/server/web/roles";
import { getOSInfo, getTSVersion } from "~/utils/host-info";
import { extractTagOwnerTags, isNoExpiry, mapNodes, sortAssignableTags } from "~/utils/node-info";
import { getUserDisplayName } from "~/utils/user";

import { derpNodeSources } from "../overview-helpers";
import { deriveDerpPublicEndpoint } from "../settings/headscale/derp-settings";
import type { Route } from "./+types/machine";
import MachineAttribute from "./components/attribute";
import ClientConnectivity from "./components/client-connectivity";
import DerpInfo from "./components/derp-info";
import { NodeAvailabilityBar } from "./components/history-bar";
import MachineCard from "./components/machine-card";
import { mapTagsToComponents, uiTagsForNode } from "./components/machine-row";
import MachineStatus from "./components/machine-status";
import MenuOptions from "./components/menu";
import NodeDiagnostics from "./components/node-diagnostics";
import { embeddedDerpRegion, relayRegionSources, servedDerpRegionIds } from "./derp-info";
import DebugNode from "./dialogs/debug-node";
import Delete from "./dialogs/delete";
import Expire from "./dialogs/expire";
import Routes from "./dialogs/routes";
import { machineAction } from "./machine-actions";
import { relayAddressLines } from "./relay-verdicts";
import { shouldRevalidateMachines } from "./should-revalidate";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
  const appConfig = context.get(appConfigContext);
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);
  const derpMirror = context.get(derpMirrorContext);
  const nodeHistory = context.get(nodeHistoryContext);

  if (!params.id) {
    throw new Error("No machine ID provided");
  }

  if (params.id.endsWith(".ico")) {
    throw data(null, { status: 204 });
  }

  // The list page hides this route from accounts without `read_machines`, but
  // the flags it hands the header are not enforcement: a guessed node id used to
  // reach the same node details (addresses, tags, users, history) from here.
  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.read_machines)) {
    throw data({ localized: { key: "errors.permission.view" } }, { status: 403 });
  }

  const magic = headscaleConfig.getMagicDNSBaseDomain();

  const { api } = await getRequestApi(request);
  const [nodesSnap, usersSnap] = await Promise.all([
    headscaleLiveStore.get(nodesResource, api),
    headscaleLiveStore.get(usersResource, api),
  ]);
  const nodes = nodesSnap.data;
  const users = usersSnap.data;
  const node = nodes.find((node) => node.id === params.id);
  if (node == null) {
    throw data(null, { status: 404 });
  }

  const agents = agentsFeature.state === "enabled" ? agentsFeature.value : undefined;
  const [lookup, policyResult] = await Promise.allSettled([
    agents?.lookup([node.nodeKey]),
    api.policy.get(),
  ]);
  const stats = lookup.status === "fulfilled" ? lookup.value : undefined;
  const [enhancedNode] = mapNodes([node], stats);
  const tags = [...node.tags].toSorted();
  const supportsNodeOwnerChange = !headscale.capabilities.nodeOwnerIsImmutable;
  const supportsDisablingKeyExpiry = headscale.capabilities.keyExpiryCanBeDisabled;
  const agentSync = agents?.lastSync();
  const policy = policyResult.status === "fulfilled" ? policyResult.value.policy : undefined;

  // Availability comes from Headplane's own sampler. A store that has never
  // been written, or one that cannot be read, leaves the card saying so rather
  // than failing the page.
  await nodeHistory.ready();
  const availability = attemptNodeTimeline(nodeHistory.document(), node.id);

  // The relay clients actually reach comes from Headscale's server_url and its
  // DNS records, not from `derp.server`'s declared addresses. The lookup is
  // cached and fail-soft, so a relay that cannot be resolved never fails the
  // page — it only leaves the card saying why.
  const derp = headscaleConfig.getDERPSettings();
  const relayEndpoint = deriveDerpPublicEndpoint(derp.serverUrl);
  // Region names come from a chain the loader resolves once: the operator's
  // manual mapping, the local `derp.paths` maps and the remote `derp.urls` maps.
  // The card only ever receives the plain result, and a map that cannot be read
  // or fetched simply leaves that region as a bare id.
  //
  // The maps are read held apart by source rather than merged, exactly as the
  // Overview node card reads them: that is what tells the card whether a relay
  // the machine uses is served by this deployment (the embedded relay, a local
  // file, the official-region filter) or only advertised upstream. The read is
  // the same one the merged names come from, so it costs nothing extra.
  const mirrorSettingsLookup = (async () => {
    await derpMirror.ready();
    return derpMirror.settings();
  })();

  const nodeInventoryLookup = (async () => {
    const mirror = await mirrorSettingsLookup;
    return loadDerpNodeInventory({
      paths: derp.paths,
      urls: derp.urls,
      autoUpdateEnabled: derp.autoUpdateEnabled,
      updateFrequency: derp.updateFrequency,
      baseDir: appConfig.headscale.config_path
        ? dirname(appConfig.headscale.config_path)
        : undefined,
      mirrorPath: mirror.targetPath,
    });
  })();

  const [relayResolution, regionNames, nodeInventory, mirrorSettings] = await Promise.all([
    loadSharedRelayResolution(relayEndpoint?.host),
    readDerpRegionNames(appConfig.server.data_path),
    nodeInventoryLookup,
    mirrorSettingsLookup,
  ]);
  // The address lines join the declared addresses with the lookup, so each
  // family reads as one line instead of a declared-versus-resolved pair. The
  // card receives the finished lines: it must never import a module that
  // reaches Node-only code (see `./relay-verdicts`).
  const relayView = buildRelayView(relayEndpoint, relayResolution, derp.server);
  const relay = relayView.host;
  // One region id to the source that serves it, so a relay row can say whether
  // this deployment serves the relay the machine uses.
  const relaySources = relayRegionSources(nodeInventory.groups, embeddedDerpRegion(derp.server));
  // Every region this deployment serves — the embedded relay's region plus every
  // region of the maps it actually loads, the region mirror's own file included.
  // The projection is the Overview card's own served inventory, so the machine
  // card cannot call a region served that the dashboard does not.
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
    agent: agentSync
      ? {
          syncedAt: agentSync.syncedAt?.toISOString() ?? null,
          nodeCount: agentSync.nodeCount,
          nodeKey: agents?.agentNodeKey(),
        }
      : undefined,
    availability,
    // Unlike `agent`, this stays true while the agent feature is on but no
    // agent has synced yet, so the page can tell "no agent" from "no data".
    agentEnabled: agents !== undefined,
    derp,
    // Region labels the DERP card resolves: the manual names Headplane stores in
    // its data directory, plus what the configured DERP maps describe. A missing
    // or corrupt source simply resolves to fewer known names.
    derpRegions: {
      manual: regionNames,
      local: nodeInventory.local,
      remote: nodeInventory.remote,
    },
    relay,
    // What the latency table needs beyond the machine's own report: every region
    // this deployment serves, the values this server measured itself (keyed by
    // the official region id the probe dialled) and the mirror's stored
    // assignment, which lines a measured official region up with the mirrored
    // number its row shows. Plain values only: the card never reads the store.
    relayInventory: {
      assignment: mirrorSettings.assignment,
      measured: locallyMeasuredRegionLatencies(mirrorSettings.latency),
      servedRegionIds: servedDerpRegionIds(nodeSources),
    },
    relayLines: relayAddressLines(derp.server, relayResolution),
    relaySources,
    existingTags: sortAssignableTags(nodes, policy),
    // `undefined` keeps the tag dialog from flagging every tag as undeclared.
    policyTags: extractTagOwnerTags(policy),
    magic,
    node: enhancedNode,
    stats: stats?.[enhancedNode.nodeKey],
    supportsNodeOwnerChange: supportsNodeOwnerChange,
    supportsDisablingKeyExpiry: supportsDisablingKeyExpiry,
    tags,
    users,
  };
}

export const action = machineAction;

/**
 * A machine's detail page is keyed by `params.id`, never by the query string, so
 * a search-param-only navigation must not re-run this loader. See
 * `./should-revalidate.ts`; a form submission still revalidates.
 */
export const shouldRevalidate: ShouldRevalidateFunction = shouldRevalidateMachines;

export default function Page({
  loaderData: {
    node,
    tags,
    users,
    magic,
    agent,
    agentEnabled,
    availability,
    derp,
    derpRegions,
    relay,
    relayInventory,
    relayLines,
    relaySources,
    stats,
    existingTags,
    policyTags,
    supportsNodeOwnerChange,
    supportsDisablingKeyExpiry,
  },
}: Route.ComponentProps) {
  const { t, locale } = useI18n();
  const [showRouting, setShowRouting] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [showExpire, setShowExpire] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const uptime = availability ? uptimePercent(availability.uptime) : undefined;

  const uiTags = useMemo(() => {
    const tags = uiTagsForNode(node, agent?.nodeKey === node.nodeKey);
    return tags;
  }, [node, agent]);

  const owner = node.user
    ? getUserDisplayName(node.user, t("machines.common.tagOwned"))
    : t("machines.common.tagOwned");
  const hasTags = tags.length > 0 || uiTags.length > 0;

  return (
    <div className="flex w-full flex-col gap-5">
      <Routes isOpen={showRouting} node={node} setIsOpen={setShowRouting} />
      <Delete isOpen={showRemove} machine={node} setIsOpen={setShowRemove} />
      <Expire isOpen={showExpire} machine={node} setIsOpen={setShowExpire} />
      <DebugNode isOpen={showDebug} setIsOpen={setShowDebug} />

      <header className="flex flex-col gap-3">
        <nav className="text-sm text-mist-600 dark:text-mist-400">
          <Link className="font-medium" to="/machines">
            {t("machines.detail.allMachines")}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-mist-900 dark:text-mist-100">{node.givenName}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="max-w-full min-w-0 truncate text-2xl font-semibold tracking-tight">
                {node.givenName}
              </h1>
              <MachineStatus node={node} />
            </div>
            <p className="flex items-center gap-x-2 text-sm text-mist-600 dark:text-mist-400">
              <UserCircle className="h-4 w-4 shrink-0" />
              <span>{t("machines.detail.managedBy")}</span>
              <span className="min-w-0 truncate font-medium text-mist-900 dark:text-mist-100">
                {owner}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Personal, presentation-only: whether addresses stay masked. */}
            <AddressVisibilityMenu />
            <MenuOptions
              existingTags={existingTags}
              policyTags={policyTags}
              isFullButton
              magic={magic}
              node={node}
              users={users}
              supportsNodeOwnerChange={supportsNodeOwnerChange}
              supportsDisablingKeyExpiry={supportsDisablingKeyExpiry}
            />
          </div>
        </div>
      </header>

      {/* `items-stretch` plus `h-full` on the cards keeps every card in a row
          as tall as the tallest one in it, whatever it holds. */}
      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <MachineCard icon={Info} title={t("machines.detail.detailsTitle")}>
          <dl className="flex flex-col">
            <MachineAttribute name={t("machines.detail.creator")} value={owner} />
            <MachineAttribute name={t("machines.detail.machineName")} value={node.givenName} />
            <MachineAttribute
              name={t("machines.detail.osHostname")}
              tooltip={t("machines.detail.osHostnameTooltip")}
              value={node.name}
            />
            {stats ? (
              <>
                <MachineAttribute name={t("machines.detail.os")} value={getOSInfo(stats)} />
                <MachineAttribute
                  name={t("machines.detail.tailscaleVersion")}
                  value={getTSVersion(stats)}
                />
              </>
            ) : undefined}
            <MachineAttribute
              isCode
              isCopyable
              name={t("machines.detail.id")}
              tooltip={t("machines.detail.idTooltip")}
              value={node.id}
            />
            <MachineAttribute
              isCode
              isCopyable
              name={t("machines.detail.nodeKey")}
              tooltip={t("machines.detail.nodeKeyTooltip")}
              value={node.nodeKey}
            />
            <MachineAttribute
              name={t("machines.detail.created")}
              value={new Date(node.createdAt).toLocaleString(locale)}
            />
            <MachineAttribute
              name={t("machines.detail.lastSeen")}
              value={
                node.online
                  ? t("machines.common.connected")
                  : new Date(node.lastSeen).toLocaleString(locale)
              }
            />
            <MachineAttribute
              name={t("machines.detail.keyExpiry")}
              value={
                !isNoExpiry(node.expiry)
                  ? new Date(node.expiry!).toLocaleString(locale)
                  : t("machines.common.never")
              }
            />
            {magic ? (
              <MachineAttribute
                isAddress
                isCopyable
                name={t("machines.detail.domain")}
                value={`${node.givenName}.${magic}`}
              />
            ) : undefined}
          </dl>
        </MachineCard>

        <MachineCard icon={Network} title={t("machines.detail.addresses")}>
          <dl className="flex flex-col">
            <MachineAttribute
              isAddress
              isCode
              isCopyable
              name={t("machines.detail.tailscaleIpv4")}
              tooltip={t("machines.detail.tailscaleIpv4Tooltip")}
              value={getIpv4Address(node.ipAddresses)}
            />
            <MachineAttribute
              isAddress
              isCode
              isCopyable
              name={t("machines.detail.tailscaleIpv6")}
              tooltip={t("machines.detail.tailscaleIpv6Tooltip")}
              value={getIpv6Address(node.ipAddresses)}
            />
            <MachineAttribute
              isCopyable
              name={t("machines.detail.shortDomain")}
              tooltip={t("machines.detail.shortDomainTooltip")}
              value={node.givenName}
            />
            {magic ? (
              <MachineAttribute
                isAddress
                isCopyable
                name={t("machines.detail.fullDomain")}
                tooltip={t("machines.detail.fullDomainTooltip")}
                value={`${node.givenName}.${magic}`}
              />
            ) : undefined}
            {stats?.Endpoints ? (
              <MachineAttribute
                isAddress
                name={t("machines.detail.endpoints")}
                value={stats.Endpoints.join("\n")}
              />
            ) : undefined}
          </dl>
        </MachineCard>

        <MachineCard
          description={t("machines.detail.availability.body")}
          icon={ChartColumn}
          status={
            <SettingsStatus tone={uptime === undefined ? "neutral" : "ok"}>
              {uptime === undefined
                ? t("machines.detail.availability.noDataChip")
                : t("machines.detail.availability.uptime", { percent: uptime })}
            </SettingsStatus>
          }
          title={t("machines.detail.availability.title")}
        >
          {availability !== undefined && uptime !== undefined ? (
            <div className="flex flex-col gap-2">
              <NodeAvailabilityBar
                labels={{
                  label: t("machines.detail.availability.title"),
                  online: t("machines.detail.availability.legendOnline"),
                  offline: t("machines.detail.availability.legendOffline"),
                  unknown: t("machines.detail.availability.legendUnknown"),
                }}
                states={availability.buckets}
              />
              {availability.partial && availability.collectingSince ? (
                <p className="text-xs text-mist-500 dark:text-mist-400">
                  {t("machines.detail.availability.collectingSince", {
                    at: new Date(availability.collectingSince).toLocaleString(locale),
                  })}
                </p>
              ) : undefined}
            </div>
          ) : (
            <p className="text-sm text-mist-500 dark:text-mist-400">
              {t("machines.detail.availability.noData")}
            </p>
          )}
        </MachineCard>

        <MachineCard
          action={
            <Button onClick={() => setShowRouting(true)} variant="ghost">
              {t("machines.detail.review")}
            </Button>
          }
          description={
            <>
              {t("machines.detail.routingBody")}{" "}
              <Link external styled to="https://tailscale.com/kb/1019/subnets">
                {t("common.learnMore")}
              </Link>
            </>
          }
          icon={RouteIcon}
          title={t("machines.detail.routingTitle")}
        >
          <dl className="flex flex-col">
            <MachineAttribute
              isAddress
              isCode
              name={t("machines.detail.approved")}
              tooltip={t("machines.detail.approvedTooltip")}
              value={
                node.customRouting.subnetApprovedRoutes.length === 0
                  ? "—"
                  : node.customRouting.subnetApprovedRoutes.join("\n")
              }
            />
            <MachineAttribute
              isAddress
              isCode
              name={t("machines.detail.awaitingApproval")}
              tooltip={t("machines.detail.awaitingApprovalTooltip")}
              value={
                node.customRouting.subnetWaitingRoutes.length === 0
                  ? "—"
                  : node.customRouting.subnetWaitingRoutes.join("\n")
              }
            />
            <MachineAttribute
              name={t("machines.detail.exitNode")}
              tooltip={t("machines.detail.exitNodeTooltip")}
              value={
                node.customRouting.exitRoutes.length === 0
                  ? "—"
                  : node.customRouting.exitApproved
                    ? t("machines.detail.allowed")
                    : t("machines.detail.awaitingApproval")
              }
            />
          </dl>
        </MachineCard>

        <MachineCard
          className="h-full"
          icon={TagsIcon}
          status={
            hasTags ? (
              <span className="text-xs text-mist-500 dark:text-mist-400">{tags.length}</span>
            ) : undefined
          }
          title={t("machines.detail.tagsTitle")}
        >
          {hasTags ? (
            <div className="flex flex-wrap items-center gap-1">
              {mapTagsToComponents(node, uiTags)}
              {tags.map((tag) => (
                <Chip key={tag} text={tag} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-mist-500 dark:text-mist-400">{t("machines.tags.empty")}</p>
          )}
        </MachineCard>

        {stats ? (
          <MachineCard
            className="h-full"
            icon={Activity}
            title={t("machines.detail.clientConnectivity")}
          >
            <ClientConnectivity
              facts={[
                {
                  name: t("machines.detail.varies"),
                  tooltip: t("machines.detail.variesTooltip"),
                  value: Boolean(stats.NetInfo?.MappingVariesByDestIP),
                },
                {
                  name: t("machines.detail.hairpinning"),
                  tooltip: t("machines.detail.hairpinningTooltip"),
                  value: Boolean(stats.NetInfo?.HairPinning),
                },
                {
                  name: t("machines.detail.ipv6"),
                  tooltip: t("machines.detail.ipv6Tooltip"),
                  value: Boolean(stats.NetInfo?.WorkingIPv6),
                },
                {
                  name: t("machines.detail.udp"),
                  tooltip: t("machines.detail.udpTooltip"),
                  value: Boolean(stats.NetInfo?.WorkingUDP),
                },
                {
                  name: t("machines.detail.upnp"),
                  tooltip: t("machines.detail.upnpTooltip"),
                  value: Boolean(stats.NetInfo?.UPnP),
                },
                {
                  name: t("machines.detail.pcp"),
                  tooltip: t("machines.detail.pcpTooltip"),
                  value: Boolean(stats.NetInfo?.PCP),
                },
                {
                  name: t("machines.detail.natPmp"),
                  tooltip: t("machines.detail.natPmpTooltip"),
                  value: Boolean(stats.NetInfo?.PMP),
                },
              ]}
            />
          </MachineCard>
        ) : undefined}

        <DerpInfo
          agentEnabled={agentEnabled}
          inventory={relayInventory}
          regions={derpRegions}
          relay={relay}
          relayLines={relayLines}
          relaySources={relaySources}
          server={derp.server}
          stats={stats}
        />
      </div>

      {/* Directly above the danger zone, and exactly as wide: the diagnostics
          block is the last read-only card before the destructive one. It reads
          only what this page already loaded, so it asks nothing of Headscale. */}
      <NodeDiagnostics
        diagnostics={{
          agentEnabled,
          stats,
          regions: derpRegions,
          relaySources,
          server: derp.server,
          inventory: relayInventory,
        }}
      />

      <MachineCard
        description={t("machines.remove.body")}
        icon={TriangleAlert}
        title={t("machines.detail.dangerTitle")}
        tone="danger"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setShowExpire(true)}>
            <CalendarClock className="h-4 w-4" />
            {t("machines.menu.expire")}
          </Button>
          {/* The one entry here that adds a node instead of removing one, kept
              beside the destructive action because it fabricates a machine that
              really exists until it is deleted again. */}
          <Button onClick={() => setShowDebug(true)}>
            <Bug className="h-4 w-4" />
            {t("machines.debug.menu")}
          </Button>
          <Button onClick={() => setShowRemove(true)} variant="danger">
            <Trash2 className="h-4 w-4" />
            {t("machines.menu.remove")}
          </Button>
        </div>
      </MachineCard>
    </div>
  );
}

/**
 * The node's availability timeline over the last day, or `undefined` when it
 * cannot be derived. The maths is pure and defensive, but a loader must never
 * fail because of a status card.
 */
function attemptNodeTimeline(
  document: NodeHistoryDocument,
  nodeId: string,
): NodeTimeline | undefined {
  try {
    return computeNodeTimeline(document, nodeId, "24h", Date.now());
  } catch {
    return undefined;
  }
}

function getIpv4Address(addresses: string[]) {
  for (const address of addresses) {
    if (address.startsWith("100.")) {
      // Return the first CGNAT address
      return address;
    }
  }

  return "—";
}

function getIpv6Address(addresses: string[]) {
  for (const address of addresses) {
    if (address.startsWith("fd")) {
      // Return the first IPv6 address
      return address;
    }
  }

  return "—";
}
