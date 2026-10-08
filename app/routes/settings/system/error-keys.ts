import type { TranslationKey } from "~/i18n";
import type {
  IntegrationReloadStage,
  IntegrationRestartStage,
} from "~/server/config/integration/abstract";

/**
 * Stable error codes returned by the system status action, mapped onto the
 * localized message the page renders. Kept free of server imports so the page
 * can use it without pulling server-only modules into the browser bundle: the
 * one import above is a type, which the compiler erases.
 */
export type SystemErrorCode =
  | "invalidAction"
  | "notAvailable"
  | "failed"
  | "notRestartable"
  | "restartFailed"
  | "reloadFailed";

export const SYSTEM_ERROR_KEYS: Record<SystemErrorCode, TranslationKey> = {
  invalidAction: "settings.system.errors.invalidAction",
  notAvailable: "settings.system.errors.notAvailable",
  failed: "settings.system.errors.failed",
  notRestartable: "settings.system.errors.notRestartable",
  restartFailed: "settings.system.errors.restartFailed",
  reloadFailed: "settings.system.errors.reloadFailed",
};

/**
 * One message per step a restart can stop at, so "it did not work" says which
 * part did not work: nothing to stop, the process never came back, it came back
 * unhealthy, ...
 */
export const RESTART_STAGE_KEYS: Record<IntegrationRestartStage, TranslationKey> = {
  "no-process": "settings.system.restartStage.noProcess",
  "stale-pid": "settings.system.restartStage.stalePid",
  permission: "settings.system.restartStage.permission",
  "stop-timeout": "settings.system.restartStage.stopTimeout",
  "not-restarted": "settings.system.restartStage.notRestarted",
  unhealthy: "settings.system.restartStage.unhealthy",
  healthy: "settings.system.restartStage.healthy",
  unsupported: "settings.system.restartStage.unsupported",
};

/**
 * The same for a reload, which is the path that fails when a container is not
 * allowed to signal the Headscale process running on its host.
 */
export const RELOAD_STAGE_KEYS: Record<IntegrationReloadStage, TranslationKey> = {
  healthy: "settings.system.reloadStage.healthy",
  "not-confirmed": "settings.system.reloadStage.notConfirmed",
  "no-process": "settings.system.reloadStage.noProcess",
  unconfigured: "settings.system.reloadStage.unconfigured",
  permission: "settings.system.reloadStage.permission",
  failed: "settings.system.reloadStage.failed",
  unsupported: "settings.system.reloadStage.unsupported",
};

export interface SystemSuccess {
  success: true;
  /** Present after a restart request: the step it reached (`healthy` when it worked). */
  restart?: { stage: IntegrationRestartStage };
  /** Present after a reload request: the step it reached (`healthy` when it worked). */
  reload?: { stage: IntegrationReloadStage };
}

export interface SystemFailure {
  success: false;
  errorCode: SystemErrorCode;
  /** The step a restart stopped at, when a restart is what failed. */
  stage?: IntegrationRestartStage;
  /** The step a reload stopped at, when a reload is what failed. */
  reloadStage?: IntegrationReloadStage;
}

export type SystemResult = SystemSuccess | SystemFailure;
