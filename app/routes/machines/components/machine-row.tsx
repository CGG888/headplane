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

/** The divider every cell carries so the sticky header can use `border-separate`. */
const CELL = "border-b border-mist-100 dark:border-mist-800";

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
        "group align-middle transition-colors",
        isSelected
          ? "bg-indigo-50/60 dark:bg-indigo-500/5"
          : "hover:bg-mist-50 dark:hover:bg-mist-900/50",
      )}
    >
      {onSelectChange !== undefined ? (
        <td className={cn(CELL, "w-10 py-3 pl-2 align-middle")}>
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
      <td className={cn(CELL, "min-w-0 py-3 pr-3 align-middle")}>
        <Link className="group/link flex min-w-0 flex-col gap-1" to={`/machines/${node.id}`}>
          <span
            className="truncate leading-snug font-semibold group-hover/link:text-indigo-600 dark:group-hover/link:text-indigo-400"
            title={node.givenName}
          >
            {node.givenName}
          </span>
          <span className="flex min-w-0 items-center gap-x-1.5 text-xs text-mist-500 dark:text-mist-400">
            <span className="min-w-0 truncate" title={node.name}>
              {node.name || t("machines.common.unknown")}
            </span>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <span className="shrink-0 font-mono">#{node.id}</span>
          </span>
          {/* Below `md` the owner moves here so it is never lost with the column. */}
          <span
            className="truncate text-xs text-mist-500 md:hidden dark:text-mist-400"
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

      <td className={cn(CELL, "hidden max-w-40 py-3 pr-3 align-middle md:table-cell")}>
        <span className="block truncate" title={owner}>
          {owner}
        </span>
      </td>

      <td className={cn(CELL, "hidden py-3 pr-3 align-middle lg:table-cell")}>
        <div className="flex items-center gap-x-1">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-xs" title={ipv4}>
              {ipv4}
            </span>
            <span
              className="truncate font-mono text-xs text-mist-500 dark:text-mist-400"
              title={ipv6}
            >
              {ipv6}
            </span>
          </div>
          <Menu>
            <MenuTrigger className="shrink-0 rounded-full bg-transparent p-1 hover:bg-mist-100 dark:hover:bg-mist-800">
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
                  <div
                    className={cn("flex items-center justify-between", "text-sm w-full gap-x-6")}
                  >
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
        <td className={cn(CELL, "hidden py-3 pr-3 align-middle xl:table-cell")}>
          {node.hostInfo !== undefined ? (
            <div className="flex min-w-0 flex-col">
              <span className="truncate leading-snug">{hinfo.getTSVersion(node.hostInfo)}</span>
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

      <td className={cn(CELL, "whitespace-nowrap py-3 pr-3 align-middle")}>
        <MachineStatus node={node} />
      </td>

      <td className={cn(CELL, "hidden py-3 pr-3 align-middle sm:table-cell")}>
        <div className="flex flex-col gap-0.5" title={lastSeen.toLocaleString(locale)}>
          <span
            className="truncate text-sm text-mist-600 dark:text-mist-300"
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

      <td className={cn(CELL, "py-3 pr-1 align-middle")}>
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
