import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * The `action_id` the ACL editor sends for a parse-only check. `acl-action.ts`
 * answers it without touching the stored policy.
 */
export const POLICY_CHECK_ACTION_ID = "check_policy";

/**
 * Revalidation policy for the access-control page.
 *
 * "Check" is a read-only request: it asks Headscale to parse the policy in the
 * editor and reports back, while every other action (including Save) is a real
 * mutation that must refresh the page. React Router cannot know that - any
 * fetcher submission, however harmless, sets `isRevalidationRequired` and
 * revalidates every loader of the current route by default - so clicking
 * "Check" re-ran `aclLoader`: a policy read plus the node and user lists, and a
 * re-render of the whole editor for data that had not changed.
 *
 * Only the parse-only check is silenced; everything else keeps React Router's
 * answer, so permissions, saves and errors behave exactly as before.
 */
export function shouldRevalidateAcls(args: ShouldRevalidateFunctionArgs): boolean {
  const { formData, defaultShouldRevalidate } = args;

  if (formData?.get("action_id") === POLICY_CHECK_ACTION_ID) {
    return false;
  }

  return defaultShouldRevalidate;
}
