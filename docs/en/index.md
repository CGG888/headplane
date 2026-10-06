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

<div class="feature-grid">
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><ellipse cx="12" cy="12" rx="3.6" ry="9" /></svg>
</div>

### Official region filter

Mirror only the official relays you pick, numbered 901/902.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 9h13" /><path d="M13.5 5.5 17 9l-3.5 3.5" /><path d="M20 15H7" /><path d="M10.5 11.5 7 15l3.5 3.5" /></svg>
</div>

### Relay address auto-sync and external IPv6 echo

Relay addresses sync on a schedule; IPv6 echo is optional.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M12.5 20.5h8" /><path d="M15.8 4.1a2.12 2.12 0 0 1 3 3L7.5 18.4l-3.9 1 1-3.9z" /></svg>
</div>

### DERP map files you edit in the browser

Edit `derp.paths` in the browser with validation and rollback.

[Headscale settings →](/en/features/headscale-settings)

</div>
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M10.3 21a2 2 0 0 0 3.4 0" /><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3" /></svg>
</div>

### Alert notifications

Offline nodes, an unreachable Headscale or expiring keys reach you.

[Alert notifications →](/en/features/notifications)

</div>
</div>

This is [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN) for
self-hosted NAS setups (fnOS in particular), based on the upstream
[Headplane](https://github.com/tale/headplane) project by
[tale](https://github.com/tale), with that credit, its licence and its original
features kept intact; see [differences from upstream](/en/differences) for what
it adds or changes.
