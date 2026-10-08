import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// `signalAndWaitHealthy` imports `kill` from `node:process` as a module binding,
// so the signal has to be intercepted at the module rather than on `process`.
const { killMock } = vi.hoisted(() => ({ killMock: vi.fn() }));

vi.mock("node:process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:process")>();
  return { ...actual, kill: killMock };
});

import {
  detectHeadscaleSupervisor,
  findHeadscaleServe,
  isHeadscaleServe,
  restartHeadscale,
  signalAndWaitHealthy,
} from "~/server/config/integration/proc-helper";
import type { Headscale } from "~/server/headscale/api";

let root: string;

/** Writes the two files the scan reads for one process. */
async function writeProcess(
  pid: number | string,
  comm: string,
  args: string[],
  extra: Record<string, string> = {},
) {
  const dir = join(root, String(pid));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "comm"), `${comm}\n`);
  await writeFile(join(dir, "cmdline"), `${args.join("\0")}\0`);

  for (const [name, content] of Object.entries(extra)) {
    await writeFile(join(dir, name), content);
  }

  return dir;
}

beforeEach(async () => {
  killMock.mockReset();
  root = await mkdtemp(join(tmpdir(), "headplane-proc-helper-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signalAndWaitHealthy", () => {
  /** A Headscale whose /health always answers the same thing. */
  function headscaleAnswering(answer: boolean): Headscale {
    return { health: async () => answer } as unknown as Headscale;
  }

  test("a signal the kernel refuses is a permission problem, not a failure", async () => {
    killMock.mockImplementation(() => {
      throw Object.assign(new Error("kill EACCES"), { code: "EACCES" });
    });

    const result = await signalAndWaitHealthy(headscaleAnswering(true), {
      pid: 4242,
      retryDelayMs: 1,
    });

    expect(result).toEqual({ ok: false, stage: "permission", pid: 4242 });
  });

  test("an unrelated kill error is reported as a plain failure", async () => {
    killMock.mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });

    const result = await signalAndWaitHealthy(headscaleAnswering(true), {
      pid: 4243,
      retryDelayMs: 1,
    });

    expect(result).toEqual({ ok: false, stage: "failed", pid: 4243 });
  });

  test("a delivered signal whose health never answers is not confirmed", async () => {
    killMock.mockImplementation(() => true);

    const result = await signalAndWaitHealthy(headscaleAnswering(false), {
      pid: 4244,
      maxAttempts: 2,
      retryDelayMs: 1,
    });

    expect(killMock).toHaveBeenCalledWith(4244, "SIGHUP");
    expect(result).toEqual({ ok: false, stage: "not-confirmed", pid: 4244 });
  });
});

describe("findHeadscaleServe", () => {
  test("finds the serve process and ignores every other process", async () => {
    await writeProcess(1, "init", ["/sbin/init"]);
    await writeProcess(7, "headscale", ["headscale", "nodes", "list"]);
    await writeProcess(9, "headscale", ["headscale", "serve", "--config", "/etc/headscale"]);

    expect(await findHeadscaleServe(root)).toBe(9);
  });

  test("returns nothing when no headscale serve process exists", async () => {
    await writeProcess(7, "headscale", ["headscale", "users", "list"]);
    await writeProcess(8, "nginx", ["nginx"]);

    expect(await findHeadscaleServe(root)).toBeUndefined();
  });
});

describe("isHeadscaleServe", () => {
  test("accepts only a headscale process running serve", async () => {
    await writeProcess(9, "headscale", ["headscale", "serve"]);
    await writeProcess(10, "headscale", ["headscale", "nodes", "list"]);
    await writeProcess(11, "other", ["other", "serve"]);

    expect(await isHeadscaleServe(9, root)).toBe(true);
    expect(await isHeadscaleServe(10, root)).toBe(false);
    expect(await isHeadscaleServe(11, root)).toBe(false);
  });

  test("a pid that is gone is never signalled again", async () => {
    expect(await isHeadscaleServe(4242, root)).toBe(false);
  });
});

describe("detectHeadscaleSupervisor", () => {
  test("a cgroup in a systemd slice is systemd", async () => {
    await writeProcess(9, "headscale", ["headscale", "serve"], {
      cgroup: "0::/system.slice/headscale.service\n",
    });

    expect(await detectHeadscaleSupervisor(9, root)).toEqual({ supervised: true, hint: "systemd" });
  });

  test("a parent of pid 1 is treated as a supervisor", async () => {
    await writeProcess(9, "headscale", ["headscale", "serve"], {
      stat: "9 (headscale) S 1 9 9 0 -1 4194560\n",
    });

    expect(await detectHeadscaleSupervisor(9, root)).toEqual({ supervised: true, hint: "pid 1" });
  });

  test("a known supervisor as the parent is reported by name", async () => {
    await writeProcess(9, "headscale", ["headscale", "serve"], {
      stat: "9 (headscale) S 100 9 9 0 -1 4194560\n",
    });
    await writeProcess(100, "systemd", ["/sbin/init"]);

    expect(await detectHeadscaleSupervisor(9, root)).toEqual({ supervised: true, hint: "systemd" });
  });

  test("an unknown parent is a hint that nothing will start it again", async () => {
    await writeProcess(9, "headscale", ["headscale", "serve"], {
      stat: "9 (headscale) S 100 9 9 0 -1 4194560\n",
    });
    await writeProcess(100, "bash", ["bash", "-c", "headscale serve"]);

    expect(await detectHeadscaleSupervisor(9, root)).toEqual({ supervised: false, hint: "bash" });
  });

  test("a process that is already gone reports nothing", async () => {
    expect(await detectHeadscaleSupervisor(4242, root)).toEqual({ supervised: false });
  });
});

describe("restartHeadscale", () => {
  const headscale = { health: async () => true } as unknown as Headscale;

  test("reports a missing process instead of signalling anything", async () => {
    const result = await restartHeadscale(headscale, { procPath: root });

    expect(result).toMatchObject({ ok: false, stage: "no-process" });
  });

  test("a pid that is no longer headscale serve is never stopped", async () => {
    await writeProcess(9, "headscale", ["headscale", "nodes", "list"]);

    const result = await restartHeadscale(headscale, { procPath: root, pid: 9 });

    expect(result).toMatchObject({ ok: false, stage: "stale-pid", pid: 9 });
  });
});
