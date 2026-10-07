import Link from "~/components/link";
import { ExitNodeTag } from "~/components/tags/ExitNode";
import { ExpiryTag } from "~/components/tags/Expiry";
import { HeadplaneAgentTag } from "~/components/tags/HeadplaneAgent";
import { SubnetTag } from "~/components/tags/Subnet";
import { TailscaleSSHTag } from "~/components/tags/TailscaleSSH";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types";
import cn from "~/utils/cn";
import * as hinfo from "~/utils/host-info";
import { isNoExpiry, type PopulatedNode } from "~/utils/node-info";
import { formatTimeDelta } from "~/utils/time";
import { getUserDisplayName } from "~/utils/user";

import {
  preferredRelayLabel,
  type DerpEmbeddedServer,
  type DerpRegionNameData,
} from "../derp-info";
import CopyValue from "./copy-value";
import MachineStatus from "./machine-status";
import { AclTags } from "./machine-tags";
import MenuOptions from "./menu";
import OSTile from "./os-tile";
import SelectCheckbox from "./select-checkbox";

export interface MachineRowProps {
  node: PopulatedNode;
  users: User[];
  isAgent?: boolean;
  magic?: string;
  isDisabled?: boolean;
  existingTags?: string[];
  policyTags?: string[];
  supportsNodeOwnerChange: boolean;
  supportsDisablingKeyExpiry: boolean;
  isSelected?: boolean;
  isSelectionDisabled?: boolean;
  onSelectChange?: (selected: boolean) => void;
  /**
   * Region names the loader resolved, for the relay column: the manual mapping
   * plus what the configured `derp.paths`/`derp.urls` maps describe. The card
   * list below `md` has no columns, so it leaves these out.
   */
  relayRegions?: DerpRegionNameData;
  /** Headscale's embedded DERP configuration, named through the same chain. */
  relayServer?: DerpEmbeddedServer;
}

/**
 * The divider every cell carries so the sticky header can use `border-separate`.
 * One hairline per cell is what makes the row rule continuous, so it stays
 * low-contrast instead of reading as a box around every cell.
 */
const CELL = "border-b border-mist-100 py-2.5 align-middle dark:border-mist-800/80";

/**
 * The two identity columns stay pinned while the rest of the table scrolls.
 * `bg-inherit` is what makes that work: the row owns one opaque background per
 * state (and inherits its hover tint), so a pinned cell can never let the cells
 * sliding underneath show through it.
 */
const STICKY_CELL = "sticky z-10 bg-inherit";

/** A key this close to expiry is worth flagging before it strands a machine. */
const EXPIRING_SOON_MS = 30 * 24 * 60 * 60 * 1000;

/** True while a machine has a real key expiry inside the warning window. */
export function expiresSoon(node: PopulatedNode) {
  if (node.expired || isNoExpiry(node.expiry)) {
    return false;
  }

  return new Date(node.expiry!).getTime() - Date.now() <= EXPIRING_SOON_MS;
}

