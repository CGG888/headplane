import type { TranslationKey } from "~/i18n";

import type { AclActionErrorCode } from "./acl-action";

/**
 * Stable error codes returned by the ACL action, mapped onto the localized
 * explanatory line the Access Control page renders above Headscale's own
 * message. Kept free of server imports so the page can use it without pulling
 * server-only modules into the browser bundle.
 */
export const ACL_ERROR_KEYS: Record<AclActionErrorCode, TranslationKey> = {
  policyRejected: "acls.check.errors.policyRejected",
};
