---
title: Machines
description: The machine list, the filters, and every card on a machine's detail page.
outline: [2, 3]
---

# Machines

**Machines** is the tailnet's inventory: one row per registered machine, and a
detail page that gathers everything HeadplaneCN knows about a single one.

## The machine list

| Column       | Shown                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Machine name | The name HeadplaneCN shows, with its owner beneath it; a machine owned by a tag says `tag:…` instead |
| Addresses    | The machine's Tailscale IPv4 address, and its IPv6 address when it has one                           |
| Version      | The Tailscale version the machine reports — only with the [HeadplaneCN Agent](/en/features/agent)    |
| Status       | Online or offline                                                                                    |
| Last seen    | When the control server last heard from the machine                                                  |

The list is searchable, sortable on nearly every column, and filterable by user,
ACL tag, status and advertised route. Filters combine, and a clear-filters button
appears as soon as one is active.

Anyone who can write machines also gets a checkbox column, which turns the list
into the selection [bulk operations](/en/features/bulk-operations) act on.

## The machine detail page

A card per topic, each one degrading on its own when its source is unavailable:

| Card                    | Contents                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Availability**        | Whether the machine was online over the last 24 hours, sampled every few minutes, as an uptime percentage and a timeline; says so rather than guessing when nothing has been recorded yet |
| **Machine Details**     | Creator, machine name, OS hostname, OS, Tailscale version, ID, node key, creation time, last seen, key expiry and domain                                                                  |
| **Addresses**           | Tailscale IPv4 and IPv6, the short and full MagicDNS names, and the endpoints the machine reported                                                                                        |
| **DERP Relays**         | The relay address clients reach, the embedded region, and the relays this machine uses                                                                                                    |
| **Subnets & Routing**   | The routes the machine advertises, which of them are approved, and whether it may act as an exit node                                                                                     |
| **ACL tags**            | The tags the machine carries; a tag nothing in the policy owns is flagged                                                                                                                 |
| **Client Connectivity** | The machine's own connectivity self-test: varying NAT, hairpinning, IPv6, UDP, UPnP, PCP and NAT-PMP                                                                                      |
| **Danger zone**         | Expire the machine's key, or remove the machine from the tailnet                                                                                                                          |

The **node key** is hidden by default like an address or a hostname: the eye
button at the end of the row reveals that one value, the copy click copies the
real key either way, and the hover title is dropped while it is hidden so a
tooltip cannot become a second way to read it. This is a browser-local
preference and changes no request; the visibility menu in the header shows or
hides everything at once, and node keys and addresses share the one switch.

The rest of a machine's actions live in the row menu: open an SSH session, rename
it, turn key expiry on or off, edit its routes and tags, and move it to another
owner. Both the card and the menu act on the machine the page is about, so there
is no confirmation-free bulk path here.

The rows that describe the machine itself — its OS, Tailscale version, client
connectivity and relays — come from the HeadplaneCN Agent, because the Headscale
API does not carry them. Without the agent those cards say it is needed instead
of showing an empty table.

## The DERP Relays card

**Relay clients reach** is read-only: the endpoint derived from `server_url`,
then the **IPv4** and **IPv6** addresses `derp.server` declares, each with a copy
button, the verdict against what the hostname actually resolves to, and the
resolver the lookup used. Those addresses are the same values the
[Headscale settings](/en/features/headscale-settings#address-auto-sync) card
manages; this card configures nothing and links back to it.

**Relays this machine uses** lists the home and preferred region and the latency
it measured to each region, fastest first. Region names come from the same chain
the settings page describes — the manual region-name mapping, the `derp.paths`
maps, the `derp.urls` maps, then Headscale's embedded region — and a region
nothing describes is shown by ID. The agent keys its samples by region **and**
address family (`<regionID>-v4`, `<regionID>-v6`), so a region measured over both
appears once with its fastest sample. See
[HeadplaneCN Agent](/en/features/agent#the-relay-card-on-a-machine) for the details.

::: tip An "IPv6: No" row is about that machine, not about your relay
The IPv6 value in **Client Connectivity** is the machine's own self-test: whether
its network has working IPv6 at all. It tells you nothing about Headscale or the
DERP server, and it cannot be fixed from HeadplaneCN. The
[fnOS guide](/en/install/fnos) has a troubleshooting entry for it.
:::
