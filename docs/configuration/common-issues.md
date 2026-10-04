---
title: Common Issues
description: Common issues and their solutions
---

# Common Issues and Their Solutions

This document outlines some common issues users may encounter while using Headplane, along with their solutions.

## Login does not work

::: tip
Headplane tries to detect misconfigurations and will surface a warning banner on
the login page if it detects any abnormalities. You may see a banner like this:

<figure>
    <img class="dark-only" src="../assets/login-banner-dark.png" />
    <img class="light-only" src="../assets/login-banner-light.png" />
    <figcaption>Login Warning Banner</figcaption>
</figure>
:::

If you attempt to log in to Headplane but nothing happens, it may be due to a
misconfiguration of the server cookie settings. In your Headplane configuration,
ensure that `server.cookie_secure` is set appropriately based on how you are
accessing Headplane:

- Serving over HTTPS: `cookie_secure` should be enabled (`true`).
- Serving over HTTP: `cookie_secure` should be disabled (`false`).

## Saving gives "Unexpected Server Error"

If logging in works but **every** form submission fails (adding users, creating
pre-auth keys, saving the ACL policy, switching the language, logging out), the
reverse proxy in front of Headplane is probably rewriting the `Host` header.

React Router rejects any form submission whose `Origin` header does not match
the origin it derived from `Host`, as protection against cross-site request
forgery. When a proxy terminates TLS and forwards the request with an internal
`Host` (for example `192.168.1.10:3000` instead of
`headplane.example.com`), that check fails and the browser only sees the
sanitized message. The server log is more explicit and shows
`Error: Bad Request`.

Pick one of these fixes:

1. **Tell Headplane its public address** (recommended). Set `server.base_url` to
   the URL you use in the browser:

   ```yaml
   server:
     base_url: "https://headplane.example.com"
   ```

2. **List the extra hosts** that may submit forms, for example when
   `server.base_url` has to stay an internal address:

   ```yaml
   server:
     allowed_action_origins:
       - "headplane.example.com"
       - "headplane.example.com:8443"
   ```

3. **Preserve the original `Host` header** in your reverse proxy. For nginx that
   is `proxy_set_header Host $host;` and most other proxies have an equivalent
   option.

::: warning
Do not add wildcard entries. Anything listed here may submit actions on behalf
of a logged-in user.
:::
