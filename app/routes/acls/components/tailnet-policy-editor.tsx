import { ArrowRight, Plane } from "lucide-react";
import { useState } from "react";

import Chip from "~/components/chip";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import type { GrantRule, NodeAttr, Policy } from "~/utils/acl-policy";

import AutoApproverDialog from "../dialogs/auto-approver";
import ExitNodeDialog from "../dialogs/exit-node";
import GrantRuleDialog from "../dialogs/grant-rule";
import NodeAttrDialog from "../dialogs/node-attr";
import { Empty, RowActions, Section } from "./editor-section";

interface TailnetPolicyEditorProps {
  policy: Policy;
  onChange: (policy: Policy) => void;
  isDisabled: boolean;
  sources: string[];
  destinations: string[];
}

type Editing =
  | { kind: "grant"; index: number | null }
  | { kind: "route"; route: string | null }
  | { kind: "exitNode" }
  | { kind: "nodeAttr"; index: number | null }
  | null;

// The remaining Headscale policy sections: grants, auto-approvers and node
// attributes. Each edit spreads the untouched keys back in so nothing is lost.
export default function TailnetPolicyEditor({
  policy,
  onChange,
  isDisabled,
  sources,
  destinations,
}: TailnetPolicyEditorProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Editing>(null);

  const grantRule =
    editing?.kind === "grant" && editing.index !== null ? policy.grants[editing.index] : undefined;
  const nodeAttr =
    editing?.kind === "nodeAttr" && editing.index !== null
      ? policy.nodeAttrs[editing.index]
      : undefined;
  const editingRoute = editing?.kind === "route" ? editing.route : null;

  function saveGrant(rule: GrantRule) {
    const grants = [...policy.grants];
    if (editing?.kind === "grant" && editing.index !== null) {
      grants[editing.index] = rule;
    } else {
      grants.push(rule);
    }
    onChange({ ...policy, grants });
  }

  function saveNodeAttr(entry: NodeAttr) {
    const nodeAttrs = [...policy.nodeAttrs];
    if (editing?.kind === "nodeAttr" && editing.index !== null) {
      nodeAttrs[editing.index] = entry;
    } else {
      nodeAttrs.push(entry);
    }
    onChange({ ...policy, nodeAttrs });
  }

  function saveRoute(route: string, approvers: string[]) {
    const routes = { ...policy.autoApprovers.routes };
    if (editingRoute !== null && editingRoute !== route) {
      delete routes[editingRoute];
    }
    routes[route] = approvers;
    onChange({ ...policy, autoApprovers: { ...policy.autoApprovers, routes } });
  }

  function removeRoute(route: string) {
    const routes = { ...policy.autoApprovers.routes };
    delete routes[route];
    onChange({ ...policy, autoApprovers: { ...policy.autoApprovers, routes } });
  }

  function saveExitNode(exitNode: string[]) {
    onChange({ ...policy, autoApprovers: { ...policy.autoApprovers, exitNode } });
  }

  const routes = Object.entries(policy.autoApprovers.routes).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-8">
      {editing?.kind === "grant" ? (
        <GrantRuleDialog
          destinations={destinations}
          isOpen
          onSave={saveGrant}
          rule={grantRule}
          setIsOpen={(open) => {
            if (!open) setEditing(null);
          }}
          sources={sources}
        />
      ) : null}
      {editing?.kind === "route" ? (
        <AutoApproverDialog
          approvers={editingRoute !== null ? policy.autoApprovers.routes[editingRoute] : undefined}
          existingRoutes={Object.keys(policy.autoApprovers.routes)}
          isOpen
          onSave={saveRoute}
          route={editingRoute ?? undefined}
          setIsOpen={(open) => {
            if (!open) setEditing(null);
          }}
          suggestions={sources}
        />
      ) : null}
      {editing?.kind === "exitNode" ? (
        <ExitNodeDialog
          approvers={policy.autoApprovers.exitNode}
          isOpen
          onSave={saveExitNode}
          setIsOpen={(open) => {
            if (!open) setEditing(null);
          }}
          suggestions={sources}
        />
      ) : null}
      {editing?.kind === "nodeAttr" ? (
        <NodeAttrDialog
          entry={nodeAttr}
          isOpen
          onSave={saveNodeAttr}
          setIsOpen={(open) => {
            if (!open) setEditing(null);
          }}
          sources={sources}
        />
      ) : null}

      <Section
        description={t("acls.grants.description")}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "grant", index: null })}
        title={t("acls.grants.title")}
      >
        {policy.grants.length === 0 ? (
          <Empty text={t("acls.grants.empty")} />
        ) : (
          policy.grants.map((rule, index) => (
            <TableList.Item
              className="flex-col items-stretch gap-2 py-3 md:flex-row md:items-center"
              key={`grant-${index}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ChipRow values={rule.src} />
                <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
                <ChipRow values={rule.dst} />
                {rule.ip.length === 0 ? (
                  <span className="text-xs opacity-60">{t("acls.grantRule.ipEmpty")}</span>
                ) : (
                  <ChipRow values={rule.ip} />
                )}
              </div>
              <RowActions
                isDisabled={isDisabled}
                onDelete={() =>
                  onChange({ ...policy, grants: policy.grants.filter((_, i) => i !== index) })
                }
                onEdit={() => setEditing({ kind: "grant", index })}
              />
            </TableList.Item>
          ))
        )}
      </Section>

      <Section
        description={t("acls.autoApprovers.description")}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "route", route: null })}
        title={t("acls.autoApprovers.title")}
      >
        {routes.length === 0 ? <Empty text={t("acls.autoApprovers.routesEmpty")} /> : null}
        {routes.map(([route, approvers]) => (
          <TableList.Item
            className="flex-col items-stretch gap-2 py-3 md:flex-row md:items-center"
            key={route}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{route}</span>
              <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
              <ChipRow values={approvers} />
            </div>
            <RowActions
              isDisabled={isDisabled}
              onDelete={() => removeRoute(route)}
              onEdit={() => setEditing({ kind: "route", route })}
            />
          </TableList.Item>
        ))}
        <TableList.Item className="flex-col items-stretch gap-2 py-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Plane className="h-4 w-4 shrink-0 opacity-60" />
            <span className="text-sm font-medium">{t("acls.autoApprovers.exitNodeLabel")}</span>
            <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
            {policy.autoApprovers.exitNode.length === 0 ? (
              <span className="text-xs opacity-60">{t("acls.autoApprovers.noApprovers")}</span>
            ) : (
              <ChipRow values={policy.autoApprovers.exitNode} />
            )}
          </div>
          <RowActions
            isDisabled={isDisabled}
            onDelete={() => saveExitNode([])}
            onEdit={() => setEditing({ kind: "exitNode" })}
          />
        </TableList.Item>
      </Section>

      <Section
        description={t("acls.nodeAttrs.description")}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "nodeAttr", index: null })}
        title={t("acls.nodeAttrs.title")}
      >
        {policy.nodeAttrs.length === 0 ? (
          <Empty text={t("acls.nodeAttrs.empty")} />
        ) : (
          policy.nodeAttrs.map((entry, index) => (
            <TableList.Item
              className="flex-col items-stretch gap-2 py-3 md:flex-row md:items-center"
              key={`node-attr-${index}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ChipRow values={entry.target} />
                <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />
                <ChipRow values={entry.attr} />
              </div>
              <RowActions
                isDisabled={isDisabled}
                onDelete={() =>
                  onChange({
                    ...policy,
                    nodeAttrs: policy.nodeAttrs.filter((_, i) => i !== index),
                  })
                }
                onEdit={() => setEditing({ kind: "nodeAttr", index })}
              />
            </TableList.Item>
          ))
        )}
      </Section>
    </div>
  );
}

function ChipRow({ values }: { values: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {values.map((value) => (
        <Chip className="font-mono" key={value} text={value} />
      ))}
    </span>
  );
}
