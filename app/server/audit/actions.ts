/**
 * Stable action codes for the audit log. This module has no imports so client
 * components can map codes to labels without pulling server code into the
 * browser bundle.
 */

export const AUDIT_ACTIONS = {
  apiKeyCreate: "api_key.create",
  apiKeyExpire: "api_key.expire",
  apiKeyDelete: "api_key.delete",
  preAuthKeyDelete: "pre_auth_key.delete",
  restrictionAddDomain: "restriction.add_domain",
  restrictionRemoveDomain: "restriction.remove_domain",
  restrictionAddGroup: "restriction.add_group",
  restrictionRemoveGroup: "restriction.remove_group",
  restrictionAddUser: "restriction.add_user",
  restrictionRemoveUser: "restriction.remove_user",
  registrationReject: "registration.reject",
  nodeBackfillIps: "node.backfill_ips",
  nodeDebugCreate: "node.debug_create",
  derpAddressSync: "derp.address_sync",
  derpRegionMirror: "derp.region_mirror",
  snapshotCreate: "snapshot.create",
  snapshotRestore: "snapshot.restore",
  // HeadplaneCN's own console-login configuration: an update names the fields
  // that changed (never their values), and a blocked change is recorded because
  // the refusal is a security decision worth keeping.
  loginOidcUpdate: "login_oidc.update",
  loginOidcChangeBlocked: "login_oidc.change_blocked",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Action codes offered by the audit page's action filter. */
export const AUDIT_ACTION_CODES: readonly string[] = Object.values(AUDIT_ACTIONS);
