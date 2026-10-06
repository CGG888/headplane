---
title: API Keys
description: Create and revoke Headscale API keys from the HeadplaneCN UI.
outline: [2, 3]
---

# Headscale API Keys

Headscale's own API is authenticated with an **API key**, the kind that starts
with `hskey-api-`. HeadplaneCN needs one to talk to Headscale, and every other
tool you point at the API needs one too — which is why the keys live under
**Settings → API keys** instead of only in the server shell.

## Managing keys

| Action     | What happens                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create** | Pick how long the key should live (days). HeadplaneCN asks Headscale for a key that expires at that moment.                                             |
| **Copy**   | The full key is returned **exactly once**. Copy it straight away — Headscale only ever stores a prefix, so it cannot be shown again.                  |
| **Expire** | Revokes a key immediately. The prefix in the list is enough; HeadplaneCN normalises the masked `hskey-api-…-***` display form before calling Headscale. |

The list shows the prefix, when the key was created, when it expires and when it
was last used. Expired keys are counted next to the status filter, and the
filter can be switched to **Active** to hide them; selecting several keys and
choosing **Expire selected** revokes them together.

## Keys cannot be deleted

Headscale has no delete for API keys — its API only offers
`POST /api/v1/apikey/expire`, and the CLI equivalent is
`headscale apikeys expire --prefix <PREFIX>`. So the list never loses a key:

- **Expiring is the revoke.** It takes effect immediately: the key stops
  authenticating the moment Headscale records it, and it cannot be undone.
- **The record stays.** An expired key keeps its place in the list for
  traceability, and the page marks it as expired instead of offering the expire
  action again, so you can still see when it was created and when it was last
  used. Because there is nothing to delete, there is also nothing to clean up.
- **Rotating** therefore means: create a new key, put it in
  `headscale.api_key`, restart HeadplaneCN, then expire the old key.

The **Pre-Auth Keys** page works the same way: pre-auth keys are revoked by
expiring them, used and expired keys stay in the list, and nothing is deleted.

::: warning An API key is full admin access
Headscale has no scopes or roles for API keys: any valid, unexpired key can do
everything the API allows, including creating further keys. Treat one exactly
like the root password:

- keep it in a password manager, not in a chat or an issue,
- prefer short expirations and rotate,
- expire keys you no longer recognise.
  :::

## Requirements

- The HeadplaneCN user needs the **`configure_iam`** capability (`owner`, `admin`
  and `network_admin` have it).
- Creating a key talks to Headscale with the API key HeadplaneCN is configured
  with, so that key must still be valid.

::: tip Expiration is mandatory
Headscale stores whatever `expiration` it is given, and a key with no
expiration is created with the zero timestamp — which Headscale then treats as
already expired. HeadplaneCN always sends an explicit expiration so this cannot
happen by accident.
:::

## Where the key is used

`headscale.api_key` in HeadplaneCN's own configuration is the key HeadplaneCN uses
for everything: reading nodes and users, writing the policy, and the HeadplaneCN
Agent's automatic pre-auth keys. Rotating it means updating that file and
restarting HeadplaneCN.
