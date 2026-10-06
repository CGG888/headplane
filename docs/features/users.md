---
title: Users
description: Headplane accounts, their roles, linked Headscale users and ACL groups.
outline: [2, 3]
---

# Users

**Users** separates two things that are easy to confuse: the accounts that sign
in to Headplane, and the users that exist in Headscale.

## Headplane users

The first section lists every account that has signed in to Headplane, with its
role, its last login, whether it is linked to a Headscale user, and the machines
that link gives it.

Accounts are created by signing in. The banner at the top of the page says where
they come from — **Users are managed through your OIDC provider** with a link to
it, or, when OIDC is not configured, that they are managed locally, next to a
shortcut to the [OIDC settings](/features/headscale-settings#oidc). The first
account to sign in becomes the owner.

| Role              | What it can do                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Owner**         | Everything, including transferring ownership. There is exactly one.                             |
| **Admin**         | The admin console, plus network, machine and user settings.                                     |
| **Network Admin** | The admin console, ACLs and network settings; no machines and no users.                         |
| **IT Admin**      | The admin console, machines and users; no ACLs and no network settings.                         |
| **Auditor**       | The admin console, read-only.                                                                   |
| **Viewer**        | Machines and users, and their own auth keys; no admin console.                                  |
| **Member**        | No admin console.                                                                               |

## What you can do to an account

| Action                | Notes                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Change role**       | Moves the account between the roles above. The owner's role cannot be reassigned.                                                        |
| **Rename**            | Changes the account name. ACL policies that refer to the user by name are **not** updated.                                                |
| **Link a Headscale user** | Connects the account to a Headscale user, which is what decides whose machines it manages. An account can be re-linked later.        |
| **Edit ACL groups**   | Adds or removes the user in the policy's `groups`. Groups live in the ACL policy, so this needs `policy.mode: database`; a policy that contains comments has them dropped when it is rewritten. |
| **Transfer ownership** | Owner only. The owner becomes an admin and the target becomes the owner.                                                                  |
| **Delete**            | Refused while the linked Headscale user still has machines — re-assign or delete those first. A user authenticated through OIDC is recreated the next time they sign in. |

## Unlinked Headscale users

The second section lists the Headscale users no Headplane account has claimed.
They cannot be managed through Headplane until an account links to them, which is
what the **Link Headscale user** action on a Headplane account is for.

**Add user** creates a **Headscale** user, not a Headplane account: the new user
appears in this section and is linked automatically once it signs in through your
OIDC provider. A username has to be at least two characters, start with a letter
and use only letters, numbers, dots, dashes and underscores.

When the Headscale API cannot be read, the page says so and the Headscale user
data — and the machines each account manages — is unavailable rather than shown
empty.
