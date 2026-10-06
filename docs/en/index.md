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
