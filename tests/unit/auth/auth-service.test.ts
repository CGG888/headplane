import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { authSessions } from "~/server/db/schema";
import type { AuthService, Principal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import type { Machine } from "~/types";

import { createTestAuth } from "./create-auth";

vi.mock("~/utils/log", () => ({
  default: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

/**
 * `require` answers a request that carries no usable session with a redirect to the
 * login page (routes outside the layout call it directly, and a thrown `Error`
 * surfaced there as a 500). Asserting the redirect keeps that contract honest.
 */
async function expectLoginRedirect(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    const response = error as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    return;
  }

  throw new Error("Expected require() to redirect to the login page");
}

describe("findOrCreateUser", () => {
  let auth: AuthService;

  beforeEach(() => {
    ({ auth } = createTestAuth());
  });

  test("first created user becomes owner", async () => {
    await auth.findOrCreateUser("sub-owner", { name: "Owner" });
    const role = await auth.roleForSubject("sub-owner");
    expect(role).toBe("owner");
  });

  test("second distinct user stays member", async () => {
    await auth.findOrCreateUser("sub-owner", { name: "Owner" });
    await auth.findOrCreateUser("sub-member", { name: "Member" });
    const role = await auth.roleForSubject("sub-member");
    expect(role).toBe("member");
  });

  test("second distinct user can receive a configured initial role", async () => {
    await auth.findOrCreateUser("sub-owner", { name: "Owner" });
    await auth.findOrCreateUser("sub-admin", { name: "Admin" }, { initialRole: "admin" });
    const role = await auth.roleForSubject("sub-admin");
    expect(role).toBe("admin");
  });

  test("first created user becomes owner even with a configured initial role", async () => {
    await auth.findOrCreateUser("sub-owner", { name: "Owner" }, { initialRole: "viewer" });
    const role = await auth.roleForSubject("sub-owner");
    expect(role).toBe("owner");
  });

  test("configured initial roles cannot grant owner", async () => {
    await auth.findOrCreateUser("sub-owner", { name: "Owner" });
    await auth.findOrCreateUser("sub-other", { name: "Other" }, { initialRole: "owner" });
    const role = await auth.roleForSubject("sub-other");
    expect(role).toBe("member");
  });

  test("existing subject returns same id (idempotent)", async () => {
    const id1 = await auth.findOrCreateUser("sub-1", { name: "Alice" });
    const id2 = await auth.findOrCreateUser("sub-1", { name: "Alice" });
    expect(id1).toBe(id2);
  });

  test("updates name and email on re-login", async () => {
    await auth.findOrCreateUser("sub-1", { name: "Old", email: "old@test.com" });
    await auth.findOrCreateUser("sub-1", { name: "New", email: "new@test.com" });

    const users = await auth.listUsers();
    const user = users.find((u) => u.sub === "sub-1");
    expect(user?.name).toBe("New");
    expect(user?.email).toBe("new@test.com");
  });

  test("syncs an existing non-owner role when explicitly provided", async () => {
    await auth.findOrCreateUser("sub-owner");
    await auth.findOrCreateUser("sub-1", { name: "User" });

    await auth.findOrCreateUser("sub-1", { name: "User" }, { syncRole: "admin" });

    const role = await auth.roleForSubject("sub-1");
    expect(role).toBe("admin");
  });

  test("does not apply initial role to an existing user", async () => {
    await auth.findOrCreateUser("sub-owner");
    await auth.findOrCreateUser("sub-1", { name: "User" });

    await auth.findOrCreateUser("sub-1", { name: "User" }, { initialRole: "admin" });

    const role = await auth.roleForSubject("sub-1");
    expect(role).toBe("member");
  });

  test("does not sync the owner role", async () => {
    await auth.findOrCreateUser("sub-owner");

    await auth.findOrCreateUser("sub-owner", { name: "Owner" }, { syncRole: "admin" });

    const role = await auth.roleForSubject("sub-owner");
    expect(role).toBe("owner");
  });
});

describe("linkHeadscaleUser", () => {
  let auth: AuthService;

  beforeEach(() => {
    ({ auth } = createTestAuth());
  });

  test("links unclaimed Headscale user successfully", async () => {
    const userId = await auth.findOrCreateUser("sub-1");
    const result = await auth.linkHeadscaleUser(userId, "hs-1");
    expect(result).toBe(true);
  });

  test("returns false if another Headplane user already claimed that headscale_user_id", async () => {
    const id1 = await auth.findOrCreateUser("sub-1");
    const id2 = await auth.findOrCreateUser("sub-2");
    await auth.linkHeadscaleUser(id1, "hs-1");

    const result = await auth.linkHeadscaleUser(id2, "hs-1");
    expect(result).toBe(false);
  });

  test("unlinkHeadscaleUser clears the link", async () => {
    const userId = await auth.findOrCreateUser("sub-1");
    await auth.linkHeadscaleUser(userId, "hs-1");
    await auth.unlinkHeadscaleUser(userId);

    const users = await auth.listUsers();
    const user = users.find((u) => u.id === userId);
    expect(user?.headscale_user_id).toBeNull();
  });
});

describe("reassignUser", () => {
  let auth: AuthService;

  beforeEach(() => {
    ({ auth } = createTestAuth());
  });

  test("updates an existing non-owner role", async () => {
    await auth.findOrCreateUser("sub-owner");
    const userId = await auth.findOrCreateUser("sub-user");

    const result = await auth.reassignUser(userId, "admin");
    expect(result).toBe(true);

    const role = await auth.roleForSubject("sub-user");
    expect(role).toBe("admin");
  });

  test("returns false for owner demotion attempt", async () => {
    const ownerId = await auth.findOrCreateUser("sub-owner");

    const result = await auth.reassignUser(ownerId, "member");
    expect(result).toBe(false);
  });

  test("returns false when user does not exist", async () => {
    const result = await auth.reassignUser("01ARZ3NDEKTSV4RRFFQ69G5FAV", "auditor");
    expect(result).toBe(false);
  });
});

describe("transferOwnership", () => {
  let auth: AuthService;

  beforeEach(() => {
    ({ auth } = createTestAuth());
  });

  test("swaps roles: owner→admin, target→owner", async () => {
    const ownerId = await auth.findOrCreateUser("sub-owner");
    const targetId = await auth.findOrCreateUser("sub-target");

    const result = await auth.transferOwnership(ownerId, targetId);
    expect(result).toBe(true);

    expect(await auth.roleForSubject("sub-owner")).toBe("admin");
    expect(await auth.roleForSubject("sub-target")).toBe("owner");
  });

  test("returns false if caller is not owner", async () => {
    const ownerId = await auth.findOrCreateUser("sub-owner");
    const otherId = await auth.findOrCreateUser("sub-other");

    const result = await auth.transferOwnership(otherId, ownerId);
    expect(result).toBe(false);
  });

  test("returns false if target doesn't exist", async () => {
    const ownerId = await auth.findOrCreateUser("sub-owner");

    const result = await auth.transferOwnership(ownerId, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(result).toBe(false);
  });

  test("returns false if target is same user as owner", async () => {
    const ownerId = await auth.findOrCreateUser("sub-owner");

    const result = await auth.transferOwnership(ownerId, ownerId);
    expect(result).toBe(false);
  });
});

describe("session round-trip", () => {
  let auth: AuthService;

  beforeEach(() => {
    ({ auth } = createTestAuth());
  });

  test("createOidcSession + require resolves back to OIDC principal with correct user data", async () => {
    const userId = await auth.findOrCreateUser("sub-1", { name: "Alice", email: "alice@test.com" });

    const cookieHeader = await auth.createOidcSession(userId, {
      name: "Alice",
      email: "alice@test.com",
    });

    const cookieValue = cookieHeader.split(";")[0];
    const request = new Request("http://localhost/test", {
      headers: { cookie: cookieValue },
    });

    const principal = await auth.require(request);
    expect(principal.kind).toBe("oidc");
    if (principal.kind === "oidc") {
      expect(principal.user.id).toBe(userId);
      expect(principal.user.subject).toBe("sub-1");
      expect(principal.profile.name).toBe("Alice");
      expect(principal.profile.email).toBe("alice@test.com");
    }
  });

  test("expired session throws", async () => {
    const userId = await auth.findOrCreateUser("sub-1", { name: "Alice" });

    const cookieHeader = await auth.createOidcSession(
      userId,
      { name: "Alice" },
      { maxAgeMs: -1000 },
    );

    const cookieValue = cookieHeader.split(";")[0];
    const request = new Request("http://localhost/test", {
      headers: { cookie: cookieValue },
    });

    await expectLoginRedirect(auth.require(request));
  });

  test("defaults the session lifetime to the cookie max age in seconds", async () => {
    const { auth: sessionAuth, db } = createTestAuth();
    const userId = await sessionAuth.findOrCreateUser("sub-1", { name: "Alice" });

    // `cookie.maxAge` is configured in seconds (3600 in the test setup) and both
    // the stored row and the cookie have to agree with it. Passing that number
    // through a millisecond parameter used to put the expiry ~285 years out.
    const before = Date.now();
    const cookieHeader = await sessionAuth.createOidcSession(userId, { name: "Alice" });
    const after = Date.now();

    expect(cookieHeader).toContain("Max-Age=3600");

    // The column stores whole seconds, so the row may sit up to a second below
    // the exact instant; the magnitude is what matters here.
    const [session] = await db.select().from(authSessions);
    const expiresAt = session.expires_at.getTime();
    expect(expiresAt).toBeGreaterThan(before + 3599_000);
    expect(expiresAt).toBeLessThan(after + 3600_000);
  });
});

describe("api key sessions", () => {
  test("resolves a session whose credential matches the stored hash", async () => {
    const { auth } = createTestAuth();
    const cookieHeader = await auth.createApiKeySession(
      "hskey-api-abc123",
      "hskey-api-abc***",
      60_000,
    );
    const request = new Request("http://localhost/test", {
      headers: { cookie: cookieHeader.split(";")[0] },
    });

    const principal = await auth.require(request);
    expect(principal.kind).toBe("api_key");
    if (principal.kind === "api_key") {
      expect(principal.apiKey).toBe("hskey-api-abc123");
      expect(principal.displayName).toBe("hskey-api-abc***");
    }
  });

  test("rejects and drops a session whose hash no longer matches the cookie", async () => {
    const { auth, db } = createTestAuth();
    const cookieHeader = await auth.createApiKeySession(
      "hskey-api-abc123",
      "hskey-api-abc***",
      60_000,
    );

    // Revocation happens on the row, not in the cookie: clearing the hash takes
    // the session out of service even though the client still holds its cookie.
    await db
      .update(authSessions)
      .set({ api_key_hash: null })
      .where(eq(authSessions.kind, "api_key"));

    const request = new Request("http://localhost/test", {
      headers: { cookie: cookieHeader.split(";")[0] },
    });

    await expectLoginRedirect(auth.require(request));
    expect(await db.select().from(authSessions)).toHaveLength(0);
  });

  test("keeps a database failure as an error instead of a login redirect", async () => {
    const { auth, db } = createTestAuth();
    const cookieHeader = await auth.createApiKeySession("hskey-api-abc123", "key", 60_000);
    const request = new Request("http://localhost/test", {
      headers: { cookie: cookieHeader.split(";")[0] },
    });

    // A redirect is only right when the request has no session; an outage has to
    // stay a 500, otherwise every user is bounced to a login page that also fails.
    vi.spyOn(db, "select").mockImplementation(() => {
      throw new Error("database is offline");
    });

    await expect(auth.require(request)).rejects.toThrow("database is offline");
  });

  test("rejects a cookie whose credential differs from the stored hash", async () => {
    const { auth, db } = createTestAuth();
    const cookieHeader = await auth.createApiKeySession(
      "hskey-api-abc123",
      "hskey-api-abc***",
      60_000,
    );

    await db
      .update(authSessions)
      .set({ api_key_hash: "0".repeat(64) })
      .where(eq(authSessions.kind, "api_key"));

    const request = new Request("http://localhost/test", {
      headers: { cookie: cookieHeader.split(";")[0] },
    });

    await expectLoginRedirect(auth.require(request));
  });
});

describe("proxy authentication", () => {
  test("creates a user-backed principal from trusted proxy headers", async () => {
    const { auth } = createTestAuth({
      headscaleApiKey: "configured-headscale-key",
      proxyAuth: {
        enabled: true,
        allowedCidrs: ["10.10.0.0/16"],
        emailHeader: "X-Forwarded-Email",
        nameHeader: "X-Forwarded-Name",
      },
    });
    const request = new Request("http://localhost/test", {
      headers: {
        "Remote-User": "alice",
        "X-Forwarded-Email": "alice@example.com",
        "X-Forwarded-Name": "Alice Example",
      },
    });

    auth.registerRequestClientAddress(request, "10.10.42.9");

    const principal = await auth.require(request);
    expect(principal.kind).toBe("proxy");
    if (principal.kind === "proxy") {
      expect(principal.user.subject).toBe("proxy:alice");
      expect(principal.user.role).toBe("owner");
      expect(principal.profile.name).toBe("Alice Example");
      expect(principal.profile.email).toBe("alice@example.com");
      expect(principal.profile.username).toBe("alice");
    }
    expect(auth.getHeadscaleApiKey(principal)).toBe("configured-headscale-key");
  });

  test("uses localhost CIDRs by default when no allowed CIDRs are configured", async () => {
    const { auth } = createTestAuth({
      headscaleApiKey: "configured-headscale-key",
      proxyAuth: { enabled: true },
    });
    const request = new Request("http://localhost/test", {
      headers: { "Remote-User": "alice" },
    });

    auth.registerRequestClientAddress(request, "::ffff:127.0.0.1");

    const principal = await auth.require(request);
    expect(principal.kind).toBe("proxy");
    expect(auth.getHeadscaleApiKey(principal)).toBe("configured-headscale-key");
  });

  test("falls back to normal session auth outside allowed CIDRs", async () => {
    const { auth } = createTestAuth({
      headscaleApiKey: "configured-headscale-key",
      proxyAuth: { enabled: true, allowedCidrs: ["10.10.0.0/16"] },
    });
    const request = new Request("http://localhost/test");

    auth.registerRequestClientAddress(request, "10.11.42.9");

    await expectLoginRedirect(auth.require(request));
  });

  test("can check allowed CIDRs against a forwarded IP from a trusted proxy", async () => {
    const { auth } = createTestAuth({
      headscaleApiKey: "configured-headscale-key",
      proxyAuth: {
        enabled: true,
        allowedCidrs: ["203.0.113.0/24"],
        trustedProxyCidrs: ["10.0.0.0/24"],
        ipHeader: "X-Forwarded-For",
      },
    });
    const request = new Request("http://localhost/test", {
      headers: {
        "Remote-User": "alice",
        "X-Forwarded-For": "203.0.113.42, 10.0.0.10",
      },
    });

    auth.registerRequestClientAddress(request, "10.0.0.10");

    const principal = await auth.require(request);
    expect(principal.kind).toBe("proxy");
  });

  test("does not trust forwarded IP headers from untrusted direct peers", async () => {
    const { auth } = createTestAuth({
      headscaleApiKey: "configured-headscale-key",
      proxyAuth: {
        enabled: true,
        allowedCidrs: ["203.0.113.0/24"],
        trustedProxyCidrs: ["10.0.0.0/24"],
        ipHeader: "X-Real-IP",
      },
    });
    const request = new Request("http://localhost/test", {
      headers: {
        "Remote-User": "alice",
        "X-Real-IP": "203.0.113.42",
      },
    });

    auth.registerRequestClientAddress(request, "198.51.100.10");

    await expectLoginRedirect(auth.require(request));
  });
});

describe("authorization", () => {
  let auth: AuthService;

  beforeEach(() => {
    ({ auth } = createTestAuth());
  });

  const apiKeyPrincipal: Principal = {
    kind: "api_key",
    sessionId: "test",
    displayName: "Test Key",
    apiKey: "key",
  };

  const oidcPrincipal: Principal = {
    kind: "oidc",
    sessionId: "test",
    user: { id: "u1", subject: "sub1", role: "viewer", headscaleUserId: "hs-1" },
    profile: { name: "Test" },
  };

  const machine: Machine = {
    id: "m1",
    machineKey: "",
    nodeKey: "",
    discoKey: "",
    ipAddresses: [],
    name: "test",
    lastSeen: "",
    expiry: null,
    createdAt: "",
    registerMethod: "REGISTER_METHOD_OIDC",
    tags: [],
    givenName: "test",
    online: true,
    approvedRoutes: [],
    availableRoutes: [],
    subnetRoutes: [],
    user: { id: "hs-1", name: "test", createdAt: "" },
  };

  test("can() returns true for api_key principal regardless of capability", () => {
    expect(auth.can(apiKeyPrincipal, Capabilities.write_machines)).toBe(true);
    expect(auth.can(apiKeyPrincipal, Capabilities.owner)).toBe(true);
  });

  test("canManageNode() returns true when user owns the node (matching headscaleUserId)", () => {
    expect(auth.canManageNode(oidcPrincipal, machine)).toBe(true);
  });

  test("canManageNode() returns false when user doesn't own the node and lacks write_machines", () => {
    const otherMachine: Machine = {
      ...machine,
      user: { id: "hs-other", name: "other", createdAt: "" },
    };
    expect(auth.canManageNode(oidcPrincipal, otherMachine)).toBe(false);
  });
});
