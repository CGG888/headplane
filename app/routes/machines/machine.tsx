import { CheckCircle, CircleSlash, Info, UserCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { data } from "react-router";

import Attribute from "~/components/attribute";
import Button from "~/components/button";
import Card from "~/components/card";
import Chip from "~/components/chip";
import Link from "~/components/link";
import StatusCircle from "~/components/status-circle";
import Tooltip from "~/components/tooltip";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  headscaleConfigContext,
  headscaleContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { nodesResource, usersResource } from "~/server/headscale/live-store";
import cn from "~/utils/cn";
import { getOSInfo, getTSVersion } from "~/utils/host-info";
import { extractTagOwnerTags, isNoExpiry, mapNodes, sortAssignableTags } from "~/utils/node-info";
import { getUserDisplayName } from "~/utils/user";

import type { Route } from "./+types/machine";
import { mapTagsToComponents, uiTagsForNode } from "./components/machine-row";
import MenuOptions from "./components/menu";
import Routes from "./dialogs/routes";
import { machineAction } from "./machine-actions";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
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
    stats,
    existingTags,
    policyTags,
    supportsNodeOwnerChange,
    supportsDisablingKeyExpiry,
  },
}: Route.ComponentProps) {
  const { t, locale } = useI18n();
  const [showRouting, setShowRouting] = useState(false);

  const uiTags = useMemo(() => {
    const tags = uiTagsForNode(node, agent?.nodeKey === node.nodeKey);
    return tags;
  }, [node, agent]);

  return (
    <div>
      <p className="text-md mb-8">
        <Link className="font-medium" to="/machines">
          {t("machines.detail.allMachines")}
        </Link>
        <span className="mx-2">/</span>
        {node.givenName}
      </p>
      <div
        className={cn(
          "flex justify-between items-center pb-2",
          "border-b border-mist-100 dark:border-mist-800",
        )}
      >
        <span className="flex items-baseline gap-x-4 text-sm">
          <h1 className="text-2xl font-medium">{node.givenName}</h1>
          <StatusCircle className="h-4 w-4" isOnline={node.online} />
        </span>
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
      <div className="mb-4 flex gap-1">
        <div className="border-r border-mist-100 p-2 pr-4 dark:border-mist-800">
          <span className="flex items-center gap-x-1 text-sm text-mist-600 dark:text-mist-300">
            {t("machines.detail.managedBy")}
            <Tooltip content={t("machines.detail.managedByTooltip")}>
              <Info className="p-1" />
            </Tooltip>
          </span>
          <div className="mt-1 flex items-center gap-x-2.5">
            <UserCircle />
            {node.user
              ? getUserDisplayName(node.user, t("machines.common.tagOwned"))
              : t("machines.common.tagOwned")}
          </div>
        </div>
        <div className="p-2 pl-4">
          <p className="text-sm text-mist-600 dark:text-mist-300">{t("machines.detail.status")}</p>
          <div className="mt-1 mb-8 flex gap-1">
            {mapTagsToComponents(node, uiTags)}
            {tags.map((tag) => (
              <Chip key={tag} text={tag} />
            ))}
          </div>
        </div>
      </div>
      <Routes isOpen={showRouting} node={node} setIsOpen={setShowRouting} />
      <h2 className="mt-8 text-xl font-medium">{t("machines.detail.routingTitle")}</h2>
      <div className="mb-4 flex items-center justify-between">
        <p>
          {t("machines.detail.routingBody")}{" "}
          <Link external styled to="https://tailscale.com/kb/1019/subnets">
            {t("common.learnMore")}
          </Link>
        </p>
        <Button onClick={() => setShowRouting(true)}>{t("machines.detail.review")}</Button>
      </div>
      <Card
        className={cn(
          "w-full max-w-full grid sm:grid-cols-2",
          "md:grid-cols-4 gap-8 mr-2 text-sm mb-8",
        )}
        variant="flat"
      >
        <div>
          <span className="flex items-center gap-x-1 text-mist-600 dark:text-mist-300">
            {t("machines.detail.approved")}
            <Tooltip content={t("machines.detail.approvedTooltip")}>
              <Info className="h-3.5 w-3.5" />
            </Tooltip>
          </span>
          <div className="mt-1">
            {node.customRouting.subnetApprovedRoutes.length === 0 ? (
              <span className="opacity-50">—</span>
            ) : (
              <ul className="leading-normal">
                {node.customRouting.subnetApprovedRoutes.map((route) => (
                  <li key={route}>{route}</li>
                ))}
              </ul>
            )}
          </div>
          <Button
            className="mt-1.5 px-1.5 py-0.5"
            onClick={() => setShowRouting(true)}
            variant="ghost"
          >
            {t("machines.detail.edit")}
          </Button>
        </div>
        <div>
          <span className="flex items-center gap-x-1 text-mist-600 dark:text-mist-300">
            {t("machines.detail.awaitingApproval")}
            <Tooltip content={t("machines.detail.awaitingApprovalTooltip")}>
              <Info className="h-3.5 w-3.5" />
            </Tooltip>
          </span>
          <div className="mt-1">
            {node.customRouting.subnetWaitingRoutes.length === 0 ? (
              <span className="opacity-50">—</span>
            ) : (
              <ul className="leading-normal">
                {node.customRouting.subnetWaitingRoutes.map((route) => (
                  <li key={route}>{route}</li>
                ))}
              </ul>
            )}
          </div>
          <Button
            className="mt-1.5 px-1.5 py-0.5"
            onClick={() => setShowRouting(true)}
            variant="ghost"
          >
            {t("machines.detail.edit")}
          </Button>
        </div>
        <div>
          <span className="flex items-center gap-x-1 text-mist-600 dark:text-mist-300">
            {t("machines.detail.exitNode")}
            <Tooltip content={t("machines.detail.exitNodeTooltip")}>
              <Info className="h-3.5 w-3.5" />
            </Tooltip>
          </span>
          <div className="mt-1">
            {node.customRouting.exitRoutes.length === 0 ? (
              <span className="opacity-50">—</span>
            ) : node.customRouting.exitApproved ? (
              <span className="flex items-center gap-x-1">
                <CheckCircle className="h-3.5 w-3.5 text-green-700" />
                {t("machines.detail.allowed")}
              </span>
            ) : (
              <span className="flex items-center gap-x-1">
                <CircleSlash className="h-3.5 w-3.5 text-red-700" />
                {t("machines.detail.awaitingApproval")}
              </span>
            )}
          </div>
          <Button
            className="mt-1.5 px-1.5 py-0.5"
            onClick={() => setShowRouting(true)}
            variant="ghost"
          >
            {t("machines.detail.edit")}
          </Button>
        </div>
      </Card>
      <h2 className="text-xl font-medium">{t("machines.detail.detailsTitle")}</h2>
      <p className="mb-4">{t("machines.detail.detailsBody")}</p>
      <Card
        className="grid w-full max-w-full grid-cols-1 gap-y-2 sm:gap-x-12 lg:grid-cols-2"
        variant="flat"
      >
        <div className="flex flex-col gap-1">
          <Attribute
            name={t("machines.detail.creator")}
            value={
              node.user
                ? getUserDisplayName(node.user, t("machines.common.tagOwned"))
                : t("machines.common.tagOwned")
            }
          />
          <Attribute name={t("machines.detail.machineName")} value={node.givenName} />
          <Attribute
            name={t("machines.detail.osHostname")}
            tooltip={t("machines.detail.osHostnameTooltip")}
            value={node.name}
          />
          {stats ? (
            <>
              <Attribute name={t("machines.detail.os")} value={getOSInfo(stats)} />
              <Attribute name={t("machines.detail.tailscaleVersion")} value={getTSVersion(stats)} />
            </>
          ) : undefined}
          <Attribute
            name={t("machines.detail.id")}
            tooltip={t("machines.detail.idTooltip")}
            value={node.id}
          />
          <Attribute
            isCopyable
            name={t("machines.detail.nodeKey")}
            tooltip={t("machines.detail.nodeKeyTooltip")}
            value={node.nodeKey}
          />
          <Attribute
            name={t("machines.detail.created")}
            value={new Date(node.createdAt).toLocaleString(locale)}
          />
          <Attribute
            name={t("machines.detail.lastSeen")}
            value={
              node.online
                ? t("machines.common.connected")
                : new Date(node.lastSeen).toLocaleString(locale)
            }
          />
          <Attribute
            name={t("machines.detail.keyExpiry")}
            value={
              !isNoExpiry(node.expiry)
                ? new Date(node.expiry!).toLocaleString(locale)
                : t("machines.common.never")
            }
          />
          {magic ? (
            <Attribute
              isCopyable
              name={t("machines.detail.domain")}
              value={`${node.givenName}.${magic}`}
            />
          ) : undefined}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-mist-600 uppercase dark:text-mist-300">
            {t("machines.detail.addresses")}
          </p>
          <Attribute
            isCopyable
            name={t("machines.detail.tailscaleIpv4")}
            tooltip={t("machines.detail.tailscaleIpv4Tooltip")}
            value={getIpv4Address(node.ipAddresses)}
          />
          <Attribute
            isCopyable
            name={t("machines.detail.tailscaleIpv6")}
            tooltip={t("machines.detail.tailscaleIpv6Tooltip")}
            value={getIpv6Address(node.ipAddresses)}
          />
          <Attribute
            isCopyable
            name={t("machines.detail.shortDomain")}
            tooltip={t("machines.detail.shortDomainTooltip")}
            value={node.givenName}
          />
          {magic ? (
            <Attribute
              isCopyable
              name={t("machines.detail.fullDomain")}
              tooltip={t("machines.detail.fullDomainTooltip")}
              value={`${node.givenName}.${magic}`}
            />
          ) : undefined}
          {stats?.Endpoints ? (
            <Attribute
              name={t("machines.detail.endpoints")}
              value={stats?.Endpoints?.join("\n") ?? "—"}
            />
          ) : undefined}
          {stats ? (
            <>
              <p className="mt-4 text-sm font-semibold text-mist-600 uppercase dark:text-mist-300">
                {t("machines.detail.clientConnectivity")}
              </p>
              <Attribute
                name={t("machines.detail.varies")}
                tooltip={t("machines.detail.variesTooltip")}
                value={
                  stats.NetInfo?.MappingVariesByDestIP
                    ? t("machines.common.yes")
                    : t("machines.common.no")
                }
              />
              <Attribute
                name={t("machines.detail.hairpinning")}
                tooltip={t("machines.detail.hairpinningTooltip")}
                value={
                  stats.NetInfo?.HairPinning ? t("machines.common.yes") : t("machines.common.no")
                }
              />
              <Attribute
                name={t("machines.detail.ipv6")}
                value={
                  stats.NetInfo?.WorkingIPv6 ? t("machines.common.yes") : t("machines.common.no")
                }
              />
              <Attribute
                name={t("machines.detail.udp")}
                value={
                  stats.NetInfo?.WorkingUDP ? t("machines.common.yes") : t("machines.common.no")
                }
              />
              <Attribute
                name={t("machines.detail.upnp")}
                value={stats.NetInfo?.UPnP ? t("machines.common.yes") : t("machines.common.no")}
              />
              <Attribute
                name={t("machines.detail.pcp")}
                value={stats.NetInfo?.PCP ? t("machines.common.yes") : t("machines.common.no")}
              />
              <Attribute
                name={t("machines.detail.natPmp")}
                value={stats.NetInfo?.PMP ? t("machines.common.yes") : t("machines.common.no")}
              />
            </>
          ) : undefined}
        </div>
      </Card>
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
