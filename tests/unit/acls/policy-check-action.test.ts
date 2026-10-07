import { describe, expect, test, vi } from "vitest";

import { authContext, requestApiContext } from "~/server/context";

// Mock the log module to avoid console spam during tests
vi.mock("~/utils/log", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const POLICY = '{"acls": [{"action": "accept", "src": ["*"], "dst": ["*:*"]}]}';
const PARSE_ERROR = "parsing HuJSON: invalid character '}' looking for beginning of value";

function mockFormData(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

function mockRequest(formData: FormData): Request {
  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

interface SubmitOptions {
  allowed?: boolean;
  /** Rejection for `POST v1/policy/check`. */
  checkFails?: unknown;
  /** Rejection for `PUT v1/policy`. */
  setFails?: unknown;
}

// React Router delivers context values through context.get(contextKey), so the
// mock answers whichever key the action asks for.
function createMockContext(options: SubmitOptions, api: Record<string, unknown>) {
  return {
    get: (context: unknown) => {
      if (context === authContext) {
        return {
          require: () => Promise.resolve({ id: 1 }),
          can: () => options.allowed ?? true,
        };
      }
      if (context === requestApiContext) {
        return () => Promise.resolve({ principal: { id: 1 }, api });
      }
      return undefined;
    },
  };
}

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

/** The shape the transport throws for an API error. */
function apiFailure(requestUrl: string, statusCode: number, data: Record<string, unknown> | null) {
  return {
    data: {
      requestUrl,
      statusCode,
      detail: data == null ? "" : JSON.stringify(data),
      data,
    },
    init: { status: 502 },
  };
}

async function submit(entries: Record<string, string>, options: SubmitOptions = {}) {
  const { aclAction } = await import("~/routes/acls/acl-action");

  const check = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockResolvedValue({
    policy: entries.policy ?? "",
    updatedAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  if (options.checkFails !== undefined) {
    check.mockRejectedValue(options.checkFails);
  }
  if (options.setFails !== undefined) {
    set.mockRejectedValue(options.setFails);
  }

  let result: ActionResult;
  try {
    result = (await aclAction({
      request: mockRequest(mockFormData(entries)),
      context: createMockContext(options, { policy: { check, set } }),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    // Rejections can come back as thrown data() payloads, which carry the same
    // shape as a returned one.
    result = thrown as ActionResult;
  }

  return { result, check, set };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

describe("ACL policy check action", () => {
  test("validate reports a policy headscale refuses", async () => {
    const { result, check, set } = await submit(
      { action_id: "check_policy", policy: POLICY },
      { checkFails: apiFailure("POST v1/policy/check", 500, { code: 13, message: PARSE_ERROR }) },
    );

    expect(statusOf(result)).toBe(400);
    expect((result.data as { success: boolean }).success).toBe(false);
    expect((result.data as { errorCode: string }).errorCode).toBe("policyRejected");
    // Headscale's own text has to reach the operator verbatim.
    expect((result.data as { detail: string }).detail).toBe(PARSE_ERROR);
    expect(check).toHaveBeenCalledWith(POLICY);
    expect(set).not.toHaveBeenCalled();
  });

  test("validate confirms a policy headscale accepts", async () => {
    const { result, check, set } = await submit({ action_id: "check_policy", policy: POLICY });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(check).toHaveBeenCalledWith(POLICY);
    expect(set).not.toHaveBeenCalled();
  });

  test("a rejected policy is never saved", async () => {
    const { result, check, set } = await submit(
      { policy: POLICY },
      { checkFails: apiFailure("POST v1/policy/check", 500, { code: 13, message: PARSE_ERROR }) },
    );

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("policyRejected");
    expect((result.data as { detail: string }).detail).toBe(PARSE_ERROR);
    expect(check).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });

  // Everything below used to save without a pre-flight check, so none of it is
  // allowed to start failing because the check endpoint is unusable.
  test.for([
    [
      "an unsupported check endpoint",
      apiFailure("POST v1/policy/check", 404, { code: 5, message: "Not Found" }),
    ],
    [
      "file mode",
      apiFailure("POST v1/policy/check", 500, {
        code: 13,
        message: "policy update is disabled",
      }),
    ],
    [
      "a permission problem",
      apiFailure("POST v1/policy/check", 403, { code: 7, message: "denied" }),
    ],
    [
      "a transport failure",
      {
        data: {
          requestUrl: "POST v1/policy/check",
          errorCode: "UNKNOWN_NODE_NETWORK_ERROR",
          errorMessage: "fetch failed",
          extraData: {},
        },
        init: { status: 502 },
      },
    ],
  ])("still saves when the check fails with %s", async ([, failure]) => {
    const { result, check, set } = await submit({ policy: POLICY }, { checkFails: failure });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(check).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(POLICY);
  });

  test("saves once through the happy path", async () => {
    const { result, check, set } = await submit({ policy: POLICY });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(check).toHaveBeenCalledWith(POLICY);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(POLICY);
  });

  test("keeps the localized file-mode rejection from Headscale", async () => {
    const { result, set } = await submit(
      { policy: POLICY },
      {
        setFails: apiFailure("PUT v1/policy", 500, {
          code: 13,
          message: "policy update is disabled",
        }),
      },
    );

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.policyNotWritable",
    );
    expect(set).toHaveBeenCalledOnce();
  });

  test("refuses to check or save without the policy capability", async () => {
    const { result, check, set } = await submit({ policy: POLICY }, { allowed: false });

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.writePolicy",
    );
    expect(check).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
