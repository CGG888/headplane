---
title: Dual-Image Deployment
description: "Run Headscale and HeadplaneCN in two separate containers: host networking, the same absolute path inside and outside the container, Docker integration, plus .env, compose, both full configuration files, migration in both directions, the reverse proxy and a verification checklist."
outline: [2, 3]
---

# Dual-image deployment: one container each for Headscale and HeadplaneCN

This guide describes the **two-container shape**: Headscale and HeadplaneCN each run in their own
container. Its counterpart is the native shape on the [fnOS page](./fnos.md), where Headscale stays
a host process managed by the NAS app centre; both are supported, and this page also covers moving
from one to the other and back. Both containers use **host networking**, so `127.0.0.1` inside a
container is this NAS itself: Headscale's listen port, metrics port and `udp/3478` (STUN) land
directly on the NAS, with no port mapping.

It differs from the other common shape in exactly one way, and that difference matters a lot:

| Shape             | Where Headscale runs | Absolute paths in Headscale's configuration                                                | Integration                                            |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Native / fpk      | A host process       | Host paths (`/vol1/@appdata/headscale/...`)                                                | `integration.proc`: sends SIGHUP to reload the ACL     |
| **Dual-image**    | A container          | **Unchanged** (the host directory is mounted into the container at the same absolute path) | `integration.docker`: restarts the Headscale container |
| Legacy dual-image | A container          | Rewritten into container paths (`/etc/headscale/...`)                                      | `integration.proc` + `pid: host`                       |

**This guide uses the middle row**: Headscale runs in a container, but the data directory is mounted
into that container at "the same absolute path as on the host", so every absolute path in
`config.yaml` (database, noise key, DERP key, `unix_socket`, `derp.paths`) **has not a single
character to change** — one less thing to edit during a migration means one less "I changed a path
and Headscale will not start" incident.

::: tip Environment this assumes

- A NAS (fnOS, …) with Docker and Docker Compose already in place
- A reverse proxy such as Lucky (it may run on a different machine than these two containers)
- Clients already registered against a **fixed `server_url`** — the migration never changes it
  :::

