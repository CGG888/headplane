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

async function submit(entries: Record<string, string>, options: SubmitOptions = {}) {
  const { apiKeysAction } = await import("~/routes/settings/api-keys/actions");

  const create = vi.fn().mockResolvedValue({ apiKey: "hskey-api-abcdefghijkl-secret" });
  const expire = vi.fn().mockResolvedValue(undefined);
  if (options.failWith) {
    create.mockRejectedValue(options.failWith);
    expire.mockRejectedValue(options.failWith);
  }

  let result: ActionResult;
  try {
    result = (await apiKeysAction({
      request: mockRequest(mockFormData(entries)),
      context: createMockContext(options, { apiKeys: { create, expire } }),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    // Rejections can come back as thrown data() payloads, which carry the same
    // shape as a returned one.
    result = thrown as ActionResult;
  }

  return { result, create, expire };
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
            rawData: "not found",
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
