import type {
  IntegrationKind,
  IntegrationReloadResult,
  IntegrationReloadStage,
  IntegrationRestartResult,
  IntegrationRestartStage,
} from "~/server/config/integration/abstract";
import type { Headscale } from "~/server/headscale/api";
import log from "~/utils/log";

import { clearRemoteDerpMapCache } from "./headscale/derp-map-remote";
import { clearLocalDerpRegionCache } from "./headscale/derp-region-sources";
import { bumpDerpRevision } from "./headscale/derp-revision";
import { clearSharedRelayDnsCache } from "./relay-dns";

/**
 * What a DERP write changed. This decides whether Headscale has to re-read
 * anything at all, which is the part the deployment does not change:
 *
 * - `local`: HeadplaneCN's own data (region names, mirror settings, a pasted
 *   map, the sync schedule). Headscale never reads it, so nothing to re-read.
 * - `map-file`: the contents of a file `derp.paths` lists, including the
 *   mirror's own output and a restored map snapshot. Headscale re-reads file
 *   *contents* on every updater tick, but the list of files comes from its
 *   startup configuration snapshot.
 * - `config`: Headscale's configuration file (`derp.urls`, `derp.paths`,
 *   `derp.server.*`, the updater settings). Only a process that reads the file
 *   again can see it.
 */
export type DerpChangeKind = "local" | "map-file" | "config";

/**
 * How the change reached Headscale's running process.
 *
 * - `not-needed`: nothing Headscale reads changed.
 * - `ticker`: Headscale's own updater will re-read the file within
 *   `derp.update_frequency`; no restart needed.
 * - `triggered`: the integration reloaded or restarted Headscale now.
 * - `manual`: nothing could reach it — the operator has to reload Headscale.
 * - `failed`: the integration tried and did not get Headscale back healthy.
 */
export type DerpReloadOutcome = "not-needed" | "ticker" | "triggered" | "manual" | "failed";

/**
 * How a refresh that failed actually failed: which call the integration was
 * asked to make, and where it stopped. `"error"` means the call threw instead
 * of answering with a stage, so only the logs name the cause.
 */
export type DerpRefreshFailure =
  | { action: "restart"; stage: IntegrationRestartStage | "error" }
  | { action: "reload"; stage: IntegrationReloadStage | "error" };

export interface DerpRefreshResult {
  changeKind: DerpChangeKind;
  /** The action id (or a short label) that wrote, for the notice on the page. */
  reason: string;
  /** When this refresh ran, so the page can say how fresh the notice is. */
  at: string;
  /** Every real write clears the per-process caches; kept for clarity in tests. */
  invalidated: true;
  outcome: DerpReloadOutcome;
  /** True when Headscale's running process has not picked the change up yet. */
  pendingRestart: boolean;
  /**
   * Set only when `outcome` is `failed`: the notice can then name the stage
   * instead of telling the operator to read the logs. The integration's own
   * stages are the same ones Settings → System already reports.
   */
  failure?: DerpRefreshFailure;
}

let lastRefresh: DerpRefreshResult | undefined;

/** The last DERP refresh this process performed, for the page notice. */
export function getLastDerpRefresh(): DerpRefreshResult | undefined {
  return lastRefresh;
}

/** Test helper: forget the recorded refresh. */
export function clearLastDerpRefresh(): void {
  lastRefresh = undefined;
}

/**
 * Forgets everything this process cached about DERP maps and bumps the DERP
 * revision the live store polls.
 *
 * Three caches have to go together, because one page can read all of them: the
 * remote map answers (keyed by URL, up to six hours), the parsed local files
 * (keyed by path + size + mtime) and the relay host resolutions. A write that
 * touches only one of them still has to clear all three — the local file cache
 * is keyed by mtime and size, so restoring a snapshot with identical size can
 * otherwise keep serving the old regions.
 */
export function invalidateDerpData(): number {
  clearRemoteDerpMapCache();
  clearLocalDerpRegionCache();
  clearSharedRelayDnsCache();

  const revision = bumpDerpRevision();
  log.debug("config", "Cleared the DERP caches (revision %d)", revision);
  return revision;
}

/**
 * The integration, as a DERP refresh needs it. Kept structural so the mirror and
 * sync services can take it through their own narrow ports instead of depending
 * on the whole integration class.
 */
export interface DerpReloadTarget {
  name: string;
  kind: IntegrationKind;
  canRestart(): boolean;
  restart(headscale: Headscale): Promise<IntegrationRestartResult>;
  onConfigChange(headscale: Headscale): Promise<IntegrationReloadResult> | IntegrationReloadResult;
}

