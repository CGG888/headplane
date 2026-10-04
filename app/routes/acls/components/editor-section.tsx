import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import Button from "~/components/button";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";

// Chrome shared by the rules and the tags/groups editors.

interface SectionProps {
  title: string;
  description: ReactNode;
  isDisabled: boolean;
  onAdd: () => void;
  children: ReactNode;
}

export function Section({ title, description, isDisabled, onAdd, children }: SectionProps) {
  const { t } = useI18n();

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="max-w-prose text-sm text-mist-600 dark:text-mist-300">{description}</p>
        </div>
        <Button className="shrink-0" disabled={isDisabled} onClick={onAdd} type="button">
          <Plus className="h-4 w-4" />
          {t("acls.common.add")}
        </Button>
      </div>
      <TableList>{children}</TableList>
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <TableList.Item className="justify-center py-6 text-sm opacity-70">{text}</TableList.Item>;
}

interface RowActionsProps {
  isDisabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function RowActions({ isDisabled, onEdit, onDelete }: RowActionsProps) {
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        aria-label={t("acls.common.edit")}
        className="rounded-md p-1"
        disabled={isDisabled}
        onClick={onEdit}
        type="button"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        aria-label={t("acls.common.delete")}
        className="rounded-md p-1"
        disabled={isDisabled}
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
