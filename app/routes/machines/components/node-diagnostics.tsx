import { Bug, Info } from "lucide-react";

import { SettingsCollapsible, type SettingsStatusTone } from "~/components/settings-nav";
import Tooltip from "~/components/tooltip";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

import {
  buildNodeDiagnostics,
  type NodeDebugField,
  type NodeDebugView,
  type NodeDiagnosticsFailure,
  type NodeDiagnosticsInput,
  type NodeDiagnosticsLabels,
} from "../diagnostics";
import MachineAttribute from "./attribute";
import { ConnectivityValue } from "./client-connectivity";

/** One tone per card state, from the app's one badge helper. */
const STATUS_TONES: Record<NodeDebugView["status"], SettingsStatusTone> = {
  ok: "ok",
  empty: "neutral",
  unavailable: "error",
};

/** Why the card has nothing to show, as its one sentence. */
const FAILURE_KEYS: Record<NodeDiagnosticsFailure, TranslationKey> = {
  "no-agent": "machines.detail.diagnostics.noAgent",
  "no-report": "machines.detail.diagnostics.noReport",
};

/**
 * The node diagnostics card: a collapsed-by-default block directly above the
 * danger zone that prints the few facts no card above it already shows — the
 * agent's own version strings, its IPv4 ICMP self-test, and how much of this
 * deployment's region inventory the machine accounts for.
 *
 * The page hands it the data it has already loaded, so the card asks nothing of
 * Headscale. It opens itself when there is nothing to report at all (the same
 * "reveal the problem without a click" rule the settings cards follow) and says
 * so when its view held nothing. Everything else the agent reports — the
 * operating system, the host identity, the end-points, the network booleans and
 * the relay regions with their latency — is already printed by the cards above,
 * so repeating it here would only make a reader compare two views of one fact.
 */
export default function NodeDiagnostics({
  diagnostics,
}: {
  /** The per-node facts the page already loaded; plain values only. */
  diagnostics: NodeDiagnosticsInput | undefined;
}) {
  const { t } = useI18n();

  // The builder is locale-free, so the card supplies the wording.
  const labels: NodeDiagnosticsLabels = {
    notReported: t("machines.detail.diagnostics.notReported"),
    version: t("machines.detail.diagnostics.version"),
    osVersion: t("machines.detail.diagnostics.osVersion"),
    icmpv4: t("machines.detail.diagnostics.icmpv4"),
    coverage: t("machines.detail.diagnostics.coverage"),
    coverageValue: (counts) =>
      t("machines.detail.diagnostics.coverageValue", {
        served: counts.served,
        reported: counts.reported,
        measured: counts.measured,
      }),
    groups: {
      agent: t("machines.detail.diagnostics.groupAgent"),
      checks: t("machines.detail.diagnostics.groupChecks"),
    },
  };

  const view = buildNodeDiagnostics(diagnostics, labels);

  const status = {
    tone: STATUS_TONES[view.status],
    label:
      view.status === "ok"
        ? t("machines.detail.diagnostics.fields", { count: view.fieldCount })
        : view.status === "empty"
          ? t("machines.detail.diagnostics.noData")
          : t("machines.detail.diagnostics.unavailable"),
  };

  return (
    <SettingsCollapsible
      description={t("machines.detail.diagnostics.body")}
      hasError={view.status === "unavailable"}
      icon={Bug}
      status={status}
      summary={
        view.status === "empty"
          ? t("machines.detail.diagnostics.empty")
          : view.status === "unavailable"
            ? t("machines.detail.diagnostics.summaryUnavailable")
            : undefined
      }
      title={t("machines.detail.diagnostics.title")}
    >
      {view.status === "unavailable" ? (
        <p className="text-sm text-red-700 dark:text-red-400">
          {t(FAILURE_KEYS[view.failure ?? "no-report"])}
        </p>
      ) : view.status === "empty" ? (
        <p className="text-sm text-mist-500 dark:text-mist-400">
          {t("machines.detail.diagnostics.empty")}
        </p>
      ) : (
        <NodeDebugRows view={view} />
      )}
    </SettingsCollapsible>
  );
}

/**
 * The grouped rows one successful view prints. It is its own component for the
 * same reason the builder is its own module: the rows are the card's whole
 * payload, and a test can lay them out without the collapsible wrapper's open
 * state.
 */
export function NodeDebugRows({ view }: { view: NodeDebugView }) {
  return (
    <div className="flex flex-col gap-4">
      {view.groups.map((group) => (
        <div className="flex flex-col" key={group.key}>
          <span className="text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
            {group.label}
          </span>
          <dl className="mt-0.5 flex flex-col">
            {group.fields.map((field) =>
              field.kind === "boolean" ? (
                <BooleanRow field={field} key={field.key} />
              ) : (
                <MachineAttribute
                  key={field.key}
                  name={field.label}
                  tooltip={field.path}
                  value={field.value}
                />
              ),
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * One yes/no row, laid out like the shared attribute row so the self-test sits
 * in the same column as the values above it. The answer is the same check or
 * cross the connectivity card prints, so the schema's `true`/`false` never
 * reaches the reader raw; an answer nobody reported keeps the card's wording.
 */
function BooleanRow({ field }: { field: NodeDebugField }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="flex items-start gap-x-1 text-mist-600 dark:text-mist-400">
        <span className="min-w-0">{field.label}</span>
        {field.path ? (
          <Tooltip content={field.path}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40 transition-opacity hover:opacity-100" />
          </Tooltip>
        ) : undefined}
      </dt>
      <dd className="flex min-w-0 items-center gap-x-1.5 px-1.5 py-1">
        {field.flag === undefined ? (
          <span className="text-mist-500 dark:text-mist-400">{field.value}</span>
        ) : (
          <ConnectivityValue value={field.flag} />
        )}
      </dd>
    </div>
  );
}
