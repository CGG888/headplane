import { beforeEach, describe, expect, test, vi } from "vitest";

import { authContext, headscaleLiveStoreContext, requestApiContext } from "~/server/context";
import log from "~/utils/log";

// Mock the log module to avoid console spam during tests
vi.mock("~/utils/log", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface SubmitOptions {
  /** Result of `auth.can(principal, Capabilities.write_machines)`. */
  allowed?: boolean;
  /** Whether the Headscale client exposes the optional `reassignUser`. */
  reassignSupported?: boolean;
  /** Nodes whose API call should reject, to exercise partial failures. */
  failFor?: (id: string) => boolean;
}

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

/**
 * Actions reject with data() payloads and resolve with either data() payloads
 * or plain objects, so normalize both into the same shape.
 */
function normalizeResult(returned: unknown): ActionResult {
  if (
    returned !== null &&
    typeof returned === "object" &&
    "data" in returned &&
    "init" in returned
  ) {
    return returned as ActionResult;
  }

  return { data: returned };
}

function mockFormData(entries: Record<string, string>, nodeIds: string[]): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  for (const id of nodeIds) {
    formData.append("node_ids", id);
  }

  return formData;
}

function mockRequest(formData: FormData): Request {
  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

async function submit(
  entries: Record<string, string>,
  nodeIds: string[],
  options: SubmitOptions = {},
) {
  const { machineAction } = await import("~/routes/machines/machine-actions");

  const fail = (id: string) => {
    if (options.failFor?.(id)) {
      throw new Error(`node ${id} failed`);
    }
  };

  const setTags = vi.fn(async (id: string, _tags: string[]) => fail(id));
  const toggleExpiry = vi.fn(async (id: string, _disableExpiry: boolean) => fail(id));
  const setExpiry = vi.fn(async (id: string, _expiry: Date) => fail(id));
  const deleteNode = vi.fn(async (id: string) => fail(id));
  const reassignUser = vi.fn(async (id: string, _user: string) => fail(id));
  const refresh = vi.fn(async () => undefined);

  const api = {
    nodes: {
      setTags,
      toggleExpiry,
      setExpiry,
      delete: deleteNode,
      ...(options.reassignSupported === false ? {} : { reassignUser }),
    },
  };

  // React Router resolves context values through context.get(contextKey), so
  // the mock answers whichever key the action asks for.
  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          can: () => options.allowed ?? true,
          canManageNode: () => true,
        };
      }
      if (key === requestApiContext) {
        return () => Promise.resolve({ principal: { kind: "api_key" }, api });
      }
      if (key === headscaleLiveStoreContext) {
        return { refresh };
      }
      return undefined;
    },
  };

  let result: ActionResult;
  try {
    result = normalizeResult(
      await machineAction({
        request: mockRequest(mockFormData(entries, nodeIds)),
        context,
        params: {},
      } as never),
    );
  } catch (thrown) {
    // Rejections come back as thrown data() payloads, carrying the same shape.
    result = normalizeResult(thrown);
  }

  return { result, setTags, toggleExpiry, setExpiry, deleteNode, reassignUser, refresh };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

