---
title: fnOS (飞牛)
description: Deploy HeadplaneCN in Docker on fnOS, next to a natively installed Headscale, behind a reverse proxy.
outline: [2, 3]
---

# fnOS (飞牛)

fnOS (飞牛) is a Chinese NAS operating system, and its usual HeadplaneCN setup puts
each part where it fits best:

- **Headscale** is the `headscale` fpk package from the third-party app source
  [github.com/conversun/fnos-store](https://github.com/conversun/fnos-store)
  (the official fnOS app centre does not ship it), running as a **native
  process** — 0.29.2 or newer recommended.
- **HeadplaneCN** runs in **Docker**, on host networking, listening on `4100`.
- A **reverse proxy** (Lucky, nginx, …) publishes both; it may live on another
  machine entirely.

::: tip The complete walkthrough is in Simplified Chinese
The step-by-step guide — both configuration files copied verbatim, every path
explained, and a troubleshooting entry for each symptom — is maintained in
Simplified Chinese. Switch the site language to 简体中文 (the language menu in the
navigation bar) to read it; what follows is the shape of that deployment in
English.
:::

This page covers **Headscale as a native fnOS app plus HeadplaneCN in a container**. If you want
Docker to manage Headscale as well, use [Dual-image deployment](./dual-image.md) instead: that shape
restarts the Headscale container through the Docker socket — no SIGHUP, no `pid: host`, no AppArmor
change — and mounts the data directory at the same absolute path inside the container, so the
absolute paths in Headscale's own configuration stay unchanged.

## Choosing between the two NAS shapes

| Item                                            | This page: native Headscale + panel container                                               | Dual-image deployment                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Where Headscale runs                            | Native host process, from the fnOS app (fpk package)                                        | Container                                                                  |
| Who owns its lifecycle                          | The fnOS app centre (start / stop / upgrade)                                                | Docker / Docker Compose                                                    |
| Integration                                     | `integration.proc`: SIGHUP to `headscale serve` to reload ACLs                              | `integration.docker`: restarts the Headscale container                     |
| `pid: host` needed?                             | Yes — `integration.proc` reads `/proc` to find `headscale serve`                            | No (optional, for the Agent only)                                          |
| `security_opt: ["apparmor=unconfined"]` needed? | Yes — otherwise the container cannot signal the `unconfined` native process (`kill EACCES`) | No                                                                         |
| `/var/run/docker.sock` mounted?                 | No — this shape never restarts a container                                                  | Yes (`:ro` cannot restrict socket traffic, so treat it as root equivalent) |
| Which page to read                              | This page                                                                                   | [Dual-image deployment](./dual-image.md)                                   |

## Three paths, and the one that matters

| Path                          | Role                  | Contents                                                                                                             |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | Program directory     | The `headscale` binary and CLI, the launcher script, the **seed** `config/config.yaml`, the bundled UI               |
| `/vol1/@appdata/headscale/`   | Configuration + data  | The `config.yaml` that actually takes effect, `db.sqlite`, `noise_private.key`, the unix socket, the pid and the log |
| `/vol1/1000/APP/headplane/`   | HeadplaneCN directory | `docker-compose.yml`, HeadplaneCN's own `config.yaml`, and `data/`                                                   |

fnOS's launcher copies the seed configuration into `@appdata/headscale` on the
first start only, and reads that copy from then on. Editing
`@appcenter/headscale/config/config.yaml` therefore changes nothing, and the
binary lives in one directory while the data lives in the other.

## Prerequisites

- Headscale installed from the third-party source above and answering on its
  control port (`curl http://127.0.0.1:8480/health` → `{"status":"pass"}`).
- Docker and Docker Compose (fnOS ships both).
- The HeadplaneCN image, `ghcr.io/cgg888/headplanecn:latest`. When the registry is
  slow, an acceleration prefix such as
  `v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:latest` works the same way.
- A Headscale API key for HeadplaneCN's server side:
  `./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 3650d`
  run from `/vol1/@appcenter/headscale`. It is shown once; it goes into
  `headscale.api_key`, and it is what the agent, the OIDC session and proxy
  authentication authenticate with.

## The settings that matter

In HeadplaneCN's `config.yaml`:

| Setting                      | Why                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `headscale.url`              | The Headscale control endpoint — usually `http://127.0.0.1:8480` on host networking.                                                       |
| `server.base_url`            | The URL the browser uses, without a path. Required for form submissions to pass the origin check behind a reverse proxy.                   |
| `server.cookie_secret`       | **Exactly 32 characters**; `openssl rand -base64 24` produces one. Any other length stops the container at startup.                        |
| `headscale.config_path`      | The mount point of Headscale's **effective** `config.yaml`, mounted **read-write** — this is what makes the DNS and Settings pages appear. |
| `headscale.dns_records_path` | Only valid together with `dns.extra_records_path` in Headscale's own configuration; setting it alone makes HeadplaneCN exit.               |

And in `docker-compose.yml`:

- `network_mode: host` (so `127.0.0.1` inside the container is the host, and the
  natively installed Headscale is reachable).
- `pid: host`, because `integration.proc` reads `/proc` to find the
  `headscale serve` process before it can signal it. That is a requirement of
  **this** shape — Headscale is a host process. The dual-image deployment
  restarts a container through Docker instead and does not need it; there
  `pid: host` is optional and only helps the Agent see host processes.
- `security_opt: ["apparmor=unconfined"]`, needed **only** because Headscale runs
  as an `unconfined` native process: without it Docker's default AppArmor profile
  refuses to signal it and a reload fails with `kill EACCES` (`dmesg` reports
  `operation="signal" ... peer="unconfined"`). The dual-image deployment signals
  no host process and does not need it.
- The Headscale configuration file mounted read-write, HeadplaneCN's `data`
  directory mounted for persistence, and — for the DNS and DERP features — the
  relevant Headscale directories mounted at **exactly** the absolute paths they
  have on the host. That identity follows from Headscale being a **host process**;
  the dual-image deployment reaches the same result differently, by mounting the
  data directory at the same absolute path inside the container.
- `integration.proc.enabled` and `integration.agent.enabled` (the agent is what
  fills in node versions, OS details and the per-machine relay cards).
- No `docker.sock`: Headscale is a native process here and this shape never
  restarts a container, so nothing needs the socket — and mounting it would hand
  the container root on the host. The dual-image deployment does restart a
  container, so it mounts the socket — remembering that `:ro` does **not**
  restrict API access and that the mount is root-equivalent either way.

::: warning The official image has no shell
`docker compose exec headplane sh` prints a notice and exits: the image is
distroless. Swap `image:` for a `:<version>-shell` debug tag — for example
`ghcr.io/cgg888/headplanecn:0.22.22-shell` — while you investigate, then put
`latest` back.
:::

## Reverse proxy

Forward the paths verbatim — `/api`, `/ts2021`, `/health` and **`/derp`** — with
no prefix rewriting, HTTP Upgrade allowed and response buffering off, so an
embedded DERP relay keeps working. Publish the relay's public port as the one in
`server_url` (for example `https://headscale.example.com:8443`), and let
`udp/3478` reach Headscale directly for STUN.

## Troubleshooting

| Symptom                                                              | Cause and fix                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every form submission fails with `Unexpected Server Error`           | The proxy rewrites `Host`. Set `server.base_url`, list the hosts in `server.allowed_action_origins`, or preserve the original `Host` header in the proxy.                                                                                                                                                                                                    |
| The page keeps reloading after an upgrade, or says it is out of date | The proxy is caching the HTML document, so the browser keeps loading a shell that references files the new build no longer serves. Hard refresh once, and stop caching the document in the proxy — only the hashed files under `/assets/` may be cached.                                                                                                     |
| The database directory is reported as not writable                   | Expected when the data directory is mounted read-only: HeadplaneCN's permissions are not Headscale's. The check says what it could not verify rather than calling it a failure.                                                                                                                                                                              |
| A saved `derp.paths` file cannot be written                          | The mount is read-only, or the container path differs from the host path. Headscale reads that list as a **host process**, so the paths in it are host paths. Mount the directory read-write at the identical absolute path; the dual-image deployment instead mounts the whole data directory at the same absolute path, which keeps those paths unchanged. |
