import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  appConfigContext,
  auditContext,
  authContext,
  derpMirrorContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
} from "~/server/context";
import {
  ensureMirrorPathInDerpPaths,
  isMirrorPathListed,
  type MirrorPathConfigPort,
} from "~/server/derp-mirror/paths";

function mockFormData(entries: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        formData.append(key, entry);
      }
      continue;
    }

    formData.set(key, value);
  }
  return formData;
}

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

/** A configuration port whose patches and write permission a test controls. */
function configPort(options: {
  paths: string[];
  writable?: boolean;
  patch?: (patches: unknown) => Promise<void>;
}): MirrorPathConfigPort {
  const apply = async (patches: Array<{ path: string; value: unknown }>) => {
    await (options.patch ?? (async () => undefined))(patches);
  };

  return {
    getDERPSettings: () => ({ paths: options.paths }),
    writable: () => options.writable ?? true,
    patch: apply,
    // The real port rebuilds the patch inside the write queue; this mock holds a
    // fixed `paths` array, so running the builder once is equivalent.
    mutate: (build) => apply(build()),
  };
}

describe("the mirror's file in derp.paths", () => {
  test("matches the trailing-slash and dot-segment spellings of one file", () => {
    expect(isMirrorPathListed(["/maps/mirror.yaml"], "/maps/mirror.yaml")).toBe(true);
    expect(isMirrorPathListed(["/maps/mirror.yaml/"], "/maps/mirror.yaml")).toBe(true);
    expect(isMirrorPathListed(["/maps/./mirror.yaml"], "/maps/mirror.yaml")).toBe(true);
    expect(isMirrorPathListed(["/maps/other.yaml"], "/maps/mirror.yaml")).toBe(false);
    expect(isMirrorPathListed([], "/maps/mirror.yaml")).toBe(false);
    // Blank entries are ignored rather than treated as the working directory.
    expect(isMirrorPathListed(["   "], "/maps/mirror.yaml")).toBe(false);
  });

  test("resolves a relative entry against Headscale's own config directory", () => {
    expect(
      isMirrorPathListed(["mirror.yaml"], "/etc/headscale/mirror.yaml", "/etc/headscale"),
    ).toBe(true);
    expect(isMirrorPathListed(["mirror.yaml"], "/etc/headscale/mirror.yaml")).toBe(false);
  });

  test("appends exactly the missing path and leaves every other entry alone", async () => {
    const patch = vi.fn(async () => undefined);
    const beforeWrite = vi.fn(async () => undefined);

    const outcome = await ensureMirrorPathInDerpPaths({
      config: configPort({ paths: ["/maps/first.yaml", "/maps/second.yaml"], patch }),
      targetPath: "/maps/official-mirror.yaml",
      beforeWrite,
    });

    expect(outcome).toEqual({
      status: "added",
      path: "/maps/official-mirror.yaml",
      fileExists: false,
    });
    expect(patch).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledWith([
      {
        path: "derp.paths",
        value: ["/maps/first.yaml", "/maps/second.yaml", "/maps/official-mirror.yaml"],
      },
    ]);
    // The snapshot hook runs once, and only when something is about to change.
    expect(beforeWrite).toHaveBeenCalledTimes(1);
  });

  test("is idempotent: a listed path is never appended twice", async () => {
    const patch = vi.fn(async () => undefined);
    const beforeWrite = vi.fn(async () => undefined);

    const outcome = await ensureMirrorPathInDerpPaths({
      config: configPort({ paths: ["/maps/official-mirror.yaml/"], patch }),
      targetPath: "/maps/official-mirror.yaml",
      beforeWrite,
    });

    expect(outcome).toEqual({ status: "present", path: "/maps/official-mirror.yaml" });
    expect(patch).not.toHaveBeenCalled();
    expect(beforeWrite).not.toHaveBeenCalled();
  });

  test("reports a read-only configuration as a skip instead of failing", async () => {
    const patch = vi.fn(async () => undefined);

    const outcome = await ensureMirrorPathInDerpPaths({
      config: configPort({ paths: [], writable: false, patch }),
      targetPath: "/maps/official-mirror.yaml",
    });

    expect(outcome).toEqual({
      status: "skipped",
      path: "/maps/official-mirror.yaml",
      reason: "read-only",
    });
    expect(patch).not.toHaveBeenCalled();
  });

  test("fails soft when the patch itself is refused", async () => {
    const outcome = await ensureMirrorPathInDerpPaths({
      config: configPort({
        paths: [],
        patch: async () => {
          throw new Error("read-only filesystem");
        },
      }),
      targetPath: "/maps/official-mirror.yaml",
    });

    expect(outcome).toEqual({
      status: "skipped",
      path: "/maps/official-mirror.yaml",
      reason: "write-failed",
    });
  });

  test("reports whether the target is already on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "headplane-mirror-path-"));
    try {
      const target = join(dir, "official-mirror.yaml");
      await writeFile(target, "regions: {}\n", "utf8");

      const outcome = await ensureMirrorPathInDerpPaths({
        config: configPort({ paths: [] }),
        targetPath: target,
      });

      expect(outcome).toEqual({ status: "added", path: target, fileExists: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips a target that names nothing usable", async () => {
    const patch = vi.fn(async () => undefined);

    const outcome = await ensureMirrorPathInDerpPaths({
      config: configPort({ paths: [], patch }),
      targetPath: "   ",
    });

    expect(outcome).toEqual({ status: "skipped", path: "", reason: "invalid-target" });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("the region filter action keeps derp.paths loaded", () => {
  let dir: string;
  let target: string;

  interface SubmitOptions {
    writable?: boolean;
    paths?: string[];
    mirror?: unknown;
    snapshots?: { take: (reason: string) => Promise<unknown> } | undefined;
    audit?: { record: (input: Record<string, unknown>) => Promise<unknown> } | undefined;
    patchFails?: boolean;
    /** A configuration surface that cannot answer for `derp.paths` at all. */
    noDerpSettings?: boolean;
  }

  interface ActionResult {
    data: unknown;
    init?: { status?: number } | null;
  }

  const onConfigChange = vi.fn().mockResolvedValue({ ok: true, stage: "healthy" });

  function createMockContext(
    options: SubmitOptions,
    patch: (patches: Array<{ path: string; value: unknown }>) => Promise<void>,
  ) {
    return {
      get: (context: unknown) => {
        if (context === authContext) {
          return {
            require: () =>
              Promise.resolve({
                kind: "oidc",
                sessionId: "session-1",
                user: { id: "1", subject: "tester", role: "admin", headscaleUserId: undefined },
                profile: { name: "Tester", email: "tester@example.com" },
              }),
            can: () => true,
          };
        }

        if (context === snapshotContext) {
          return options.snapshots;
        }

        if (context === auditContext) {
          return options.audit;
        }

        if (context === headscaleConfigContext) {
          return {
            writable: () => options.writable ?? true,
            patch,
            // The real port rebuilds the patch inside the write queue; this
            // context is single-threaded, so building then patching is enough.
            mutate: (build: () => Array<{ path: string; value: unknown }>) => patch(build()),
            ...(options.noDerpSettings
              ? {}
              : { getDERPSettings: () => ({ paths: options.paths ?? [] }) }),
          };
        }

        if (context === headscaleContext) {
          return { config: {} };
        }

        if (context === integrationContext) {
          return { onConfigChange };
        }

        if (context === appConfigContext) {
          return {
            server: { data_path: dir },
            headscale: { config_path: "/etc/headscale/config.yaml" },
          };
        }

        if (context === derpMirrorContext) {
          return options.mirror;
        }

        return undefined;
      },
    };
  }

  async function submit(entries: Record<string, string | string[]>, options: SubmitOptions = {}) {
    const { headscaleSettingsAction } = await import("~/routes/settings/headscale/actions");

    const patch = options.patchFails
      ? vi.fn(async () => {
          throw new Error("read-only filesystem");
        })
      : vi.fn(async () => undefined);
    onConfigChange.mockClear();

    let result: ActionResult;
    try {
      result = (await headscaleSettingsAction({
        request: mockRequest(mockFormData(entries)),
        context: createMockContext(options, patch),
        params: {},
      } as never)) as ActionResult;
    } catch (thrown) {
      result = thrown as ActionResult;
    }

    return { result, patch };
  }

  /** The mirror service as the action sees it; every method is a stub. */
  function mirrorStub(settings: Record<string, unknown> = {}) {
    const resolved = {
      enabled: true,
      autoReload: true,
      targetPath: target,
      officialRegionIds: ["20"],
      intervalHours: 24,
      assignment: {},
      ...settings,
    };

    return {
      update: vi.fn(async (patch: Record<string, unknown>) => ({
        success: true,
        settings: { ...resolved, ...patch },
      })),
      settings: vi.fn(() => resolved),
      runNow: vi.fn(async () => ({ outcome: "changed", reload: "not-needed" })),
      reassign: vi.fn(async () => ({ outcome: "changed", reload: "not-needed" })),
      check: vi.fn(async () => ({ outcome: "changed" })),
    };
  }

  function pathReportOf(result: ActionResult): Record<string, unknown> | undefined {
    return (result.data as { mirrorPath?: Record<string, unknown> } | undefined)?.mirrorPath;
  }

  const SAVE_FIELDS = (extra: Record<string, string> = {}) => ({
    action_id: "save_derp_mirror",
    mirror_enabled: "true",
    mirror_auto_reload: "false",
    mirror_interval_hours: "24",
    mirror_path: target,
    mirror_region: "20",
    ...extra,
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-mirror-path-action-"));
    target = join(dir, "official-mirror.yaml");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** The audit sink, typed so its recorded calls can be inspected. */
  function auditStub() {
    return { record: vi.fn(async (_input: Record<string, unknown>) => undefined) };
  }

  test("saving an enabled filter adds the missing path, once", async () => {
    // The map file exists already: the entry is what was missing.
    await writeFile(target, "regions: {}\n", "utf8");

    const snapshot = { take: vi.fn(async () => ({ id: "snap-1" })) };
    const audit = auditStub();
    const mirror = mirrorStub();

    const { result, patch } = await submit(SAVE_FIELDS({ mirror_auto_reload: "false" }), {
      paths: ["/maps/first.yaml"],
      mirror,
      snapshots: snapshot,
      audit,
    });

    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledWith([
      { path: "derp.paths", value: ["/maps/first.yaml", target] },
    ]);
    expect(snapshot.take).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: "derp.region_mirror",
      target,
      result: "success",
    });
    expect(pathReportOf(result)).toMatchObject({ status: "added", path: target });
    // The auto-reload switch was off, so the card is told a reload is needed.
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(pathReportOf(result)?.reload).toBe("manual");
  });

  test("saving again changes nothing: no patch, no snapshot, no audit", async () => {
    const snapshot = { take: vi.fn(async () => ({ id: "snap-1" })) };
    const audit = auditStub();

    const { result, patch } = await submit(SAVE_FIELDS(), {
      // The same file, spelled with a trailing slash.
      paths: [`${target}/`],
      mirror: mirrorStub(),
      snapshots: snapshot,
      audit,
    });

    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).not.toHaveBeenCalled();
    expect(snapshot.take).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(pathReportOf(result)).toMatchObject({ status: "present", path: target });
  });

  test("the auto-reload switch is followed when the target file exists", async () => {
    await writeFile(target, "regions: {}\n", "utf8");

    const { result } = await submit(SAVE_FIELDS({ mirror_auto_reload: "true" }), {
      paths: [],
      mirror: mirrorStub({ autoReload: true }),
    });

    expect(pathReportOf(result)).toMatchObject({
      status: "added",
      fileExists: true,
      reload: "triggered",
    });
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  test("a path that is not there yet is never reloaded into", async () => {
    const { result } = await submit(SAVE_FIELDS({ mirror_auto_reload: "true" }), {
      paths: [],
      mirror: mirrorStub({ autoReload: true }),
    });

    expect(pathReportOf(result)).toMatchObject({ status: "added", fileExists: false });
    expect(pathReportOf(result)?.reload).toBeUndefined();
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  test("disabling the filter never removes the path", async () => {
    const mirror = mirrorStub({ enabled: false });

    const { result, patch } = await submit(SAVE_FIELDS({ mirror_enabled: "false" }), {
      paths: [target],
      mirror,
    });

    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).not.toHaveBeenCalled();
    expect(pathReportOf(result)).toBeUndefined();
  });

  test("a read-only configuration saves the filter and records the skip", async () => {
    const audit = auditStub();
    const snapshot = { take: vi.fn(async () => ({ id: "snap-1" })) };
    const mirror = mirrorStub();

    const { result, patch } = await submit(SAVE_FIELDS(), {
      writable: false,
      paths: [],
      mirror,
      snapshots: snapshot,
      audit,
    });

    // The mirror's own settings live outside Headscale's configuration, so the
    // save still succeeds; only the automatic `derp.paths` step is skipped.
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(mirror.update).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
    expect(snapshot.take).not.toHaveBeenCalled();
    expect(pathReportOf(result)).toMatchObject({ status: "skipped", reason: "read-only" });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: "derp.region_mirror",
      result: "failure",
    });
    const recorded = audit.record.mock.calls[0]?.[0] as { detail?: string } | undefined;
    expect(recorded?.detail).toContain("not added (read-only)");
  });

  test("a failing configuration write is reported, not thrown", async () => {
    const { result, patch } = await submit(SAVE_FIELDS(), {
      paths: [],
      patchFails: true,
      mirror: mirrorStub(),
    });

    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(pathReportOf(result)).toMatchObject({ status: "skipped", reason: "write-failed" });
  });

  test("re-running the filter also makes sure the path is listed", async () => {
    const mirror = mirrorStub({ autoReload: false });

    const { result, patch } = await submit(
      { action_id: "run_derp_mirror" },
      {
        paths: ["/maps/first.yaml"],
        mirror,
      },
    );

    expect(mirror.runNow).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledWith([
      { path: "derp.paths", value: ["/maps/first.yaml", target] },
    ]);
    expect(pathReportOf(result)).toMatchObject({ status: "added", path: target });
  });

  test("renumbering does the same, and a check writes nothing", async () => {
    const mirror = mirrorStub({ autoReload: false });

    const reassign = await submit({ action_id: "reassign_derp_mirror" }, { paths: [], mirror });
    expect(reassign.patch).toHaveBeenCalledTimes(1);

    const check = await submit({ action_id: "check_derp_mirror" }, { paths: [], mirror });
    expect(mirror.check).toHaveBeenCalledTimes(1);
    // The check's own entry is the only patch so far; a check adds none.
    expect(check.patch).not.toHaveBeenCalled();
    expect(pathReportOf(check.result)).toBeUndefined();
  });

  test("a configuration that cannot answer for derp.paths still saves the filter", async () => {
    const { result, patch } = await submit(SAVE_FIELDS(), {
      noDerpSettings: true,
      mirror: mirrorStub(),
    });

    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).not.toHaveBeenCalled();
    expect(pathReportOf(result)).toMatchObject({ status: "skipped", reason: "write-failed" });
  });

  test("a run whose service answers without settings is still reported", async () => {
    // The run already happened; nothing about reading the settings afterwards
    // may turn its result into an error.
    const bare = { runNow: vi.fn(async () => ({ outcome: "unchanged" })) };

    const { result, patch } = await submit({ action_id: "run_derp_mirror" }, { mirror: bare });

    expect((result.data as { success: boolean }).success).toBe(true);
    expect((result.data as { mirror?: unknown }).mirror).toEqual({ outcome: "unchanged" });
    expect(patch).not.toHaveBeenCalled();
    expect(pathReportOf(result)).toBeUndefined();
  });
});
