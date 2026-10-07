import { UserCircle } from "lucide-react";

import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import { formatTimeDelta } from "~/utils/time";
import { getUserDisplayName } from "~/utils/user";

import CopyValue from "./copy-value";
import { mapTagsToComponents, uiTagsForNode, type MachineRowProps } from "./machine-row";
import MachineStatus from "./machine-status";
import { AclTags } from "./machine-tags";
import MenuOptions from "./menu";
import OSTile from "./os-tile";
import SelectCheckbox from "./select-checkbox";

/**
 * One machine below `md`, where the table's columns would only fit by hiding
 * what matters. It carries the same four things a row does — device, status,
 * owner, addresses — stacked instead of side by side, and keeps the actions
 * visible because a phone has no hover to reveal them with.
 */
export default function MachineListCard({
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

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3 transition-colors",
        isSelected
          ? "border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-500/10"
          : "border-mist-200 bg-white dark:border-mist-800 dark:bg-mist-900",
      )}
    >
      <div className="flex min-w-0 items-start gap-x-2.5">
        {onSelectChange !== undefined ? (
          <SelectCheckbox
            aria-label={t("machines.bulk.selectRow", { name: node.givenName })}
            checked={isSelected ?? false}
            className="mt-1.5"
            disabled={isSelectionDisabled}
            onChange={onSelectChange}
          />
        ) : undefined}

        <Link
          className={cn(
            "group/link flex min-w-0 flex-1 items-start gap-x-2.5 rounded-md",
            "outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1",
            "dark:focus-visible:ring-indigo-400/40 dark:focus-visible:ring-offset-mist-900",
          )}
          to={`/machines/${node.id}`}
        >
          <OSTile node={node} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
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
          </span>
        </Link>

        <MenuOptions
          existingTags={existingTags}
          isCard
          isDisabled={isDisabled}
          magic={magic}
          node={node}
          policyTags={policyTags}
          supportsDisablingKeyExpiry={supportsDisablingKeyExpiry}
          supportsNodeOwnerChange={supportsNodeOwnerChange}
          users={users}
        />
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <MachineStatus node={node} />
        <span className="flex min-w-0 items-center gap-x-1.5 text-xs text-mist-600 dark:text-mist-400">
          <UserCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate" title={owner}>
            {owner}
          </span>
        </span>
      </div>

      {hasChips ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {mapTagsToComponents(node, uiTags)}
          <AclTags tags={tags} />
        </span>
      ) : undefined}

      <div className="flex min-w-0 flex-col gap-1 border-t border-mist-100 pt-2.5 dark:border-mist-800/80">
        {ipv4 || ipv6 || magicDns ? (
          <div className="flex min-w-0 flex-col">
            {ipv4 ? <CopyValue reveal="always" value={ipv4} /> : undefined}
            {ipv6 ? <CopyValue muted reveal="always" value={ipv6} /> : undefined}
            {magicDns ? (
              <CopyValue
                copiedMessage={t("common.copiedName", { name: magicDns })}
                muted
                reveal="always"
                value={magicDns}
              />
            ) : undefined}
          </div>
        ) : undefined}
        <span
          className="truncate text-xs text-mist-500 tabular-nums dark:text-mist-400"
          suppressHydrationWarning
        >
          {isConnected
            ? t("machines.common.connected")
            : `${lastSeen.toLocaleString(locale)} · ${formatTimeDelta(lastSeen, locale)}`}
        </span>
      </div>
    </article>
  );
}
