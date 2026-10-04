import { useState } from "react";

import Chip from "~/components/chip";
import Link from "~/components/link";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import type { Policy } from "~/utils/acl-policy";
import { asUserReference } from "~/utils/acl-policy";

import NamedListDialog, { type NamedListKind } from "../dialogs/named-list";
import { Empty, RowActions, Section } from "./editor-section";

export interface TagUsage {
  tag: string;
  nodes: string[];
}

interface TagsGroupsEditorProps {
  policy: Policy;
  onChange: (policy: Policy) => void;
  isDisabled: boolean;
  users: string[];
  // Node names keyed by the tags currently assigned to them.
  tagUsage: TagUsage[];
}

type Editing = { kind: NamedListKind; name: string | null } | null;

export default function TagsGroupsEditor({
  policy,
  onChange,
  isDisabled,
  users,
  tagUsage,
}: TagsGroupsEditorProps) {
  const { t, tr } = useI18n();
  const [editing, setEditing] = useState<Editing>(null);

  const groups = Object.entries(policy.groups).sort(([a], [b]) => a.localeCompare(b));
  const tags = Object.entries(policy.tagOwners).sort(([a], [b]) => a.localeCompare(b));

  const userSuggestions = users.map(asUserReference);
  const ownerSuggestions = [...Object.keys(policy.groups), ...userSuggestions];

  const record = editing?.kind === "group" ? policy.groups : policy.tagOwners;
  const existingNames = Object.keys(record);

  function save(name: string, members: string[]) {
    if (!editing) return;

    const next = { ...record };
    if (editing.name !== null && editing.name !== name) {
      delete next[editing.name];
    }
    next[name] = members;

    onChange(
      editing.kind === "group" ? { ...policy, groups: next } : { ...policy, tagOwners: next },
    );
  }

  function remove(kind: NamedListKind, name: string) {
    if (kind === "group") {
      const groups = { ...policy.groups };
      delete groups[name];
      onChange({ ...policy, groups });
      return;
    }

    const tagOwners = { ...policy.tagOwners };
    delete tagOwners[name];
    onChange({ ...policy, tagOwners });
  }

  return (
    <div className="flex flex-col gap-8">
      {editing ? (
        <NamedListDialog
          existingNames={existingNames}
          isOpen
          kind={editing.kind}
          members={editing.name !== null ? record[editing.name] : undefined}
          name={editing.name ?? undefined}
          onSave={save}
          setIsOpen={(open) => {
            if (!open) setEditing(null);
          }}
          suggestions={editing.kind === "group" ? userSuggestions : ownerSuggestions}
        />
      ) : null}

      <Section
        description={t("acls.groups.description")}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "group", name: null })}
        title={t("acls.groups.title")}
      >
        {groups.length === 0 ? (
          <Empty text={t("acls.groups.empty")} />
        ) : (
          groups.map(([name, members]) => (
            <TableList.Item
              className="flex-col items-stretch gap-2 py-3 md:flex-row md:items-center"
              key={name}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-sm">{name}</span>
                <span className="flex flex-wrap items-center gap-1">
                  {members.length === 0 ? (
                    <span className="text-xs opacity-60">{t("acls.groups.noMembers")}</span>
                  ) : (
                    members.map((member) => (
                      <Chip className="font-mono" key={member} text={member} />
                    ))
                  )}
                </span>
              </div>
              <RowActions
                isDisabled={isDisabled}
                onDelete={() => remove("group", name)}
                onEdit={() => setEditing({ kind: "group", name })}
              />
            </TableList.Item>
          ))
        )}
      </Section>

      <Section
        description={tr("acls.tags.description", {
          link: (
            <Link external styled to="https://tailscale.com/kb/1068/acl-tags">
              {t("acls.tags.docs")}
            </Link>
          ),
        })}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "tag", name: null })}
        title={t("acls.tags.title")}
      >
        {tags.length === 0 ? (
          <Empty text={t("acls.tags.empty")} />
        ) : (
          tags.map(([name, owners]) => {
            const usedBy = tagUsage.find((usage) => usage.tag === name)?.nodes ?? [];
            return (
              <TableList.Item
                className="flex-col items-stretch gap-2 py-3 md:flex-row md:items-center"
                key={name}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{name}</span>
                    <span className="text-xs opacity-60">
                      {usedBy.length === 0
                        ? t("acls.tags.notAssigned")
                        : tr("acls.tags.usedBy", {
                            count: usedBy.length,
                            names: usedBy.join(", "),
                          })}
                    </span>
                  </div>
                  <span className="flex flex-wrap items-center gap-1">
                    {owners.length === 0 ? (
                      <span className="text-xs opacity-60">{t("acls.tags.noOwners")}</span>
                    ) : (
                      owners.map((owner) => <Chip className="font-mono" key={owner} text={owner} />)
                    )}
                  </span>
                </div>
                <RowActions
                  isDisabled={isDisabled}
                  onDelete={() => remove("tag", name)}
                  onEdit={() => setEditing({ kind: "tag", name })}
                />
              </TableList.Item>
            );
          })
        )}
      </Section>
    </div>
  );
}
