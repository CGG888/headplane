---
title: fnOS (飞牛)
description: Deploy Headplane in Docker on fnOS, next to a natively installed Headscale, behind a reverse proxy.
outline: [2, 3]
---

# fnOS (飞牛)

fnOS (飞牛) is a Chinese NAS operating system, and its usual Headplane setup puts
each part where it fits best:

- **Headscale** is the `headscale` fpk package from the third-party app source
  [github.com/conversun/fnos-store](https://github.com/conversun/fnos-store)
  (the official fnOS app centre does not ship it), running as a **native
  process** — 0.29.2 or newer recommended.
- **Headplane** runs in **Docker**, on host networking, listening on `4100`.
- A **reverse proxy** (Lucky, nginx, …) publishes both; it may live on another
  machine entirely.

::: tip The complete walkthrough is in Simplified Chinese
The step-by-step guide — both configuration files copied verbatim, every path
explained, and a troubleshooting entry for each symptom — is maintained in
Simplified Chinese: **[fnOS 部署指南（简体中文）](/zh-Hans/install/fnos)**. What
follows is the shape of that deployment in English.
:::

## Three paths, and the one that matters

| Path                          | Role                  | Contents                                                                                                             |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | Program directory     | The `headscale` binary and CLI, the launcher script, the **seed** `config/config.yaml`, the bundled UI               |
| `/vol1/@appdata/headscale/`   | Configuration + data  | The `config.yaml` that actually takes effect, `db.sqlite`, `noise_private.key`, the unix socket, the pid and the log |
| `/vol1/1000/APP/headplane/`   | Headplane directory   | `docker-compose.yml`, Headplane's own `config.yaml`, and `data/`                                                     |

fnOS's launcher copies the seed configuration into `@appdata/headscale` on the
first start only, and reads that copy from then on. Editing
`@appcenter/headscale/config/config.yaml` therefore changes nothing, and the
binary lives in one directory while the data lives in the other.

## Prerequisites

- Headscale installed from the third-party source above and answering on its
  control port (`curl http://127.0.0.1:8480/health` → `{"status":"pass"}`).
- Docker and Docker Compose (fnOS ships both).
- The Headplane image, `ghcr.io/cgg888/headplanecn:latest`. When the registry is
  slow, an acceleration prefix such as
  `v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:latest` works the same way.
- A Headscale API key for Headplane's server side:
  `./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 3650d`
  run from `/vol1/@appcenter/headscale`. It is shown once; it goes into
  `headscale.api_key`, and it is what the agent, the OIDC session and proxy
  authentication authenticate with.

## The settings that matter

In Headplane's `config.yaml`:

| Setting                       | Why                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `headscale.url`               | The Headscale control endpoint — usually `http://127.0.0.1:8480` on host networking.                                                   |
| `server.base_url`             | The URL the browser uses, without a path. Required for form submissions to pass the origin check behind a reverse proxy.              |
| `server.cookie_secret`        | **Exactly 32 characters**; `openssl rand -base64 24` produces one. Any other length stops the container at startup.                    |
| `headscale.config_path`       | The mount point of Headscale's **effective** `config.yaml`, mounted **read-write** — this is what makes the DNS and Settings pages appear. |
| `headscale.dns_records_path`  | Only valid together with `dns.extra_records_path` in Headscale's own configuration; setting it alone makes Headplane exit.             |

And in `docker-compose.yml`:

- `network_mode: host` (so `127.0.0.1` inside the container is the host, and the
  natively installed Headscale is reachable) and `pid: host` (so
  `integration.proc` can find the `headscale serve` process to signal).
- The Headscale configuration file mounted read-write, Headplane's `data`
  directory mounted for persistence, and — for the DNS and DERP features — the
  relevant Headscale directories mounted at **exactly** the absolute paths they
  have on the host.
- `integration.proc.enabled` and `integration.agent.enabled` (the agent is what
  fills in node versions, OS details and the per-machine relay cards).
- No `docker.sock`: Headscale is a native process here, and mounting the socket
  would hand the container root on the host.

::: warning The official image has no shell
`docker compose exec headplane sh` prints a notice and exits: the image is
distroless. Swap `image:` for a `:<version>-shell` debug tag while you
investigate, then put `latest` back.
:::

## Reverse proxy

Forward the paths verbatim — `/api`, `/ts2021`, `/health` and **`/derp`** — with
no prefix rewriting, HTTP Upgrade allowed and response buffering off, so an
embedded DERP relay keeps working. Publish the relay's public port as the one in
`server_url` (for example `https://headscale.example.com:8443`), and let
`udp/3478` reach Headscale directly for STUN.

## Troubleshooting

| Symptom                                                      | Cause and fix                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every form submission fails with `Unexpected Server Error`    | The proxy rewrites `Host`. Set `server.base_url`, list the hosts in `server.allowed_action_origins`, or preserve the original `Host` header in the proxy.         |
| The page keeps reloading after an upgrade, or says it is out of date | The proxy is caching the HTML document, so the browser keeps loading a shell that references files the new build no longer serves. Hard refresh once, and stop caching the document in the proxy — only the hashed files under `/assets/` may be cached. |
| The database directory is reported as not writable            | Expected when the data directory is mounted read-only: Headplane's permissions are not Headscale's. The check says what it could not verify rather than calling it a failure. |
| A saved `derp.paths` file cannot be written                   | The mount is read-only, or the container path differs from the host path. Mount the directory read-write at the identical absolute path.                          |