function errorCodeOf(result: ActionResult): string | undefined {
  return (result.data as { errorCode?: string } | null)?.errorCode;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bulk machine actions", () => {
  test("applies one tag set to every selected machine", async () => {
    const { result, setTags, refresh } = await submit(
      { action_id: "bulk_set_tags", tags: "tag:web, tag:prod" },
      ["1", "2", "3"],
    );

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, updated: 3, failed: 0, failures: [] });
    expect(setTags).toHaveBeenCalledTimes(3);
    expect(setTags).toHaveBeenNthCalledWith(1, "1", ["tag:web", "tag:prod"]);
    expect(setTags).toHaveBeenNthCalledWith(3, "3", ["tag:web", "tag:prod"]);
    // One refresh covers the whole run.
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("clears tags when the submitted tag list is empty", async () => {
    const { result, setTags } = await submit({ action_id: "bulk_set_tags", tags: "" }, ["1", "2"]);

    expect(statusOf(result)).toBe(200);
    expect(setTags).toHaveBeenNthCalledWith(1, "1", []);
    expect(setTags).toHaveBeenNthCalledWith(2, "2", []);
  });

  test("rejects a missing tag list", async () => {
    const { result, setTags } = await submit({ action_id: "bulk_set_tags" }, ["1"]);

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("missingTags");
    expect(setTags).not.toHaveBeenCalled();
  });

  test("counts per-machine failures without aborting the run", async () => {
    const { result, setTags, refresh } = await submit(
      { action_id: "bulk_set_tags", tags: "tag:web" },
      ["1", "2", "3"],
      { failFor: (id) => id === "2" },
    );

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({
      success: true,
      updated: 2,
      failed: 1,
      // The failing machine's reason reaches the dialog, not just the count.
      failures: [{ id: "2", reason: "node 2 failed" }],
    });
    // The machine after the failing one is still attempted.
    expect(setTags).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("deduplicates repeated machine ids", async () => {
    const { result, setTags } = await submit({ action_id: "bulk_set_tags", tags: "tag:web" }, [
      "1",
      "1",
      "2",
    ]);

    expect(result.data).toEqual({ success: true, updated: 2, failed: 0, failures: [] });
    expect(setTags).toHaveBeenCalledTimes(2);
  });

  test("rejects an empty selection", async () => {
    const { result, setTags, refresh } = await submit(
      { action_id: "bulk_set_tags", tags: "tag:web" },
      [],
    );

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("noMachinesSelected");
    expect(setTags).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("rejects a selection above the bulk cap", async () => {
    const { MAX_BULK_NODES } = await import("~/routes/machines/machine-actions");
    const ids = Array.from({ length: MAX_BULK_NODES + 1 }, (_, index) => String(index + 1));

    const { result, deleteNode } = await submit({ action_id: "bulk_delete" }, ids);

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("tooManyMachines");
    expect(deleteNode).not.toHaveBeenCalled();
  });

  test("disables key expiry on every selected machine", async () => {
    const { result, toggleExpiry, refresh } = await submit(
      { action_id: "bulk_set_expiry", expiry_mode: "never" },
      ["7", "8"],
    );

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, updated: 2, failed: 0, failures: [] });
    expect(toggleExpiry).toHaveBeenNthCalledWith(1, "7", true);
    expect(toggleExpiry).toHaveBeenNthCalledWith(2, "8", true);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("restores the default expiry on every selected machine", async () => {
    const { result, toggleExpiry } = await submit(
      { action_id: "bulk_set_expiry", expiry_mode: "default" },
      ["7"],
    );

    expect(statusOf(result)).toBe(200);
    expect(toggleExpiry).toHaveBeenCalledWith("7", false);
  });

  test("pins an explicit expiry timestamp", async () => {
    const expiry = new Date(Date.now() + 86_400_000).toISOString();

    const { result, setExpiry } = await submit(
      { action_id: "bulk_set_expiry", expiry_mode: "custom", expiry },
      ["7", "8"],
      { failFor: (id) => id === "8" },
    );

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({
      success: true,
      updated: 1,
      failed: 1,
      failures: [{ id: "8", reason: "node 8 failed" }],
    });
    expect(setExpiry).toHaveBeenCalledTimes(2);
    expect((setExpiry.mock.calls[0][1] as Date).toISOString()).toBe(expiry);
  });

  // Values the browser would happily send but the action cannot use.
  const invalidExpiryCases: Array<[string, Record<string, string>, string]> = [
    ["an unparseable date", { expiry_mode: "custom", expiry: "not-a-date" }, "invalidExpiry"],
    ["a past date", { expiry_mode: "custom", expiry: "2000-01-01T00:00:00.000Z" }, "expiryInPast"],
    ["no mode", {}, "invalidExpiry"],
    ["an unknown mode", { expiry_mode: "someday" }, "invalidExpiry"],
  ];

  test.for(invalidExpiryCases)(
    "rejects %s before touching the API",
    async ([, entries, expected]) => {
      const { result, setExpiry, toggleExpiry, refresh } = await submit(
        { action_id: "bulk_set_expiry", ...entries },
        ["7"],
      );

      expect(statusOf(result)).toBe(400);
      expect(errorCodeOf(result)).toBe(expected);
      expect(setExpiry).not.toHaveBeenCalled();
      expect(toggleExpiry).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("reassigns every selected machine", async () => {
    const { result, reassignUser, refresh } = await submit(
      { action_id: "bulk_reassign", user_name: "alice" },
      ["1", "2"],
    );

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, updated: 2, failed: 0, failures: [] });
    // Headscale's move endpoint resolves the owner by *username*; the numeric
    // Headscale user id it used to receive was rejected with a 4xx.
    expect(reassignUser).toHaveBeenNthCalledWith(1, "1", "alice");
    expect(reassignUser).toHaveBeenNthCalledWith(2, "2", "alice");
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("rejects a reassignment without a user", async () => {
    const { result, reassignUser } = await submit({ action_id: "bulk_reassign" }, ["1"]);

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("missingUserId");
    expect(reassignUser).not.toHaveBeenCalled();
  });

  test("reports when headscale cannot change owners", async () => {
    const { result, refresh } = await submit(
      { action_id: "bulk_reassign", user_name: "alice" },
      ["1"],
      { reassignSupported: false },
    );

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("ownerUnsupported");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("deletes every selected machine", async () => {
    const { result, deleteNode, refresh } = await submit({ action_id: "bulk_delete" }, [
      "1",
      "2",
      "3",
    ]);

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, updated: 3, failed: 0, failures: [] });
    expect(deleteNode.mock.calls.map((call) => call[0])).toEqual(["1", "2", "3"]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("keeps deleting after one machine fails", async () => {
    const { result, deleteNode } = await submit({ action_id: "bulk_delete" }, ["1", "2", "3"], {
      failFor: (id) => id === "1",
    });

    expect(result.data).toEqual({
      success: true,
      updated: 2,
      failed: 1,
      failures: [{ id: "1", reason: "node 1 failed" }],
    });
    expect(deleteNode).toHaveBeenCalledTimes(3);
  });

  test("refuses bulk actions without the write capability", async () => {
    const { result, deleteNode, refresh } = await submit({ action_id: "bulk_delete" }, ["1"], {
      allowed: false,
    });

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.manageMachines",
    );
    expect(deleteNode).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("reports why each failed machine failed, in selection order", async () => {
    const { result } = await submit({ action_id: "bulk_delete" }, ["1", "2", "3"], {
      failFor: (id) => id !== "2",
    });

    expect(result.data).toEqual({
      success: true,
      updated: 1,
      failed: 2,
      failures: [
        { id: "1", reason: "node 1 failed" },
        { id: "3", reason: "node 3 failed" },
      ],
    });
  });

  test("logs every bulk failure with the node id and the reason", async () => {
    const { result } = await submit({ action_id: "bulk_set_tags", tags: "tag:web" }, ["4"], {
      failFor: () => true,
    });

    expect(result.data).toMatchObject({ failed: 1 });
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      "api",
      "Bulk machine action %s failed for node %s: %s",
      "bulk_set_tags",
      "4",
      "node 4 failed",
    );
  });
});
