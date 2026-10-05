import { ChevronDown, ChevronUp, Info, SearchX, ServerOff, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { data, useSearchParams, type ShouldRevalidateFunction } from "react-router";

import Button from "~/components/button";
import Code from "~/components/code";
import Input from "~/components/input";
import Link from "~/components/link";
import PageError from "~/components/page-error";
import Tooltip from "~/components/tooltip";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { nodesResource, usersResource } from "~/server/headscale/live-store";
import { isUserPrincipal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import cn from "~/utils/cn";
import {
  extractTagOwnerTags,
  mapNodes,
  sortAssignableTags,
  type PopulatedNode,
} from "~/utils/node-info";

import type { Route } from "./+types/overview";
import BulkActions from "./components/bulk-actions";
import { MachineFilters } from "./components/machine-filters";
import MachineRow from "./components/machine-row";
import SelectCheckbox from "./components/select-checkbox";
import NewMachine from "./dialogs/new";
import { useMachineFilterParams } from "./hooks/use-machine-filter-params";
import { machineAction } from "./machine-actions";
import { shouldRevalidateMachines } from "./should-revalidate";

export async function loader({ request, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const getRequestApi = context.get(requestApiContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  const principal = await auth.require(request);

  if (!auth.can(principal, Capabilities.read_machines)) {
    throw data({ localized: { key: "errors.permission.view" } }, { status: 403 });
  }

  const writablePermission = auth.can(principal, Capabilities.write_machines);

  const { api } = await getRequestApi(request);
  const [nodesSnap, usersSnap] = await Promise.all([
    headscaleLiveStore.get(nodesResource, api),
    headscaleLiveStore.get(usersResource, api),
  ]);
  const nodes = nodesSnap.data;
  const users = usersSnap.data;

  const magic = headscaleConfig.getMagicDNSBaseDomain();

  const agents = agentsFeature.state === "enabled" ? agentsFeature.value : undefined;
  const [statsResult, policyResult] = await Promise.allSettled([
    agents?.lookup(nodes.map((node) => node.nodeKey)),
    api.policy.get(),
  ]);
  const stats = statsResult.status === "fulfilled" ? statsResult.value : undefined;
  const policy = policyResult.status === "fulfilled" ? policyResult.value.policy : undefined;
  const populatedNodes = mapNodes(nodes, stats);
  const supportsNodeOwnerChange = !headscale.capabilities.nodeOwnerIsImmutable;
  const supportsDisablingKeyExpiry = headscale.capabilities.keyExpiryCanBeDisabled;
  const agentSync = agents?.lastSync();

  return {
    agent: agentSync
      ? {
          syncedAt: agentSync.syncedAt?.toISOString() ?? null,
          nodeCount: agentSync.nodeCount,
          nodeKey: agents?.agentNodeKey(),
        }
      : undefined,
    headscaleUserId: isUserPrincipal(principal) ? principal.user.headscaleUserId : undefined,
    existingTags: sortAssignableTags(nodes, policy),
    // `undefined` keeps the tag dialog from flagging every tag as undeclared.
    policyTags: extractTagOwnerTags(policy),
    magic,
    nodes,
    populatedNodes,
    preAuth: auth.can(principal, Capabilities.generate_authkeys),
    publicServer: config.headscale.public_url,
    server: config.headscale.url,
    supportsNodeOwnerChange: supportsNodeOwnerChange,
    supportsDisablingKeyExpiry: supportsDisablingKeyExpiry,
    users,
    writable: writablePermission,
  };
}

export const action = machineAction;

/**
 * Filtering, sorting and searching write the query string but are applied in the
 * browser, so a search-param-only navigation must not re-run this loader. See
 * `./should-revalidate.ts`.
 */
export const shouldRevalidate: ShouldRevalidateFunction = shouldRevalidateMachines;

type SortField = "name" | "ip" | "version" | "lastSeen";

const STATUS_MATCH: Record<string, (n: PopulatedNode) => boolean> = {
  online: (n) => n.online && !n.expired,
  offline: (n) => !n.online && !n.expired,
  expired: (n) => n.expired,
};

const ROUTE_MATCH: Record<string, (n: PopulatedNode) => boolean> = {
  "exit-node": (n) => n.customRouting.exitRoutes.length > 0,
  subnet: (n) =>
    n.customRouting.subnetApprovedRoutes.length > 0 ||
    n.customRouting.subnetWaitingRoutes.length > 0,
};

/**
 * Every header cell shares one divider so the sticky row keeps its border. The
 * background has to live on the cell itself: the row group scrolls away from a
 * stuck cell. `z-0` keeps row menus (ported to the body) painted above it.
 */
const HEADER_CELL =
  "sticky top-0 z-0 border-b border-mist-200 bg-white pb-2 text-left text-xs font-bold uppercase dark:border-mist-800 dark:bg-mist-900";

interface SortHeaderProps {
  field: SortField;
  label: string;
  sortLabel: string;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  onSort: (field: SortField) => void;
  className?: string;
  children?: ReactNode;
}

/** A column header that toggles the existing sort state. */
function SortHeader({
  field,
  label,
  sortLabel,
  sortField,
  sortDirection,
  onSort,
  className,
  children,
}: SortHeaderProps) {
  const isActive = sortField === field;

  return (
    <th
      aria-sort={isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
      className={cn(HEADER_CELL, className)}
      scope="col"
    >
      <div className="flex items-center gap-x-1">
        <button
          aria-label={sortLabel}
          className={cn(
            "flex cursor-pointer items-center gap-x-1",
            "hover:text-mist-900 dark:hover:text-mist-100",
          )}
          onClick={() => onSort(field)}
          type="button"
        >
          {label}
          {isActive ? (
            sortDirection === "asc" ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )
          ) : undefined}
        </button>
        {children}
      </div>
    </th>
  );
}

/** Shown in place of the table when nothing can be listed. */
function MachineEmptyState({ isFiltered, onReset }: { isFiltered: boolean; onReset: () => void }) {
  const { t } = useI18n();
  const Icon = isFiltered ? SearchX : ServerOff;

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
        "border-mist-200 bg-mist-50/50",
        "dark:border-mist-800 dark:bg-mist-950/30",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full",
          "bg-mist-100 text-mist-500 dark:bg-mist-800 dark:text-mist-400",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className="font-medium">
          {isFiltered ? t("machines.list.empty") : t("machines.list.emptyNone")}
        </p>
        <p className="text-sm text-mist-600 dark:text-mist-400">
          {isFiltered ? t("machines.list.emptyFilteredBody") : t("machines.list.emptyNoneBody")}
        </p>
      </div>
      {isFiltered ? (
        <Button onClick={onReset}>{t("machines.filters.clearFilters")}</Button>
      ) : undefined}
    </div>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const searchQuery = searchParams.get("q") ?? "";
  const { filterUser, filterTag, filterStatus, filterRoute, hasActiveFilters } =
    useMachineFilterParams();

  const hasAgent = loaderData.agent !== undefined;

  const setSearchQuery = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const v = value.slice(0, 100);
      if (v) next.set("q", v);
      else next.delete("q");
      return next;
    });
  };

  const clearSearch = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("q");
      return next;
    });
  };

  const resetSearchAndFilters = useCallback(() => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const filteredAndSortedNodes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    let nodes = loaderData.populatedNodes.filter(
      (node) =>
        (!query ||
          node.givenName.toLowerCase().includes(query) ||
          node.ipAddresses.some((ip) => ip.toLowerCase().includes(query))) &&
        (filterUser === null ||
          (filterUser === "tag-owned" ? !node.user : node.user?.name === filterUser)) &&
        (filterTag === null || (node.tags?.includes(filterTag) ?? false)) &&
        (filterStatus === null || STATUS_MATCH[filterStatus](node)) &&
        (filterRoute === null || ROUTE_MATCH[filterRoute](node)),
    );

    nodes = [...nodes].toSorted((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "name": {
          comparison = a.givenName.localeCompare(b.givenName);
          break;
        }
        case "ip": {
          const getIPv4 = (addresses: string[]) =>
            addresses.find((ip) => !ip.includes(":")) || addresses[0] || "";
          const ipA = getIPv4(a.ipAddresses);
          const ipB = getIPv4(b.ipAddresses);

          if (!ipA.includes(":") && !ipB.includes(":")) {
            const octetsA = ipA.split(".").map(Number);
            const octetsB = ipB.split(".").map(Number);
            for (let i = 0; i < 4; i++) {
              if (octetsA[i] !== octetsB[i]) {
                comparison = octetsA[i] - octetsB[i];
                break;
              }
            }
          } else {
            comparison = ipA.localeCompare(ipB);
          }
          break;
        }
        case "version": {
          const versionA = a.hostInfo?.IPNVersion?.split("-")[0] || "0";
          const versionB = b.hostInfo?.IPNVersion?.split("-")[0] || "0";
          const partsA = versionA.split(".").map(Number);
          const partsB = versionB.split(".").map(Number);
          const maxLen = Math.max(partsA.length, partsB.length);

          for (let i = 0; i < maxLen; i++) {
            const segA = partsA[i] || 0;
            const segB = partsB[i] || 0;
            if (segA !== segB) {
              comparison = segA - segB;
              break;
            }
          }
          break;
        }
        case "lastSeen": {
          if (a.online !== b.online) {
            comparison = a.online ? 1 : -1;
            break;
          }
          comparison = new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
          break;
        }
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return nodes;
  }, [
    loaderData.populatedNodes,
    searchQuery,
    filterUser,
    filterTag,
    filterStatus,
    filterRoute,
    sortField,
    sortDirection,
  ]);

  // Selection only ever refers to rows the user can currently see, so
  // filtering or searching drops the rows that are no longer visible.
  const visibleIds = useMemo(
    () => new Set(filteredAndSortedNodes.map((node) => node.id)),
    [filteredAndSortedNodes],
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }

      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const selectedNodes = useMemo(
    () => filteredAndSortedNodes.filter((node) => selectedIds.has(node.id)),
    [filteredAndSortedNodes, selectedIds],
  );

  const toggleSelection = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleAllVisible = useCallback(
    (selected: boolean) => setSelectedIds(selected ? new Set(visibleIds) : new Set()),
    [visibleIds],
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <h1 className="text-2xl font-semibold tracking-tight">{t("machines.list.title")}</h1>
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("machines.list.subtitle")}{" "}
            <Link external styled to="https://tailscale.com/kb/1372/manage-devices">
              {t("common.learnMore")}
            </Link>
          </p>
        </div>
        <NewMachine
          disabledKeys={loaderData.preAuth ? [] : ["pre-auth"]}
          isDisabled={!loaderData.writable}
          server={loaderData.publicServer ?? loaderData.server}
          users={loaderData.users}
        />
      </div>

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative w-full sm:w-64">
          <Input
            label={t("machines.list.searchLabel")}
            labelHidden
            maxLength={100}
            onChange={setSearchQuery}
            placeholder={t("machines.list.searchPlaceholder")}
            value={searchQuery}
          />
          {searchQuery && (
            <button
              aria-label={t("machines.list.clearSearch")}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
                "p-1 rounded-full",
                "text-mist-400 hover:text-mist-600",
                "dark:text-mist-500 dark:hover:text-mist-300",
                "hover:bg-mist-100 dark:hover:bg-mist-800",
              )}
              onClick={clearSearch}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MachineFilters users={loaderData.users} populatedNodes={loaderData.populatedNodes} />
        </div>
        <span className="text-sm whitespace-nowrap text-mist-500 lg:ml-auto">
          {searchQuery || hasActiveFilters
            ? t("machines.list.showing", {
                count: filteredAndSortedNodes.length,
                total: loaderData.populatedNodes.length,
              })
            : t("machines.list.total", { count: loaderData.populatedNodes.length })}
        </span>
      </div>

      {loaderData.writable && selectedNodes.length > 0 ? (
        <BulkActions
          existingTags={loaderData.existingTags}
          nodes={selectedNodes}
          onClearSelection={clearSelection}
          policyTags={loaderData.policyTags}
          supportsNodeOwnerChange={loaderData.supportsNodeOwnerChange}
          users={loaderData.users}
        />
      ) : undefined}

      {filteredAndSortedNodes.length === 0 ? (
        <MachineEmptyState
          isFiltered={Boolean(searchQuery) || hasActiveFilters}
          onReset={resetSearchAndFilters}
        />
      ) : (
        // No scroll container: the sticky header has to stick to the page, so
        // every column truncates instead of forcing the table wider.
        <table className="w-full table-fixed border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className={cn(HEADER_CELL, "w-10 pl-2")} scope="col">
                <SelectCheckbox
                  aria-label={t("machines.bulk.selectAll")}
                  checked={
                    selectedNodes.length > 0 &&
                    selectedNodes.length === filteredAndSortedNodes.length
                  }
                  disabled={!loaderData.writable || filteredAndSortedNodes.length === 0}
                  indeterminate={
                    selectedNodes.length > 0 && selectedNodes.length < filteredAndSortedNodes.length
                  }
                  onChange={toggleAllVisible}
                />
              </th>
              <SortHeader
                field="name"
                label={t("machines.list.columnName")}
                onSort={handleSort}
                sortDirection={sortDirection}
                sortField={sortField}
                sortLabel={t("machines.list.sortByName")}
              />
              <th className={cn(HEADER_CELL, "hidden w-36 md:table-cell")} scope="col">
                {t("machines.common.ownerLabel")}
              </th>
              <SortHeader
                className="hidden w-40 lg:table-cell"
                field="ip"
                label={t("machines.list.columnAddresses")}
                onSort={handleSort}
                sortDirection={sortDirection}
                sortField={sortField}
                sortLabel={t("machines.list.sortByIp")}
              >
                {loaderData.magic ? (
                  <Tooltip
                    content={
                      <span className="font-normal">
                        {tr("machines.list.magicDnsTooltip", {
                          code: (
                            <Code>
                              [name].
                              {loaderData.magic}
                            </Code>
                          ),
                        })}
                      </span>
                    }
                  >
                    <Info className="h-4 w-4" />
                  </Tooltip>
                ) : undefined}
              </SortHeader>
              {/* We only want to show the version column if there are agents */}
              {hasAgent ? (
                <SortHeader
                  className="hidden w-24 xl:table-cell"
                  field="version"
                  label={t("machines.list.columnVersion")}
                  onSort={handleSort}
                  sortDirection={sortDirection}
                  sortField={sortField}
                  sortLabel={t("machines.list.sortByVersion")}
                />
              ) : undefined}
              <th className={cn(HEADER_CELL, "w-28 whitespace-nowrap")} scope="col">
                {t("machines.filters.status")}
              </th>
              <SortHeader
                className="hidden w-40 sm:table-cell"
                field="lastSeen"
                label={t("machines.list.columnLastSeen")}
                onSort={handleSort}
                sortDirection={sortDirection}
                sortField={sortField}
                sortLabel={t("machines.list.sortByLastSeen")}
              />
              <th className={cn(HEADER_CELL, "w-12 pr-1")} scope="col">
                <span className="sr-only">{t("machines.list.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedNodes.map((node) => (
              <MachineRow
                existingTags={loaderData.existingTags}
                policyTags={loaderData.policyTags}
                isAgent={hasAgent ? node.nodeKey === loaderData.agent?.nodeKey : undefined}
                isDisabled={
                  loaderData.writable
                    ? false // If the user has write permissions, they can edit all machines
                    : node.user?.id !== loaderData.headscaleUserId
                }
                isSelected={selectedIds.has(node.id)}
                isSelectionDisabled={!loaderData.writable}
                key={node.id}
                magic={loaderData.magic}
                node={node}
                onSelectChange={(selected) => toggleSelection(node.id, selected)}
                users={loaderData.users}
                supportsNodeOwnerChange={loaderData.supportsNodeOwnerChange}
                supportsDisablingKeyExpiry={loaderData.supportsDisablingKeyExpiry}
              />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Machines" />;
}
