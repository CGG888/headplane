---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "HeadplaneCN"
  tagline: "A full-featured admin interface for Headscale"
  image:
    src: "/logo.svg"
    alt: "HeadplaneCN"
  actions:
    - text: "Getting Started"
      link: "/en/introduction"
    - text: "Installation"
      link: "/en/install"
      theme: "alt"
    - text: "See how this fork differs →"
      link: "/en/differences"
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

## About this fork

This is [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN), aimed at
self-hosted NAS setups (fnOS in particular). This project is based on the
upstream [Headplane](https://github.com/tale/headplane) project by
[tale](https://github.com/tale); that credit, its licence and its original
features are kept here.

Everything this fork adds or changes compared with upstream lives on its own
page:

[See how this fork differs →](/en/differences)

## What sets it apart

Four things this fork does that are worth a look on their own; the full list
lives in [differences from upstream](/en/differences).

<div class="feature-grid">
<div class="feature-card">

### fnOS and native Headscale, working as one

Run a containerised HeadplaneCN against a natively installed Headscale: `pid: host`
lets `integration.proc` discover and signal `headscale serve`, and the
`config.yaml` that actually takes effect is mounted **read-write**. The usual trap
is `derp.paths` — every entry has to be a **host path** whose directory is mounted
into the container **at the same absolute path**.

[fnOS installation →](/en/install/fnos)

</div>
<div class="feature-card">

### Official region filter

Mirror only the official relays you want into one local map file, renumbered into
the **900s**: **901 is always Hong Kong, 902 always Singapore**, and the rest
follow from **903** in the order your own machines measure. Numbers stay put once
assigned, so clients do not switch relays over one noisy latency sample.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### Relay address auto-sync and external IPv6 echo

The addresses clients have to reach are detected and written back for you — on a
6/12/24-hour schedule or on demand — after snapshotting the configuration and
recording an audit entry. An optional external IPv6 echo answers what the internet
really sees once a router forwards or translates the address (**off by default**,
IPv6-only).

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### DERP map files you edit in the browser

View and edit any `derp.paths` file in the browser, or create one from a commented
template. Saves are validated against the DERP map schema and snapshotted first,
so a wrong edit is one click from being rolled back.

[Headscale settings →](/en/features/headscale-settings)

</div>
</div>
