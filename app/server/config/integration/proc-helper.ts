import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { kill } from "node:process";
import { setTimeout } from "node:timers/promises";

import type { Headscale } from "~/server/headscale/api";
import log from "~/utils/log";

import type { IntegrationRestartResult, IntegrationSupervisor } from "./abstract";

/**
 * Does a two-stage scan of /proc to find the headscale process that is running
 * a "serve" subcommand. It first scans all processes' comm files to find
 * headscale processes, then checks their cmdline files to see if "serve" is
 * the second argument.
 *
 * @param procPath The path to the proc filesystem (default: /proc)
 * @returns The PID of the headscale serve process, or undefined if not found
 */
export async function findHeadscaleServe(procPath = "/proc"): Promise<number | undefined> {
  const subdirs = await readdir(procPath);
  const commResults = await Promise.allSettled(
    subdirs.map(async (entry) => {
      const pid = Number.parseInt(entry, 10);
      if (Number.isNaN(pid)) {
        return undefined;
      }

      try {
        const comm = await readFile(join(procPath, entry, "comm"), "utf8");
        return comm.trim() === "headscale" ? pid : undefined;
      } catch {
        return undefined;
      }
    }),
  );

  const headscalePids = commResults
    .map((result) => {
      if (result.status === "fulfilled" && result.value !== undefined) {
        return result.value;
      }
      return undefined;
    })
    .filter((pid): pid is number => pid !== undefined);

  if (headscalePids.length === 0) {
    return undefined;
  }

  log.debug("config", "Found %d headscale process(es), checking for serve", headscalePids.length);
  for (const pid of headscalePids) {
    try {
      const cmdline = await readFile(join(procPath, pid.toString(), "cmdline"), "utf8");
      const args = cmdline.split("\0").filter(Boolean);

      if (args[1] === "serve") {
        return pid;
      }
    } catch {
      // Process may have exited between stages
    }
  }

  return undefined;
}

/**
 * Options for signaling the headscale process.
 */
export interface SignalHeadscaleOptions {
  pid: number;
  signal?: NodeJS.Signals;
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Sends a signal to the headscale process and waits for it to become healthy.
 * @param headscale The Headscale instance to health-check
 * @param options Options for signaling and waiting
 * @returns True if headscale became healthy, false otherwise
 */
export async function signalAndWaitHealthy(
  headscale: Headscale,
  options: SignalHeadscaleOptions,
): Promise<boolean> {
  const { pid, signal = "SIGHUP", maxAttempts = 10, retryDelayMs = 1000 } = options;

  try {
    kill(pid, signal);
    log.info("config", "Sent %s to Headscale (PID %d)", signal, pid);
  } catch (error) {
    log.error("config", "Failed to send %s to PID %d: %s", signal, pid, error);
    return false;
  }

  await setTimeout(retryDelayMs);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const healthy = await headscale.health();
      if (healthy) {
        log.info("config", "Headscale is healthy after restart");
        return true;
      }
    } catch {
      // Still restarting
    }

    if (attempt < maxAttempts) {
      await setTimeout(retryDelayMs);
    }
  }

  log.error("config", "Headscale did not become healthy after %d attempts", maxAttempts);
  return false;
}

/**
 * Whether a pid still is the `headscale serve` process.
 *
 * The pid this integration holds is read once, and a pid is only unique while
 * its process lives: after a restart the kernel can hand the same number to an
 * unrelated process. Every signal therefore re-checks the pid instead of
 * trusting the cached one.
 */
export async function isHeadscaleServe(pid: number, procPath = "/proc"): Promise<boolean> {
  try {
    const comm = await readFile(join(procPath, pid.toString(), "comm"), "utf8");
    if (comm.trim() !== "headscale") {
      return false;
    }

    const cmdline = await readFile(join(procPath, pid.toString(), "cmdline"), "utf8");
    return cmdline.split("\0").filter(Boolean)[1] === "serve";
  } catch {
    // The process is gone, or /proc entry is not readable: either way it is
    // not something to send a signal to.
    return false;
  }
}

/** Process names that mean "something else will start Headscale again". */
const SUPERVISOR_COMMS = new Set([
  "systemd",
  "supervisord",
  "s6-svscan",
  "runsv",
  "runit",
  "tini",
  "containerd-shim",
  "containerd-shim-runc-v2",
  "dockerd",
  "init",
]);

/**
 * Best-effort answer to "if this process dies, does it come back?".
 *
 * It is a hint for the confirmation dialog, never a guarantee: s6, a wrapper
 * script or a systemd unit without `Restart=` all look different from here, and
 * an unsupervised process looks exactly like a supervised one whose supervisor
 * is not in the list.
 */
