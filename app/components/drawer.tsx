import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight } from "lucide-react";
import React, { cloneElement, useEffect, useState } from "react";

import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import { useLiveData } from "~/utils/live-data";

/**
 * A panel that slides in from the right, used to edit one group of settings
 * without leaving the page. It mirrors `Dialog`'s API so a section can own its
 * own open state and carry the form it needs.
 */

export interface DrawerProps {
  children:
    | React.ReactElement<DrawerPanelProps>
    | [React.ReactElement, React.ReactElement<DrawerPanelProps>];
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

function Drawer(props: DrawerProps) {
  const { pause, resume } = useLiveData();
  const { isOpen, onOpenChange } = props;

  useEffect(() => {
    if (isOpen) {
      pause();
    } else {
      resume();
    }
  }, [isOpen]);

  if (Array.isArray(props.children)) {
    const [trigger, panel] = props.children;
    return (
      <Dialog.Root open={isOpen} onOpenChange={(open) => onOpenChange?.(open)}>
        <Dialog.Trigger render={cloneElement(trigger)} />
        <DrawerOverlay>{panel}</DrawerOverlay>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => onOpenChange?.(open)}>
      <DrawerOverlay>{props.children}</DrawerOverlay>
    </Dialog.Root>
  );
}

export interface DrawerPanelProps {
  children: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra controls for the header, e.g. a status chip. */
  badge?: React.ReactNode;
  size?: "normal" | "wide";
}

function Panel(props: DrawerPanelProps) {
  const { t } = useI18n();
  const { title, description, badge, children, size = "normal" } = props;

  return (
    <Dialog.Popup
      className={cn(
        "flex h-full w-full flex-col",
        size === "wide" ? "max-w-3xl" : "max-w-xl",
        "outline-hidden",
        "bg-white dark:bg-mist-900",
        "border-l border-mist-200 dark:border-mist-800",
        "shadow-overlay",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-mist-200 p-4 dark:border-mist-800">
        <div className="min-w-0">
          <Dialog.Title className="text-lg font-medium">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-sm opacity-70">
              {description}
            </Dialog.Description>
          ) : undefined}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {badge}
          <Dialog.Close
            aria-label={t("common.close")}
            className={cn(
              "rounded-md p-1.5",
              "text-mist-500 hover:bg-mist-100 dark:text-mist-400 dark:hover:bg-mist-800",
            )}
          >
            <svg
              aria-hidden
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Dialog.Close>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </Dialog.Popup>
  );
}

function DrawerOverlay({ children }: { children: React.ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop
        className={cn(
          "fixed inset-0 z-20 h-screen w-screen",
          "bg-mist-900/30 dark:bg-mist-950/60",
          "transition-opacity duration-100",
        )}
      />
      <div className="fixed inset-0 z-20 flex h-screen w-screen justify-end">{children}</div>
    </Dialog.Portal>
  );
}

/**
 * One row in a settings list. The row itself is the trigger: opening it reveals
 * the settings it owns in a drawer, so a page stays a short list of groups
 * instead of one very long form.
 */
export interface SettingsSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A short "what is set right now" line, e.g. the current value. */
  summary?: React.ReactNode;
  /** A status chip in the row, e.g. an update hint. */
  badge?: React.ReactNode;
  children: React.ReactNode;
  size?: DrawerPanelProps["size"];
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

export function SettingsSection(props: SettingsSectionProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = props.isOpen !== undefined;
  const isOpen = isControlled ? props.isOpen : internalOpen;
  const setOpen = (open: boolean) => {
    if (!isControlled) {
      setInternalOpen(open);
    }
    props.onOpenChange?.(open);
  };

  return (
    <>
      <button
        className={cn(
          "flex w-full items-center justify-between gap-4 p-3 text-left",
          "border-b border-mist-200 last:border-b-0 dark:border-mist-800",
          "hover:bg-mist-50 dark:hover:bg-mist-800/50",
        )}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block font-medium">{props.title}</span>
          {props.description ? (
            <span className="mt-0.5 block text-sm opacity-70">{props.description}</span>
          ) : undefined}
          {props.summary ? <span className="mt-1 block text-sm">{props.summary}</span> : undefined}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {props.badge}
          <ChevronRight className="h-4 w-4 opacity-50" />
        </span>
      </button>

      <Drawer isOpen={isOpen} onOpenChange={setOpen}>
        <Panel description={props.description} size={props.size} title={props.title}>
          {props.children}
        </Panel>
      </Drawer>
    </>
  );
}

/** The bordered list that holds `SettingsSection` rows. */
export function SettingsSectionList({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg", "border border-mist-200 dark:border-mist-800")}>
      {children}
    </div>
  );
}

export { Panel as DrawerPanel };
export default Drawer;
