---
title: Overview
description: The read-only dashboard for versions, the embedded DERP region, service facts, counts and health.
outline: [2, 3]
---

# Overview

**Overview** is the first tab in the navigation and lives at `/overview`. It
answers the questions that otherwise mean opening several pages — what am I
running, how is Headscale configured, and is anything wrong? — in one place.

Nothing on the page writes. There are no forms and no actions, and every card
degrades on its own: a Headscale that does not answer, a configuration file
Headplane cannot read or an agent that is not running leave the rest of the
dashboard intact. A value that could not be read is shown as an em dash with a
short reason ("the Headscale API could not be read", "not configured") instead of
being guessed at.

## Versions

| Card                 | Shown                                                                                                                             | Source                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Headplane            | The version this build reports, and the latest Headplane release when it can be looked up                                          | The build version, and the same cached GitHub lookup the system page uses                                     |
| Headscale            | The running version, and the latest Headscale release when it can be looked up                                                     | Headscale's `/version` API                                                                                    |
| Headplane Agent      | The Tailscale version the agent reports, its last sync, how many nodes it reported and its last error                             | The agent's host info; when the agent is disabled the card says so and points at **Settings → Agent**         |

Headplane and Headscale each get an **Update available** chip when a newer release
exists, and a **No release information** chip when the lookup could not run, so an
offline instance is never claimed to be up to date.

## The embedded DERP region

The **Embedded Region** card describes `derp.server` and the DERP map:

| Row                   | Meaning                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region                | `#{id} · {code} · {name}` from `derp.server.region_id`, `region_code` and `region_name`                                                                      |
| Relay sources         | Where clients' relays come from, derived from `derp.server.enabled` and `derp.urls`: the embedded server only, the embedded server plus the public map, the public map only, or none |
| DERP map URLs         | How many `derp.urls` entries are configured                                                                                                                  |
| Local DERP map files  | How many `derp.paths` entries are configured                                                                                                                 |
| Machines homed here   | How many machines report this region as their home relay; the count comes from the Headplane Agent, so it needs the agent to be running                       |

The card's chip says whether the embedded server is enabled.

## Relay addresses and STUN

The second card separates what clients actually dial from what the configuration
file declares:

| Row                  | Chip       | Meaning                                                                                                                                                                  |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clients connect to   | Derived    | The public `host:port` for the relay, derived from Headscale's `server_url`. DERP shares Headscale's HTTPS endpoint, so the port comes from the URL — 443 when it carries none — and never from `listen_addr`. |
| Declared IPv4        | Configured | `derp.server.ipv4`, the address Headscale hands to clients that reach the relay directly                                                                                   |
| Declared IPv6        | Configured | `derp.server.ipv6`, the same for the other address family                                                                                                                  |
| STUN listen address  | Configured | `derp.server.stun_listen_addr`, the UDP address that answers STUN requests                                                                                                 |

::: warning STUN and IPv6-only clients

When `derp.server.ipv6` is set while STUN is bound to an IPv4 address such as
`0.0.0.0:3478`, the card raises a warning. Go binds an IPv4 literal as IPv4 only,
so a client without an IPv4 stack never reaches STUN and cannot discover its NAT
mapping. Use a dual-stack or IPv6 listen address such as `[::]:3478` instead.
Headscale's own `listen_addr`, which serves both the control API and the relay,
needs the same treatment.

:::

## Service facts

Three cards read the configuration Headplane already has:

| Card              | Shown                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headscale Server  | The configured Headscale URL and whether it answers, `base_domain`, and the policy mode (**File** or **Database**)                                                             |
| DNS & Policy      | The MagicDNS and override-local-DNS switches, and `dns.extra_records_path`, the extra-records file                                                                            |
| Metrics & Proxies | The metrics listener address and whether Headplane can reach it — **Reachable**, **Unreachable**, **Not enabled**, **Invalid listen address** or **Unknown** — and how many entries `trusted_proxies` has |

## Counts

| Card           | Shown                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailnet        | Nodes with their online/offline split, users, pre-auth keys (only on Headscale versions that expose a global key list) and API keys              |
| Headplane Data | Operation-log entries, and the number of configuration snapshots with their total size                                                          |

Counts that need the Headscale API show an em dash when that API cannot be read.
The snapshot size is formatted in binary units, and the audit and snapshot counts
come from Headplane's own stores.

## Health

The **Health Summary** card tallies the same configuration checks and diagnostics
that the [System Status](/features/system-status) page lists in full: the *pass*,
*warning* and *fail* counts of each list. The chip reads **Healthy** while the
diagnostics report no failures and no warnings, and **Needs attention** as soon
as one of them does. The last line links straight to the system page for the
per-check details, the metrics panel and the reload/restart button.
