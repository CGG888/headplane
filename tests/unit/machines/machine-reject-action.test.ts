import { beforeEach, describe, expect, test, vi } from "vitest";

import type { MachineRejectErrorCode } from "~/routes/machines/machine-actions";
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

/** A registration URL and the auth ID it normalizes to. */
const REGISTER_URL = "https://headscale.example.com/register/hskey-authreq-abcdefghijklmnop";
const AUTH_ID = "hskey-authreq-abcdefghijklmnop";

interface SubmitOptions {
  /** Result of `auth.can(principal, Capabilities.write_machines)`. */
  allowed?: boolean;
  /** Whether the Headscale client exposes the optional `auth.reject`. */
  rejectSupported?: boolean;
  /** Make the client's rejection fail. */
  fail?: boolean;
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

async function submit(entries: Record<string, string>, options: SubmitOptions = {}) {
  const { machineAction } = await import("~/routes/machines/machine-actions");

  const reject = vi.fn(async (_authId: string) => {
    if (options.fail) {
      throw new Error("headscale said no");
    }
  });
  const refresh = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);

  const api = {
    auth: options.rejectSupported === false ? {} : { reject },
    nodes: {},
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
        return () =>
          Promise.resolve({
            principal: { kind: "api_key", apiKey: "hskey-api-0123456789abcdef", displayName: "CI" },
            api,
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
    // Rejections come back as thrown data() payloads, carrying the same shape.
    result = normalizeResult(thrown);
  }

  return { result, reject, refresh, record };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

function errorCodeOf(result: ActionResult): MachineRejectErrorCode | undefined {
  return (result.data as { errorCode?: MachineRejectErrorCode } | null)?.errorCode;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reject registration action", () => {
  test("rejects the pending request through the client and audits it", async () => {
    const { result, reject, refresh, record } = await submit({
      action_id: "reject_registration",
      register_key: REGISTER_URL,
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true });
    // The URL is normalized to the auth ID the approve path also takes.
    expect(reject).toHaveBeenCalledExactlyOnceWith(AUTH_ID);
    // A rejection is a security-relevant answer about a device, so it is logged
    // with the acting principal and the request it turned down.
    expect(record).toHaveBeenCalledExactlyOnceWith({
      actor: "CI",
      actorType: "api_key",
      action: AUDIT_ACTIONS.registrationReject,
      target: AUTH_ID,
      result: "success",
    });
    // One resource refresh is what makes the list reflect the removal without a
    // full page reload.
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("accepts a bare registration key and prefixes it like the API expects", async () => {
    const { result, reject } = await submit({
      action_id: "reject_registration",
      register_key: "abcdefghijklmnopqrstuvwx",
    });

    expect(statusOf(result)).toBe(200);
    expect(reject).toHaveBeenCalledExactlyOnceWith("hskey-authreq-abcdefghijklmnopqrstuvwx");
  });

  test("never touches a node id, so it cannot remove a machine", async () => {
    const { reject } = await submit({
      action_id: "reject_registration",
      node_id: "42",
      register_key: AUTH_ID,
    });

    expect(reject).toHaveBeenCalledExactlyOnceWith(AUTH_ID);
  });

  test("records a failed rejection and reports it back", async () => {
    const { result, reject, refresh, record } = await submit(
      { action_id: "reject_registration", register_key: AUTH_ID },
      { fail: true },
    );

    expect(statusOf(result)).toBe(502);
    expect(errorCodeOf(result)).toBe("failed");
    expect(reject).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.registrationReject,
        target: AUTH_ID,
        result: "failure",
        detail: "headscale said no",
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  test("reports an older Headscale that cannot reject a request", async () => {
    const { result, refresh, record } = await submit(
      { action_id: "reject_registration", register_key: AUTH_ID },
      { rejectSupported: false },
    );

    expect(statusOf(result)).toBe(501);
    expect(errorCodeOf(result)).toBe("unsupported");
    expect(record).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("rejects a missing key before touching the client", async () => {
    const { result, reject } = await submit({ action_id: "reject_registration" });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("missingKey");
    expect(reject).not.toHaveBeenCalled();
  });

  test("rejects a key that is not a registration key", async () => {
    const { result, reject } = await submit({
      action_id: "reject_registration",
      register_key: "not-a-key",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidKey");
    expect(reject).not.toHaveBeenCalled();
  });

  test("refuses without the write capability", async () => {
    const { result, reject, record } = await submit(
      { action_id: "reject_registration", register_key: AUTH_ID },
      { allowed: false },
    );

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.manageMachines",
    );
    expect(reject).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
