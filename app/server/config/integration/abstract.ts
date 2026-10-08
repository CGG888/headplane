import type { Headscale } from "~/server/headscale/api";

/** Which deployment the integration talks to; DERP handling differs per kind. */
export type IntegrationKind = "docker" | "kubernetes" | "proc";

/**
 * How far a restart got. The stage is what the operator sees, so it has to name
 * the step that failed rather than a bare boolean:
 *
 * - `no-process`: no `headscale serve` process was found at all.
 * - `stale-pid`: the recorded pid is not (or no longer) headscale serve.
 * - `stop-timeout`: the process did not exit within the budget.
 * - `not-restarted`: it exited, but nothing started it again.
 * - `unhealthy`: a new process exists but never answered `/health`.
 * - `healthy`: the new process is up and answering.
 * - `unsupported`: this integration cannot restart Headscale.
 */
export type IntegrationRestartStage =
  | "no-process"
  | "stale-pid"
  | "stop-timeout"
  | "not-restarted"
  | "unhealthy"
  | "healthy"
  | "unsupported";

export interface IntegrationSupervisor {
  /** True when something other than the operator's shell should start it again. */
  supervised: boolean;
  /** What looks like the supervisor (systemd, supervisord, ...), for the dialog. */
  hint?: string;
}

export interface IntegrationRestartResult {
  ok: boolean;
  stage: IntegrationRestartStage;
  /** The new process once it exists, otherwise the old one. */
  pid?: number;
  supervisor?: IntegrationSupervisor;
}

export abstract class Integration<T> {
  protected context: NonNullable<T>;
  constructor(context: T) {
    if (!context) {
      throw new Error("Missing integration context");
    }

    this.context = context;
  }

  abstract isAvailable(): Promise<boolean> | boolean;

  /**
   * Asks the running Headscale to pick up a configuration change, as far as
   * this deployment can. Returns whether Headscale answered healthy afterwards:
   * an implementation that cannot do it must return false rather than throwing,
   * so the caller can report "written but not live" instead of a success.
   */
  abstract onConfigChange(headscale: Headscale): Promise<boolean> | boolean;
  abstract get name(): string;
  abstract get kind(): IntegrationKind;

  /** Whether this integration can perform a full restart, not just a reload. */
  canRestart(): boolean {
    return false;
  }

  /** Restarts Headscale. Only called when `canRestart()` is true. */
  async restart(_headscale: Headscale): Promise<IntegrationRestartResult> {
    return { ok: false, stage: "unsupported" };
  }
}
