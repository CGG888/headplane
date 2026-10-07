import { describe, expect, test, vi } from "vitest";

import { userAction } from "~/routes/users/user-actions";
import { createAuditStore, createMemoryAuditStorage } from "~/server/audit/store";
import {
  auditContext,
  authContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";

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

function createContext(options: { refresh: () => Promise<void>; api: Record<string, unknown> }) {
  const audit = createAuditStore(createMemoryAuditStorage());
  const principal = {
    kind: "api_key",
    displayName: "Tester",
    apiKey: "hskey-api-abcdef123456",
  };

  return {
    audit,
    context: {
      get: (context: unknown) => {
        if (context === authContext) {
          return { require: () => Promise.resolve(principal), can: () => Promise.resolve(true) };
        }

        if (context === requestApiContext) {
          return () => Promise.resolve({ principal, api: options.api });
        }

        if (context === headscaleLiveStoreContext) {
          return { refresh: options.refresh };
        }

        if (context === auditContext) {
          return audit;
        }

        return undefined;
      },
    },
  };
}

async function run(
  entries: Record<string, string>,
  options: { refresh: () => Promise<void>; api: Record<string, unknown> },
) {
  const { audit, context } = createContext(options);

  const result = await userAction({
    request: mockRequest(mockFormData(entries)),
    context,
    params: {},
  } as never);

  return { result, entries: await audit.list() };
}

// The action signals refusal by throwing `data(value, { status })`.
async function statusOf(
  entries: Record<string, string>,
  options: { refresh: () => Promise<void>; api: Record<string, unknown> },
): Promise<number> {
  try {
    const { result } = await run(entries, options);
    return (result as { init?: { status: number } }).init?.status ?? 200;
  } catch (thrown) {
    return (thrown as { init?: { status: number } }).init?.status ?? 0;
  }
}

const failingRefresh = () => Promise.reject(new Error("headscale is unreachable"));

describe("user management actions", () => {
  // The mutation has already been applied in Headscale when the cache refresh
  // runs. Failing the request there made the operator retry a create (or, worse,
  // a delete) that had already gone through, so the refresh is best effort now.
  test("a create that cannot refresh the cached list still succeeds", async () => {
    const { result, entries } = await run(
      { action_id: "create_user", username: "alice" },
      { refresh: failingRefresh, api: { users: { create: () => Promise.resolve({}) } } },
    );

    expect(result).toEqual({ message: "User created successfully" });
    expect(entries.entries).toHaveLength(1);
    expect(entries.entries[0].result).toBe("success");
  });

  test("a delete that cannot refresh the cached list still succeeds", async () => {
    const { result, entries } = await run(
      { action_id: "delete_user", headscale_user_id: "7" },
      { refresh: failingRefresh, api: { users: { delete: () => Promise.resolve({}) } } },
    );

    expect(result).toEqual({ message: "User deleted successfully" });
    expect(entries.entries).toHaveLength(1);
    expect(entries.entries[0].target).toBe("user:7");
  });

  // The dialog only marks up `type="email"` and a lower length bound, so a value
  // Headscale refuses used to travel all the way to the API and come back as an
  // opaque error instead of a form message.
  test("rejects user fields that Headscale would refuse", async () => {
    const create = vi.fn(() => Promise.resolve({}));
    const api = { users: { create } };
    const cases: Record<string, string>[] = [
      { action_id: "create_user", username: "a".repeat(256) },
      { action_id: "create_user", username: "alice", display_name: "bad\u0007name" },
      { action_id: "create_user", username: "alice", email: "not-an-email" },
    ];

    for (const entries of cases) {
      expect(await statusOf(entries, { refresh: () => Promise.resolve(), api })).toBe(400);
    }

    expect(create).not.toHaveBeenCalled();
  });

  test("a blank display name and email stay allowed", async () => {
    const create = vi.fn(() => Promise.resolve({}));
    const { result } = await run(
      { action_id: "create_user", username: "alice", display_name: "", email: "" },
      { refresh: () => Promise.resolve(), api: { users: { create } } },
    );

    expect(result).toEqual({ message: "User created successfully" });
    expect(create).toHaveBeenCalledWith({ name: "alice", email: "", displayName: "" });
  });

  test("passes valid optional fields through untouched", async () => {
    const create = vi.fn(() => Promise.resolve({}));
    const { result } = await run(
      {
        action_id: "create_user",
        username: "alice",
        display_name: "Alice Smith",
        email: "alice@example.com",
      },
      { refresh: () => Promise.resolve(), api: { users: { create } } },
    );

    expect(result).toEqual({ message: "User created successfully" });
    expect(create).toHaveBeenCalledWith({
      name: "alice",
      email: "alice@example.com",
      displayName: "Alice Smith",
    });
  });
});
