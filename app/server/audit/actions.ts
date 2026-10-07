/**
 * Stable action codes for the audit log. This module has no imports so client
 * components can map codes to labels without pulling server code into the
 * browser bundle.
 */

export const AUDIT_ACTIONS = {
  apiKeyCreate: "api_key.create",
  apiKeyExpire: "api_key.expire",
  apiKeyDelete: "api_key.delete",
  preAuthKeyCreate: "pre_auth_key.create",
  preAuthKeyExpire: "pre_auth_key.expire",
  preAuthKeyDelete: "pre_auth_key.delete",
  userCreate: "user.create",
  userDelete: "user.delete",
  userRename: "user.rename",
  userRoleChange: "user.role_change",
  userOwnershipTransfer: "user.ownership_transfer",
  userLink: "user.link",
  restrictionAddDomain: "restriction.add_domain",
  restrictionRemoveDomain: "restriction.remove_domain",
  restrictionAddGroup: "restriction.add_group",
  restrictionRemoveGroup: "restriction.remove_group",
  restrictionAddUser: "restriction.add_user",
  restrictionRemoveUser: "restriction.remove_user",
  registrationReject: "registration.reject",
  nodeBackfillIps: "node.backfill_ips",
  nodeDebugCreate: "node.debug_create",
  // Triggering the in-container agent hands it a Tailscale auth key, which
  // joins a machine to the tailnet: a node-level change worth keeping.
  agentSync: "agent.sync",
  derpAddressSync: "derp.address_sync",
  derpRegionMirror: "derp.region_mirror",
  snapshotCreate: "snapshot.create",
  snapshotRestore: "snapshot.restore",
  // Local API key logins. Failures are recorded because the login form is the
  // one place an unauthenticated caller can submit a credential; the throttle
  // in front of it bounds how many entries this can produce per address.
  loginSuccess: "auth.login",
  loginFailure: "auth.login_failure",
  loginLocked: "auth.login_locked",
  // HeadplaneCN's own console-login configuration: an update names the fields
  // that changed (never their values), and a blocked change is recorded because
  // the refusal is a security decision worth keeping.
  loginOidcUpdate: "login_oidc.update",
  loginOidcChangeBlocked: "login_oidc.change_blocked",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Action codes offered by the audit page's action filter. */
export const AUDIT_ACTION_CODES: readonly string[] = Object.values(AUDIT_ACTIONS);
