import { ChevronDown, X } from "lucide-react";
import type { JSX } from "react";

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "~/components/menu";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types/User";
import cn from "~/utils/cn";
import type { PopulatedNode } from "~/utils/node-info";
import { getUserDisplayName } from "~/utils/user";

import { useMachineFilterParams } from "../hooks/use-machine-filter-params";

const STATUS_OPTIONS = [
  { value: "online", labelKey: "machines.filters.online" },
  { value: "offline", labelKey: "machines.filters.offline" },
  { value: "expired", labelKey: "machines.filters.expired" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TranslationKey }>;

const ROUTE_OPTIONS = [
  { value: "exit-node", labelKey: "machines.filters.exitNode" },
  { value: "subnet", labelKey: "machines.filters.subnetRouter" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TranslationKey }>;

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}): JSX.Element {
  const { t } = useI18n();
  const activeOption = options.find((o) => o.value === value) ?? null;
  const isActive = activeOption !== null;

  return (
    <Menu>
      <MenuTrigger
        className={cn(
          "px-3 py-1.5 rounded-full text-sm font-medium",
          "border transition-colors",
          "flex items-center gap-1.5",
          isActive
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
            : "border-mist-200 dark:border-mist-700 text-mist-700 dark:text-mist-300 hover:border-mist-300 dark:hover:border-mist-600",
        )}
      >
        {activeOption?.label ?? label}
        <ChevronDown className="h-3.5 w-3.5" />
      </MenuTrigger>
      <MenuContent>
        {options.map((option) => (
          <MenuItem
            key={option.value}
            onClick={() => onChange(value === option.value ? null : option.value)}
          >
            {option.value === value ? (
              <span className="font-medium text-indigo-600 dark:text-indigo-400">
                {option.label}
              </span>
            ) : (
              option.label
            )}
          </MenuItem>
        ))}
        {isActive && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChange(null)}>{t("machines.filters.clearFilter")}</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

interface MachineFiltersProps {
  users: User[];
  populatedNodes: PopulatedNode[];
}

export function MachineFilters({ users, populatedNodes }: MachineFiltersProps): JSX.Element {
  const { t } = useI18n();
  const {
    filterUser,
    filterTag,
    filterStatus,
    filterRoute,
    hasActiveFilters,
    setParam,
    clearFilters,
  } = useMachineFilterParams();

  const tagOwnedExists = populatedNodes.some((n) => !n.user);
  const userOptions = [
    ...(tagOwnedExists ? [{ value: "tag-owned", label: t("machines.common.tagOwned") }] : []),
    ...users.map((u) => ({
      value: u.name,
      label: getUserDisplayName(u, t("machines.common.tagOwned")),
    })),
  ];

  const tagOptions = Array.from(new Set(populatedNodes.flatMap((n) => n.tags)))
    .filter(Boolean)
    .sort()
    .map((tag) => ({ value: tag, label: tag }));

  return (
    <>
      {userOptions.length > 0 && (
        <FilterDropdown
          label={t("machines.filters.user")}
          onChange={(v) => setParam("user", v)}
          options={userOptions}
          value={filterUser}
        />
      )}
      {tagOptions.length > 0 && (
        <FilterDropdown
          label={t("machines.filters.tag")}
          onChange={(v) => setParam("tag", v)}
          options={tagOptions}
          value={filterTag}
        />
      )}
      <FilterDropdown
        label={t("machines.filters.status")}
        onChange={(v) => setParam("status", v)}
        options={STATUS_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={filterStatus}
      />
      <FilterDropdown
        label={t("machines.filters.route")}
        onChange={(v) => setParam("route", v)}
        options={ROUTE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={filterRoute}
      />
      {hasActiveFilters && (
        <button
          className={cn(
            "flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium",
            "border border-mist-200 dark:border-mist-700",
            "text-mist-600 dark:text-mist-400",
            "hover:border-mist-300 dark:hover:border-mist-600",
          )}
          onClick={clearFilters}
          type="button"
        >
          {t("machines.filters.clearFilters")}
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  );
}
