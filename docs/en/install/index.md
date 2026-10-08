---
title: Installation
description: Choose a deployment shape, a domain scheme and a reverse proxy route, then install.
outline: [2, 3]
---

# Installation

HeadplaneCN is the web panel for Headscale. Installation itself is only a few
steps; what you need to decide first is **three things**:

1. **Deployment shape**: run Headscale as a native process (native mode) or hand
   it to Docker as well (dual-image mode);
2. **Domain scheme**: one domain on one port, one domain on two ports, or two
   domains;
3. **Reverse proxy route**: a home NAS (Lucky on the router terminates TLS and
   Caddy inside the NAS splits paths), or a cloud server (Caddy does everything
   on one machine).

The conclusions come first, the details come after. Anything long lives on its
own page; this page only helps you pick the right route.

## Choose a deployment shape

| Shape                                                   | What it looks like                              | Who it is for                                       | Trade-off                                                        |
| ------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| [Limited mode](/en/install/limited-mode)                | Panel only, no Headscale configuration file     | Trying it out, demos                                | No network management, no browser SSH                            |
| [Native mode](/en/install/native-mode)                  | Panel runs directly on the host                 | Linux users who avoid Docker                        | You prepare Node.js and systemd yourself                         |
| [Docker](/en/install/docker)                            | Panel in one container                          | Most self-hosters                                   | Features are limited while the panel and Headscale are separated |
| [fnOS (飞牛) · native mode](/en/install/fnos)           | Headscale as a native process + panel container | fnOS NAS, keeping auth and data in native Headscale | The panel must be able to read Headscale's config and process    |
| [fnOS (飞牛) · dual-image mode](/en/install/dual-image) | Headscale and the panel each in a container     | fnOS NAS, when both should be managed by Docker     | Migration changes how the Headscale process runs                 |

::: tip Which NAS shape?
**Install once on the NAS and touch as little as possible** → native mode
(Headscale stays a native process, the panel is just one more container).
**You want restarts, upgrades and backups to be independent** → dual-image mode.
You can convert between them; see [Migration and rollback](/en/install/migration),
and back up first.
:::

## Choose a domain scheme

Headscale has one hard constraint: `server_url` **cannot carry a path prefix**,
so clients always talk to the root of the domain. The panel therefore needs its
own place, and there are only three realistic options:

| Scheme                                    | Panel address                  | Caddy/Nginx required?              | Certificates                             |
| ----------------------------------------- | ------------------------------ | ---------------------------------- | ---------------------------------------- |
| **One domain + path split** (recommended) | `https://ha.example.com/admin` | **Yes**, on the NAS to split paths | One, installed on the proxy layer        |
| **One domain + two ports**                | `https://ha.example.com:8443`  | No, two Lucky sub-rules are enough | One (the same certificate on both ports) |
| **Two domains**                           | `https://panel.example.com`    | No                                 | Two (or one wildcard certificate)        |

For the details, DNS records, where certificates belong and the ICP filing
question, see [Domains and access](/en/install/domains).

## Choose a reverse proxy route

| Your environment                                               | Which route                                                     | Why                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Home NAS, public IP or a tunnel available, **cannot be filed** | [Lucky + Caddy inside the NAS](/en/install/reverse-proxy-lucky) | Home broadband cannot get 80/443 or an ICP filing; Lucky terminates TLS and Caddy splits paths inside the NAS |
| A cloud server with a public IP                                | [Caddy on a cloud server](/en/install/reverse-proxy-caddy)      | Caddy does everything on one machine: automatic certificates and path splitting, no Lucky needed              |
| You already run Nginx / Traefik                                | Use the Nginx example in [native mode](/en/install/native-mode) | Changing the proxy does not change the path-splitting requirement                                             |

::: warning Cloud servers in mainland China need an ICP filing
On a mainland Chinese server the domain needs a completed **ICP filing** before
80/443 can serve traffic; **servers outside mainland China (including Hong Kong,
Macao and Taiwan) need no filing** and can use 80/443 with automatic
certificates. Home broadband uses a non-standard port with its own certificate,
so no filing is needed — or even possible. See
[Caddy on a cloud server](/en/install/reverse-proxy-caddy) for the details.
:::

## What to prepare before installing

HeadplaneCN needs a configuration file to run. Start from the
[sample file](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml).
A few fields you cannot avoid:

| Field                      | Description                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`headscale.url`**        | Where the panel reaches the Headscale API. On the same host the default is `http://127.0.0.1:8480` (inside a container it is `http://headscale:8080`). |
| **`headscale.public_url`** | The **external** address browsers use to reach Headscale. It must match `server_url` and is used to build registration links.                          |
| **`server.base_url`**      | The address browsers use to reach the **panel**, for example `https://ha.example.com/admin` or `https://ha.example.com:8443/admin`.                    |
| **`server.cookie_secret`** | Encrypts cookies. Generate it with `openssl rand -base64 24`. **Replacing it logs everyone out.**                                                      |
| **`server.cookie_secure`** | Set it to `true` whenever the outside world is HTTPS.                                                                                                  |
| **`server.data_path`**     | The panel's own database directory; mount it out in Docker.                                                                                            |

The user (or container) running HeadplaneCN needs `server.data_path` to be
writable and `headscale.config_path` to be readable. To change Headscale
settings or restart it from the interface, the matching integration is also
required (the proc integration in native mode, or the Docker integration in
dual-image mode).

You also need a Headscale API key:

```bash
# Run this where Headscale runs; adjust the lifetime as needed
headscale apikeys create --expiration 90d
```

## Verify after installing

Whichever route you took, the installation should pass these four checks (every
tutorial has the exact commands):

1. `https://<your address>/health` returns `200`, and `/admin` redirects with
   `302` and opens the login page;
2. `POST /ts2021` is **not 404** (new clients come online through it; a 404 means
   the proxy rewrote the path);
3. `https://<your address>/derp` returns `426` or `400` (the DERP link works; it
   is not a 404);
4. `tailscale up --login-server https://<your address>` can register a device.

## Next

- Converting a deployment shape: [Migration and rollback](/en/install/migration)
- DERP relays and region mirrors: [DERP and relays](/en/configuration/derp)
- Certificates and TLS details for the panel: [TLS & certificates](/en/configuration/tls)
- Something went wrong after installing: [Common issues](/en/configuration/common-issues)
