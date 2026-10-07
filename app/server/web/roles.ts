export type Capabilities = (typeof Capabilities)[keyof typeof Capabilities];
export const Capabilities = {
  ui_access: 1 << 0,
  read_policy: 1 << 1,
  write_policy: 1 << 2,
  read_network: 1 << 3,
  write_network: 1 << 4,
  read_feature: 1 << 5,
  write_feature: 1 << 6,
  configure_iam: 1 << 7,
  read_machines: 1 << 8,
  write_machines: 1 << 9,
  read_users: 1 << 10,
  write_users: 1 << 11,
  generate_authkeys: 1 << 12,
  generate_own_authkeys: 1 << 16,
  use_tags: 1 << 13,
  write_tailnet: 1 << 14,
  owner: 1 << 15,
} as const;

export const Roles = {
  owner:
    Capabilities.ui_access |
    Capabilities.read_policy |
    Capabilities.write_policy |
    Capabilities.read_network |
    Capabilities.write_network |
    Capabilities.read_feature |
    Capabilities.write_feature |
    Capabilities.configure_iam |
    Capabilities.read_machines |
    Capabilities.write_machines |
    Capabilities.read_users |
    Capabilities.write_users |
    Capabilities.generate_authkeys |
    Capabilities.use_tags |
    Capabilities.write_tailnet |
    Capabilities.owner,

  admin:
    Capabilities.ui_access |
    Capabilities.read_policy |
    Capabilities.write_policy |
    Capabilities.read_network |
    Capabilities.write_network |
    Capabilities.read_feature |
    Capabilities.write_feature |
    Capabilities.configure_iam |
    Capabilities.read_machines |
    Capabilities.write_machines |
    Capabilities.read_users |
    Capabilities.write_users |
    Capabilities.generate_authkeys |
    Capabilities.use_tags |
    Capabilities.write_tailnet,

  network_admin:
    Capabilities.ui_access |
    Capabilities.read_policy |
    Capabilities.write_policy |
    Capabilities.read_network |
    Capabilities.write_network |
    Capabilities.read_feature |
    Capabilities.read_machines |
    Capabilities.read_users |
    Capabilities.generate_authkeys |
    Capabilities.use_tags |
    Capabilities.write_tailnet,

  it_admin:
    Capabilities.ui_access |
    Capabilities.read_policy |
    Capabilities.read_network |
    Capabilities.read_feature |
    Capabilities.write_feature |
    Capabilities.configure_iam |
    Capabilities.read_machines |
    Capabilities.write_machines |
    Capabilities.read_users |
    Capabilities.write_users |
    Capabilities.generate_authkeys,

  auditor:
    Capabilities.ui_access |
    Capabilities.read_policy |
    Capabilities.read_network |
    Capabilities.read_feature |
    Capabilities.read_machines |
    Capabilities.read_users |
    Capabilities.generate_own_authkeys,

  viewer:
    Capabilities.ui_access |
    Capabilities.read_machines |
    Capabilities.read_users |
    Capabilities.generate_own_authkeys,

  // No access — user exists but has not been granted any role
  member: 0,
} as const;

export type Role = keyof typeof Roles;
export type Capability = keyof typeof Capabilities;

/**
 * The roles an IdP claim or an administrator may hand out, in the priority
 * order the OIDC role claim uses when the claim carries a list. `owner` is
 * deliberately absent: ownership is transferred inside HeadplaneCN and is never
 * taken from a claim.
 */
export const ASSIGNABLE_ROLES = [
  "admin",
  "network_admin",
  "it_admin",
  "auditor",
  "viewer",
  "member",
] as const satisfies ReadonlyArray<Role>;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(value: string): value is AssignableRole {
  return ASSIGNABLE_ROLES.some((role) => role === value);
}

/**
 * Coerce a role name that came from the database or a claim into a real role.
 * `value in Roles` was the old shape of this check and it walks the prototype
 * chain, so a stored `"constructor"` or `"toString"` used to survive and reach
 * `capsForRole`/`hasCapability`. The owner is kept, everything else unknown
 * falls back to `member`, which is the database default.
 */
export function normalizeRole(value: string): Role {
  if (value === "owner" || isAssignableRole(value)) {
    return value;
  }

  return "member";
}

export function hasCapability(role: Role, capability: Capability): boolean {
  return (Roles[role] & Capabilities[capability]) !== 0;
}

export function getRoleFromCapabilities(capabilities: Capabilities): Role {
  const iterable = Roles as Record<string, Capabilities>;
  for (const role in iterable) {
    if (iterable[role] === capabilities) {
      return role as Role;
    }
  }

  return "member";
}

export function capsForRole(role: Role): number {
  return Roles[role];
}
