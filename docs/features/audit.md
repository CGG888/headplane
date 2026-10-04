---
title: Audit Log
description: See who changed what in Headplane, and when.
outline: [2, 3]
---

# Audit Log

Once more than one person can administer a tailnet, "who changed the policy
yesterday?" stops being a rhetorical question. **Settings → Audit log** answers
it from Headplane's own records.

## What gets recorded

Every change Headplane makes to Headscale is recorded with the acting identity,
the action, the target and whether it succeeded:

| Recorded              | Examples                                                      |
| --------------------- | ------------------------------------------------------------- |
| Headscale settings    | OIDC, trusted proxies, policy mode, node lifetime, logs, DERP |
| Access Control        | Policy saves and validations                                  |
| DNS                   | Added, removed and imported records                           |
| Machines              | Bulk tag, expiry, owner and delete runs                       |
| API keys              | Creation and expiry                                           |
| Process and snapshots | Reload/restart, taking and restoring a snapshot               |

The actor is the Headplane user who performed it, and the API key or OIDC
identity behind that user where one is available.

## Where it lives

Entries go into Headplane's own database (`server.data_path`, default
`/var/lib/headplane/`, file `hp_persist.db`), keeping the newest few thousand so
the file cannot grow without bound. Mount that directory as a volume if you want
the history to survive recreating the container.

## Viewing it

The page requires the `configure_iam` capability — the same permission that lets
someone change these settings in the first place. Entries are newest first with
filters by actor and action.

::: warning What it does not cover
Only changes made **through Headplane** are recorded. Edits made with
`headscale` on the host, or by hand in `config.yaml`, never pass through
Headplane and are invisible here.

An audit write is also best-effort: if it fails, the change itself still happens
and the failure is logged server-side, because losing a log line must not block
an operator.
:::
