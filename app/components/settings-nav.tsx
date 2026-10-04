import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React, { useState } from "react";

import cn from "~/utils/cn";

/**
 * The settings shell.
 *
 * Every settings page shares one header, one segmented navigation and one
 * collapsible card so the section looks like a single product rather than seven
 * different pages. The navigation deliberately echoes the top navigation (same
 * pill geometry, icons, indigo focus ring), just with a quieter container.
 */

export interface SettingsPageProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Breadcrumb-ish line above the title, e.g. a link back to Settings. */
  breadcrumb?: React.ReactNode;
  /** Notices (permission, restart hints, warnings) shown under the header. */
  notices?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsPage(props: SettingsPageProps) {
  return (
    <div className={cn("flex w-full flex-col gap-5 md:max-w-4xl", props.className)}>
      <header className="flex flex-col gap-1">
        {props.breadcrumb ? (
          <nav className="text-sm text-mist-600 dark:text-mist-400">{props.breadcrumb}</nav>
        ) : undefined}
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        {props.description ? (
          <p className="max-w-3xl text-sm text-mist-600 dark:text-mist-400">{props.description}</p>
        ) : undefined}
      </header>

      {props.notices ? <div className="flex flex-col gap-3">{props.notices}</div> : undefined}

      {props.children}
    </div>
  );
}

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
        "flex w-full items-center gap-1 overflow-x-auto p-1",
        "rounded-xl",
        "border border-mist-200 bg-mist-100/60",
        "dark:border-mist-800 dark:bg-mist-950/50",
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
        "flex flex-1 items-center justify-center gap-x-2 whitespace-nowrap rounded-lg px-3 py-2",
        "text-mist-600 transition-colors dark:text-mist-300",
        "hover:bg-mist-200/60 hover:text-mist-900 dark:hover:bg-mist-800/60 dark:hover:text-mist-50",
        "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
        "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
        "data-[selected]:bg-white data-[selected]:text-mist-900 data-[selected]:shadow-sm",
        "dark:data-[selected]:bg-mist-800 dark:data-[selected]:text-mist-50",
        className,
      )}
      value={value}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : undefined}
      {children}
    </BaseTabs.Tab>
  );
}

export function SettingsPanel({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <BaseTabs.Panel className="flex flex-col gap-3 focus:outline-hidden" value={value}>
      {children}
    </BaseTabs.Panel>
  );
}

export type SettingsStatusTone = "ok" | "warn" | "error" | "neutral";

const STATUS_TONES: Record<SettingsStatusTone, string> = {
  ok: "bg-green-500/15 text-green-700 dark:text-green-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
  neutral: "bg-mist-500/15 text-mist-700 dark:text-mist-300",
};

/** A small pill for "enabled", "not configured", "2 warnings" and friends. */
export function SettingsStatus({
  tone = "neutral",
  children,
}: {
  tone?: SettingsStatusTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export interface SettingsCollapsibleProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Short "what is set right now" line, shown while the block is closed. */
  summary?: React.ReactNode;
  icon?: LucideIcon;
  status?: { tone: SettingsStatusTone; label: React.ReactNode };
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Renders tighter, for blocks nested inside another collapsible. */
  nested?: boolean;
  className?: string;
}

/**
 * A card that opens and closes in place. Pages with a lot of configuration use
 * one per sub-topic so the page stays scannable without hiding anything behind
 * navigation.
 */
export function SettingsCollapsible(props: SettingsCollapsibleProps) {
  const [isOpen, setIsOpen] = useState(props.defaultOpen ?? false);
  const { icon: Icon } = props;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        isOpen
          ? "border-mist-200 bg-white dark:border-mist-800 dark:bg-mist-900"
          : "border-mist-200 bg-mist-50/40 hover:bg-mist-100/60 dark:border-mist-800 dark:bg-mist-950/30 dark:hover:bg-mist-900/50",
        props.nested ? "ml-0" : undefined,
        props.className,
      )}
    >
      <button
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center gap-3 p-3.5 text-left",
          "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
          "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
        )}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        {Icon ? (
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              "bg-mist-100 text-mist-600 dark:bg-mist-800 dark:text-mist-300",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : undefined}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{props.title}</span>
            {props.status ? (
              <SettingsStatus tone={props.status.tone}>{props.status.label}</SettingsStatus>
            ) : undefined}
          </span>
          {props.description ? (
            <span className="mt-0.5 block text-sm text-mist-600 dark:text-mist-400">
              {props.description}
            </span>
          ) : undefined}
          {!isOpen && props.summary ? (
            <span className="mt-1 block truncate text-sm text-mist-600 dark:text-mist-400">
              {props.summary}
            </span>
          ) : undefined}
        </span>

        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            "bg-mist-100 text-mist-500 dark:bg-mist-800 dark:text-mist-400",
          )}
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-150", isOpen && "rotate-180")}
          />
        </span>
      </button>

      {isOpen ? (
        <div className="flex flex-col gap-4 border-t border-mist-200 p-4 dark:border-mist-800">
          {props.children}
        </div>
      ) : undefined}
    </section>
  );
}

/** Stacks collapsible blocks. */
export function SettingsCollapsibleGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

/** A consistent row for a field's label/help/control inside a card body. */
export function SettingsField({
  label,
  description,
  children,
  className,
}: {
  label?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? <span className="text-sm font-medium">{label}</span> : undefined}
      {children}
      {description ? (
        <span className="text-sm text-mist-600 dark:text-mist-400">{description}</span>
      ) : undefined}
    </div>
  );
}

/** Right-aligned primary action row, so every save button sits in the same spot. */
export function SettingsActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{children}</div>;
}
