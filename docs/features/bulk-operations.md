---
title: Bulk Machine Operations
description: Select many machines and change their tags, expiry or owner in one go.
outline: [2, 3]
---

# Bulk Machine Operations

Managing a tailnet one machine at a time gets old quickly. The machines page
lets you tick any number of rows — or the whole filtered list — and act on all of
them at once.

## Selecting machines

A checkbox column appears on the machines page for anyone who can write
machines. The header checkbox selects **every row that currently passes your
filters and search**, which is the behaviour you want after narrowing the list
down to, say, every machine without a tag.

## What you can do in bulk

| Action           | Notes                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Set tags**     | Replaces the tags on every selected machine. Tags must already exist in the Access Control policy (`tagOwners`), otherwise Headscale rejects the update. |
| **Set expiry**   | The same three choices as a single machine: never expires, the default expiry, or a specific date and time.                                              |
| **Change owner** | Only offered when Headscale lets a node's owner change (Headscale 0.28+ locks the owner after registration).                                             |
| **Delete**       | Removes the machines from Headscale. The devices have to register again to come back, so this is the one to use carefully.                               |

## Partial failures

Bulk actions are applied one machine at a time, so one rejected machine does not
abort the rest. When something fails you get a summary of how many machines were
updated and how many failed, and the failures are logged server-side with the
Headscale error for the affected machine.

::: tip Bulk operations and the policy
Because tags are validated against the policy, a bulk tag change is a quick way
to notice that a tag was never declared: Headscale answers `tags not in policy`
and the UI reports it instead of silently doing nothing.
:::

::: warning Deleting machines
Deleting a machine removes it from Headscale immediately. Its key is gone, so
the device needs to re-authenticate (`tailscale up`) before it shows up again.
When the Headplane Agent is enabled, nodes come back with fresh details on the
next sync.
:::
