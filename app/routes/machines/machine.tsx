import {
  Activity,
  CalendarClock,
  Info,
  Network,
  Route as RouteIcon,
  Tags as TagsIcon,
  Trash2,
  TriangleAlert,
  UserCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { data } from "react-router";

import Button from "~/components/button";
import Chip from "~/components/chip";
import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  headscaleConfigContext,
  headscaleContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { nodesResource, usersResource } from "~/server/headscale/live-store";
import { getOSInfo, getTSVersion } from "~/utils/host-info";
import { extractTagOwnerTags, isNoExpiry, mapNodes, sortAssignableTags } from "~/utils/node-info";
import { getUserDisplayName } from "~/utils/user";

import type { Route } from "./+types/machine";
import MachineAttribute from "./components/attribute";
import DerpInfo from "./components/derp-info";
import MachineCard from "./components/machine-card";
import { mapTagsToComponents, uiTagsForNode } from "./components/machine-row";
import MachineStatus from "./components/machine-status";
import MenuOptions from "./components/menu";
import Delete from "./dialogs/delete";
import Expire from "./dialogs/expire";
import Routes from "./dialogs/routes";
import { machineAction } from "./machine-actions";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
  const appConfig = context.get(appConfigContext);
  const getRequestApi = context.get(requestApiContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  if (!params.id) {
    throw new Error("No machine ID provided");
  }

  if (params.id.endsWith(".ico")) {
    throw data(null, { status: 204 });
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

  return {
    agent: agentSync
      ? {
          syncedAt: agentSync.syncedAt?.toISOString() ?? null,
          nodeCount: agentSync.nodeCount,
          nodeKey: agents?.agentNodeKey(),
        }
      : undefined,
    // Unlike `agent`, this stays true while the agent feature is on but no
    // agent has synced yet, so the page can tell "no agent" from "no data".
    agentEnabled: agents !== undefined,
    derp: headscaleConfig.getDERPSettings(),
    // Manual names for the regions Headscale cannot name itself; a missing or
    // corrupt file simply resolves to no mapping.
    derpRegionNames: await readDerpRegionNames(appConfig.server.data_path),
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

export default function Page({
  loaderData: {
    node,
    tags,
    users,
    magic,
    agent,
    agentEnabled,
    derp,
    derpRegionNames,
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
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
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
              isCode
              isCopyable
              name={t("machines.detail.tailscaleIpv4")}
              tooltip={t("machines.detail.tailscaleIpv4Tooltip")}
              value={getIpv4Address(node.ipAddresses)}
            />
            <MachineAttribute
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
                isCopyable
                name={t("machines.detail.fullDomain")}
                tooltip={t("machines.detail.fullDomainTooltip")}
                value={`${node.givenName}.${magic}`}
              />
            ) : undefined}
            {stats?.Endpoints ? (
              <MachineAttribute
                name={t("machines.detail.endpoints")}
                value={stats.Endpoints.join("\n")}
              />
            ) : undefined}
          </dl>
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
          <MachineCard icon={Activity} title={t("machines.detail.clientConnectivity")}>
            <dl className="flex flex-col">
              <MachineAttribute
                name={t("machines.detail.varies")}
                tooltip={t("machines.detail.variesTooltip")}
                value={
                  stats.NetInfo?.MappingVariesByDestIP
                    ? t("machines.common.yes")
                    : t("machines.common.no")
                }
              />
              <MachineAttribute
                name={t("machines.detail.hairpinning")}
                tooltip={t("machines.detail.hairpinningTooltip")}
                value={
                  stats.NetInfo?.HairPinning ? t("machines.common.yes") : t("machines.common.no")
                }
              />
              <MachineAttribute
                name={t("machines.detail.ipv6")}
                value={
                  stats.NetInfo?.WorkingIPv6 ? t("machines.common.yes") : t("machines.common.no")
                }
              />
              <MachineAttribute
                name={t("machines.detail.udp")}
                value={
                  stats.NetInfo?.WorkingUDP ? t("machines.common.yes") : t("machines.common.no")
                }
              />
              <MachineAttribute
                name={t("machines.detail.upnp")}
                value={stats.NetInfo?.UPnP ? t("machines.common.yes") : t("machines.common.no")}
              />
              <MachineAttribute
                name={t("machines.detail.pcp")}
                value={stats.NetInfo?.PCP ? t("machines.common.yes") : t("machines.common.no")}
              />
              <MachineAttribute
                name={t("machines.detail.natPmp")}
                value={stats.NetInfo?.PMP ? t("machines.common.yes") : t("machines.common.no")}
              />
            </dl>
          </MachineCard>
        ) : undefined}

        <DerpInfo
          agentEnabled={agentEnabled}
          regionNames={derpRegionNames}
          server={derp.server}
          stats={stats}
        />
      </div>

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
          <Button onClick={() => setShowRemove(true)} variant="danger">
            <Trash2 className="h-4 w-4" />
            {t("machines.menu.remove")}
          </Button>
        </div>
      </MachineCard>
    </div>
  );
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
