import type { TranslationKey } from "~/i18n";
import type { IntegrationRestartStage } from "~/server/config/integration/abstract";

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
  | "restartFailed";

export const SYSTEM_ERROR_KEYS: Record<SystemErrorCode, TranslationKey> = {
  invalidAction: "settings.system.errors.invalidAction",
  notAvailable: "settings.system.errors.notAvailable",
  failed: "settings.system.errors.failed",
  notRestartable: "settings.system.errors.notRestartable",
  restartFailed: "settings.system.errors.restartFailed",
};

/**
 * One message per step a restart can stop at, so "it did not work" says which
 * part did not work: nothing to stop, the process never came back, it came back
 * unhealthy, ...
 */
export const RESTART_STAGE_KEYS: Record<IntegrationRestartStage, TranslationKey> = {
  "no-process": "settings.system.restartStage.noProcess",
  "stale-pid": "settings.system.restartStage.stalePid",
  "stop-timeout": "settings.system.restartStage.stopTimeout",
  "not-restarted": "settings.system.restartStage.notRestarted",
  unhealthy: "settings.system.restartStage.unhealthy",
  healthy: "settings.system.restartStage.healthy",
  unsupported: "settings.system.restartStage.unsupported",
};

export interface SystemSuccess {
  success: true;
  /** Present after a restart request: the step it reached (`healthy` when it worked). */
  restart?: { stage: IntegrationRestartStage };
}

export interface SystemFailure {
  success: false;
  errorCode: SystemErrorCode;
  /** The step a restart stopped at, when a restart is what failed. */
  stage?: IntegrationRestartStage;
}

export type SystemResult = SystemSuccess | SystemFailure;