export interface DerpReloadInput {
  changeKind: DerpChangeKind;
  integration: DerpReloadTarget | undefined;
  /**
   * `derp.auto_update_enabled`: Headscale re-reads `derp.paths` and `derp.urls`
   * on its own. Left out when the caller does not know it, because assuming the
   * ticker covers a file change would silently leave the change unloaded.
   */
  autoUpdateEnabled?: boolean;
}

type DerpReloadAction = "none" | "notify" | "restart" | "manual";

/**
 * Decides what HeadplaneCN can do about a write, from the change class and the
 * integration. The deployment matters here, not in the invalidation above:
 *
 * - nothing configured: the operator reloads Headscale by hand, unless the
 *   updater covers a file change.
 * - Docker: `onConfigChange` restarts the container, which re-reads the
 *   configuration and every map file.
 * - Kubernetes: a pod restart would do the same, but only a restart the
 *   integration actually reports is used, so a change it cannot restart is
 *   reported as a manual reload instead of a silent no-op.
 * - Native: the only in-place signal Headscale honours is SIGHUP, and SIGHUP
 *   reloads the ACL policy *only*. A restart is therefore the sole way to make
 *   a configuration change live, and the only way to make a file change live
 *   when the updater is off.
 */
export function decideDerpReload(input: DerpReloadInput): DerpReloadAction {
  if (input.changeKind === "local") {
    return "none";
  }

  if (input.changeKind === "map-file" && input.autoUpdateEnabled === true) {
    return "none";
  }

  const integration = input.integration;
  if (!integration) {
    return "manual";
  }

  if (integration.kind === "proc" || integration.kind === "kubernetes") {
    return integration.canRestart() ? "restart" : "manual";
  }

  return "notify";
}

export interface DerpRefreshInput extends DerpReloadInput {
  headscale: Headscale;
  reason: string;
}

/**
 * The reload state the mirror and sync cards already report (`DerpMirrorReload`
 * and `DerpSyncReload` are the same four values), derived from a refresh.
 */
export function toReloadState(
  outcome: DerpReloadOutcome,
): "not-needed" | "manual" | "triggered" | "failed" {
  switch (outcome) {
    case "triggered":
      return "triggered";
    case "failed":
      return "failed";
    case "not-needed":
    case "ticker":
      return "not-needed";
    default:
      return "manual";
  }
}

/**
 * The one entry point every DERP write calls after it changed something:
 * clear what this process cached, then get the change into Headscale's running
 * process as far as the deployment allows, and record what happened so the page
 * can say whether the change is live or still needs a restart.
 */
export async function refreshDerpAfterWrite(input: DerpRefreshInput): Promise<DerpRefreshResult> {
  const revision = invalidateDerpData();
  const action = decideDerpReload(input);
  const integration = input.integration;

  let outcome: DerpReloadOutcome;
  let failedStage: IntegrationReloadStage | IntegrationRestartStage | "error" | undefined;
  let failedCall: "reload" | "restart" | undefined;
  if (action === "none") {
    outcome = input.changeKind === "map-file" ? "ticker" : "not-needed";
  } else if (action === "manual" || !integration) {
    outcome = "manual";
  } else {
    let ok = false;
    try {
      const reloaded =
        action === "restart"
          ? await integration.restart(input.headscale)
          : await integration.onConfigChange(input.headscale);
      ok = reloaded.ok;
      if (!reloaded.ok) {
        failedStage = reloaded.stage;
        failedCall = action === "restart" ? "restart" : "reload";
        log.error(
          "config",
          "Integration %s could not %s after %s: %s",
          integration.name,
          action,
          input.reason,
          reloaded.stage,
        );
      }
    } catch (error) {
      failedStage = "error";
      failedCall = action === "restart" ? "restart" : "reload";
      log.error(
        "config",
        "Integration %s failed to %s after %s: %s",
        integration.name,
        action,
        input.reason,
        error,
      );
      ok = false;
    }

    outcome = ok ? "triggered" : "failed";
  }

  const failure =
    outcome === "failed" && failedStage !== undefined && failedCall !== undefined
      ? ({ action: failedCall, stage: failedStage } as DerpRefreshFailure)
      : undefined;

  const result: DerpRefreshResult = {
    changeKind: input.changeKind,
    reason: input.reason,
    at: new Date().toISOString(),
    invalidated: true,
    outcome,
    pendingRestart: outcome === "manual" || outcome === "failed",
    ...(failure === undefined ? {} : { failure }),
  };

  lastRefresh = result;

  if (outcome === "failed") {
    log.error(
      "config",
      "DERP refresh after %s failed at %s (revision %d)",
      input.reason,
      failedStage ?? "unknown",
      revision,
    );
  } else {
    log.info("config", "DERP refresh after %s: %s (revision %d)", input.reason, outcome, revision);
  }

  return result;
}
