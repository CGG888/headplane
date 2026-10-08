import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  IntegrationKind,
  IntegrationReloadResult,
} from "~/server/config/integration/abstract";
import {
  clearLastDerpRefresh,
  decideDerpReload,
  getLastDerpRefresh,
  invalidateDerpData,
  refreshDerpAfterWrite,
  toReloadState,
  type DerpReloadTarget,
} from "~/server/derp-refresh";
import type { Headscale } from "~/server/headscale/api";
import { getDerpRevision, resetDerpRevision } from "~/server/headscale/derp-revision";

const headscale = {} as unknown as Headscale;

interface TargetOptions {
  kind?: IntegrationKind;
  canRestart?: boolean;
  reloadOk?: boolean;
  restartOk?: boolean;
  reloadThrows?: boolean;
}

function makeTarget(options: TargetOptions = {}) {
  const restartResult = { ok: options.restartOk ?? true, stage: "healthy" as const };
  const onConfigChange = options.reloadThrows
    ? vi.fn(async (): Promise<IntegrationReloadResult> => {
        throw new Error("reload refused");
      })
    : vi.fn(async (): Promise<IntegrationReloadResult> => ({
        ok: options.reloadOk ?? true,
        stage: options.reloadOk === false ? "permission" : "healthy",
      }));
  const restart = vi.fn(async () => restartResult);

  const target: DerpReloadTarget = {
    name: "Test integration",
    kind: options.kind ?? "docker",
    canRestart: () => options.canRestart ?? false,
    restart,
    onConfigChange,
  };

  return { target, onConfigChange, restart };
}

beforeEach(() => {
  clearLastDerpRefresh();
  resetDerpRevision();
});

describe("decideDerpReload", () => {
  test("a local write never needs Headscale", () => {
    const { target } = makeTarget();
    expect(decideDerpReload({ changeKind: "local", integration: target })).toBe("none");
  });

  test("a map file is covered by the updater when it is enabled", () => {
    const { target } = makeTarget();
    expect(
      decideDerpReload({ changeKind: "map-file", integration: target, autoUpdateEnabled: true }),
    ).toBe("none");
  });

  test("a map file still needs a reload when the updater is off or unknown", () => {
    const { target } = makeTarget();
    expect(decideDerpReload({ changeKind: "map-file", integration: target })).toBe("notify");
    expect(
      decideDerpReload({ changeKind: "map-file", integration: target, autoUpdateEnabled: false }),
    ).toBe("notify");
  });

  test("without an integration the operator has to reload", () => {
    expect(decideDerpReload({ changeKind: "config", integration: undefined })).toBe("manual");
  });

  test("a native install reloads only when it was allowed to restart", () => {
    const off = makeTarget({ kind: "proc", canRestart: false });
    const on = makeTarget({ kind: "proc", canRestart: true });

    expect(decideDerpReload({ changeKind: "config", integration: off.target })).toBe("manual");
    expect(decideDerpReload({ changeKind: "config", integration: on.target })).toBe("restart");
  });

  test("Kubernetes reports a manual reload and Docker is asked to restart", () => {
    const kubernetes = makeTarget({ kind: "kubernetes" });
    const docker = makeTarget({ kind: "docker" });

    expect(decideDerpReload({ changeKind: "config", integration: kubernetes.target })).toBe(
      "manual",
    );
    expect(decideDerpReload({ changeKind: "config", integration: docker.target })).toBe("notify");
  });
});

describe("invalidateDerpData", () => {
  test("bumps the revision the live store polls", () => {
    const before = getDerpRevision();
    const first = invalidateDerpData();
    const second = invalidateDerpData();

    expect(first).toBe(before + 1);
    expect(second).toBe(before + 2);
  });
});

describe("refreshDerpAfterWrite", () => {
  test("asks a restartable native install to restart and reports it live", async () => {
    const { target, onConfigChange, restart } = makeTarget({ kind: "proc", canRestart: true });

    const result = await refreshDerpAfterWrite({
      headscale,
      integration: target,
      changeKind: "config",
      reason: "save_derp_settings",
    });

    expect(restart).toHaveBeenCalledWith(headscale);
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      changeKind: "config",
      reason: "save_derp_settings",
      invalidated: true,
      outcome: "triggered",
      pendingRestart: false,
    });
    expect(Number.isNaN(Date.parse(result.at))).toBe(false);
    expect(getLastDerpRefresh()).toEqual(result);
  });

  test("a restart that did not come back healthy is a pending restart", async () => {
    const { target } = makeTarget({ kind: "proc", canRestart: true, restartOk: false });

    const result = await refreshDerpAfterWrite({
      headscale,
      integration: target,
      changeKind: "config",
      reason: "restore_snapshot",
    });

    expect(result.outcome).toBe("failed");
    expect(result.pendingRestart).toBe(true);
  });

  test("a reload that throws is reported as failed", async () => {
    const { target } = makeTarget({ kind: "docker", reloadThrows: true });

    const result = await refreshDerpAfterWrite({
      headscale,
      integration: target,
      changeKind: "config",
      reason: "add_derp_url",
    });

    expect(result.outcome).toBe("failed");
    expect(result.pendingRestart).toBe(true);
  });

  test("a Docker reload that answers ok: false is recorded as a failed refresh", async () => {
    const { target, onConfigChange } = makeTarget({ kind: "docker", reloadOk: false });

    const result = await refreshDerpAfterWrite({
      headscale,
      integration: target,
      changeKind: "config",
      reason: "add_derp_path",
    });

    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("failed");
    expect(result.pendingRestart).toBe(true);
    expect(getLastDerpRefresh()).toEqual(result);
  });

  test("the updater covers a map file without touching the integration", async () => {
    const { target, onConfigChange, restart } = makeTarget({ kind: "docker" });

    const result = await refreshDerpAfterWrite({
      headscale,
      integration: target,
      changeKind: "map-file",
      reason: "save_derp_map",
      autoUpdateEnabled: true,
    });

    expect(result.outcome).toBe("ticker");
    expect(result.pendingRestart).toBe(false);
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  test("a local write needs nothing at all", async () => {
    const { target, onConfigChange } = makeTarget();

    const result = await refreshDerpAfterWrite({
      headscale,
      integration: target,
      changeKind: "local",
      reason: "add_derp_region_name",
    });

    expect(result.outcome).toBe("not-needed");
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  test("no integration means a manual reload", async () => {
    const result = await refreshDerpAfterWrite({
      headscale,
      integration: undefined,
      changeKind: "config",
      reason: "save_derp_settings",
    });

    expect(result.outcome).toBe("manual");
    expect(result.pendingRestart).toBe(true);
  });
});

describe("toReloadState", () => {
  test("maps every outcome onto the mirror and sync reload states", () => {
    expect(toReloadState("triggered")).toBe("triggered");
    expect(toReloadState("failed")).toBe("failed");
    expect(toReloadState("manual")).toBe("manual");
    expect(toReloadState("not-needed")).toBe("not-needed");
    expect(toReloadState("ticker")).toBe("not-needed");
  });
});

describe("getLastDerpRefresh", () => {
  test("is empty until something refreshed and can be cleared", async () => {
    expect(getLastDerpRefresh()).toBeUndefined();
    clearLastDerpRefresh();
    expect(getLastDerpRefresh()).toBeUndefined();
  });
});
