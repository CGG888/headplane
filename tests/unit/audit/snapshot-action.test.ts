import { describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AUDIT_ACTIONS } from "~/server/audit/actions";
import {
  auditContext,
  authContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
} from "~/server/context";
import { SnapshotError } from "~/server/snapshots/types";

function mockFormData(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return formData;
}

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

interface SubmitOptions {
  allowed?: boolean;
  take?: () => Promise<unknown>;
  restore?: () => Promise<unknown>;
  record?: (input: unknown) => Promise<unknown>;
}

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

async function submit(entries: Record<string, string>, options: SubmitOptions = {}) {
  const { snapshotsAction } = await import("~/routes/settings/snapshots/actions");

  const take = vi.fn(options.take ?? (() => Promise.resolve({ id: "snap-1", files: [] })));
  const restore = vi.fn(
    options.restore ??
      (() => Promise.resolve({ snapshot: { id: "snap-1" }, restored: ["config.yaml"] })),
  );
  const record = vi.fn(options.record ?? (() => Promise.resolve(undefined)));
  const onConfigChange = vi.fn().mockResolvedValue(true);

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          require: () => Promise.resolve({ kind: "oidc", profile: { name: "Alice" } }),
          can: () => options.allowed ?? true,
        };
      }

      if (key === snapshotContext) {
        return { take, restore, list: () => Promise.resolve([]), root: () => "/tmp" };
      }

      if (key === auditContext) {
        return { record };
      }

      if (key === headscaleContext) {
        return { id: "headscale" };
      }

      if (key === integrationContext) {
        return { name: "proc", onConfigChange };
      }

      return undefined;
    },
  };

  let result: ActionResult;
  try {
    result = (await snapshotsAction({
      request: mockRequest(mockFormData(entries)),
      context,
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    result = thrown as ActionResult;
  }

  return { result, take, restore, record, onConfigChange };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

describe("snapshot action", () => {
  test("takes a manual snapshot and records it", async () => {
    const { result, take, record } = await submit({ action_id: "take_snapshot" });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(take).toHaveBeenCalledWith("manual");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "Alice",
        actorType: "user",
        action: AUDIT_ACTIONS.snapshotCreate,
        target: "snap-1",
        result: "success",
      }),
    );
  });

  test("reports a snapshot that could not be written", async () => {
    const { result, record } = await submit(
      { action_id: "take_snapshot" },
      { take: () => Promise.reject(new SnapshotError("unavailable", "no disk")) },
    );

    expect(statusOf(result)).toBe(500);
    expect((result.data as { errorCode: string }).errorCode).toBe("unavailable");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.snapshotCreate, result: "failure" }),
    );
  });

  test("restores a snapshot and reloads Headscale", async () => {
    const { result, restore, onConfigChange, record } = await submit({
      action_id: "restore_snapshot",
      snapshot_id: "snap-1",
    });

    expect(statusOf(result)).toBe(200);
    expect(restore).toHaveBeenCalledWith("snap-1");
    expect(onConfigChange).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.snapshotRestore,
        target: "snap-1",
        detail: "config.yaml",
        result: "success",
      }),
    );
  });

  test.for([
    ["notFound", 404, "notFound"],
    ["unexpectedPath", 400, "unexpectedPath"],
    ["noTargets", 400, "noTargets"],
  ] as const)("maps a %s restore failure onto status %i", async ([code, status, errorCode]) => {
    const { result, onConfigChange } = await submit(
      { action_id: "restore_snapshot", snapshot_id: "snap-1" },
      { restore: () => Promise.reject(new SnapshotError(code)) },
    );

    expect(statusOf(result)).toBe(status);
    expect((result.data as { errorCode: string }).errorCode).toBe(errorCode);
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  test("rejects a restore without a snapshot id", async () => {
    const { result, restore } = await submit({
      action_id: "restore_snapshot",
      snapshot_id: "  ",
    });

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("notFound");
    expect(restore).not.toHaveBeenCalled();
  });

  test.for([["unknown_action"], [""]])("rejects an unknown action (%s)", async ([action]) => {
    const { result, take, restore } = await submit({ action_id: action });

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("invalidAction");
    expect(take).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  test("refuses to touch snapshots without the IAM capability", async () => {
    const { result, take, restore } = await submit(
      { action_id: "take_snapshot" },
      { allowed: false },
    );

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.modifyIam",
    );
    expect(take).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});
