---
title: Snapshots
description: Automatic backups of Headscale's configuration, with one-click restore.
outline: [2, 3]
---

# Snapshots

HeadplaneCN writes to Headscale's `config.yaml` for you — DNS, OIDC, policy mode,
DERP, logs. **Settings → Snapshots** keeps a copy of the file from before each
of those writes, so a change you regret is one click away from being undone.

## What a snapshot contains

| File                            | When                         |
| ------------------------------- | ---------------------------- |
| Headscale's `config.yaml`       | Every snapshot               |
| The policy file (`policy.path`) | When `policy.mode` is `file` |

Each snapshot is a directory under `server.data_path/snapshots/`, named with its
timestamp and the reason it was taken (`settings`, `dns`, `manual`, …), together
with a small index that the page reads.

::: tip Mount the data directory
Snapshots live under `server.data_path` (default `/var/lib/headplane/`). Without
a volume mount there, they disappear when the container is recreated — exactly
when you would want them.
:::

## Taking and restoring

- **Take a snapshot** manually before you do something ambitious.
- **Download** any file in a snapshot to keep it somewhere else.
- **Restore** writes the recorded file(s) back to the configured paths, asks
  Headscale to reload or restart through the configured integration, and records
  an audit entry. It refuses to write anywhere other than the paths Headscale's
  configuration actually points at.

Restoring is destructive in the sense that it replaces the current file, so the
page asks for confirmation and requires the `configure_iam` capability. A
restart is often needed for the restored configuration to take effect.

::: danger Not a database backup
Snapshots cover Headscale's **configuration**, not its database. Back up
`db.sqlite` (or your Postgres database) separately — stop Headscale and copy the
file, or use SQLite's `.backup`, so the copy is consistent.
:::
