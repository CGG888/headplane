import { describe, expect, test } from "vitest";

import { confirmedDeleteRequest as apiKeyDeleteRequest } from "~/routes/settings/api-keys/delete-confirm";
import { confirmedDeleteRequest as authKeyDeleteRequest } from "~/routes/settings/auth-keys/delete-confirm";

// The dialogs are React components and the unit project has no DOM, so the
// confirmation gate they submit through is tested directly: nothing is sent
// unless the operator confirmed inside the dialog, and when it is sent the
// action receives exactly the fields it switches on.

describe("API key delete confirmation", () => {
  test("produces nothing before the operator confirms", () => {
    expect(apiKeyDeleteRequest(false, { prefix: "abcdefghijkl" })).toBeNull();
  });

  test("builds the request the action expects once confirmed", () => {
    const form = apiKeyDeleteRequest(true, { prefix: "hskey-api-abcdefghijkl-***" });

    expect(form?.get("action_id")).toBe("delete_api_key");
    expect(form?.get("prefix")).toBe("hskey-api-abcdefghijkl-***");
  });

  test("has no other fields to smuggle in", () => {
    const form = apiKeyDeleteRequest(true, { prefix: "abcdefghijkl" });

    expect([...(form?.keys() ?? [])].sort()).toEqual(["action_id", "prefix"]);
  });
});

describe("Pre-auth key delete confirmation", () => {
  test("produces nothing before the operator confirms", () => {
    expect(authKeyDeleteRequest(false, { key_id: "7" })).toBeNull();
  });

  test("builds the request the action expects once confirmed", () => {
    const form = authKeyDeleteRequest(true, { key_id: "7", user_id: "1" });

    expect(form?.get("action_id")).toBe("delete_preauthkey");
    expect(form?.get("key_id")).toBe("7");
    expect(form?.get("user_id")).toBe("1");
  });

  // Tag-only keys have no owner, so the ownership check has nothing to compare.
  test("omits the owner for a tag-only key", () => {
    const form = authKeyDeleteRequest(true, { key_id: "8" });

    expect(form?.get("user_id")).toBeNull();
    expect([...(form?.keys() ?? [])].sort()).toEqual(["action_id", "key_id"]);
  });
});
