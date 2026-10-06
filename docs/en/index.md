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

## What makes this fork different

This is [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN) for
self-hosted NAS setups (fnOS in particular), based on the upstream
[Headplane](https://github.com/tale/headplane) project by
[tale](https://github.com/tale), with that credit, its licence and its original
features kept intact; see [differences from upstream](/en/differences) for what
it adds or changes.

<div class="feature-grid">
<div class="feature-card">

### fnOS and native Headscale, working as one

Run containerised HeadplaneCN against native fnOS Headscale using `pid: host`
and a read-write `config.yaml`.

[fnOS installation →](/en/install/fnos)

</div>
<div class="feature-card">

### Official region filter

Mirror only the official relays you pick, renumbered stably: 901 Hong Kong,
902 Singapore.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### Relay address auto-sync and external IPv6 echo

Relay addresses are written back on a schedule or on demand; external IPv6 echo
is optional.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">

### DERP map files you edit in the browser

`derp.paths` files are edited in the browser, validated and snapshotted on save
for one-click rollback.

[Headscale settings →](/en/features/headscale-settings)

</div>
</div>
