import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React, { useState } from "react";

import cn from "~/utils/cn";

/**
 * Settings navigation.
 *
 * Settings pages used to stack every group into one long scroll (and briefly
 * into right-side drawers). They now look like the app's top navigation: a row
 * of pill tabs, one per group, with everything inside a group either visible or
 * tucked into a collapsible block when it would otherwise be a wall of inputs.
 */

export interface SettingsTabsProps {
  label: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function SettingsTabs({ label, children, className, ...props }: SettingsTabsProps) {
  return (
    <BaseTabs.Root
      {...props}
      aria-label={label}
      className={cn("flex flex-col gap-4", className)}
      defaultValue={props.defaultValue}
    >
      {children}
    </BaseTabs.Root>
  );
}

export function SettingsTabList({ children }: { children: React.ReactNode }) {
  return (
    <BaseTabs.List
      className={cn(
        "flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 p-1",
        "text-sm font-medium",
      )}
    >
      {children}
    </BaseTabs.List>
  );
}

export interface SettingsTabProps {
  value: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}

export function SettingsTab({ value, icon: Icon, children, className }: SettingsTabProps) {
  return (
    <BaseTabs.Tab
      className={cn(
        "flex items-center gap-x-1.5 rounded-md px-3 py-1.5 text-nowrap",
        "hover:bg-mist-300/50 dark:hover:bg-mist-800",
        "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
        "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
        "text-mist-600 dark:text-mist-300",
        "data-[selected]:bg-mist-300/70 data-[selected]:text-mist-900",
        "dark:data-[selected]:bg-mist-800 dark:data-[selected]:text-mist-50",
        className,
      )}
      value={value}
    >
      {Icon ? <Icon className="w-4" /> : undefined}
      {children}
    </BaseTabs.Tab>
  );
}

export function SettingsPanel({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <BaseTabs.Panel className="flex flex-col gap-4 focus:outline-hidden" value={value}>
      {children}
    </BaseTabs.Panel>
  );
}

export interface SettingsCollapsibleProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Short "what is set right now" line, shown while the block is closed. */
  summary?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Renders tighter, for blocks nested inside another collapsible. */
  nested?: boolean;
}

/**
 * A section that opens and closes in place. Pages with a lot of configuration
 * use one per sub-topic so the page stays scannable without hiding anything
 * behind navigation.
 */
export function SettingsCollapsible(props: SettingsCollapsibleProps) {
  const [isOpen, setIsOpen] = useState(props.defaultOpen ?? false);

  return (
    <div
      className={cn(
        "rounded-lg",
        "border border-mist-200 dark:border-mist-800",
        props.nested ? "bg-mist-50/50 dark:bg-mist-950/30" : undefined,
      )}
    >
      <button
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center justify-between gap-4 p-3 text-left",
          "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
          "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
        )}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block font-medium">{props.title}</span>
          {props.description ? (
            <span className="mt-0.5 block text-sm opacity-70">{props.description}</span>
          ) : undefined}
          {!isOpen && props.summary ? (
            <span className="mt-1 block text-sm opacity-80">{props.summary}</span>
          ) : undefined}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {props.badge}
          <ChevronDown
            className={cn("h-4 w-4 opacity-60 transition-transform", isOpen && "rotate-180")}
          />
        </span>
      </button>

      {isOpen ? (
        <div className="flex flex-col gap-4 border-t border-mist-200 p-4 dark:border-mist-800">
          {props.children}
        </div>
      ) : undefined}
    </div>
  );
}

/** Stacks collapsible blocks. */
export function SettingsCollapsibleGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
