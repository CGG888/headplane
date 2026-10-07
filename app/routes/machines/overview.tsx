import { dirname } from "node:path";

import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Info,
  SearchX,
  ServerOff,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { data, useSearchParams, type ShouldRevalidateFunction } from "react-router";

import { AddressVisibilityMenu, useAddressVisibility } from "~/components/address-visibility";
import Button from "~/components/button";
import Code from "~/components/code";
import Input from "~/components/input";
import Link from "~/components/link";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/menu";
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
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { loadDerpRegionSources } from "~/server/headscale/derp-region-sources";
import { nodesResource, usersResource } from "~/server/headscale/live-store";
import { isUserPrincipal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import { maskAddress } from "~/utils/address-visibility";
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
import MachineListCard from "./components/machine-list-card";
import MachineRow from "./components/machine-row";
import SelectCheckbox from "./components/select-checkbox";
import BackfillIps from "./dialogs/backfill-ips";
import NewMachine from "./dialogs/new";
import {
  useMachineFilterParams,
  type MachineFilterParams,
} from "./hooks/use-machine-filter-params";
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

  // Region names for the list's relay column come from the same chain the
  // machine detail card resolves: the operator's manual mapping, the maps in
  // `derp.paths` and the maps fetched from `derp.urls`, so the two views can
  // never name a region differently. Both reads are fail-soft and cached, so
  // they run alongside the agent lookup rather than after it.
  const derp = headscaleConfig.getDERPSettings();
  const regionNamesLookup = Promise.all([
    readDerpRegionNames(config.server.data_path),
    loadDerpRegionSources({
      paths: derp.paths,
      urls: derp.urls,
      autoUpdateEnabled: derp.autoUpdateEnabled,
      updateFrequency: derp.updateFrequency,
      baseDir: config.headscale.config_path ? dirname(config.headscale.config_path) : undefined,
    }),
  ]);

  const agents = agentsFeature.state === "enabled" ? agentsFeature.value : undefined;
  const [statsResult, policyResult] = await Promise.allSettled([
    agents?.lookup(nodes.map((node) => node.nodeKey)),
    api.policy.get(),
  ]);
  const [regionNames, derpRegionSources] = await regionNamesLookup;
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
    // Region labels the relay column resolves: the manual names Headplane stores
    // in its data directory, plus what the configured DERP maps describe. The
    // column runs them through the same helper the machine card uses.
    derpRegions: {
      manual: regionNames,
      local: derpRegionSources.local,
      remote: derpRegionSources.remote,
    },
    // Headscale's own embedded region, so a machine relaying through it reads
    // with its name instead of a bare id. Plain values only: the row must never
    // import a module that reads a file.
    derpServer: derp.server,
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

const STATUS_MATCH: Record<
  NonNullable<MachineFilterParams["filterStatus"]>,
  (n: PopulatedNode) => boolean
> = {
  online: (n) => n.online && !n.expired,
  offline: (n) => !n.online && !n.expired,
  expired: (n) => n.expired,
};

const ROUTE_MATCH: Record<
  NonNullable<MachineFilterParams["filterRoute"]>,
  (n: PopulatedNode) => boolean
> = {
  "exit-node": (n) => n.customRouting.exitRoutes.length > 0,
  subnet: (n) =>
    n.customRouting.subnetApprovedRoutes.length > 0 ||
    n.customRouting.subnetWaitingRoutes.length > 0,
};

/**
 * Every header cell carries the band's background through `bg-inherit` and one
 * shared divider, so the header row can stick inside the scrolling list without
 * flashing a seam. The background has to come from the row: `border-separate`
 * lets the header box scroll away from its cells.
 *
 * `z-20` outranks the pinned identity cells (`z-10`) so rows slide *under* the
 * stuck header. Both are contained by the list surface's `isolate`, which keeps
 * portalled menus above the whole table.
 */
const HEADER_CELL = cn(
  "sticky top-0 z-20 border-b border-mist-200 bg-inherit py-2 text-left",
  "text-[0.6875rem] font-semibold tracking-wide uppercase text-mist-500",
  "dark:border-mist-800 dark:text-mist-400",
);

/**
 * The one control style the mobile toolbar and the filter row share, so both
 * read as the same kind of object.
 */
const CONTROL =
  "inline-flex items-center gap-x-1.5 rounded-md border px-3 py-2 text-sm leading-5 font-medium";

interface SortHeaderProps {
  field: SortField;
  label: string;
  sortLabel: string;
  sortField: SortField;
  sortDirection: "asc" | "desc";
  onSort: (field: SortField) => void;
  align?: "left" | "center" | "right";
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
  align = "left",
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
      <div
        className={cn(
          "flex items-center gap-x-1",
          align === "center" && "justify-center",
          align === "right" && "justify-end",
        )}
      >
        <button
          aria-label={sortLabel}
          className={cn(
            "group/sort -mx-1 flex cursor-pointer items-center gap-x-1 rounded-md px-1 py-0.5",
            "transition-colors duration-100",
            // Hovering a sortable column shows the direction control it would
            // use; the active column keeps it, in indigo, at all times.
            "hover:bg-mist-200/70 dark:hover:bg-mist-800/80",
            isActive
              ? "text-indigo-600 dark:text-indigo-400"
              : "hover:text-mist-900 dark:hover:text-mist-100",
          )}
          onClick={() => onSort(field)}
          type="button"
        >
          {label}
          {isActive ? (
            sortDirection === "asc" ? (
              <ChevronUp className="h-3 w-3 stroke-[2.5]" />
            ) : (
              <ChevronDown className="h-3 w-3 stroke-[2.5]" />
            )
          ) : (
            <ChevronsUpDown
              className={cn(
                "h-3 w-3 opacity-0 transition-opacity",
                "group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
                "hover:opacity-60",
              )}
            />
          )}
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
        "mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
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

  // Addresses are masked by default; the addresses column masks itself, and the
  // one tooltip that quotes the MagicDNS domain follows the same choice.
  const { hidden, revealAll } = useAddressVisibility();
  const addressesHidden = hidden && !revealAll;

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

  /**
   * The empty state is the only placeholder this page renders, and it may only
   * appear once there is genuinely nothing to show. A refresh keeps the rows it
   * already has — React Router holds the previous `loaderData` until the next
   * one lands — so a placeholder can never flash over them.
   */
  const hasRows = filteredAndSortedNodes.length > 0;

  // The table's headers are the sort control on desktop; the card list needs
  // its own, built from the same state so both stay in sync.
  const sortColumns: Array<{ field: SortField; label: string }> = [
    { field: "name", label: t("machines.list.columnName") },
    { field: "ip", label: t("machines.list.columnAddresses") },
    ...(hasAgent ? [{ field: "version" as const, label: t("machines.list.columnVersion") }] : []),
    { field: "lastSeen", label: t("machines.list.columnLastSeen") },
  ];

  const allVisibleSelected =
    selectedNodes.length > 0 && selectedNodes.length === filteredAndSortedNodes.length;
  const someVisibleSelected =
    selectedNodes.length > 0 && selectedNodes.length < filteredAndSortedNodes.length;

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
        <div className="flex flex-wrap items-center gap-2">
          {/* Personal, presentation-only: whether addresses stay masked. */}
          <AddressVisibilityMenu />
          {/* A server-wide repair, so it is offered exactly where the other
              machine mutations are: to a principal who can write machines. */}
          {loaderData.writable ? <BackfillIps /> : undefined}
          <NewMachine
            disabledKeys={loaderData.preAuth ? [] : ["pre-auth"]}
            isDisabled={!loaderData.writable}
            server={loaderData.publicServer ?? loaderData.server}
            users={loaderData.users}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        {/* The search field and the filter controls share one baseline: both are
            2.375rem tall, and this row centres them on the same axis. */}
        <div className="flex flex-wrap items-center gap-2">
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

      {hasRows ? (
        <>
          {/* Below `md` a table can only fit by hiding the columns that explain
              the machine, so every machine becomes a card instead. */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 md:hidden">
            <label className="flex min-w-0 items-center gap-x-2 text-xs font-medium text-mist-600 dark:text-mist-400">
              <SelectCheckbox
                aria-label={t("machines.bulk.selectAll")}
                checked={allVisibleSelected}
                disabled={!loaderData.writable || filteredAndSortedNodes.length === 0}
                indeterminate={someVisibleSelected}
                onChange={toggleAllVisible}
              />
              <span className="hidden truncate sm:inline">{t("machines.bulk.selectAll")}</span>
            </label>
            <div className="flex items-center gap-x-2">
              <span className="text-xs font-medium text-mist-500 dark:text-mist-400">
                {t("machines.list.sort")}
              </span>
              <Menu>
                <MenuTrigger
                  className={cn(
                    CONTROL,
                    "px-2.5 py-1.5",
                    "border-mist-200 bg-white text-mist-700",
                    "hover:border-mist-300 hover:bg-mist-50",
                    "dark:border-mist-800 dark:bg-mist-900 dark:text-mist-300",
                    "dark:hover:border-mist-700 dark:hover:bg-mist-800/60",
                  )}
                >
                  <span className="truncate">
                    {sortColumns.find((column) => column.field === sortField)?.label}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-mist-400 dark:text-mist-500" />
                </MenuTrigger>
                <MenuContent align="end">
                  {sortColumns.map((column) => (
                    <MenuItem key={column.field} onClick={() => handleSort(column.field)}>
                      <span className="flex w-full items-center justify-between gap-x-4">
                        <span
                          className={cn(
                            column.field === sortField &&
                              "font-medium text-indigo-600 dark:text-indigo-400",
                          )}
                        >
                          {column.label}
                        </span>
                        {column.field === sortField ? (
                          <Check className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                        ) : undefined}
                      </span>
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 md:hidden">
            {filteredAndSortedNodes.map((node) => (
              <MachineListCard
                existingTags={loaderData.existingTags}
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
                policyTags={loaderData.policyTags}
                supportsDisablingKeyExpiry={loaderData.supportsDisablingKeyExpiry}
                supportsNodeOwnerChange={loaderData.supportsNodeOwnerChange}
                users={loaderData.users}
              />
            ))}
          </div>

          {/* `md` and up keeps the dense table, inside one rounded surface that
              scrolls on its own: the header sticks to the top of that surface
              and the identity columns stay pinned to its left edge, so a narrow
              window never loses the machine it is looking at. */}
          <div
            className={cn(
              "isolate hidden max-h-[70vh] overflow-auto rounded-xl border md:block",
              "border-mist-200 bg-white shadow-surface",
              "dark:border-mist-800 dark:bg-mist-900 dark:shadow-none",
            )}
          >
            <table className="w-full table-fixed border-separate border-spacing-0 text-left">
              <thead>
                <tr className="bg-mist-50 dark:bg-mist-950">
                  <th className={cn(HEADER_CELL, "sticky left-0 z-20 w-10 pl-2")} scope="col">
                    <SelectCheckbox
                      aria-label={t("machines.bulk.selectAll")}
                      checked={allVisibleSelected}
                      disabled={!loaderData.writable || filteredAndSortedNodes.length === 0}
                      indeterminate={someVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <SortHeader
                    className="sticky left-10 z-20 w-64"
                    field="name"
                    label={t("machines.list.columnName")}
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortField={sortField}
                    sortLabel={t("machines.list.sortByName")}
                  />
                  <th className={cn(HEADER_CELL, "w-32")} scope="col">
                    {t("machines.common.ownerLabel")}
                  </th>
                  <SortHeader
                    className="hidden w-52 md:table-cell"
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
                                  {maskAddress(loaderData.magic, addressesHidden)}
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
                      align="center"
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
                  {/* The relay each machine is using now. Read-only and not
                      sortable, because the list only sorts the columns whose
                      header already offers it. */}
                  <th className={cn(HEADER_CELL, "w-36")} scope="col">
                    {t("machines.list.columnDerpNode")}
                  </th>
                  <SortHeader
                    className="w-36"
                    field="lastSeen"
                    label={t("machines.list.columnLastSeen")}
                    onSort={handleSort}
                    sortDirection={sortDirection}
                    sortField={sortField}
                    sortLabel={t("machines.list.sortByLastSeen")}
                  />
                  <th className={cn(HEADER_CELL, "w-12 pr-2 text-right")} scope="col">
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
                    relayRegions={loaderData.derpRegions}
                    relayServer={loaderData.derpServer}
                    users={loaderData.users}
                    supportsNodeOwnerChange={loaderData.supportsNodeOwnerChange}
                    supportsDisablingKeyExpiry={loaderData.supportsDisablingKeyExpiry}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <MachineEmptyState
          isFiltered={Boolean(searchQuery) || hasActiveFilters}
          onReset={resetSearchAndFilters}
        />
      )}
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Machines" />;
}