export async function detectHeadscaleSupervisor(
  pid: number,
  procPath = "/proc",
): Promise<IntegrationSupervisor> {
  try {
    const cgroup = await readFile(join(procPath, pid.toString(), "cgroup"), "utf8");
    if (cgroup.includes(".service") || cgroup.includes("system.slice")) {
      return { supervised: true, hint: "systemd" };
    }
  } catch {
    // No cgroup entry (older kernels, containers): fall back to the parent.
  }

  try {
    const stat = await readFile(join(procPath, pid.toString(), "stat"), "utf8");
    // `pid (comm) state ppid ...`; comm can contain spaces and parentheses, so
    // the parent is read from behind the last closing parenthesis.
    const closing = stat.lastIndexOf(")");
    const fields = stat.slice(closing + 2).split(" ");
    const ppid = Number.parseInt(fields[1] ?? "", 10);
    if (Number.isNaN(ppid)) {
      return { supervised: false };
    }

    if (ppid === 1) {
      return { supervised: true, hint: "pid 1" };
    }

    const parent = (await readFile(join(procPath, ppid.toString(), "comm"), "utf8")).trim();
    return SUPERVISOR_COMMS.has(parent)
      ? { supervised: true, hint: parent }
      : { supervised: false, hint: parent };
  } catch {
    return { supervised: false };
  }
}

export interface RestartHeadscaleOptions {
  /** The pid found at load time; re-validated and otherwise re-discovered. */
  pid?: number;
  procPath?: string;
  stopTimeoutMs?: number;
  startTimeoutMs?: number;
  healthTimeoutMs?: number;
  pollIntervalMs?: number;
}

/** Waits for a pid to disappear; false when it is still there at the deadline. */
async function waitForExit(
  pid: number,
  procPath: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isHeadscaleServe(pid, procPath))) {
      return true;
    }

    await setTimeout(pollIntervalMs);
  }

  return !(await isHeadscaleServe(pid, procPath));
}

/**
 * Restarts Headscale through the supervisor that owns it.
 *
 * A native install has no API to restart Headscale, so this sends SIGTERM —
 * which Headscale handles as a graceful stop — and then waits for something
 * else to start it again. Nothing is guessed about the supervisor: if no new
 * `headscale serve` process appears, that is reported as such instead of being
 * treated as a success.
 */
export async function restartHeadscale(
  headscale: Headscale,
  options: RestartHeadscaleOptions = {},
): Promise<IntegrationRestartResult> {
  const procPath = options.procPath ?? "/proc";
  const stopTimeoutMs = options.stopTimeoutMs ?? 8_000;
  const startTimeoutMs = options.startTimeoutMs ?? 20_000;
  const healthTimeoutMs = options.healthTimeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;

  const pid = options.pid ?? (await findHeadscaleServe(procPath).catch(() => undefined));
  if (pid === undefined) {
    log.error("config", "Cannot restart Headscale: no headscale serve process found");
    return { ok: false, stage: "no-process", supervisor: { supervised: false } };
  }

  // A restart hands the pid back to the kernel, so a cached one can belong to
  // another process by now; only signal it when it still is headscale serve.
  if (!(await isHeadscaleServe(pid, procPath))) {
    log.error("config", "Cannot restart Headscale: PID %d is not headscale serve anymore", pid);
    return { ok: false, stage: "stale-pid", pid, supervisor: { supervised: false } };
  }

  const supervisor = await detectHeadscaleSupervisor(pid, procPath);
  if (!supervisor.supervised) {
    log.warn(
      "config",
      "No supervisor detected for Headscale (PID %d); it may not come back after a restart",
      pid,
    );
  }

  try {
    kill(pid, "SIGTERM");
    log.info("config", "Sent SIGTERM to Headscale (PID %d)", pid);
  } catch (error) {
    log.error("config", "Failed to stop Headscale (PID %d): %s", pid, error);
    return { ok: false, stage: "stale-pid", pid, supervisor };
  }

  if (!(await waitForExit(pid, procPath, stopTimeoutMs, pollIntervalMs))) {
    log.error("config", "Headscale (PID %d) did not exit within %dms", pid, stopTimeoutMs);
    return { ok: false, stage: "stop-timeout", pid, supervisor };
  }

  const startDeadline = Date.now() + startTimeoutMs;
  let startedPid: number | undefined;
  while (Date.now() < startDeadline) {
    await setTimeout(pollIntervalMs);

    const candidate = await findHeadscaleServe(procPath).catch(() => undefined);
    if (candidate !== undefined && candidate !== pid) {
      startedPid = candidate;
      break;
    }
  }

  if (startedPid === undefined) {
    log.error("config", "Headscale did not start again within %dms", startTimeoutMs);
    return { ok: false, stage: "not-restarted", pid, supervisor };
  }

  log.info("config", "Headscale started again (PID %d)", startedPid);

  const healthDeadline = Date.now() + healthTimeoutMs;
  while (Date.now() <= healthDeadline) {
    try {
      if (await headscale.health()) {
        log.info("config", "Headscale is healthy after restart (PID %d)", startedPid);
        return { ok: true, stage: "healthy", pid: startedPid, supervisor };
      }
    } catch {
      // Still starting up.
    }

    await setTimeout(pollIntervalMs);
  }

  log.error("config", "Headscale (PID %d) never became healthy after the restart", startedPid);
  return { ok: false, stage: "unhealthy", pid: startedPid, supervisor };
}