export default function MachineRow({
  node,
  users,
  isAgent,
  magic,
  isDisabled,
  existingTags,
  policyTags,
  supportsNodeOwnerChange,
  supportsDisablingKeyExpiry,
  isSelected,
  isSelectionDisabled,
  onSelectChange,
  relayRegions,
  relayServer,
}: MachineRowProps) {
  const { t, locale } = useI18n();
  const uiTags = uiTagsForNode(node, isAgent);

  const ipv4 = node.ipAddresses.find((ip) => !ip.includes(":")) ?? undefined;
  const ipv6 = node.ipAddresses.find((ip) => ip.includes(":")) ?? undefined;
  const magicDns = magic ? `${node.givenName}.${magic}` : undefined;
  const isConnected = node.online && !node.expired;
  const lastSeen = new Date(node.lastSeen);
  const owner = node.user
    ? getUserDisplayName(node.user, t("machines.common.tagOwned"))
    : t("machines.common.tagOwned");
  const tags = node.tags ?? [];
  const hasChips = uiTags.length > 0 || tags.length > 0;
  // The relay this machine is using right now: the same preferred region the
  // detail card marks "in use", resolved through the same name chain. Undefined
  // simply means the agent has not reported a region for this machine yet.
  const derpNode = preferredRelayLabel(
    node.hostInfo,
    relayServer,
    t("machines.detail.derp.unknown"),
    relayRegions,
  );

  return (
    <tr
      className={cn(
        "group transition-colors duration-100",
        // One opaque wash per state so the pinned identity column can inherit
        // it exactly: hover lifts the row, selection tints it indigo.
        isSelected
          ? "bg-indigo-50 dark:bg-[color-mix(in_oklab,var(--color-indigo-500)_14%,var(--color-mist-900))]"
          : cn(
              "bg-white hover:bg-mist-50 dark:bg-mist-900 dark:hover:bg-mist-800",
              // Keyboard focus on the row's link lifts the whole row too.
              "has-[a:focus-visible]:bg-mist-50 dark:has-[a:focus-visible]:bg-mist-800",
            ),
      )}
    >
      {onSelectChange !== undefined ? (
        <td className={cn(CELL, STICKY_CELL, "left-0 w-10 pl-2")}>
          {/* The accent rail is the row's hover/selection tell: a hint of
              indigo on hover, a solid bar once the row is selected. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-0 w-[3px] transition-colors duration-100",
              isSelected
                ? "bg-indigo-500"
                : "bg-transparent group-hover:bg-indigo-300/70 dark:group-hover:bg-indigo-500/40",
            )}
          />
          <SelectCheckbox
            aria-label={t("machines.bulk.selectRow", { name: node.givenName })}
            checked={isSelected ?? false}
            disabled={isSelectionDisabled}
            onChange={onSelectChange}
          />
        </td>
      ) : undefined}

      {/* Primary column: the device tile plus the name carry the identity, and
          everything else in it truncates instead of widening the row. */}
      <td
        className={cn(
          CELL,
          STICKY_CELL,
          "left-10 min-w-0 pr-3",
          "shadow-[inset_-1px_0_0_0_var(--color-mist-100)] dark:shadow-[inset_-1px_0_0_0_var(--color-mist-800)]",
        )}
      >
        <Link
          className={cn(
            "group/link flex min-w-0 items-start gap-x-2.5 rounded-md",
            "outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1",
            "dark:focus-visible:ring-indigo-400/40 dark:focus-visible:ring-offset-mist-900",
          )}
          to={`/machines/${node.id}`}
        >
          <OSTile node={node} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              className={cn(
                "truncate text-sm leading-5 font-semibold text-mist-900",
                "transition-colors group-hover/link:text-indigo-600",
                "dark:text-mist-50 dark:group-hover/link:text-indigo-400",
              )}
              title={node.givenName}
            >
              {node.givenName}
            </span>
            <span className="flex min-w-0 items-center gap-x-1.5 text-xs leading-4 text-mist-500 dark:text-mist-400">
              <span className="min-w-0 truncate" title={node.name}>
                {node.name || t("machines.common.unknown")}
              </span>
              <span aria-hidden="true" className="shrink-0 text-mist-300 dark:text-mist-600">
                ·
              </span>
              <span className="shrink-0 font-mono tabular-nums">#{node.id}</span>
            </span>
            {hasChips ? (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {mapTagsToComponents(node, uiTags)}
                <AclTags tags={tags} />
              </span>
            ) : undefined}
          </span>
        </Link>
      </td>

      <td className={cn(CELL, "pr-3")}>
        <span className="block truncate text-sm text-mist-600 dark:text-mist-400" title={owner}>
          {owner}
        </span>
      </td>

      <td className={cn(CELL, "hidden pr-3 md:table-cell")}>
        {/* Every address copies itself. The rows are fixed height so a machine
            with one address does not make its neighbours jump. */}
        <div className="flex min-w-0 flex-col">
          {ipv4 ? (
            <CopyValue value={ipv4} />
          ) : (
            <span className="py-0.5 text-xs leading-4 text-mist-400 dark:text-mist-500">—</span>
          )}
          {ipv6 ? (
            <CopyValue muted value={ipv6} />
          ) : (
            <span className="py-0.5 text-xs leading-4 text-mist-400 dark:text-mist-500">—</span>
          )}
          {magicDns ? (
            <CopyValue
              copiedMessage={t("common.copiedName", { name: magicDns })}
              muted
              value={magicDns}
            />
          ) : undefined}
        </div>
      </td>

      {/* We pass undefined when agents are not enabled */}
      {isAgent !== undefined ? (
        <td className={cn(CELL, "hidden pr-3 text-center xl:table-cell")}>
          {node.hostInfo !== undefined ? (
            <div className="flex min-w-0 flex-col leading-4">
              <span className="truncate text-sm text-mist-700 tabular-nums dark:text-mist-200">
                {hinfo.getTSVersion(node.hostInfo)}
              </span>
              <span
                className="truncate text-xs text-mist-500 dark:text-mist-400"
                title={hinfo.getOSInfo(node.hostInfo)}
              >
                {hinfo.getOSInfo(node.hostInfo)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-mist-500 dark:text-mist-400">
              {t("machines.common.unknown")}
            </span>
          )}
        </td>
      ) : undefined}

      <td className={cn(CELL, "pr-3")}>
        <MachineStatus node={node} />
      </td>

      {/* The relay this machine is using. One line either way, so a row keeps its
          height whatever a region is called: the label truncates and the full
          text stays in the title. Read-only, and unsorted because the list only
          sorts columns whose header already offers it. */}
      <td className={cn(CELL, "pr-3")}>
        {derpNode === undefined ? (
          <span className="block truncate text-sm text-mist-400 dark:text-mist-500">
            {t("machines.list.derpNodeNotReported")}
          </span>
        ) : (
          <span
            className="block truncate text-sm text-mist-700 dark:text-mist-300"
            title={derpNode}
          >
            {derpNode}
          </span>
        )}
      </td>

      <td className={cn(CELL, "pr-3")}>
        <div className="flex flex-col leading-4" title={lastSeen.toLocaleString(locale)}>
          <span
            className="truncate text-sm text-mist-700 dark:text-mist-300"
            suppressHydrationWarning
          >
            {isConnected ? t("machines.common.connected") : lastSeen.toLocaleString(locale)}
          </span>
          {!isConnected ? (
            <span
              className="truncate text-xs text-mist-500 tabular-nums dark:text-mist-400"
              suppressHydrationWarning
            >
              {formatTimeDelta(lastSeen, locale)}
            </span>
          ) : undefined}
        </div>
      </td>

      <td className={cn(CELL, "pr-2")}>
        <MenuOptions
          existingTags={existingTags}
          policyTags={policyTags}
          isDisabled={isDisabled}
          magic={magic}
          node={node}
          users={users}
          supportsNodeOwnerChange={supportsNodeOwnerChange}
          supportsDisablingKeyExpiry={supportsDisablingKeyExpiry}
        />
      </td>
    </tr>
  );
}

export function uiTagsForNode(node: PopulatedNode, isAgent?: boolean) {
  const uiTags: string[] = [];
  if (node.expired) {
    uiTags.push("expired");
  } else if (isNoExpiry(node.expiry)) {
    uiTags.push("no-expiry");
  } else if (expiresSoon(node)) {
    uiTags.push("expiring-soon");
  }

  if (node.customRouting.exitRoutes.length > 0) {
    if (node.customRouting.exitApproved) {
      uiTags.push("exit-approved");
    } else {
      uiTags.push("exit-waiting");
    }
  }

  if (node.customRouting.subnetWaitingRoutes.length > 0) {
    uiTags.push("subnet-waiting");
  } else if (node.customRouting.subnetApprovedRoutes.length > 0) {
    uiTags.push("subnet-approved");
  }

  if (node.hostInfo?.sshHostKeys && node.hostInfo?.sshHostKeys.length > 0) {
    uiTags.push("tailscale-ssh");
  }

  if (isAgent === true) {
    uiTags.push("headplane-agent");
  }

  return uiTags;
}

export function mapTagsToComponents(node: PopulatedNode, uiTags: string[]) {
  return uiTags.map((tag) => {
    switch (tag) {
      case "exit-approved":
      case "exit-waiting": {
        return <ExitNodeTag isEnabled={tag === "exit-approved"} key={tag} />;
      }

      case "subnet-approved":
      case "subnet-waiting": {
        return <SubnetTag isEnabled={tag === "subnet-approved"} key={tag} />;
      }

      case "expired":
      case "no-expiry": {
        return <ExpiryTag expiry={node.expiry ?? undefined} key={tag} variant={tag} />;
      }

      case "expiring-soon": {
        return <ExpiryTag expiry={node.expiry ?? undefined} key={tag} variant="expiring" />;
      }

      case "tailscale-ssh": {
        return <TailscaleSSHTag key={tag} />;
      }

      case "headplane-agent": {
        return <HeadplaneAgentTag key={tag} />;
      }

      default: {
        return null;
      }
    }
  });
}
