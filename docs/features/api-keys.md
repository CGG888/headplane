---
title: API Keys
description: Create and revoke Headscale API keys from the Headplane UI.
outline: [2, 3]
---

# Headscale API Keys

Headscale's own API is authenticated with an **API key**, the kind that starts
with `hskey-api-`. Headplane needs one to talk to Headscale, and every other
tool you point at the API needs one too — which is why the keys live under
**Settings → API keys** instead of only in the server shell.

## Managing keys

| Action     | What happens                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create** | Pick how long the key should live (days). Headplane asks Headscale for a key that expires at that moment.                                             |
| **Copy**   | The full key is returned **exactly once**. Copy it straight away — Headscale only ever stores a prefix, so it cannot be shown again.                  |
| **Expire** | Revokes a key immediately. The prefix in the list is enough; Headplane normalises the masked `hskey-api-…-***` display form before calling Headscale. |

The list shows the prefix, when the key was created, when it expires and when it
was last used.

::: warning An API key is full admin access
Headscale has no scopes or roles for API keys: any valid, unexpired key can do
everything the API allows, including creating further keys. Treat one exactly
like the root password:

- keep it in a password manager, not in a chat or an issue,
- prefer short expirations and rotate,
- expire keys you no longer recognise.
  :::

## Requirements

- The Headplane user needs the **`configure_iam`** capability (`owner`, `admin`
  and `network_admin` have it).
- Creating a key talks to Headscale with the API key Headplane is configured
  with, so that key must still be valid.

::: tip Expiration is mandatory
Headscale stores whatever `expiration` it is given, and a key with no
expiration is created with the zero timestamp — which Headscale then treats as
already expired. Headplane always sends an explicit expiration so this cannot
happen by accident.
:::

## Where the key is used

`headscale.api_key` in Headplane's own configuration is the key Headplane uses
for everything: reading nodes and users, writing the policy, and the Headplane
Agent's automatic pre-auth keys. Rotating it means updating that file and
restarting Headplane.
