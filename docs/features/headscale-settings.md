---
title: Headscale Settings
description: Edit Headscale's OIDC configuration, trusted proxies and policy mode from Headplane.
outline: [2, 3]
---

# Headscale Settings

**Settings → Headscale** edits the parts of Headscale's own `config.yaml` that
Headplane can safely change for you, instead of leaving you to SSH in.

::: warning Requirements

- Headscale's configuration file must be mounted **read-write** into Headplane
  and `headscale.config_path` must point at it. Without it Headplane can neither
  show nor save these values (see [Network Management](/install/docker#network-management)).
- Headscale reads most of this at startup, so changes only take effect after the
  Headscale process restarts. With the process integration enabled Headplane asks
  it to reload or restart for you.
  :::

## OIDC

The full single sign-on block:

| Field                             | Notes                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issuer`                          | The provider's discovery URL. **Headscale treats an empty issuer as "OIDC disabled".**                                                                                                                                         |
| `client_id`                       | Client registered at the provider.                                                                                                                                                                                             |
| `client_secret`                   | Write-only here: Headplane shows whether a secret is set, never its value. Leave the field untouched to keep the current one. Setting `client_secret_path` instead of an inline secret is respected and shown as "configured". |
| `scope`                           | Defaults to `openid`, `profile`, `email`.                                                                                                                                                                                      |
| `email_verified_required`         | Default `true`. Turn it off only for providers that never send `email_verified`.                                                                                                                                               |
| `use_expiry_from_token`           | Default `false`. When enabled, OIDC logins use the provider's token expiry and `node.expiry` is ignored for those nodes.                                                                                                       |
| `only_start_if_oidc_is_available` | Default `true`; when off, Headscale starts even if the provider is unreachable.                                                                                                                                                |
| `pkce`                            | `enabled` (default `false`) and `method` (`plain` or `S256`, default `S256`).                                                                                                                                                  |

The **allowed domains / users / groups** lists have their own page under
[Settings → Restrictions](/features/sso#login-restrictions), because they are
changed far more often than the rest of the block.

::: danger Removed in Headscale 0.29
`oidc.expiry`, `oidc.strip_email_domain` and `oidc.map_legacy_users` are no
longer supported: Headscale refuses to start when they are present. Node
lifetime now lives in the top-level `node.expiry`. Headplane warns about these
keys instead of silently writing around them.
:::

## Trusted proxies

`trusted_proxies` is a list of CIDRs (for example `127.0.0.1/32`,
`172.16.0.0/12`). Only connections whose source address falls inside one of
those ranges have their `True-Client-IP`, `X-Real-IP` and `X-Forwarded-For`
headers honoured — for everyone else Headscale deletes those headers, so a
client cannot spoof its own address in the logs and in node registration.

Headplane rejects `0.0.0.0/0` and `::/0`: Headscale treats them as a
configuration error, and trusting every peer would defeat the point.

## Policy mode

| Mode             | Meaning                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file` (default) | The policy is a HuJSON file that Headscale reads. Its API is **read-only**, so the Access Control editor can only save when Headplane can write that file itself. |
| `database`       | The policy lives in Headscale's database and is writable through the API — this is what lets the [Access Control editor](/features/acls) save changes.            |

Switching modes **does not copy the policy**:

- `file` → `database`: restart Headscale, then import the file once with
  `headscale policy set -f <path>` (or save it from the Headplane editor) —
  until then the database policy is empty, which means _allow all_.
- `database` → `file`: write the current policy to a file and point
  `policy.path` at it before restarting, otherwise the policy is empty.
