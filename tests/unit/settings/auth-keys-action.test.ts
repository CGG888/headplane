import { describe, expect, test, vi } from "vitest";

import { auditContext, authContext, requestApiContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

// Mock the log module to avoid console spam during tests
vi.mock("~/utils/log", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function mockFormData(expiry: string): FormData {
  const formData = new FormData();
  formData.set("action_id", "add_preauthkey");
  formData.set("user_id", "1");
  formData.set("acl_tags", "");
  formData.set("reusable", "off");
  formData.set("ephemeral", "off");
  formData.set("expiry", expiry);
  return formData;
}

function mockRequest(formData: FormData): Request {
  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

// React Router provides context values through context.get(contextKey), so this
// returns the matching mock depending on the requested key.
function createMockContext(create: ReturnType<typeof vi.fn>) {
  return {
    get: (context: typeof authContext | typeof requestApiContext) => {
      if (context === authContext) return { can: () => true };
      if (context === requestApiContext) {
        return () => Promise.resolve({ principal: {}, api: { preAuthKeys: { create } } });
      }
      return undefined;
    },
  };
}

async function submitExpiry(expiry: string) {
  const { authKeysAction } = await import("~/routes/settings/auth-keys/actions");
  const create = vi.fn().mockResolvedValue({ key: "test-key" });

  const result = (await authKeysAction({
    request: mockRequest(mockFormData(expiry)),
    context: createMockContext(create),
    params: {},
  } as any)) as { data: unknown; init?: { status?: number } | null };

  return { result, create };
}

function daysUntil(expiration: Date): number {
  const start = new Date();
  return Math.round((expiration.getTime() - start.getTime()) / 86_400_000);
}

describe("Pre-auth key expiry parsing", () => {
  test("accepts a plain integer above the grouping threshold", async () => {
    const { result, create } = await submitExpiry("365000");

    expect(result.init?.status ?? 200).toBe(200);
    expect(create).toHaveBeenCalledOnce();
    expect(daysUntil(create.mock.calls[0][0].expiration)).toBe(365_000);
  });

  // Values >= 1000 used to be submitted through Intl.NumberFormat, which groups
  // digits differently per locale. Leniently parsing those either produced an
  // Invalid Date (500) or, for dot-grouping locales, a silently wrong expiry.
  test.for([
    ["en-US", "365,000"],
    ["ru-RU", "365 000"],
    ["fr-FR", "365 000"],
    ["de-DE", "365.000"],
  ])("rejects a locale-formatted value (%s)", async ([, expiry]) => {
    const { result, create } = await submitExpiry(expiry);

    expect(result.init?.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  test.for(["0", "-1", "", "90 days", "9999999999999"])(
    "rejects an out-of-range or non-numeric value (%s)",
    async (expiry) => {
      const { result, create } = await submitExpiry(expiry);

      expect(result.init?.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    },
  );
});

const PRINCIPAL = {
  kind: "oidc",
  sessionId: "session",
  user: { id: "1", subject: "subject-1", role: "member", headscaleUserId: "1" },
  profile: { name: "Alice" },
};

interface DeleteOptions {
  canGenerateAny?: boolean;
  canGenerateOwn?: boolean;
  /** False to model a Headscale older than 0.28, where the method is absent. */
  supported?: boolean;
  failWith?: unknown;
}

function deleteRequest(entries: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

async function submitDelete(entries: Record<string, string>, options: DeleteOptions = {}) {
  const { authKeysAction } = await import("~/routes/settings/auth-keys/actions");

  const remove = vi.fn().mockResolvedValue(undefined);
  if (options.failWith) {
    remove.mockRejectedValue(options.failWith);
  }

  const record = vi.fn().mockResolvedValue(undefined);
  const listUsers = vi
    .fn()
    .mockResolvedValue([
      { id: "9", name: "someone", provider: "oidc", providerId: "https://idp.example.com/other" },
    ]);

  const canGenerateAny = options.canGenerateAny ?? true;
  const canGenerateOwn = options.canGenerateOwn ?? true;

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          can: (_principal: unknown, capability: number) =>
            capability === Capabilities.generate_authkeys ? canGenerateAny : canGenerateOwn,
        };
      }
      if (key === requestApiContext) {
        return () =>
          Promise.resolve({
            principal: PRINCIPAL,
            api: {
              preAuthKeys: options.supported === false ? {} : { delete: remove },
              users: { list: listUsers },
            },
          });
      }
      if (key === auditContext) {
        return { record };
      }
      return undefined;
    },
  };

  let result: { data: unknown; init?: { status?: number } | null };
  try {
    result = (await authKeysAction({
      request: deleteRequest(entries),
      context,
      params: {},
    } as never)) as typeof result;
  } catch (thrown) {
    result = thrown as typeof result;
  }

  return { result, remove, record, listUsers };
}

describe("Pre-auth key deletion", () => {
  test("deletes the key by its stable id and records it", async () => {
    const { result, remove, record } = await submitDelete({
      action_id: "delete_preauthkey",
      key_id: "7",
      user_id: "1",
    });

    expect(result.init?.status ?? 200).toBe(200);
    expect(remove).toHaveBeenCalledWith("7");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pre_auth_key.delete",
        target: "preauthkey:7",
        result: "success",
      }),
    );
  });

  // A tag-only key has no owner, so only an administrator can delete it.
  test("deletes a key with no owner for an administrator", async () => {
    const { result, remove } = await submitDelete({
      action_id: "delete_preauthkey",
      key_id: "8",
    });

    expect(result.init?.status ?? 200).toBe(200);
    expect(remove).toHaveBeenCalledWith("8");
  });

  test("reports a key Headscale no longer has", async () => {
    const { result, record } = await submitDelete(
      { action_id: "delete_preauthkey", key_id: "7", user_id: "1" },
      {
        failWith: {
          data: {
            requestUrl: "DELETE v1/preauthkey?id=7",
            statusCode: 404,
            detail: "not found",
            data: null,
          },
          init: { status: 502 },
        },
      },
    );

    expect(result.init?.status).toBe(404);
    expect((result.data as { errorCode: string }).errorCode).toBe("notFound");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pre_auth_key.delete",
        result: "failure",
        detail: "notFound",
      }),
    );
  });

  test("reports a Headscale that cannot delete pre-auth keys", async () => {
    const { result, remove, record } = await submitDelete(
      { action_id: "delete_preauthkey", key_id: "7", user_id: "1" },
      { supported: false },
    );

    expect(result.init?.status).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("unsupported");
    expect(remove).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pre_auth_key.delete", detail: "unsupported" }),
    );
  });

  test("rejects a request without a key id", async () => {
    const { result, remove } = await submitDelete({ action_id: "delete_preauthkey" });

    expect(result.init?.status).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("invalidKeyId");
    expect(remove).not.toHaveBeenCalled();
  });

  // A self-service account cannot prove ownership of a key with no owner, so
  // the request is refused before Headscale is called.
  test("refuses a self-service deletion of a key with no owner", async () => {
    const { result, remove } = await submitDelete(
      { action_id: "delete_preauthkey", key_id: "7" },
      { canGenerateAny: false, canGenerateOwn: true },
    );

    expect(result.init?.status).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.manageUserPreAuthKeys",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  test("refuses a self-service deletion of someone else's key", async () => {
    const { result, remove, listUsers } = await submitDelete(
      { action_id: "delete_preauthkey", key_id: "7", user_id: "9" },
      { canGenerateAny: false, canGenerateOwn: true },
    );

    expect(listUsers).toHaveBeenCalledWith({ id: "9" });
    expect(result.init?.status).toBe(403);
    expect(remove).not.toHaveBeenCalled();
  });
});
