---
title: Differences from upstream Headplane
description: What headplaneCN adds or changes compared with the upstream Headplane project, one card per item.
outline: [2, 3]
---

# Differences from upstream Headplane

This is [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN), a fork of
[Headplane](https://github.com/tale/headplane) aimed at self-hosted NAS setups
(fnOS in particular). This page lists everything the fork adds or changes
compared with the upstream project.

## What this fork adds or changes

<div class="feature-grid">
<div class="feature-card">

### fnOS and native Headscale integration

The docs and compose guidance cover a Headscale installed as a native fnOS
process next to a containerised HeadplaneCN: `pid: host` so `integration.proc` can
find and signal `headscale serve`, and Headscale's effective `config.yaml`
mounted **read-write** so the DNS and Settings pages appear. The rule that
matters most: `derp.paths` is read by **Headscale on the host**, so every entry
must be a **host path** whose directory is mounted into the container **at the
identical absolute path**. A container-only path looks fine in the UI but makes
Headscale refuse to start (`getting DERPMap: open …: no such file or
directory`); the fix is to remove the entry or roll back the pre-write snapshot,
then restart.

If you want Docker to manage Headscale as well, use
[dual-image deployment →](/en/install/dual-image): two containers, the data directory mounted at
the **same absolute path** (not a single character of the configuration changes), and the
**Docker integration** restarting the Headscale container — a shape that needs neither
`pid: host` nor the AppArmor exemption.

[fnOS installation →](/en/install/fnos)

</div>
<div class="feature-card">

### DERP map files you can edit in the browser

Every path in `derp.paths` gets View, Edit, Save and Roll back, plus **Create
from example** with three commented templates. Saves are validated on the server
against the DERP map schema (unique region ids and codes, node regions,
hostnames, ports), a snapshot of the file is taken first, and a roll back
snapshots what it replaces.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### Automatic relay address sync

A 6/12/24-hour schedule, or **Run now**, detects `derp.server.ipv4`/`ipv6` and
writes **only the key whose value actually changed**, after snapshotting the
configuration and recording an audit entry. Auto-reload defaults to **on** so
clients pick the change up immediately — with the warning that a reload briefly
interrupts connected clients. IPv4 comes from the A record of the `server_url`
hostname; IPv6 comes from the host machine's own global unicast address.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### External IPv6 echo

An optional check asks a public endpoint what address the internet actually
sees, for when a router forwards or translates IPv6. It is the authority when
NAT66 or a forwarding router rewrites the address, since no local interface
holds it then. **Off by default** (it contacts a third party) and IPv6-only.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### Official region filter

Mirror Tailscale's official public DERP regions into your own local map file,
keeping only the ones you tick. They are renumbered into the **900s** from
**901** upward, fastest measured latency first (unmeasured regions last) — no
region is pinned and nothing is ticked by default. Numbers are stable across
runs, so clients keep the relay they selected; only **Renumber** re-ranks them.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### Alert notifications

Point a webhook at one URL and get pushed JSON when a node goes offline,
Headscale becomes unreachable (and when it recovers), a key nears expiry, a
configuration check turns into a failure, or a **writing** DERP address/region
run fails.

[Alert notifications →](/en/features/notifications)

</div>
<div class="feature-card">

### Configuration snapshots and the audit log

HeadplaneCN stores a snapshot before it writes configuration, so a bad change is
one click from being restored, and records every write so you can see who changed
what and when.

[Snapshots →](/en/features/snapshots) · [Audit log →](/en/features/audit)

</div>
<div class="feature-card">

### Machine list and detail improvements

Latency-by-region rows resolve real region names instead of "unknown", the
relay's IPv4 and IPv6 carry a copy button along with the one **in use** and its
source, the list filters and sorts on nearly every column, and bulk actions work
off a selection column.

[Machines →](/en/features/machines) · [Bulk operations →](/en/features/bulk-operations)

</div>
<div class="feature-card">

### Three interface languages and live updates

English, Simplified Chinese and Traditional Chinese ship in the box, with no
configuration. The header's **Live updates** switch is **off by default**, so
pages no longer reload themselves every few seconds in the background.

[Languages →](/en/features/languages)

</div>
</div>

## Upstream credit

This project is based on the upstream [Headplane](https://github.com/tale/headplane)
project by [tale](https://github.com/tale); that credit, its licence and its
original features are kept here. Everything not listed above is upstream's work.
