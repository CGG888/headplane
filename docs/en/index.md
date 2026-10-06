---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Headplane"
  tagline: "A full-featured admin interface for Headscale"
  image:
    src: "/logo.svg"
    alt: "Headplane"
  actions:
    - text: "Getting Started"
      link: "/en/introduction"
    - text: "Installation"
      link: "/en/install"
      theme: "alt"
    - text: "GitHub"
      link: "https://github.com/CGG888/headplaneCN"
      theme: "alt"
    - text: "Sponsor"
      link: "/en/sponsor"
      theme: "alt"

features:
  - title: "Remote web-based SSH"
    details: "Connect to and manage machines via SSH directly through your web browser"
    icon: "🌐"
  - title: "Single-sign-on"
    details: "Bring your own auth via OpenID Connect, including popular solutions such as Google Workspace, Azure/Entra, Okta, etc."
    icon: "👥"
  - title: "Detailed Tailnet Overview"
    details: "Get access to detailed host and network information from each device residing within your Tailnet"
    icon: "🔎"
  - title: "Configure Headscale Settings"
    details: "Manage settings hidden behind Headscale configuration such as DNS, networking, auth controls, etc."
    icon: "📝"
---

## What this fork changes

This is [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN), a fork of
[Headplane](https://github.com/tale/headplane) aimed at self-hosted NAS setups
(fnOS in particular). Everything below is what this repository adds or changes
compared with the upstream project — that list *is* the difference between the
two.

- **fnOS (飞牛) and native-Headscale integration.** The docs and the compose
  guidance cover a Headscale installed as a native fnOS process next to a
  containerised Headplane: `pid: host` so `integration.proc` can find and signal
  `headscale serve`, and Headscale's effective `config.yaml` mounted
  **read-write** so the DNS and Settings pages appear. The rule that matters most:
  `derp.paths` is read by **Headscale on the host**, so every entry must be a
  **host path** whose directory is mounted into the container **at the identical
  absolute path**. A container-only path looks fine in the UI but makes Headscale
  refuse to start (`getting DERPMap: open …: no such file or directory`); the fix
  is to remove the entry or roll back the pre-write snapshot, then restart. See
  [fnOS installation](/en/install/fnos) and
  [editing local DERP map files](/en/features/headscale-settings#editing-local-derp-map-files).
- **DERP map files you can view, edit and create in the browser.** Every path in
  `derp.paths` gets View, Edit, Save and Roll back, plus **Create from example**
  with three commented templates. Saves are validated against the DERP map schema
  (unique region ids and codes, node regions, hostnames, ports), a snapshot of the
  file is taken first, and a roll back snapshots what it replaces. See
  [editing local DERP map files](/en/features/headscale-settings#editing-local-derp-map-files).
- **Automatic relay address sync.** A 6/12/24-hour schedule, or **Run now**,
  detects `derp.server.ipv4`/`ipv6` and writes **only the key whose value actually
  changed**, after snapshotting the configuration and recording an audit entry.
  Auto-reload defaults to **on** so clients pick the change up immediately — with
  the warning that a reload briefly interrupts connected clients. IPv4 comes from
  the A record of the `server_url` hostname; IPv6 comes from the host machine's own
  global unicast address. See
  [address auto-sync](/en/features/headscale-settings#address-auto-sync).
- **An external IPv6 echo, for when a router forwards or translates IPv6.** An
  optional check asks a public endpoint what address the internet actually sees —
  it is the authority when NAT66 or a forwarding router rewrites the address, since
  no local interface holds it then. **Off by default** (it contacts a third party)
  and IPv6-only. See
  [is the relay actually reachable over IPv6 (or IPv4)?](/en/features/headscale-settings#is-the-relay-actually-reachable-over-ipv6-or-ipv4).
- **An official region filter.** Mirror Tailscale's official public DERP regions
  into your own local map file, keeping only the ones you tick. They are
  renumbered into the **900s**: **901 Hong Kong** and **902 Singapore** are pinned,
  and the rest are ordered by the latency your own machines measure (unmeasured
  regions last). Numbers are stable across runs, so clients keep the relay they
  selected; only **Renumber** re-ranks them. See
  [official region filter](/en/features/headscale-settings#official-region-filter).
- **Alert notifications.** Point a webhook at one URL and get pushed JSON when a
  node goes offline, Headscale becomes unreachable (and when it recovers), a key
  nears expiry, a configuration check turns into a failure, or a **writing** DERP
  address/region run fails. See [Alert Notifications](/en/features/notifications).
- **Snapshots and an audit log for configuration changes.** Headplane stores a
  snapshot before it writes configuration, so a bad change is one click from being
  restored, and records every write so you can see who changed what and when. See
  [Snapshots](/en/features/snapshots) and [Audit Log](/en/features/audit).
- **Machine list and detail improvements.** Latency-by-region rows now resolve real
  region names instead of "unknown", the relay's IPv4 and IPv6 are shown with a
  copy button, the list filters and sorts on nearly every column, and bulk actions
  work off a selection column. See [Machines](/en/features/machines) and
  [Bulk Operations](/en/features/bulk-operations).
- **Three interface languages, and live updates that stay off until you ask.**
  English, Simplified Chinese and Traditional Chinese ship in the box, with no
  configuration. The header's **Live updates** switch is **off by default**, so
  pages no longer reload themselves every few seconds in the background. See
  [Languages](/en/features/languages).
- **Sponsorship, entirely optional.** If this fork saves you time, there is a
  [sponsor page](/en/sponsor) with WeChat and Alipay QR codes. It changes nothing
  about the software.

This project is based on the upstream [Headplane](https://github.com/tale/headplane)
project by [tale](https://github.com/tale); that credit, its licence and its
original features are kept here. Everything not listed above is upstream's work.
