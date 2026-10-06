/**
 * Stable action codes for the audit log. This module has no imports so client
 * components can map codes to labels without pulling server code into the
 * browser bundle.
 */

export const AUDIT_ACTIONS = {
  apiKeyCreate: "api_key.create",
  apiKeyExpire: "api_key.expire",
  restrictionAddDomain: "restriction.add_domain",
  restrictionRemoveDomain: "restriction.remove_domain",
  restrictionAddGroup: "restriction.add_group",
  restrictionRemoveGroup: "restriction.remove_group",
  restrictionAddUser: "restriction.add_user",
  restrictionRemoveUser: "restriction.remove_user",
  derpAddressSync: "derp.address_sync",
  derpRegionMirror: "derp.region_mirror",
  snapshotCreate: "snapshot.create",
  snapshotRestore: "snapshot.restore",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Action codes offered by the audit page's action filter. */
export const AUDIT_ACTION_CODES: readonly string[] = Object.values(AUDIT_ACTIONS);
