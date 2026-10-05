import type { ShouldRevalidateFunctionArgs } from "react-router";
import { describe, expect, test } from "vitest";

import { POLICY_CHECK_ACTION_ID, shouldRevalidateAcls } from "~/routes/acls/should-revalidate";

const ACLS = "https://headplane.example/acls";

function args(overrides: Partial<ShouldRevalidateFunctionArgs> = {}): ShouldRevalidateFunctionArgs {
  const currentUrl = new URL(ACLS);
  return {
    currentUrl,
    currentParams: {},
    nextUrl: currentUrl,
    nextParams: {},
    defaultShouldRevalidate: true,
    ...overrides,
  };
}

function checkRequest(): ShouldRevalidateFunctionArgs {
  const formData = new FormData();
  formData.append("action_id", POLICY_CHECK_ACTION_ID);
  formData.append("policy", '{"acls": []}');
  return args({ formAction: ACLS, formData, formMethod: "PATCH" });
}

describe("access-control revalidation", () => {
  test("the parse-only check never revalidates the page", () => {
    expect(shouldRevalidateAcls(checkRequest())).toBe(false);
  });

  test("a save revalidates, because it changes the stored policy", () => {
    const formData = new FormData();
    formData.append("policy", '{"acls": []}');

    expect(shouldRevalidateAcls(args({ formAction: ACLS, formData, formMethod: "PATCH" }))).toBe(
      true,
    );
  });

  test("another action id keeps React Router's answer", () => {
    const formData = new FormData();
    formData.append("action_id", "some_future_action");

    expect(shouldRevalidateAcls(args({ formAction: ACLS, formData, formMethod: "POST" }))).toBe(
      true,
    );
  });

  test("navigations and programmatic revalidations follow the default", () => {
    expect(shouldRevalidateAcls(args())).toBe(true);
    expect(shouldRevalidateAcls(args({ defaultShouldRevalidate: false }))).toBe(false);
  });
});
