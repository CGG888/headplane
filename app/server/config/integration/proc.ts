import { platform } from "node:os";

import { type } from "arktype";

import type { Headscale } from "~/server/headscale/api";
import log from "~/utils/log";

import { Integration } from "./abstract";
import type { IntegrationReloadResult, IntegrationRestartResult } from "./abstract";
import { findHeadscaleServe, restartHeadscale, signalAndWaitHealthy } from "./proc-helper";

const configSchema = {
  full: type({
    enabled: "boolean",
    // Off by default: a native Headscale is only restarted from here when the
    // operator asked for it, because nothing guarantees a supervisor will
    // start it again.
    allow_restart: "boolean?",
  }),

  partial: type({
    enabled: "boolean?",
    allow_restart: "boolean?",
  }).partial(),
};

export default class ProcIntegration extends Integration<typeof configSchema.full.infer> {
  private pid: number | undefined;

  get name() {
    return "Native Linux (/proc)";
  }

  get kind() {
    return "proc" as const;
  }

  static get configSchema() {
    return configSchema;
  }

  async isAvailable() {
    if (platform() !== "linux") {
      log.error("config", "/proc is only available on Linux");
      return false;
    }

    try {
      const result = await findHeadscaleServe();
      if (!result) {
        log.error("config", "Could not find headscale serve process");
        return false;
      }

      this.pid = result;
      log.info("config", "Found headscale serve (PID %d)", this.pid);
      return true;
    } catch (error) {
      log.error("config", "Failed to scan /proc: %s", error);
      return false;
    }
  }

  /**
   * Re-reads the pid instead of reusing the one found at load time: a restart
   * gives Headscale a new pid, and the old number can be reused by an unrelated
   * process, which must never be signalled.
   */
  private async resolvePid(): Promise<number | undefined> {
    const pid = await findHeadscaleServe().catch(() => undefined);
    if (pid !== undefined) {
      this.pid = pid;
    }

    return pid;
  }

  /**
   * SIGHUP is what Headscale honours in place, and it reloads the ACL policy
   * *only* — a DERP change never goes live through it. This stays as it is for
   * the policy path; DERP writes use `restart()` or tell the operator instead.
   */
  async onConfigChange(headscale: Headscale): Promise<IntegrationReloadResult> {
    const pid = await this.resolvePid();
    if (pid === undefined) {
      log.error("config", "Cannot signal Headscale: no headscale serve process found");
      return { ok: false, stage: "no-process" };
    }

    return await signalAndWaitHealthy(headscale, {
      pid,
      signal: "SIGHUP",
    });
  }

  canRestart() {
    return this.context.allow_restart === true;
  }

  async restart(_headscale: Headscale): Promise<IntegrationRestartResult> {
    if (!this.canRestart()) {
      return { ok: false, stage: "unsupported" };
    }

    const pid = await this.resolvePid();
    const result = await restartHeadscale(_headscale, { pid });
    this.pid = result.pid ?? this.pid;
    return result;
  }
}
