import { ChevronDown, Copy } from "lucide-react";
import { useMemo } from "react";

import Chip from "~/components/chip";
import Link from "~/components/link";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/menu";
import { ExitNodeTag } from "~/components/tags/ExitNode";
import { ExpiryTag } from "~/components/tags/Expiry";
import { HeadplaneAgentTag } from "~/components/tags/HeadplaneAgent";
import { SubnetTag } from "~/components/tags/Subnet";
import { TailscaleSSHTag } from "~/components/tags/TailscaleSSH";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types";
import cn from "~/utils/cn";
import { copyToClipboard } from "~/utils/copy";
import * as hinfo from "~/utils/host-info";
import { isNoExpiry, type PopulatedNode } from "~/utils/node-info";
import { formatTimeDelta } from "~/utils/time";
import toast from "~/utils/toast";
import { getUserDisplayName } from "~/utils/user";

import MachineStatus from "./machine-status";
import MenuOptions from "./menu";
import SelectCheckbox from "./select-checkbox";

interface Props {
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
}

/**
 * The divider every cell carries so the sticky header can use `border-separate`.
 * One hairline per cell is what makes the row rule continuous, so it stays
 * low-contrast instead of reading as a box around every cell.
 */
const CELL = "border-b border-mist-100 py-3 align-middle dark:border-mist-800/80";

/** A cell that must not wrap: it truncates (or is short by construction). */
const CELL_TRUNCATE = "min-w-0 truncate";

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
}: Props) {
  const { t, locale } = useI18n();
  const uiTags = useMemo(() => uiTagsForNode(node, isAgent), [node, isAgent]);

  const ipOptions = useMemo(() => {
    if (magic) {
      return [...node.ipAddresses, `${node.givenName}.${magic}`];
    }

    return node.ipAddresses;
  }, [magic, node.ipAddresses]);

  const ipv4 = node.ipAddresses.find((ip) => !ip.includes(":")) ?? "—";
  const ipv6 = node.ipAddresses.find((ip) => ip.includes(":")) ?? "—";
  const isConnected = node.online && !node.expired;
  const lastSeen = new Date(node.lastSeen);
  const owner = node.user
    ? getUserDisplayName(node.user, t("machines.common.tagOwned"))
    : t("machines.common.tagOwned");
  const tags = node.tags ?? [];

  return (
    <tr
      className={cn(
        "group align-middle transition-colors duration-100",
        // Keyboard focus on the row's link lifts the whole row, while a pointer
        // hover uses the quieter neutral wash.
        "has-[a:focus-visible]:bg-mist-50 dark:has-[a:focus-visible]:bg-mist-900/60",
        isSelected
          ? "bg-indigo-50/60 dark:bg-indigo-500/5"
          : "hover:bg-mist-50/80 dark:hover:bg-mist-900/40",
      )}
    >
      {onSelectChange !== undefined ? (
        <td className={cn(CELL, "w-10 pl-2")}>
          <SelectCheckbox
            aria-label={t("machines.bulk.selectRow", { name: node.givenName })}
            checked={isSelected ?? false}
            disabled={isSelectionDisabled}
            onChange={onSelectChange}
          />
        </td>
      ) : undefined}

      {/* Primary column: the name carries the identity, everything else in it is
          secondary and truncates instead of widening the row. */}
      <td className={cn(CELL, "min-w-0 pr-3")}>
        <Link
          className={cn(
            "group/link flex min-w-0 flex-col gap-1 rounded-md",
            "outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1",
            "dark:focus-visible:ring-indigo-400/40 dark:focus-visible:ring-offset-mist-900",
          )}
          to={`/machines/${node.id}`}
        >
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
          {/* Below `md` the owner moves here so it is never lost with the column. */}
          <span
            className="truncate text-xs leading-4 text-mist-500 md:hidden dark:text-mist-400"
            title={owner}
          >
            {owner}
          </span>
          {tags.length > 0 || uiTags.length > 0 ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              {mapTagsToComponents(node, uiTags)}
              {tags.map((tag) => (
                <Chip key={tag} text={tag} />
              ))}
            </span>
          ) : undefined}
        </Link>
      </td>

      <td className={cn(CELL, "hidden max-w-40 pr-3 md:table-cell")}>
        <span
          className={cn(CELL_TRUNCATE, "block text-sm text-mist-600 dark:text-mist-400")}
          title={owner}
        >
          {owner}
        </span>
      </td>

      <td className={cn(CELL, "hidden pr-3 lg:table-cell")}>
        <div className="flex items-center gap-x-1">
          {/* Two fixed line-heights keep the IPv4/IPv6 block from jittering as
              rows with only one address scroll past. */}
          <div className="flex min-w-0 flex-col leading-4">
            <span
              className="truncate font-mono text-xs text-mist-700 tabular-nums dark:text-mist-200"
              title={ipv4}
            >
              {ipv4}
            </span>
            <span
              className="truncate font-mono text-xs text-mist-500 tabular-nums dark:text-mist-400"
              title={ipv6}
            >
              {ipv6}
            </span>
          </div>
          <Menu>
            <MenuTrigger
              className={cn(
                "shrink-0 rounded-full p-1 text-mist-500 transition-colors",
                "hover:bg-mist-100 hover:text-mist-700",
                "dark:text-mist-400 dark:hover:bg-mist-800 dark:hover:text-mist-200",
              )}
            >
              <ChevronDown className="h-4 w-4" />
            </MenuTrigger>
            <MenuContent align="end">
              {ipOptions.map((ip) => (
                <MenuItem
                  key={ip}
                  onClick={async () => {
                    const isCopied = await copyToClipboard(ip);
                    toast(isCopied ? t("machines.row.copiedIp") : t("machines.row.copyFailed"));
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-x-6 font-mono text-xs">
                    {ip}
                    <Copy className="h-3 w-3" />
                  </div>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      </td>

      {/* We pass undefined when agents are not enabled */}
      {isAgent !== undefined ? (
        <td className={cn(CELL, "hidden pr-3 xl:table-cell")}>
          {node.hostInfo !== undefined ? (
            <div className="flex min-w-0 flex-col leading-4">
              <span className="truncate text-sm text-mist-700 dark:text-mist-200">
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

      <td className={cn(CELL, "whitespace-nowrap pr-3")}>
        <MachineStatus node={node} />
      </td>

      <td className={cn(CELL, "hidden pr-3 sm:table-cell")}>
        <div className="flex flex-col leading-4" title={lastSeen.toLocaleString(locale)}>
          <span
            className="truncate text-sm text-mist-700 dark:text-mist-300"
            suppressHydrationWarning
          >
            {isConnected ? t("machines.common.connected") : lastSeen.toLocaleString(locale)}
          </span>
          {!isConnected ? (
            <span
              className="truncate text-xs text-mist-500 dark:text-mist-400"
              suppressHydrationWarning
            >
              {formatTimeDelta(lastSeen)}
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
  }

  if (!node.expired && isNoExpiry(node.expiry)) {
    uiTags.push("no-expiry");
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
