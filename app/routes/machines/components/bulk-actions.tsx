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
      <div
        aria-label={t("machines.bulk.actionsLabel")}
        className={cn(
          "mb-3 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border px-3 py-2",
          "border-indigo-200/80 bg-indigo-50/70 shadow-surface",
          "dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:shadow-none",
        )}
        role="toolbar"
      >
        {/* The count is the bar's anchor: it says what the buttons act on. */}
        <span className="flex items-center gap-x-2 pr-1 text-sm font-medium">
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 tabular-nums",
              "bg-indigo-600 text-xs font-semibold text-white",
              "dark:bg-indigo-500",
            )}
          >
            {nodes.length}
          </span>
          <span className="whitespace-nowrap">
            {t("machines.bulk.selected", { count: nodes.length })}
          </span>
        </span>
        <span aria-hidden="true" className="h-5 w-px bg-indigo-200 dark:bg-indigo-500/30" />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setModal("tags")}>
            <Tags className="h-4 w-4 shrink-0" />
            {t("machines.bulk.setTags")}
          </Button>
          <Button onClick={() => setModal("expire")}>
            <CalendarClock className="h-4 w-4 shrink-0" />
            {t("machines.bulk.setExpiry")}
          </Button>
          <Button
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
