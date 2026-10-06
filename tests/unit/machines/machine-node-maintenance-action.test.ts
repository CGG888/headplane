import { data } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { MachineMaintenanceErrorCode } from "~/routes/machines/machine-actions";
import { AUDIT_ACTIONS } from "~/server/audit/actions";
import {
  auditContext,
  authContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";

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

function mockRequest(entries: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

/**
 * Runs the machines action with a mocked Headscale client and returns what the
 * dialog would read back, the calls it made and the audit entries it wrote.
 */
async function submit(
  entries: Record<string, string>,
  client: Record<string, unknown>,
  options: SubmitOptions = {},
) {
  const { machineAction } = await import("~/routes/machines/machine-actions");

  const refresh = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          can: () => options.allowed ?? true,
          canManageNode: () => true,
        };
      }
      if (key === requestApiContext) {
        return () =>
          Promise.resolve({
            principal: { kind: "api_key", apiKey: "hskey-api-0123456789abcdef", displayName: "CI" },
            api: { nodes: client },
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

function errorCodeOf(result: ActionResult): MachineMaintenanceErrorCode | undefined {
  return (result.data as { errorCode?: MachineMaintenanceErrorCode } | null)?.errorCode;
}

/** The error the real transport throws for a non-2xx Headscale response. */
function apiFailure(rawData: string, statusCode = 502) {
  return data(
    {
      requestUrl: "POST v1/node/backfillips",
      statusCode,
      rawData,
      data: JSON.parse(rawData) as Record<string, unknown>,
    },
    { status: 502 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backfill IPs action", () => {
  test("backfills, audits the nodes it fixed and refreshes the list", async () => {
    const backfillIps = vi.fn(async () => [
      'assigned IPv4 "100.64.0.1" to Node(3) "alpha"',
      'assigned IPv6 "fd7a::1" to Node(3) "alpha"',
      'assigned IPv4 "100.64.0.2" to Node(7) "beta"',
    ]);

    const { record, refresh, result } = await submit(
      { action_id: "backfill_ips" },
      { backfillIps },
    );

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({
      success: true,
      changes: [
        'assigned IPv4 "100.64.0.1" to Node(3) "alpha"',
        'assigned IPv6 "fd7a::1" to Node(3) "alpha"',
        'assigned IPv4 "100.64.0.2" to Node(7) "beta"',
      ],
    });
    expect(backfillIps).toHaveBeenCalledExactlyOnceWith();
    // A repair that rewrites addresses is worth recording: the entry names the
    // nodes it touched and keeps Headscale's own lines as the detail.
    expect(record).toHaveBeenCalledExactlyOnceWith({
      actor: "CI",
      actorType: "api_key",
      action: AUDIT_ACTIONS.nodeBackfillIps,
      target: "3, 7",
      detail:
        'assigned IPv4 "100.64.0.1" to Node(3) "alpha"; assigned IPv6 "fd7a::1" to Node(3) "alpha"; assigned IPv4 "100.64.0.2" to Node(7) "beta"',
      result: "success",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("reports a run that found nothing missing as a success", async () => {
    const backfillIps = vi.fn(async () => []);

    const { record, result } = await submit({ action_id: "backfill_ips" }, { backfillIps });

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, changes: [] });
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.nodeBackfillIps,
        detail: "nothing was missing",
        result: "success",
      }),
    );
  });

  test("records a failed run and surfaces the server's message", async () => {
    const backfillIps = vi.fn(async () => {
      throw apiFailure('{"message":"not confirmed, aborting"}');
    });

    const { record, refresh, result } = await submit(
      { action_id: "backfill_ips" },
      { backfillIps },
    );

    expect(statusOf(result)).toBe(502);
    expect(errorCodeOf(result)).toBe("failed");
    expect((result.data as { error?: string }).error).toBe("not confirmed, aborting");
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.nodeBackfillIps,
        result: "failure",
      }),
    );
    // A failed repair leaves the addresses as they were, so the list is not
    // re-read as if something had changed.
    expect(refresh).not.toHaveBeenCalled();
  });

  test("refuses without the write capability", async () => {
    const backfillIps = vi.fn(async () => []);

    const { record, refresh, result } = await submit(
      { action_id: "backfill_ips" },
      { backfillIps },
      { allowed: false },
    );

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.manageMachines",
    );
    expect(backfillIps).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("debug node action", () => {
  const CREATED = {
    givenName: "debug-1",
    id: "9",
    name: "debug-1",
    tags: [],
  };

  test("creates the node from exactly the fields that were filled in", async () => {
    const debug = vi.fn(async (_options: Record<string, unknown>) => CREATED);

    const { record, refresh, result } = await submit(
      {
        action_id: "debug_create_node",
        key: "hskey-authreq-abcdefghijklmnop",
        name: "debug-1",
        routes: "10.0.0.0/24,192.168.1.0/24",
        user: "alice",
      },
      { debug },
    );

    expect(statusOf(result)).toBe(200);
    expect(debug).toHaveBeenCalledExactlyOnceWith({
      key: "hskey-authreq-abcdefghijklmnop",
      name: "debug-1",
      routes: ["10.0.0.0/24", "192.168.1.0/24"],
      user: "alice",
    });
    // The dialog reports the created node's name and where to delete it, both
    // taken from the response.
    expect(result.data).toEqual({
      success: true,
      node: { href: "/machines", id: "9", name: "debug-1" },
    });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      actor: "CI",
      actorType: "api_key",
      action: AUDIT_ACTIONS.nodeDebugCreate,
      target: "debug-1",
      detail: "10.0.0.0/24, 192.168.1.0/24",
      result: "success",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("omits the fields the operator left empty", async () => {
    const debug = vi.fn(async (_options: Record<string, unknown>) => CREATED);

    const { result } = await submit(
      { action_id: "debug_create_node", name: "  ", user: "" },
      { debug },
    );

    expect(statusOf(result)).toBe(200);
    expect(debug.mock.calls[0]?.[0]).toEqual({});
  });

  test("refuses a route that is not a CIDR before calling Headscale", async () => {
    const debug = vi.fn(async (_options: Record<string, unknown>) => CREATED);

    const { record, result } = await submit(
      { action_id: "debug_create_node", routes: "10.0.0.0" },
      { debug },
    );

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidRoutes");
    expect(debug).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test("records a failure and surfaces the server's message", async () => {
    const debug = vi.fn(async (_options: Record<string, unknown>) => {
      throw apiFailure('{"message":"user not found"}');
    });

    const { record, refresh, result } = await submit(
      { action_id: "debug_create_node", name: "debug-1" },
      { debug },
    );

    expect(statusOf(result)).toBe(502);
    expect(errorCodeOf(result)).toBe("failed");
    expect((result.data as { error?: string }).error).toBe("user not found");
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.nodeDebugCreate,
        target: "debug-1",
        result: "failure",
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  test("refuses without the write capability", async () => {
    const debug = vi.fn(async (_options: Record<string, unknown>) => CREATED);

    const { record, result } = await submit(
      { action_id: "debug_create_node" },
      { debug },
      { allowed: false },
    );

    expect(statusOf(result)).toBe(403);
    expect(debug).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
