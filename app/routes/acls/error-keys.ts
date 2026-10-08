import type { TranslationKey } from "~/i18n";
import type { PolicyIssueCode } from "~/utils/acl-policy";

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

/**
 * Localized explanation for every reason a dialogs' rule check can report. The
 * checks mirror Headscale's own validators, so these messages describe what
 * Headscale would say rather than a Headplane-only opinion.
 */
export const ACL_ISSUE_KEYS: Record<PolicyIssueCode, TranslationKey> = {
  aclAutogroupSelfSource: "acls.issues.aclAutogroupSelfSource",
  sshAutogroupDestination: "acls.issues.sshAutogroupDestination",
  sshAutogroupSource: "acls.issues.sshAutogroupSource",
  sshCheckPeriodInvalid: "acls.issues.sshCheckPeriodInvalid",
  sshCheckPeriodOnAccept: "acls.issues.sshCheckPeriodOnAccept",
  sshDestinationAlias: "acls.issues.sshDestinationAlias",
  sshDestinationHost: "acls.issues.sshDestinationHost",
  sshGroupMissing: "acls.issues.sshGroupMissing",
  sshSourceAlias: "acls.issues.sshSourceAlias",
  sshTagMissing: "acls.issues.sshTagMissing",
  sshTagSourceToAutogroupMember: "acls.issues.sshTagSourceToAutogroupMember",
  sshTagSourceToAutogroupSelf: "acls.issues.sshTagSourceToAutogroupSelf",
  sshTagSourceToUser: "acls.issues.sshTagSourceToUser",
  sshUserDestinationRequiresSameUser: "acls.issues.sshUserDestinationRequiresSameUser",
  sshUserInvalid: "acls.issues.sshUserInvalid",
};
