import { CalendarClock, Tags, Trash2, UserRoundCog, X } from "lucide-react";
import { useCallback, useState } from "react";

import Button from "~/components/button";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types";
import cn from "~/utils/cn";
import type { PopulatedNode } from "~/utils/node-info";

import BulkDelete from "../dialogs/bulk-delete";
import BulkExpire from "../dialogs/bulk-expire";
import BulkMove from "../dialogs/bulk-move";
import BulkTags from "../dialogs/bulk-tags";

type BulkModal = "tags" | "expire" | "move" | "remove" | null;

/**
 * The grouped actions read as one segmented control: no borders of their own,
 * only a hover fill, sitting together on a shared neutral track.
 */
const GROUPED_BUTTON = cn(
  "border-transparent bg-transparent px-2.5 py-1.5 shadow-none",
  "hover:bg-white dark:border-transparent dark:bg-transparent dark:hover:bg-mist-700/60",
);

interface BulkActionsProps {
  nodes: PopulatedNode[];
  users: User[];
  existingTags?: string[];
  policyTags?: string[];
  supportsNodeOwnerChange: boolean;
  onClearSelection: () => void;
}

/**
 * Toolbar shown above the machine table while rows are selected. It owns the
 * four bulk dialogs and clears the selection once one of them succeeds.
 */
export default function BulkActions({
  nodes,
  users,
  existingTags,
  policyTags,
  supportsNodeOwnerChange,
  onClearSelection,
}: BulkActionsProps) {
  const { t } = useI18n();
  const [modal, setModal] = useState<BulkModal>(null);
  const nodeIds = nodes.map((node) => node.id);
  // Stable so a re-render of the toolbar never re-runs a dialog's submit
  // effect (which would repeat its summary toast).
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      setModal(null);
    }
  }, []);

  return (
    <>
      {/* A deliberate action surface: elevated, sticky, with the count as its
          anchor and the three reversible actions grouped as one control. It is
          left without a z-index on purpose — portalled menus must stay above. */}
      <div
        aria-label={t("machines.bulk.actionsLabel")}
        className={cn(
          "sticky top-2 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5",
          "border border-indigo-200/90 bg-white shadow-overlay ring-1 ring-indigo-500/10",
          "dark:border-indigo-500/30 dark:bg-mist-900 dark:shadow-none dark:ring-0",
        )}
        role="toolbar"
      >
        {/* The count is the bar's anchor: it says what the buttons act on. */}
        <span className="flex items-center gap-x-2.5">
          <span
            className={cn(
              "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 tabular-nums",
              "bg-indigo-600 text-xs font-semibold text-white",
              "dark:bg-indigo-500",
            )}
          >
            {nodes.length}
          </span>
          <span className="text-sm font-medium whitespace-nowrap">
            {t("machines.bulk.selected", { count: nodes.length })}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="hidden h-6 w-px bg-mist-200 sm:block dark:bg-mist-700"
        />
        <div
          className={cn(
            "flex flex-wrap items-center gap-0.5 rounded-lg p-1",
            "bg-mist-100/80 dark:bg-mist-800/60",
          )}
        >
          <Button className={GROUPED_BUTTON} onClick={() => setModal("tags")}>
            <Tags className="h-4 w-4 shrink-0" />
            {t("machines.bulk.setTags")}
          </Button>
          <Button className={GROUPED_BUTTON} onClick={() => setModal("expire")}>
            <CalendarClock className="h-4 w-4 shrink-0" />
            {t("machines.bulk.setExpiry")}
          </Button>
          <Button
            className={GROUPED_BUTTON}
            disabled={!supportsNodeOwnerChange}
            onClick={() => setModal("move")}
            title={supportsNodeOwnerChange ? undefined : t("machines.bulk.errors.ownerUnsupported")}
          >
            <UserRoundCog className="h-4 w-4 shrink-0" />
            {t("machines.bulk.changeOwner")}
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => setModal("remove")} variant="danger">
            <Trash2 className="h-4 w-4 shrink-0" />
            {t("machines.bulk.delete")}
          </Button>
          <Button
            aria-label={t("machines.bulk.clearSelection")}
            className="px-2"
            onClick={onClearSelection}
            variant="ghost"
          >
            <X className="h-4 w-4 shrink-0" />
          </Button>
        </div>
      </div>

      {modal === "tags" ? (
        <BulkTags
          existingTags={existingTags}
          isOpen
          nodeIds={nodeIds}
          onComplete={onClearSelection}
          policyTags={policyTags}
          setIsOpen={handleOpenChange}
        />
      ) : undefined}
      {modal === "expire" ? (
        <BulkExpire
          isOpen
          nodes={nodes}
          onComplete={onClearSelection}
          setIsOpen={handleOpenChange}
        />
      ) : undefined}
      {modal === "move" ? (
        <BulkMove
          isOpen
          nodeIds={nodeIds}
          onComplete={onClearSelection}
          setIsOpen={handleOpenChange}
          users={users}
        />
      ) : undefined}
      {modal === "remove" ? (
        <BulkDelete
          isOpen
          nodeIds={nodeIds}
          onComplete={onClearSelection}
          setIsOpen={handleOpenChange}
        />
      ) : undefined}
    </>
  );
}
