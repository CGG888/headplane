---
title: Audit Log
description: See who changed what in HeadplaneCN, when, and export it.
outline: [2, 3]
---

# Audit Log

Once more than one person can administer a tailnet, "who changed the policy
yesterday?" stops being a rhetorical question. **Settings → Audit log** answers
it from HeadplaneCN's own records.

## What gets recorded

Every change HeadplaneCN makes to Headscale is recorded with the acting identity,
the action, the target and whether it succeeded:

| Recorded              | Examples                                                      |
| --------------------- | ------------------------------------------------------------- |
| Headscale settings    | OIDC, trusted proxies, policy mode, node lifetime, logs, DERP |
| Access Control        | Policy saves and validations                                  |
| DNS                   | Added, removed and imported records                           |
| Machines              | Bulk tag, expiry, owner and delete runs                       |
| API keys              | Creation and expiry                                           |
| Process and snapshots | Reload/restart, taking and restoring a snapshot               |

The actor is the HeadplaneCN user who performed it, and the API key or OIDC
identity behind that user where one is available.

## Where it lives

Entries go into HeadplaneCN's own database (`server.data_path`, default
`/var/lib/headplane/`, file `hp_persist.db`), keeping the newest few thousand so
the file cannot grow without bound. Mount that directory as a volume if you want
the history to survive recreating the container.

## Viewing it

The page requires the `configure_iam` capability — the same permission that lets
someone change these settings in the first place. Entries are newest first with
filters by actor, action and time range.

## Exporting

**Export CSV** and **Export JSON** sit next to the filters and download the
selection the page is showing: the actor, action and time range filters are
applied, and the page number is not — an export always starts at the newest
entry, not at the page you happen to be on. The link is
`/settings/audit/export?format=csv` (or `json`), and the route keeps the same
`configure_iam` capability gate as the page itself.

| Format | Details                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV    | RFC 4180: a field containing a quote, a comma or a line break is quoted, and quotes inside it are doubled. The header row is translated into your language; the body keeps the recorded values verbatim. |
| JSON   | An array of records with `id`, `at` (ISO 8601), `actor`, `actorType`, `action`, `result`, `target` and `detail`.                                                                                         |

The file is named `headplane-audit-YYYYMMDD-HHMMSS.csv` (or `.json`), with the
timestamp in UTC so repeated downloads stay distinct, and is sent with
`Cache-Control: no-store`.

::: warning What it does not cover
Only changes made **through HeadplaneCN** are recorded. Edits made with
`headscale` on the host, or by hand in `config.yaml`, never pass through
HeadplaneCN and are invisible here.

An audit write is also best-effort: if it fails, the change itself still happens
and the failure is logged server-side, because losing a log line must not block
an operator.

An export is bounded as well: it stops at the newest 5,000 matching operations.
Once a filtered selection reaches that size the filters card says so, and a
download that was cut short carries `X-Audit-Export-Truncated: true` and
`X-Audit-Export-Total` so whatever consumes the file can tell.
:::
