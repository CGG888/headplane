import { describe, expect, test, vi } from "vitest";

import { restrictionAction } from "~/routes/settings/restrictions/actions";
import { authContext, headscaleConfigContext } from "~/server/context";
import {
  isValidRestrictionDomain,
  isValidRestrictionName,
  RESTRICTION_DOMAIN_MAX_LENGTH,
  RESTRICTION_STRING_MAX_LENGTH,
} from "~/utils/restrictions";

function mockRequest(entries: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

// The dialogs import the same helpers this file exercises, so a change to the
// shared rules shows up on both sides.
function createHarness() {
  const principal = {
    kind: "api_key",
    displayName: "Tester",
    apiKey: "hskey-api-abcdef123456",
  };

  const mutate = vi.fn((build: () => unknown) => {
    build();
    return Promise.resolve();
  });

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return { require: () => Promise.resolve(principal), can: () => true };
      }

      if (key === headscaleConfigContext) {
        return {
          writable: () => true,
          getOIDCConfig: () => ({ allowedDomains: [], allowedGroups: [], allowedUsers: [] }),
          mutate,
        };
      }

      return undefined;
    },
  };

  return { context, mutate };
}

async function call(entries: Record<string, string>) {
  const { context, mutate } = createHarness();

  try {
    const result = await restrictionAction({ request: mockRequest(entries), context } as never);
    return { status: (result as { init?: { status: number } }).init?.status ?? 200, mutate };
  } catch (thrown) {
    return { status: (thrown as { init?: { status?: number } }).init?.status ?? 0, mutate };
  }
}

describe("shared restriction rules", () => {
  test("domains need at least two labels and no foreign characters", () => {
    expect(isValidRestrictionDomain("example.com")).toBe(true);
    expect(isValidRestrictionDomain("sub.example.co.uk")).toBe(true);
    // The action's regex is case-insensitive; the old dialog check compared
    // `URL.hostname` with the raw input and refused this.
    expect(isValidRestrictionDomain("EXAMPLE.com")).toBe(true);
    expect(isValidRestrictionDomain("localhost")).toBe(false);
    expect(isValidRestrictionDomain("foo_bar.com")).toBe(false);
    expect(isValidRestrictionDomain("example.com/path")).toBe(false);
    expect(isValidRestrictionDomain(" example.com")).toBe(false);
    expect(isValidRestrictionDomain("a".repeat(RESTRICTION_DOMAIN_MAX_LENGTH))).toBe(false);
    expect(isValidRestrictionDomain(`${"a".repeat(250)}.com`)).toBe(false);
    expect(isValidRestrictionDomain(`${"a".repeat(249)}.com`)).toBe(true);
  });

  test("group and user names reject whitespace and stay within the limit", () => {
    expect(isValidRestrictionName("admin")).toBe(true);
    expect(isValidRestrictionName("john_doe")).toBe(true);
    expect(isValidRestrictionName("a".repeat(RESTRICTION_STRING_MAX_LENGTH))).toBe(true);
    expect(isValidRestrictionName("")).toBe(false);
    expect(isValidRestrictionName("has space")).toBe(false);
    expect(isValidRestrictionName("tab\there")).toBe(false);
    expect(isValidRestrictionName("newline\n")).toBe(false);
    expect(isValidRestrictionName("delete\u007f")).toBe(false);
    expect(isValidRestrictionName("a".repeat(RESTRICTION_STRING_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("restriction action validation", () => {
  test("refuses domains the dialog now also refuses", async () => {
    for (const domain of ["example", "foo_bar.com", `a${"b".repeat(253)}.com`]) {
      const { status, mutate } = await call({ action_id: "add_domain", domain });
      expect(status, domain).toBe(400);
      expect(mutate).not.toHaveBeenCalled();
    }
  });

  test("accepts a domain the old dialog check refused", async () => {
    const { status, mutate } = await call({ action_id: "add_domain", domain: "Example.COM" });
    expect(status).toBe(200);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  test("refuses groups and users the dialogs now also refuse", async () => {
    const cases: Record<string, string>[] = [
      { action_id: "add_group", group: "a".repeat(RESTRICTION_STRING_MAX_LENGTH + 1) },
      { action_id: "add_group", group: "has space" },
      { action_id: "add_user", user: "has space" },
      { action_id: "add_user", user: "line\nbreak" },
    ];

    for (const entries of cases) {
      const { status, mutate } = await call(entries);
      expect(status, JSON.stringify(entries)).toBe(400);
      expect(mutate).not.toHaveBeenCalled();
    }
  });

  test("accepts the ordinary group and user names", async () => {
    const group = await call({ action_id: "add_group", group: "admin" });
    expect(group.status).toBe(200);
    expect(group.mutate).toHaveBeenCalledTimes(1);

    const user = await call({ action_id: "add_user", user: "john_doe" });
    expect(user.status).toBe(200);
    expect(user.mutate).toHaveBeenCalledTimes(1);
  });
});