If your current deployment is "a native Headscale process plus a HeadplaneCN container" —
[fnOS deployment](/en/install/fnos) or [native mode](/en/install/native-mode) — go straight to
[Migrating from fnOS native to dual-image](#migrating-from-fnos-native-to-dual-image); to go back
from the dual-image shape to a native process, see
[Rolling back to fnOS native mode](#rolling-back-to-fnos-native-mode).

## What makes this shape work: three things

| Mechanism                  | How                                                                                                                    | What it gets you                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Host networking**        | Both services set `network_mode: host` and write no `ports:`                                                           | The panel reaches Headscale at `http://127.0.0.1:8480`; `udp/3478` is directly usable, with no mapping                         |
| **The same absolute path** | The Headscale data directory is mounted as `/vol1/1000/APP/headplaneCN/headscale:/vol1/1000/APP/headplaneCN/headscale` | Absolute paths in the configuration need no changes; the panel and Headscale see the same `config.yaml` and the same map files |
| **Docker integration**     | The panel mounts `/var/run/docker.sock` and finds the Headscale container by its container label                       | When the configuration is saved / "Reload" is clicked, the panel restarts the Headscale container — **no SIGHUP needed**       |

Two side conclusions follow:

- **`security_opt: ["apparmor=unconfined"]` is not needed**. That is only required by
  `integration.proc` (sending SIGHUP across processes): the container's default AppArmor profile
  only allows signalling processes that carry the same profile, so signalling a native process is
  refused (`kill EACCES`). Docker integration goes through the docker socket to restart a container
  and never touches signals.
- **`pid: host` is optional**. Docker integration does not need it; the only reason to keep it is so
  that the Agent in the panel can see host process information directly (Headscale version, system
  information, DERP relay details). It runs without it too — the Agent degrades to inferring from
  what is visible inside the container.

## Running the install script (optional)

Everything above — the `.env`, the compose file, both configuration files and the migration steps —
can be produced by one script that asks for all of it up front:
[`scripts/dual-image-install.sh`](https://github.com/CGG888/headplaneCN/blob/main/scripts/dual-image-install.sh).

```bash
# on the NAS (or, after cloning the repository: bash scripts/dual-image-install.sh)
curl -fsSL -o dual-image-install.sh \
  https://raw.githubusercontent.com/CGG888/headplaneCN/main/scripts/dual-image-install.sh

bash dual-image-install.sh --help      # explains every prompt and flag
bash dual-image-install.sh --dry-run   # prints the plan only, writes no files
bash dual-image-install.sh --self-test # starts no containers, validates the compose / configuration the script itself generates
bash dual-image-install.sh             # the real install
```

- **It can also run unattended**: `--defaults` accepts every default answer, and `--base-dir`,
  `--admin-bind`, `--headscale-tag` and `--headplane-tag` take the directory and image versions
  directly, so the script can be embedded in your own deployment automation.
- **Fully interactive, with this guide's values as the defaults**: base directory, both image tags,
  `server_url`, listen ports, panel bind address, timezone, API key, cookie secret and whether to
  migrate from a native deployment are asked for and validated one by one; an invalid answer is
  asked again.
- **Look before it writes**: `--dry-run` prints every file it would write, every copy it would make
  and every command it would run afterwards, and changes nothing; a real run also prints the full
  plan first and only writes to disk after you confirm — and **without confirmation it will not
  start any container**.
- **It never deletes your data**: an existing configuration only has individual keys rewritten as
  needed (the original file is saved as `.bak`), and migration only **copies**, after a timestamped
  backup; there is no data-deleting action anywhere in the script.
- After the writes it asks whether to run `docker compose up -d` right away, and along the way runs
  the acceptance commands — `docker compose ps`, the Headscale log, `headscale health` and the panel
  health check.

## Directory layout

All paths use `/vol1/1000/APP/headplaneCN` as the example; substitute your actual storage location.
**Two containers, one directory**: configuration, data and backups all live in one place, so a single
`tar` is a complete backup.

| Host path                                          | Purpose                                                                                               | Path inside the container                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/vol1/1000/APP/headplaneCN/docker-compose.yml`    | The definition of both containers                                                                     | —                                                                                    |
| `/vol1/1000/APP/headplaneCN/.env`                  | Version numbers, run user, bind addresses                                                             | —                                                                                    |
| `/vol1/1000/APP/headplaneCN/config.yaml`           | HeadplaneCN's own configuration                                                                       | `/etc/headplane/config.yaml` (read-only)                                             |
| `/vol1/1000/APP/headplaneCN/data/`                 | Panel data: sessions, internal database, snapshots, agent state                                       | `/var/lib/headplane`                                                                 |
| `/vol1/1000/APP/headplaneCN/headscale/config.yaml` | **Headscale's effective configuration** (the full 0.29.4 configuration)                               | `/etc/headscale/config.yaml` (read-only in the container / read-write for the panel) |
| `/vol1/1000/APP/headplaneCN/headscale/`            | `db.sqlite`, `noise_private.key`, `derp_server_private.key`, `headscale.sock`, `cache/`, `derp-maps/` | **The same absolute path** (read-write for headscale / read-only for the panel)      |
| `/vol1/1000/APP/headplaneCN/headscale/derp-maps/`  | Local DERP maps (including the one the "official region filter" writes)                               | **The same absolute path** (read-write for the panel)                                |
| `/vol1/1000/APP/headplaneCN/backup/`               | `tar.gz` backups taken before migrations and upgrades                                                 | —                                                                                    |

```bash
mkdir -p /vol1/1000/APP/headplaneCN/{data,backup} \
         /vol1/1000/APP/headplaneCN/headscale/derp-maps
```

## .env

Compose reads the `.env` in the same directory automatically. **The version numbers and the run user
live here**, so an upgrade changes one number.

```ini
# /vol1/1000/APP/headplaneCN/.env

# --- Image versions ---------------------------------------------------------
# Pin the versions; do not use latest: an upgrade means editing these two lines on purpose
HEADSCALE_VERSION=0.29.4
HEADPLANE_VERSION=0.22.22

# --- The user that runs the headscale container ------------------------------
# The official image is built as a non-root user, while the data directory is owned by that original headscale user.
# Use `ls -ln /vol1/1000/APP/headplaneCN/headscale` to see the owner and fill it in accordingly:
#   e.g. owner 965:966 → HEADSCALE_UID=965 HEADSCALE_GID=966
# 0 means running as root: it starts fine, but newly created WAL / socket files become owned by root.
HEADSCALE_UID=0
HEADSCALE_GID=0

# --- Host parameters ---------------------------------------------------------
# Base directory: used both inside and outside the container, so it must be an absolute path
BASE_DIR=/vol1/1000/APP/headplaneCN

# The address and port the panel listens on. Binding a specific IP is safer than 0.0.0.0:
# the panel is an admin console, so do not expose it to the internet; there must be a TLS reverse proxy or firewall in front of it.
PANEL_BIND=192.168.1.10
PANEL_PORT=4100

TZ=Asia/Shanghai
```

::: warning Binding a specific IP means two places must change with it
The panel's `HEADPLANE_SERVER__HOST` and its own health check probe use the same address. The compose
file references `${PANEL_BIND}:${PANEL_PORT}` in both, so editing the one place in `.env` is enough —
when editing the compose file by hand, do not change only one of them, or the container will show
`unhealthy` forever (see [the panel container keeps showing unhealthy](#the-panel-container-keeps-showing-unhealthy)).
:::

## The compose file

Path: `/vol1/1000/APP/headplaneCN/docker-compose.yml`

```yaml
services:
  # ---------------------------------------------------------------------------
  # Headscale server (replaces the native fnOS/fpk install)
  # ---------------------------------------------------------------------------
  headscale:
    # When pulls fail in China, use a proxy prefix, for example:
    #   v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}
    # For debugging (ships a shell; the binary is at /ko-app/headscale):
    #   v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}-debug
    image: headscale/headscale:${HEADSCALE_VERSION:?please set HEADSCALE_VERSION in .env}
    container_name: headscale
    restart: unless-stopped

    # Same behaviour as the native install: use the host's network stack directly
    network_mode: host

    # Read-only root filesystem (the official recommendation): writable places come from mounts and tmpfs
    read_only: true
    tmpfs:
      - /var/run/headscale
      - /tmp

    # The official image is not root; fill in whoever owns the data directory (see .env)
    user: "${HEADSCALE_UID:-0}:${HEADSCALE_GID:-0}"

    # The panel's Docker integration finds this container through this label (or container_name)
    labels:
      me.tale.headplane.target: "headscale"

    volumes:
      # Configuration file: the panel writes the same host file; this container mounts it read-only
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro"
      # [KEY] The data directory is mounted at the same absolute path → absolute paths in config.yaml need no changes
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"

    # The image entrypoint is the headscale binary itself; the configuration is found in /etc/headscale in the default order
    command: serve

    healthcheck:
      test: ["CMD", "headscale", "health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

    # Container logs replace the old headscale.log (the native file could grow to hundreds of MB without rotating)
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ---------------------------------------------------------------------------
  # HeadplaneCN panel
  # ---------------------------------------------------------------------------
  headplaneCN:
    # In China an acceleration prefix can be used, for example:
    #   v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION}
    image: ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION:-0.22.22}
    container_name: headplaneCN
    restart: unless-stopped

    # host networking: only then can the panel reach the Headscale container at 127.0.0.1:8480
    network_mode: host

    # Optional: the Agent needs the host PID namespace to see host processes. Docker integration does not need it.
    pid: host

    # Only guarantees start order; the panel itself retries until Headscale is ready
    depends_on:
      - headscale

    volumes:
      # The panel's own configuration and data
      - "${BASE_DIR}/config.yaml:/etc/headplane/config.yaml:ro"
      - "${BASE_DIR}/data:/var/lib/headplane"

      # The panel must be able to rewrite Headscale's configuration and DERP maps
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
      - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps"
      # The data directory is mounted at the same absolute path (read-only): configuration checks and snapshots can see the database and the private keys
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"

      # [Optional] When enabling dns.extra_records_path, mount that file too (it needs to be writable):
      # - "${BASE_DIR}/headscale/extra-records.json:${BASE_DIR}/headscale/extra-records.json"

      # Docker integration uses this to restart the headscale container.
      # ⚠️ This is near-root access: :ro only protects the socket file itself and cannot stop API
      #    calls, so do not rely on it to reduce risk — lock down access to the panel instead.
      - "/var/run/docker.sock:/var/run/docker.sock"

    environment:
      - "TZ=${TZ}"
      # Panel listen address (also used for its own health check probe)
      - "HEADPLANE_SERVER__HOST=${PANEL_BIND}"
      - "HEADPLANE_SERVER__PORT=${PANEL_PORT}"
      # The path of Headscale's effective configuration inside the container, character-for-character the mount point
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml"

      # Integration mode: restart the Headscale container (instead of sending SIGHUP)
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true"
      - "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false"

    # The panel ships /bin/hp_healthcheck, which probes 127.0.0.1 unconditionally, so it fails when a specific IP is bound →
    # probe the real address with the image's node instead (/admin/healthz needs no auth and returns {"status":"OK"}).
    healthcheck:
      test:
        [
          "CMD",
          "/nodejs/bin/node",
          "-e",
          "fetch('http://${PANEL_BIND}:${PANEL_PORT}/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### What each mount does (one line each)

| Mount                                                      | Purpose                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.yaml:/etc/headscale/config.yaml:ro` (headscale)    | Headscale's effective configuration, mounted read-only; the panel edits the same host file                                                                               |
| `headscale:${BASE_DIR}/headscale` (headscale)              | The read-write home of the database, private keys, socket and maps; **the path is character-for-character the same as on the host**                                      |
| `config.yaml:/etc/headplane/config.yaml:ro` (panel)        | HeadplaneCN's own configuration; read-only is enough                                                                                                                     |
| `data:/var/lib/headplane` (panel)                          | HeadplaneCN's persisted data (sessions, internal database, snapshots, agent state)                                                                                       |
| `headscale/config.yaml:/etc/headscale/config.yaml` (panel) | HeadplaneCN reads and writes Headscale's configuration here (system page, DERP page, ACL, …)                                                                             |
| `headscale/derp-maps:${BASE_DIR}/.../derp-maps` (panel)    | Viewing/editing/saving DERP maps; the file the "official region filter" writes lives here too, and Headscale reads that same file                                        |
| `headscale:${BASE_DIR}/headscale:ro` (panel)               | The same absolute path, read-only: configuration checks and snapshots can see `db.sqlite`, the private keys and so on; read-only keeps the panel from writing by mistake |
| `/var/run/docker.sock` (panel)                             | Docker integration uses it to restart the Headscale container; `:ro` does not restrict socket traffic, so treat it as root-equivalent                                    |

::: info The read-only data directory is deliberate
HeadplaneCN's user is not Headscale's user. Mounting the data directory read-only makes the "database
directory" item in the configuration check report **cannot verify write permission** — that is the
expected result, not a fault.
:::

### Host networking restrictions

A container with `network_mode: host` must **not** write `ports:`, and must not write `extra_hosts:`
either: under host networking the container uses the host's network namespace directly, so port
mappings are meaningless (Compose refuses or ignores them), and `extra_hosts` does nothing either —
nor is it needed, since `127.0.0.1` inside the container already is the host.

So the externally reachable ports are decided entirely by what is listening inside the containers:

| Port        | Who is listening          | How it is exposed                                                                                                                |
| ----------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tcp/8480`  | Headscale control service | The reverse proxy points at `127.0.0.1:8480` (both the control paths and `/derp` are on this port)                               |
| `tcp/8481`  | Headscale metrics         | Listens only on `127.0.0.1` by default; do not publish it to the internet                                                        |
| `tcp/50443` | gRPC (`grpc_listen_addr`) | Listens only on `127.0.0.1` by default, for the local `headscale` CLI; no external exposure needed                               |
| `udp/3478`  | STUN of the embedded DERP | Open `udp/3478` straight to this NAS on the router/firewall; it **cannot** go through an HTTP reverse proxy                      |
| `tcp/4100`  | HeadplaneCN               | The reverse proxy points at `${PANEL_BIND}:${PANEL_PORT}` (the default is `4100`; if you change it, change the backend to match) |

> This guide uses `8480 / 8481` (the historical ports of many fnOS native installs); the official
> defaults are `8080 / 9090`. Either pair works, as long as you are **consistent all the way
> through**: `listen_addr` in `config.yaml`, the reverse proxy backend and the health check.

> [!IMPORTANT]
> `tcp/4100` is the admin console, so it has the largest exposure. When the reverse proxy runs on
> this same machine, narrowing `PANEL_BIND` to `127.0.0.1` is safer; in either case, never expose
> `tcp/4100` directly to the internet.

## Configuration changes on both sides

### HeadplaneCN: `/vol1/1000/APP/headplaneCN/config.yaml`

```yaml
server:
  host: "192.168.1.10" # matches PANEL_BIND in .env; binding a specific IP is safer than 0.0.0.0
  port: 4100

  # The full URL the browser uses: scheme + domain + port, with no trailing /admin
  base_url: "https://admin.example.com:8443"
  # Must be exactly 32 characters: openssl rand -base64 24
  cookie_secret: "<32-character random string>"
  cookie_secure: true
  data_path: "/var/lib/headplane"

headscale:
  # Under host networking, 127.0.0.1 inside the container is the host, i.e. the Headscale container
  url: "http://127.0.0.1:8480"

  # The public address shown in the browser and used by browser SSH (falls back to the url above when empty)
  public_url: "https://ha.example.com:8443"

  # [REQUIRED] The full API key, not the prefix shown in the list
  api_key: "hskey-api-<your full API key>"

  # [REQUIRED] The path of Headscale's effective configuration inside the container, character-for-character the mount point
  config_path: "/etc/headscale/config.yaml"

  # Optional: point at the same file as Headscale's dns.extra_records_path, so DNS record edits need no restart
  # dns_records_path: "/vol1/1000/APP/headplaneCN/headscale/extra-records.json"

integration:
  # [The default for this shape] Restart the Headscale container when the configuration is saved / "Reload" is clicked
  docker:
    enabled: true
    # Pick either the container name or the label; both find it (the compose file sets both)
    container_name: "headscale"
    container_label: "me.tale.headplane.target=headscale"
    socket: "unix:///var/run/docker.sock"

  # Only a native process uses this; keep it off in the dual-image shape
  proc:
    enabled: false

  # Agent: syncs node versions / OS details, plus each machine's DERP region and latency
  agent:
    enabled: true
    host_name: "nas"
    cache_ttl: 30
    work_dir: "/var/lib/headplane/agent"
    executable_path: "/usr/local/bin/hp_agent"
```

Only five settings have to change: `server.base_url`, `server.cookie_secret`, `headscale.url`,
`headscale.api_key`, `headscale.config_path`.

::: tip The compose file already sets these through environment variables
`HEADPLANE_SERVER__HOST/PORT`, `HEADPLANE_HEADSCALE__CONFIG_PATH` and
`HEADPLANE_INTEGRATION__DOCKER__*` above map one-to-one onto the keys in the configuration file, and
**environment variables take precedence**. Pick one of the two: write them into compose and leave
`config.yaml` alone, or write them into the configuration file and delete those environment
variables.
:::

### Headscale: `/vol1/1000/APP/headplaneCN/headscale/config.yaml`

Below is the **complete Headscale 0.29.4 configuration** (with redacted example values). The key
point: every absolute path points at `/vol1/1000/APP/headplaneCN/headscale/...`, and that directory
is **the same absolute path** inside the container — so when you move over from a native deployment,
these paths **need no changes**.

```yaml
# /vol1/1000/APP/headplaneCN/headscale/config.yaml

# [MOST IMPORTANT] The address clients register against. Keep it character-for-character identical throughout the migration: change it and every registered node must log in again
server_url: https://ha.example.com:8443

# Listen addresses; under host networking these are the NAS's own ports
listen_addr: 0.0.0.0:8480
metrics_listen_addr: 127.0.0.1:8481
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false

# The reverse proxy's subnet/address (127.0.0.1 is required when the panel and Headscale are on the same machine)
trusted_proxies:
  - 127.0.0.1/32
  - 192.168.1.0/24
  - fd00::/8

# Client keys and the node IP ranges
noise:
  private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key

prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential

derp:
  # The embedded DERP relay (a self-hosted relay): clients use it for relaying
  server:
    enabled: true
    region_id: 999
    region_code: "GDDG"
    region_name: "广东东莞"
    verify_clients: true
    stun_listen_addr: "[::]:3478"
    private_key_path: /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true
    # Optional: the publicly announced address; leave "" when there is no public address
    ipv4: 203.0.113.10
    ipv6: 2001:db8::1

  # The full official DERP list; keep it [] when the self-hosted relay is the only relay
  urls: []

  # Local map files. The path must match the target file of the "official region filter" on the panel's DERP page,
  # otherwise Headscale cannot find the file on reload after saving (see troubleshooting)
  paths:
    - /vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml

  # Automatic updates of the built-in map and the official list
  auto_update_enabled: true
  update_frequency: 24h
  disable_check_updates: false

node:
  expiry: 0
  ephemeral:
    inactivity_timeout: 30m
  routes:
    ha:
      probe_interval: 10s
      probe_timeout: 5s

database:
  type: sqlite
  debug: false
  gorm:
    prepare_stmt: true
    parameterized_queries: true
    skip_err_record_not_found: true
    slow_threshold: 1000
  sqlite:
    path: /vol1/1000/APP/headplaneCN/headscale/db.sqlite
    write_ahead_log: true
    wal_autocheckpoint: 1000

# TLS: leave everything empty when the reverse proxy terminates it (these are only used when Headscale obtains certificates itself)
acme_url: https://acme-v02.api.letsencrypt.org/directory
acme_email: ""
tls_letsencrypt_hostname: ""
tls_letsencrypt_cache_dir: /vol1/1000/APP/headplaneCN/headscale/cache
tls_letsencrypt_challenge_type: HTTP-01
tls_letsencrypt_listen: ":http"
tls_cert_path: ""
tls_key_path: ""

log:
  level: info
  format: text

# ACL: saving the policy from the web UI requires database; with files, change it to file and fill in path
policy:
  mode: database
  path: ""

dns:
  magic_dns: false
  base_domain: example.internal
  override_local_dns: false
  nameservers:
    global:
      - 1.1.1.1
      - 8.8.8.8
    split: {}
  search_domains: []
  extra_records: []
  # To enable "extra DNS records" and have panel saves take effect immediately, point at the file below
  # and uncomment the optional mount in the compose file:
  # extra_records_path: /vol1/1000/APP/headplaneCN/headscale/extra-records.json

# The unix socket used by the local CLI (headscale ...), also inside the data directory
unix_socket: /vol1/1000/APP/headplaneCN/headscale/headscale.sock
unix_socket_permission: "0770"

# OIDC login (delete this whole block, or keep it commented, when logging in with the panel's own accounts)
oidc:
  only_start_if_oidc_is_available: true
  issuer: "https://idp.example.com/oidc"
  client_id: "<OIDC client id>"
  client_secret: "<OIDC client secret>"
  use_expiry_from_token: true
  scope:
    - openid
    - profile
    - email
  email_verified_required: true
  allowed_domains:
    - example.com
  allowed_users: []
  pkce:
    enabled: true
    method: S256

logtail:
  enabled: false
taildrop:
  enabled: true
auto_update:
  enabled: false
```

::: tip This configuration is a full reference; the install script only writes the keys it owns
The block above is the complete 0.29.4 configuration — copy it as-is. When the install script generates
a configuration from scratch it writes only the keys it owns (`server_url`, `listen_addr`,
`metrics_listen_addr`, `prefixes`, `derp.*`, `database.sqlite.path`, `noise.private_key_path`,
`policy`, and so on); everything else stays unset and Headscale's own defaults apply — for example,
with no `grpc_listen_addr` it listens on the built-in `127.0.0.1:50443`. An existing configuration has
only those keys rewritten, and keeps every other key verbatim.
:::

::: warning Do not write this configuration from memory
When a key is wrong, Headscale refuses to start outright (the log says `unknown key` /
`cannot unmarshal`). After any edit, validate first:

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale configtest    # validates only, does not start
```

If it errors, compare it character by character against the example configuration shipped in the
image (`docker compose exec headscale headscale -h` lists the subcommands it supports), or go back to
the pre-migration file and compare against that — note that its absolute paths point at
`/vol1/@appdata/headscale/...`, so once copied into this directory they must become
`${BASE_DIR}/headscale/...` (see the next section); every other key can be copied unchanged.
:::

### Why no absolute paths need changing this time

The old dual-image documentation required rewriting `noise_private_key_path`, `database.sqlite.path`
and `derp.paths` into container paths (`/var/lib/headscale/...`, `/etc/headscale/...`), because back
then only "host directory → a different container path" was mounted. This version mounts **the host
directory at the same absolute path** into the container:

```text
host           /vol1/1000/APP/headplaneCN/headscale            ← the data lives here
headscale container   - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
in container   /vol1/1000/APP/headplaneCN/headscale            ← the same path
in config      private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key
```

So "what the configuration says" and "where the file actually is" always agree; backups, snapshots
and the panel's path checks all point at the same place. The one exception is **the configuration
file's mount point**: Headscale reads its configuration from `/etc/headscale/config.yaml` by default
(unless `-c` says otherwise), so that one file is still mounted at
`/etc/headscale/config.yaml`.

### DERP maps and the "official region filter" target path

The **official region node filter** under **Settings → Headscale → DERP** writes the map it generates
to a file and adds that file to `derp.paths`. The default location of that file is **derived from
Headscale's live configuration**, no longer hard-coded:

1. the directory of the first absolute path in `derp.paths` + `official-mirror.yaml`;
2. failing that, the Headscale data directory (inferred in order from `noise.private_key_path` →
   `database.sqlite.path` → `derp.server.private_key_path` → `unix_socket`) +
   `derp-maps/official-mirror.yaml`;
3. and only when neither can be inferred does it fall back to the old native default
   `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`.

So in the dual-image shape, as long as the file listed in `derp.paths` exists, the card points
automatically at `/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml`. **If you have
changed the path by hand, yours wins**; only when it is still on the old default is it re-derived by
the rules above — if the card still says "cannot read /vol1/@appdata/..." after migrating from a
native deployment, the panel is storing the old path; fix it either way:

- change the path to the new one in the card and save;
- or edit the panel's data file directly (back it up first, then
  `docker compose restart headplaneCN`):

  ```bash
  cd /vol1/1000/APP/headplaneCN/data
  cp -a derp-region-mirror.json derp-region-mirror.json.bak-$(date +%Y%m%d-%H%M%S)
  sed -i "s#/vol1/@appdata/headscale/derp-maps/official-mirror.yaml\
  #/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml#g" \
    derp-region-mirror.json
  cd .. && docker compose restart headplaneCN
  ```

The "DERP map file mount hint" on the page is derived from `derp.paths` too
(`- "<directory>:<directory>"`), and no longer shows the hard-coded `/vol1/@appdata/...`.

## Migrating from fnOS native to dual-image

Work through this in order, and do not skip steps. **Never change `server_url` along the way.** This
assumes the native data is under `/vol1/@appdata/headscale` and the new directory is
`/vol1/1000/APP/headplaneCN` (substitute your real paths).

**1. Back up first**

```bash
# Database, noise private key, configuration, policy files, DERP maps and the DERP private key
sudo mkdir -p /vol1/1000/APP/headplaneCN/backup
sudo tar -czf /vol1/1000/APP/headplaneCN/backup/native-headscale-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /vol1/@appdata headscale
```

To get an absolutely consistent database copy, stop headscale in the fnOS app centre before making
this backup. A native install's `headscale.log` can be several hundred MB: the `tar` above packs it
too, so add `--exclude=headscale/headscale.log` if that bothers you.

**2. Stop the native Headscale and confirm the ports are free**

```bash
# fnOS app centre → headscale → stop
ps -ef | grep '[h]eadscale serve'          # expect no output
ss -lntup | grep -E '8480|8481|3478|50443' # expect no output (-u is needed to see udp/3478)
```

**3. Copy the data into the new directory (in the final "same absolute path" shape)**

```bash
mkdir -p /vol1/1000/APP/headplaneCN/headscale
sudo cp -a /vol1/@appdata/headscale/. /vol1/1000/APP/headplaneCN/headscale/

# Delete only runtime leftovers: logs, pid and the old socket (the container recreates the socket)
sudo rm -f /vol1/1000/APP/headplaneCN/headscale/headscale.log \
           /vol1/1000/APP/headplaneCN/headscale/headscale.pid \
           /vol1/1000/APP/headplaneCN/headscale/headscale.sock

# Owner: keep it consistent with HEADSCALE_UID/GID in .env; keep the private keys at 600
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/noise_private.key
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
ls -ln /vol1/1000/APP/headplaneCN/headscale | head   # note the owner and put it into .env
```

**4. Put `.env`, `docker-compose.yml` and the panel's `config.yaml` in place**

Headscale's `config.yaml` is **kept verbatim** (step 3 already copied it). The only things to change
are `HEADSCALE_UID/GID` in `.env` (matching the owner you saw in step 3), `PANEL_BIND` and the two
version numbers.

::: warning "Verbatim" only holds when the paths already point into the new directory
The absolute paths inside the configuration — `noise.private_key_path`, `database.sqlite.path`,
`derp.server.private_key_path`, `derp.paths`, and `unix_socket` if you set it — must live under
`${BASE_DIR}/headscale/`: the container mounts that directory at its own absolute path, so the paths
themselves never change. If they still say `/vol1/@appdata/headscale/...`, a manual migration has to
rewrite them to `/vol1/1000/APP/headplaneCN/headscale/...` (the install script rewrites those stale
paths for you, but only onto `${BASE_DIR}/headscale` — never to `/etc/headscale` or
`/var/lib/headscale`).
:::

::: tip Keep a copy of the old compose file first
If the directory already holds a compose file for "single panel container + native headscale", back
it up as `docker-compose.yml.bak-native-$(date +%Y%m%d-%H%M%S)` before writing the new one — the
rollback section uses it.
:::

**5. Validate, then bring the stack up**

```bash
cd /vol1/1000/APP/headplaneCN
docker compose config --quiet        # are the syntax and every variable in place?
docker compose up -d
docker compose ps                    # both services should be Up (healthy)
```

**6. Read the logs and the UI**

```bash
docker compose logs headscale | tail -n 50
# expect: version=v0.29.4, DB opened at …/headscale/db.sqlite, DERP region 999,
#         stun server started, listening and serving HTTP on 0.0.0.0:8480

curl -s http://127.0.0.1:8480/health              # {"status":"pass"}
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list

docker compose logs headplaneCN | tail -n 50
# expect: Connected to Headscale 0.29.4,
#         Found a valid Headscale configuration file at /etc/headscale/config.yaml,
#         Using Docker integration, Listening on http://<PANEL_BIND>:4100
```

Open `https://admin.example.com:8443/admin` in a browser and go to **Settings → System**: the
integration should show **Docker**, and saving the configuration restarts the Headscale container
(the log shows `Found container` / the container restarting). Then go to
**Settings → Headscale → DERP** and confirm the map card shows the new path.

**7. Clients need no re-registration**

`server_url`, the public ports, the database, `noise_private.key` and the DERP private key are all
unchanged, so registered nodes have nothing to do:

```bash
# on any client machine
tailscale status        # should show as connected straight away; no tailscale up required
```

Do not run `tailscale up --login-server ...` or re-register at this point — that would bring the
node into the tailnet under a new identity.

**8. Finishing touches**

- Set headscale in the fnOS app centre to **not start automatically** (or uninstall it on some later
  day). Otherwise, after a reboot it grabs `8480` first and the containerised Headscale cannot start.
- Keep `/vol1/@appdata/headscale` as it is for a few weeks before cleaning it up (it is only a backup
  now; note that it may hold several hundred MB of logs).

## Rolling back to fnOS native mode

To go back from dual-image to "native Headscale process + panel container", the data itself needs no
conversion — it just moves back and the integration switches back to process-based.

**1. Stop the stack and back up**

```bash
cd /vol1/1000/APP/headplaneCN
docker compose down
sudo tar -czf backup/dual-image-headscale-$(date +%Y%m%d-%H%M%S).tar.gz -C . headscale
```

**2. Move the data back to the native directory**

```bash
sudo cp -a /vol1/1000/APP/headplaneCN/headscale/. /vol1/@appdata/headscale/
sudo rm -f /vol1/@appdata/headscale/headscale.sock        # let the native process recreate it
# Change the owner back to fnOS's headscale user (use `id headscale` to see the real uid:gid)
sudo chown -R "$(id -u headscale):$(id -g headscale)" /vol1/@appdata/headscale
```

`config.yaml` needs its absolute paths changed back to the **native data directory**. In the
dual-image shape they point at `${BASE_DIR}/headscale/...` (for example
`/vol1/1000/APP/headplaneCN/headscale/...`), while the native fnOS process reads
`/vol1/@appdata/headscale/...`: rewrite `noise.private_key_path`, `database.sqlite.path`,
`derp.server.private_key_path`, `derp.paths` and `unix_socket` (if set) one by one.
(The install script rewrites the old paths onto the new directory during the forward migration; this
reverse step is manual.)

**3. Start the native Headscale**

fnOS app centre → headscale → start (and restore "start on boot"). Confirm:

```bash
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health        # {"status":"pass"}
```

**4. Switch the panel back to the process integration**

The panel no longer has a Headscale container to restart, so the integration goes from Docker back
to proc, and the compose file has to change as native mode requires:

```yaml
services:
  headplaneCN:
    image: ghcr.io/cgg888/headplanecn:<version>
    container_name: headplaneCN
    restart: unless-stopped
    network_mode: host
    # [REQUIRED] proc integration reads /proc to find headscale serve so it can signal it
    pid: host
    # [REQUIRED] Docker's default AppArmor profile may only signal processes carrying the same profile;
    # sending SIGHUP to a native process (unconfined) is refused:
    #   Failed to send SIGHUP to PID ...: Error: kill EACCES
    security_opt:
      - "apparmor=unconfined"
    volumes:
      - "/vol1/1000/APP/headplaneCN/config.yaml:/etc/headplane/config.yaml:ro"
      - "/vol1/1000/APP/headplaneCN/data:/var/lib/headplane"
      # The native configuration directory is mounted at the same absolute path so the panel can rewrite it
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale"
      # docker.sock is no longer needed
    environment:
      - "TZ=Asia/Shanghai"
      - "HEADPLANE_SERVER__HOST=192.168.1.10"
      - "HEADPLANE_SERVER__PORT=4100"
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/vol1/@appdata/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=false"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true"
      # The "Restart Headscale" button in the UI: only safe when the process is supervised by systemd / s6 or similar
      - "HEADPLANE_INTEGRATION__PROC__ALLOW_RESTART=false"
```

```bash
docker compose up -d
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve'
# expect: Found headscale serve (PID ...)
```

**5. Verify**

- The integration shows **native process** in the panel's **Settings → System**; after saving the
  configuration the log shows `Sent SIGHUP to Headscale`;
- registered clients still need no re-registration;
- the panel health check's probe address matches `HEADPLANE_SERVER__HOST` (see troubleshooting).

For the full details (including native mode's permission and process-supervision requirements) see
[fnOS deployment](/en/install/fnos) and [native mode](/en/install/native-mode).

## Upgrade and rollback

```bash
cd /vol1/1000/APP/headplaneCN

# [MANDATORY] Back up before touching Headscale: database migrations are one-way
docker compose stop headscale
tar -czf backup/before-upgrade-$(date +%F-%H%M%S).tar.gz \
  --exclude=backup -C . headscale data config.yaml docker-compose.yml .env
docker compose start headscale

# Edit the version number(s) in .env (changing only one of the two is fine), then
docker compose pull
docker compose up -d

# Check
docker compose ps
docker compose logs headscale | tail -n 30
docker compose exec headscale headscale version
```

- **Rolling back HeadplaneCN**: set `HEADPLANE_VERSION` back to the old version and run
  `docker compose up -d`. Its data lives in its own `data/` and is independent of Headscale's
  version.
- **Rolling back Headscale**: set `HEADSCALE_VERSION` back to the old version and `up -d` again;
  **if the newer version has already run database migrations, swapping the image back is not
  enough** — run `docker compose down` first, overwrite `headscale/db.sqlite` with the `db.sqlite`
  from the backup (deleting `-wal` / `-shm` alongside it before overwriting), then `up -d`.
- The official upgrade rule: go **one minor version at a time** (0.26 → 0.27 → 0.28 → 0.29); you
  cannot skip versions, and from 0.29 the client must be ≥ v1.80.0.
- The version numbers pinned in `.env` are exactly what "locking the version" means; do not give
  that up just to let `latest` upgrade itself.

## Reverse proxy notes

There is a single public port, `8443`, and two hostnames (plus an optional `derp.`), split by the
Host header, all pointing back at this NAS:

| Public hostname          | Backend                    | Traffic it carries                                                                                        |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ha.example.com:8443`    | `http://127.0.0.1:8480`    | The `server_url` hostname: client control traffic (`/key`, `/ts2021`, `/api/v1/*`, `/health`) and `/derp` |
| `derp.example.com:8443`  | `http://127.0.0.1:8480`    | A second entrance for `/derp` relay traffic (the same container)                                          |
| `admin.example.com:8443` | `http://<PANEL_BIND>:4100` | The HeadplaneCN admin UI (`/admin`, including the browser SSH WebSocket)                                  |
| `udp/3478` (not proxied) | the NAS's `udp/3478`       | STUN, which must be reachable directly                                                                    |

### Client control traffic (`ha.`)

- It must **support HTTP/2 and pass it all the way through to the container**: the `/ts2021` control
  tunnel is a long-lived connection, and a proxy that downgrades it to HTTP/1.1 or buffers it makes
  nodes flap.
- Raise read/write timeouts to **300 seconds or more** (or turn them off) and **turn off response
  buffering / gzip rewriting**.
- **Do not rewrite paths**: `/api/v1/*`, `/ts2021`, `/key`, `/health` and `/verify` must all land on
  `8480` unchanged.
- The certificate must be trusted by clients and match the hostname in `server_url`.

### DERP relay traffic (`/derp`)

- The relay address clients receive is derived by Headscale from `server_url` (the hostname taken
  from `server_url`, its port, and the path `/derp`). So **the `server_url` hostname must be able to
  serve `/derp`**; `derp.example.com` is only a second entrance on the same container.
- Preserve the **Upgrade / WebSocket** headers, **do not buffer**, keep timeouts at 300 seconds or
  more, and never rewrite or strip the path.
- Both hostnames need valid certificates; TLS terminates at the reverse proxy, and everything stays
  plain HTTP inside the container.

### STUN (`udp/3478`)

An HTTP reverse proxy **cannot forward UDP**. The STUN port advertised in the DERP map is
`udp/3478`, and clients send packets to `<the server_url hostname>:3478/udp`, so open it directly on
the router/firewall:

```text
udp/3478  →  <the NAS's IP>:3478/udp
```

### Verification (three steps, in order)

```bash
# ① Direct to Headscale: confirm the /derp route exists (expect a 400/426-style answer, not 404)
curl -si http://127.0.0.1:8480/derp | head -3

# ② Through the reverse proxy: the status code should match ①
curl -si https://ha.example.com:8443/derp | head -3

# ③ Client side (the decisive evidence)
tailscale debug derp-map | grep -A 12 -i headscale
tailscale debug derp headscale
```

## Verification checklist

```bash
cd /vol1/1000/APP/headplaneCN

docker compose ps                                     # both services Up (healthy)
docker compose logs headplaneCN | grep -i 'valid Headscale configuration'
docker compose logs headplaneCN | grep -i 'Using Docker integration'
docker compose logs headplaneCN | grep -i 'Listening on'
docker compose logs headscale | grep -iE 'error|derp' | tail
docker compose exec headscale headscale health
curl -s http://127.0.0.1:8480/health                  # {"status":"pass"}
```

- [ ] Both containers are running, recover automatically after `docker compose restart`, and `up -d` is idempotent
- [ ] The panel's **Settings → System** shows the integration as **Docker**, and saving the configuration can restart the Headscale container
- [ ] **A registered client comes online without re-registering** (`tailscale status` shows it as connected straight away)
- [ ] **Settings → System → Configuration check** is green overall ("cannot verify write permission" for the read-only data directory is expected)
- [ ] The embedded relay is really being used: `tailscale debug derp-map` lists the region, and the machine detail page shows that region
- [ ] The "official region filter" target file path on the DERP page matches `derp.paths`, and the file exists and is readable
- [ ] `https://admin.example.com:8443/admin` opens through the reverse proxy
- [ ] `udp/3478` is reachable from the internet (STUN is not "unavailable" in `tailscale netcheck`)

## Troubleshooting

### The panel container keeps showing `unhealthy`

The panel image ships a health check at `/bin/hp_healthcheck`, which probes `127.0.0.1:<port>`
unconditionally. When `server.host` / `HEADPLANE_SERVER__HOST` binds a **specific IP** (such as
`192.168.1.10`), nothing is listening on the loopback address, so:

```text
Health check failed: Get "http://127.0.0.1:4100/admin/healthz": dial tcp 127.0.0.1:4100: connect: connection refused
```

The container works perfectly; only the health status stays red forever — replace it with your own
probe as the compose file on this page does (using the image's `/nodejs/bin/node` to probe the real
address):

```yaml
healthcheck:
  test:
    [
      "CMD",
      "/nodejs/bin/node",
      "-e",
      "fetch('http://192.168.1.10:4100/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
    ]
```

After the change run `docker compose up -d` (it only recreates the panel container).

### There is no shell in the panel container

The published image is distroless by default and has no `sh`: `docker compose exec headplaneCN sh -c
'...'` fails outright (it prints `Headplane containers do not contain a shell by default.`). To
investigate, use the image's node:

```bash
docker compose exec headplaneCN /nodejs/bin/node -e "console.log(require('fs').readFileSync('/var/lib/headplane/derp-region-mirror.json','utf8').slice(0,200))"
```

Or temporarily switch to the `:<version>-shell` variant image to investigate.

### The "official region filter" reports "cannot read /vol1/@appdata/headscale/derp-maps/..."

The panel's data file still stores the old native path, and in the dual-image shape the container
**does not mount** `/vol1/@appdata`. Change it to the new path as described in
[DERP maps and the "official region filter" target path](#derp-maps-and-the-official-region-filter-target-path)
above (either in the card, or by editing `data/derp-region-mirror.json` and restarting the panel).

### `getting DERPMap: open .../derp-maps/xxx.yaml: no such file or directory`

Headscale cannot read one of the files in `derp.paths` while starting or reloading, so it exits
outright. Three causes:

1. **The file does not exist**: create a placeholder file first, then write it into the configuration.

   ```bash
   printf 'regions: {}\n' > /vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml
   ```

2. **`derp.paths` and the path in the panel card disagree**: the two must be the same path (the same
   file).
3. **The mount did not take effect**: the compose file is missing
   `"${BASE_DIR}/headscale:${BASE_DIR}/headscale"`, or the path is wrong.

   ```bash
   docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
   ```

To get it running again first: comment out that line in `derp.paths`, or roll back to the
configuration snapshot taken before the write via the panel's **Settings → Snapshots**, then restart
and redo it in the order "create the file in the host directory → confirm the mount → write it into
`derp.paths`".

### A client never comes online

Work through these from most to least likely:

| Check                                                  | Command / place                                                             | Conclusion                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Has `server_url` been changed?                         | `docker compose exec headscale grep server_url /etc/headscale/config.yaml`  | It must be character-for-character identical to the pre-migration value; if it changed, every node must be re-registered |
| Hostname and certificate                               | From an external machine: `curl -sI https://ha.example.com:8443/health`     | The certificate must be trusted by clients and the hostname must match `server_url`                                      |
| Is the reverse proxy passing long connections through? | In the proxy: is HTTP/2 on, is buffering off, are timeouts ≥300 seconds?    | A buffered or downgraded `/ts2021` makes nodes fail to connect or drop constantly                                        |
| Was the noise private key carried over?                | `docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/` | If the key was regenerated, every registered node stops communicating (you must restore it from the backup)              |
| Was the database carried over?                         | `docker compose exec headscale headscale nodes list`                        | An empty list means `db.sqlite` was not copied correctly or points at another path                                       |
| Is the port taken by a native process?                 | `ss -lntup \| grep 8480`                                                    | The headscale in the app centre is still running → stop it and turn off start-on-boot                                    |
| Is the service itself alive?                           | `curl -s http://127.0.0.1:8480/health`, `docker compose logs headscale`     | Anything other than `{"status":"pass"}` means reading the first error in the log                                         |

::: tip In one sentence
Clients only trust `server_url` and the certificate and path behind it; the database and the noise
private key are the credentials that prove "it is still the same control server". Get those two
right and no client needs to re-register.

For other symptoms (a save failing with `Unexpected Server Error`, `403 Policy is not writable`, and
so on) see [Common Issues](/en/configuration/common-issues).
:::
