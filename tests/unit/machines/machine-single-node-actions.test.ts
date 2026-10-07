import { data } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { MachineActionErrorCode } from "~/routes/machines/machine-actions";
import {
  auditContext,
  authContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";

vi.mock("~/utils/log", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

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

function mockRequest(entries: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

const NODE = {
  id: "1",
  givenName: "alpha",
  user: { name: "alice" },
  tags: [],
  approvedRoutes: [],
  availableRoutes: ["10.0.0.0/8"],
  customRouting: {
    subnetApprovedRoutes: [],
    subnetWaitingRoutes: [],
    exitRoutes: [],
    exitApproved: false,
  },
};

/**
 * Runs a single-node machine action and returns what its dialog would read
 * back. Every Headscale failure must arrive as data: a thrown `data()` would be
 * caught by the route's ErrorBoundary and replace the whole machines page.
 */
async function submit(entries: Record<string, string>, client: Record<string, unknown>) {
  const { machineAction } = await import("~/routes/machines/machine-actions");

  const refresh = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return { can: () => true, canManageNode: () => true };
      }
      if (key === requestApiContext) {
        return () =>
          Promise.resolve({
            principal: { kind: "api_key", apiKey: "hskey-api-0123456789abcdef", displayName: "CI" },
            api: { nodes: { get: async () => NODE, ...client } },
          });
      }
      if (key === headscaleLiveStoreContext) {
        return { refresh };
      }
      if (key === auditContext) {
        return { record };
      }
      return undefined;
    },
  };

  let result: ActionResult;
  try {
    result = normalizeResult(
      await machineAction({
        request: mockRequest(entries),
        context,
        params: {},
      } as never),
    );
  } catch (thrown) {
    result = normalizeResult(thrown);
  }

  return { record, refresh, result };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

function errorCodeOf(result: ActionResult): MachineActionErrorCode | undefined {
  return (result.data as { errorCode?: MachineActionErrorCode } | null)?.errorCode;
}

/** The error the real transport throws for a non-2xx Headscale response. */
function apiFailure(message: string, statusCode = 502) {
  return data(
    {
      requestUrl: "POST v1/node/1/rename",
      statusCode,
      detail: JSON.stringify({ message }),
      data: { message },
    },
    { status: 502 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("single-node machine actions", () => {
  test("rename reports a refused call as data instead of throwing", async () => {
    const rename = vi.fn(async () => {
      throw apiFailure("node already exists");
    });

    const { refresh, result } = await submit(
      { action_id: "rename", node_id: "1", name: "beta" },
      { rename },
    );

    expect(statusOf(result)).toBe(502);
    expect(result.data).toEqual({
      success: false,
      errorCode: "failed",
      error: "node already exists",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("rename keeps the success shape the dialog closes on", async () => {
    const rename = vi.fn(async () => undefined);

    const { refresh, result } = await submit(
      { action_id: "rename", node_id: "1", name: "beta" },
      { rename },
    );

    expect(rename).toHaveBeenCalledWith("1", "beta");
    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, message: "Machine renamed" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("delete returns data rather than redirecting when Headscale refuses", async () => {
    const remove = vi.fn(async () => {
      throw apiFailure("node is online", 500);
    });

    const { result } = await submit({ action_id: "delete", node_id: "1" }, { delete: remove });

    expect(statusOf(result)).toBe(502);
    expect(errorCodeOf(result)).toBe("failed");
    expect(result.data).toMatchObject({ success: false, error: "node is online" });
  });

  test("expire reports a refused call as data", async () => {
    const expire = vi.fn(async () => {
      throw apiFailure("expiry is not supported");
    });

    const { result } = await submit({ action_id: "expire", node_id: "1" }, { expire });

    expect(statusOf(result)).toBe(502);
    expect(result.data).toEqual({
      success: false,
      errorCode: "failed",
      error: "expiry is not supported",
    });
  });

  test("update_routes reports a refused approval as data", async () => {
    const approveRoutes = vi.fn(async () => {
      throw apiFailure("route not enabled");
    });

    const { result } = await submit(
      { action_id: "update_routes", node_id: "1", routes: "10.0.0.0/8", enabled: "true" },
      { approveRoutes },
    );

    expect(approveRoutes).toHaveBeenCalledWith("1", ["10.0.0.0/8"]);
    expect(statusOf(result)).toBe(502);
    expect(result.data).toEqual({
      success: false,
      errorCode: "failed",
      error: "route not enabled",
    });
  });

  test("update_routes still rejects a route the machine never advertised", async () => {
    const approveRoutes = vi.fn(async () => undefined);

    const { result } = await submit(
      { action_id: "update_routes", node_id: "1", routes: "192.168.0.0/24", enabled: "true" },
      { approveRoutes },
    );

    expect(statusOf(result)).toBe(400);
    expect(approveRoutes).not.toHaveBeenCalled();
  });

  test("reassign reports a refused call as data", async () => {
    const reassignUser = vi.fn(async () => {
      throw apiFailure("unknown user");
    });

    const { result } = await submit(
      { action_id: "reassign", node_id: "1", user_name: "bob" },
      { reassignUser },
    );

    expect(reassignUser).toHaveBeenCalledWith("1", "bob");
    expect(statusOf(result)).toBe(502);
    expect(result.data).toEqual({ success: false, errorCode: "failed", error: "unknown user" });
  });

  test("update_tags keeps the policy code when Headscale gives no message", async () => {
    const setTags = vi.fn(async () => {
      throw data(
        { requestUrl: "POST v1/node/1/tags", statusCode: 400, detail: "", data: {} },
        { status: 502 },
      );
    });

    const { result } = await submit(
      { action_id: "update_tags", node_id: "1", tags: "tag:web" },
      { setTags },
    );

    expect(statusOf(result)).toBe(400);
    expect(result.data).toEqual({ success: false, errorCode: "tagsNotInPolicy" });
  });

  test("set_expiry keeps its own validation codes", async () => {
    const setExpiry = vi.fn(async () => undefined);
    const past = new Date(Date.now() - 60_000).toISOString();

    const { result } = await submit(
      { action_id: "set_expiry", node_id: "1", expiry_mode: "custom", expiry: past },
      { setExpiry },
    );

    expect(statusOf(result)).toBe(400);
    expect(result.data).toEqual({ success: false, errorCode: "expiryInPast" });
    expect(setExpiry).not.toHaveBeenCalled();
  });

  test("a Headscale outage while reading the node stays in the dialog", async () => {
    const { result } = await submit(
      { action_id: "rename", node_id: "1", name: "beta" },
      {
        get: async () => {
          throw apiFailure("headscale is down");
        },
      },
    );

    expect(statusOf(result)).toBe(502);
    expect(result.data).toEqual({
      success: false,
      errorCode: "failed",
      error: "headscale is down",
    });
  });

  test("rename lowercases the name before validating and sending it", async () => {
    const rename = vi.fn(async () => undefined);

    const { refresh, result } = await submit(
      { action_id: "rename", node_id: "1", name: "Beta-Node" },
      { rename },
    );

    // The action validates the lowercased DNS label, so that is what Headscale
    // must receive rather than the raw casing from the dialog.
    expect(rename).toHaveBeenCalledWith("1", "beta-node");
    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, message: "Machine renamed" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("rename rejects a name that is not a DNS label after lowercasing", async () => {
    const rename = vi.fn(async () => undefined);

    const { result } = await submit(
      { action_id: "rename", node_id: "1", name: "Beta_Node" },
      { rename },
    );

    expect(statusOf(result)).toBe(400);
    expect(rename).not.toHaveBeenCalled();
  });

  test("toggle_expiry reports the disabled direction with its own message", async () => {
    const toggleExpiry = vi.fn(async () => undefined);

    const { refresh, result } = await submit(
      { action_id: "toggle_expiry", node_id: "1", disableExpiry: "true" },
      { toggleExpiry },
    );

    expect(toggleExpiry).toHaveBeenCalledWith("1", true);
    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({
      success: true,
      message: "Key expiry disabled",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("toggle_expiry reports the restored direction with its own message", async () => {
    const toggleExpiry = vi.fn(async () => undefined);

    const { result } = await submit(
      { action_id: "toggle_expiry", node_id: "1", disableExpiry: "false" },
      { toggleExpiry },
    );

    expect(toggleExpiry).toHaveBeenCalledWith("1", false);
    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({
      success: true,
      message: "Key expiry restored",
    });
  });

  // Values the browser could send that must not silently mean "restore".
  const invalidDisableExpiryCases: Array<[string, Record<string, string>]> = [
    ["a missing field", {}],
    ["an empty value", { disableExpiry: "" }],
    ["a differently cased boolean", { disableExpiry: "TRUE" }],
    ["a non-boolean value", { disableExpiry: "yes" }],
  ];

  test.for(invalidDisableExpiryCases)(
    "toggle_expiry rejects %s instead of restoring the default",
    async ([, entries]) => {
      const toggleExpiry = vi.fn(async () => undefined);

      const { result } = await submit(
        { action_id: "toggle_expiry", node_id: "1", ...entries },
        { toggleExpiry },
      );

      expect(statusOf(result)).toBe(400);
      expect(toggleExpiry).not.toHaveBeenCalled();
    },
  );
});
