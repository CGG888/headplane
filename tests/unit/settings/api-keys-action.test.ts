import { describe, expect, test, vi } from "vitest";

import { auditContext, authContext, requestApiContext } from "~/server/context";

// Mock the log module to avoid console spam during tests
vi.mock("~/utils/log", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const PRINCIPAL = {
  kind: "oidc",
  sessionId: "session",
  user: { id: "1", subject: "subject", role: "admin", headscaleUserId: "1" },
  profile: { name: "Alice" },
};

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
  failWith?: unknown;
}

// React Router delivers context values through context.get(contextKey), so the
// mock answers whichever key the action asks for.
function createMockContext(
  options: SubmitOptions,
  api: Record<string, unknown>,
  audit: { record: ReturnType<typeof vi.fn> },
) {
  return {
    get: (context: unknown) => {
      if (context === authContext) {
        return {
          require: () => Promise.resolve(PRINCIPAL),
          can: () => options.allowed ?? true,
        };
      }
      if (context === requestApiContext) {
        return () => Promise.resolve({ api });
      }
      if (context === auditContext) {
        return audit;
      }
      return undefined;
    },
  };
}

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

async function submit(entries: Record<string, string>, options: SubmitOptions = {}) {
  const { apiKeysAction } = await import("~/routes/settings/api-keys/actions");

  const create = vi.fn().mockResolvedValue({ apiKey: "hskey-api-abcdefghijkl-secret" });
  const expire = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  if (options.failWith) {
    create.mockRejectedValue(options.failWith);
    expire.mockRejectedValue(options.failWith);
    remove.mockRejectedValue(options.failWith);
  }

  const record = vi.fn().mockResolvedValue(undefined);

  let result: ActionResult;
  try {
    result = (await apiKeysAction({
      request: mockRequest(mockFormData(entries)),
      context: createMockContext(
        options,
        { apiKeys: { create, expire, delete: remove } },
        {
          record,
        },
      ),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    // Rejections can come back as thrown data() payloads, which carry the same
    // shape as a returned one.
    result = thrown as ActionResult;
  }

  return { result, create, expire, remove, record };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

describe("API key action", () => {
  test("creates a key that expires after the requested number of days", async () => {
    const { result, create } = await submit({ action_id: "create_api_key", expiration: "30" });

    expect(statusOf(result)).toBe(200);
    expect(create).toHaveBeenCalledOnce();

    // Headscale stores whatever expiration it is given, so it must always be an
    // explicit timestamp a month out.
    const expiration = create.mock.calls[0][0] as Date;
    const days = Math.round((expiration.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(30);
    expect((result.data as { apiKey: string }).apiKey).toBe("hskey-api-abcdefghijkl-secret");
  });

  // Values the browser would happily send but Headscale cannot use.
  test.for(["0", "-1", "", "365,000", "90 days", "99999999999"])(
    "rejects an unusable expiry (%)",
    async (expiration) => {
      const { result, create } = await submit({ action_id: "create_api_key", expiration });

      expect(statusOf(result)).toBe(400);
      expect((result.data as { errorCode: string }).errorCode).toBe("invalidExpiration");
      expect(create).not.toHaveBeenCalled();
    },
  );

  // Since 0.28 the list endpoint masks the prefix, but the expire endpoint looks
  // keys up by the raw prefix stored in the database.
  test.for([
    ["hskey-api-abcdefghijkl-***", "abcdefghijkl"],
    ["hskey-api-abcdefghijkl-secret-part-***", "abcdefghijkl"],
    ["abcdefghijkl", "abcdefghijkl"],
  ])("expires the key behind the masked prefix (%s)", async ([prefix, expected]) => {
    const { result, expire } = await submit({ action_id: "expire_api_key", prefix });

    expect(statusOf(result)).toBe(200);
    expect(expire).toHaveBeenCalledWith(expected);
  });

  test("rejects an empty prefix", async () => {
    const { result, expire } = await submit({ action_id: "expire_api_key", prefix: "  " });

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("invalidPrefix");
    expect(expire).not.toHaveBeenCalled();
  });

  test("reports a key that Headscale does not know", async () => {
    const { result } = await submit(
      { action_id: "expire_api_key", prefix: "abcdefghijkl" },
      {
        // The shape the transport throws for an API error.
        failWith: {
          data: {
            requestUrl: "POST v1/apikey/expire",
            statusCode: 404,
            detail: "not found",
            data: null,
          },
          init: { status: 502 },
        },
      },
    );

    expect(statusOf(result)).toBe(404);
    expect((result.data as { errorCode: string }).errorCode).toBe("notFound");
  });

  test.for([["unknown_action"], [""]])("rejects an unknown action (%s)", async ([action]) => {
    const { result, create, expire } = await submit({ action_id: action });

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("invalidAction");
    expect(create).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  test("refuses to touch keys without the IAM capability", async () => {
    const { result, create, expire } = await submit(
      { action_id: "create_api_key", expiration: "30" },
      { allowed: false },
    );

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.modifyIam",
    );
    expect(create).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });
});

describe("API key deletion", () => {
  // The same masking as expire: Headscale stores the raw prefix and the list
  // only shows `hskey-api-<raw>-***`.
  test.for([
    ["hskey-api-abcdefghijkl-***", "abcdefghijkl"],
    ["abcdefghijkl", "abcdefghijkl"],
  ])("deletes the key behind the displayed prefix (%s)", async ([prefix, expected]) => {
    const { result, remove, record } = await submit({ action_id: "delete_api_key", prefix });

    expect(statusOf(result)).toBe(200);
    expect(remove).toHaveBeenCalledWith(expected);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "api_key.delete",
        target: `hskey-api-${expected}`,
        result: "success",
      }),
    );
  });

  test("refuses a prefix that is nothing but mask characters", async () => {
    const { result, remove } = await submit({ action_id: "delete_api_key", prefix: "***" });

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("invalidPrefix");
    expect(remove).not.toHaveBeenCalled();
  });

  // Re-deleting a key someone else already removed must not blow up the page:
  // the record the operator wanted gone is gone.
  test("reports a key Headscale no longer has", async () => {
    const { result, remove, record } = await submit(
      { action_id: "delete_api_key", prefix: "abcdefghijkl" },
      {
        failWith: {
          data: {
            requestUrl: "DELETE v1/apikey/abcdefghijkl",
            statusCode: 404,
            detail: "not found",
            data: null,
          },
          init: { status: 502 },
        },
      },
    );

    expect(statusOf(result)).toBe(404);
    expect((result.data as { errorCode: string }).errorCode).toBe("notFound");
    expect(remove).toHaveBeenCalledWith("abcdefghijkl");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "api_key.delete",
        result: "failure",
        detail: "notFound",
      }),
    );
  });

  test("refuses to delete without the IAM capability", async () => {
    const { result, remove, record } = await submit(
      { action_id: "delete_api_key", prefix: "abcdefghijkl" },
      { allowed: false },
    );

    expect(statusOf(result)).toBe(403);
    expect(remove).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
