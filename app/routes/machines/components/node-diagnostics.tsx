import { Bug } from "lucide-react";

import { SettingsCollapsible, type SettingsStatusTone } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

import {
  buildNodeDiagnostics,
  type NodeDebugView,
  type NodeDiagnosticsFailure,
  type NodeDiagnosticsInput,
  type NodeDiagnosticsLabels,
} from "../diagnostics";
import MachineAttribute from "./attribute";

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
 * danger zone that prints what the Headplane Agent reported about this machine
 * as grouped, labelled rows, together with the relays and regions this
 * deployment serves.
 *
 * The page hands it the data it has already loaded, so the card asks nothing of
 * Headscale. It opens itself when there is nothing to report at all (the same
 * "reveal the problem without a click" rule the settings cards follow), says so
 * when its view held nothing, and never renders raw JSON: the grouping and the
 * field/address shapes are decided by `buildNodeDiagnostics`, so this component
 * only lays them out. Addresses are masked by default through the page's own
 * attribute row, and identifiers and addresses copy themselves.
 */
export default function NodeDiagnostics({
  diagnostics,
}: {
  /** The per-node facts the page already loaded; plain values only. */
  diagnostics: NodeDiagnosticsInput | undefined;
}) {
  const { t } = useI18n();

  // The builder is locale-free, so the card supplies the wording. The relay
  // source and latency source names are the relay card's own keys, so one
  // region reads the same on both cards.
  const labels: NodeDiagnosticsLabels = {
    notReported: t("machines.detail.diagnostics.notReported"),
    unknown: t("machines.detail.derp.unknown"),
    latencySources: {
      reported: t("machines.detail.derp.latencySourceReported"),
      measured: t("machines.detail.derp.latencySourceMeasured"),
    },
    relaySources: {
      embedded: t("machines.detail.derp.relaySourceEmbedded"),
      local: t("machines.detail.derp.relaySourceLocal"),
      mirror: t("machines.detail.derp.relaySourceMirror"),
      official: t("machines.detail.derp.relaySourceOfficial"),
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
 * state. Addresses go through the page's own attribute row, so they stay masked
 * by default, and identifiers and addresses carry the copy control.
 */
export function NodeDebugRows({ view }: { view: NodeDebugView }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      {view.groups.map((group) => (
        <div className="flex flex-col" key={group.key}>
          <span className="text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
            {group.label}
          </span>
          <dl className="mt-0.5 flex flex-col">
            {group.fields.map((field) => (
              <MachineAttribute
                isAddress={field.address}
                isCode={field.copyable}
                isCopyable={field.copyable}
                key={`${group.key}.${field.key}`}
                name={field.label}
                tooltip={field.path}
                value={field.value}
              />
            ))}
          </dl>
        </div>
      ))}
      {view.truncated ? (
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t("machines.detail.diagnostics.truncated")}
        </p>
      ) : undefined}
    </div>
  );
}
