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

/**
 * Every control in the filter row shares one box: the search field's padding and
 * border produce the same 2.375rem height, so the row sits on one baseline
 * instead of stepping between pill and input sizes.
 */
const CONTROL =
  "inline-flex items-center gap-x-1.5 rounded-md border px-3 py-2 text-sm leading-5 font-medium";

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
          CONTROL,
          "transition-colors duration-100",
          isActive
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
            : cn(
                "border-mist-200 bg-white text-mist-700",
                "hover:border-mist-300 hover:bg-mist-50",
                "dark:border-mist-800 dark:bg-mist-900 dark:text-mist-300",
                "dark:hover:border-mist-700 dark:hover:bg-mist-800/60",
              ),
        )}
      >
        {/* A filled dot marks an applied filter without hiding which one it is. */}
        {isActive ? (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 dark:bg-indigo-400"
          />
        ) : undefined}
        <span className="truncate">{activeOption?.label ?? label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-colors",
            isActive ? "text-indigo-500 dark:text-indigo-400" : "text-mist-400 dark:text-mist-500",
          )}
        />
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
      {/* The reset stays a visible control rather than a hidden gesture, so the
          way back to the full list is always one click away. */}
      {hasActiveFilters && (
        <button
          className={cn(
            CONTROL,
            "border-transparent bg-transparent text-mist-500",
            "hover:bg-mist-100 hover:text-mist-900",
            "dark:text-mist-400 dark:hover:bg-mist-800/60 dark:hover:text-mist-100",
            "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-hidden",
            "dark:focus-visible:ring-indigo-400/40",
          )}
          onClick={clearFilters}
          type="button"
        >
          {t("machines.filters.clearFilters")}
          <X className="h-3.5 w-3.5 shrink-0" />
        </button>
      )}
    </>
  );
}
