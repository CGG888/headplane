import { describe, expect, test, vi } from "vitest";

import { agentsContext, authContext, requestApiContext } from "~/server/context";

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

interface Harness {
  action: (args: unknown) => Promise<{ data?: unknown; init?: { status?: number } | null }>;
  create: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  listForUser: ReturnType<typeof vi.fn>;
}

async function callAction(
  formData: FormData,
  overrides: {
    principal?: unknown;
    agents?: { state: string };
    canManageNode?: boolean;
    nodes?: unknown[];
    users?: unknown[];
  } = {},
): Promise<Harness & { result: { data?: unknown; init?: { status?: number } | null } }> {
  const create = vi.fn().mockResolvedValue({ key: "hskey-created", id: "42" });
  const expire = vi.fn().mockResolvedValue(undefined);
  const listForUser = vi.fn().mockResolvedValue([
    { key: "hskey-issued", id: "7", user: { id: "9" } },
    { key: "hskey-other", id: "8", user: { id: "9" } },
  ]);

  const api = {
    nodes: {
      list: vi.fn().mockResolvedValue(overrides.nodes ?? [{ givenName: "machine", id: "1" }]),
    },
    users: { list: vi.fn().mockResolvedValue(overrides.users ?? [{ id: "9", name: "alice" }]) },
    preAuthKeys: { create, expire, listForUser },
  };

  const principal = overrides.principal ?? {
    kind: "oidc",
    user: { id: "1", subject: "sub-1", headscaleUserId: "9" },
    profile: { email: "alice@example.com" },
  };

  const context = {
    get: (key: unknown) => {
      if (key === agentsContext) return overrides.agents ?? { state: "enabled" };
      if (key === authContext) return { canManageNode: () => overrides.canManageNode ?? true };
      if (key === requestApiContext) {
        return () => Promise.resolve({ principal, api });
      }
      return undefined;
    },
  };

  const { action } = await import("~/routes/ssh/key");
  const result = await action({
    request: mockRequest(formData),
    params: { id: "machine" },
    context,
  } as never);

  return { action: action as Harness["action"], create, expire, listForUser, result };
}

function createForm(user = "alice"): FormData {
  const formData = new FormData();
  formData.set("intent", "create");
  formData.set("user", user);
  return formData;
}

function revokeForm(key?: string): FormData {
  const formData = new FormData();
  formData.set("intent", "revoke");
  if (key !== undefined) {
    formData.set("key", key);
  }
  return formData;
}

describe("Console pre-auth key action", () => {
  test("mints a single-use ephemeral key for the linked Headscale user", async () => {
    const { result, create } = await callAction(createForm());

    expect(result.init?.status ?? 200).toBe(200);
    expect(result.data).toMatchObject({ key: "hskey-created", id: "42" });
    expect((result.data as { ephemeralHostname: string }).ephemeralHostname).toMatch(
      /^ssh-[0-9a-f]{8}-alice$/,
    );

    expect(create).toHaveBeenCalledOnce();
    const options = create.mock.calls[0][0];
    expect(options).toMatchObject({ user: "9", ephemeral: true, reusable: false, aclTags: null });
    expect(options.expiration).toBeInstanceOf(Date);
  });

  test("refuses to mint without a username", async () => {
    const { result, create } = await callAction(createForm(""));

    expect(result.init?.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  test("revokes a key that belongs to the signed-in user", async () => {
    const { result, expire, listForUser } = await callAction(revokeForm("hskey-issued"));

    expect(result.init?.status ?? 200).toBe(200);
    expect(result.data).toEqual({ revoked: true });
    expect(listForUser).toHaveBeenCalledWith("9");
    expect(expire).toHaveBeenCalledWith({ key: "hskey-issued", id: "7", user: { id: "9" } });
  });

  test("does not revoke a key the request made up", async () => {
    const { result, expire } = await callAction(revokeForm("hskey-someone-else"));

    expect(result.data).toEqual({ revoked: false });
    expect(expire).not.toHaveBeenCalled();
  });

  test("rejects a revoke without a key", async () => {
    const { result, expire } = await callAction(revokeForm());

    expect(result.init?.status).toBe(400);
    expect(expire).not.toHaveBeenCalled();
  });

  test("rejects API key principals", async () => {
    const { result, create } = await callAction(createForm(), {
      principal: {
        kind: "api_key",
        user: { id: "1", subject: "sub-1" },
        profile: { email: "alice@example.com" },
      },
    });

    expect(result.init?.status).toBe(403);
    expect(result.data).toMatchObject({ sshError: "oidcRequired" });
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects when the agent integration is disabled", async () => {
    const { result, create } = await callAction(createForm(), { agents: { state: "disabled" } });

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({ sshError: "agentRequired" });
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects an unknown node", async () => {
    const { result, create } = await callAction(createForm(), { nodes: [] });

    expect(result.init?.status).toBe(404);
    expect(result.data).toMatchObject({ sshError: "nodeNotFound" });
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects a node the principal cannot manage", async () => {
    const { result, create } = await callAction(createForm(), { canManageNode: false });

    expect(result.init?.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects a principal that is not linked to a Headscale user", async () => {
    const { result, create } = await callAction(createForm(), {
      users: [],
      principal: {
        kind: "oidc",
        user: { id: "1", subject: "sub-1" },
        profile: { email: "alice@example.com" },
      },
    });

    expect(result.init?.status).toBe(404);
    expect(result.data).toMatchObject({ sshError: "userNotLinked" });
    expect(create).not.toHaveBeenCalled();
  });
});
