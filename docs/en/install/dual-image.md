---
title: fnOS (飞牛) · Dual-Image Mode
description: "Run Headscale and HeadplaneCN as two containers on fnOS: host networking, the same absolute path inside and outside the container, Docker integration, with .env, the full compose file, both configurations, self-checks, upgrade and rollback, and a verification checklist."
outline: [2, 3]
---

# fnOS (飞牛) · dual-image mode installation

This page covers **installation and self-checks only**: **Headscale** and **HeadplaneCN** each run in
their own container, both on **host networking** (so `127.0.0.1` inside a container is this NAS
itself), and Headscale's data directory is mounted at **the same absolute path** on both sides of the
container boundary — so not one absolute path in its configuration has to change. Saving the
configuration takes effect by letting the panel **restart the Headscale container**.

Where everything else lives: moving in or out of this shape is in
[Migration & rollback](/en/install/migration); relays (the embedded DERP server, `derp.paths`, the
official region filter) are in [DERP & relays](/en/configuration/derp); domains and certificates are
in [Domains & access](/en/install/domains); how to fill in the reverse proxy and open STUN is in
[Lucky reverse proxy](/en/install/reverse-proxy-lucky); what each page of the UI offers is in the
[feature overview](/en/features/overview).

::: tip Environment this assumes

- A NAS (fnOS, …) with Docker and Docker Compose already in place
- A reverse proxy such as Lucky or Caddy (it may run on a different machine than these two containers)
- Clients already registered against a **fixed `server_url`** — it is never changed here
  :::

## Values you must change

| Placeholder            | Example                                 | What it means                                                                               | Where to change it                                             |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Headscale domain       | `ha.example.com`                        | **Must change**: the hostname clients register against and connect to                       | Headscale's `server_url`; the panel's `public_url`             |
| Panel domain           | `panel.example.com`                     | **Must change**: the hostname you open the panel on                                         | The panel's `base_url`; the reverse proxy rule                 |
| Public port            | `8443`                                  | **May change**: the port the reverse proxy listens on publicly; several places must agree   | `server_url`, `public_url`, `base_url`, the reverse proxy rule |
| NAS LAN IP             | `192.168.1.10`                          | **Must change**: the reverse proxy goes back to this address — `127.0.0.1` will not connect | `PANEL_BIND` in `.env`; the panel's `server.host`              |
| Base directory         | `/vol1/1000/APP/headplaneCN`            | **May change**: configuration, data and backups all live here                               | `BASE_DIR` in `.env` and every absolute path                   |
| Panel port             | `4100`                                  | **May change** (default 4100): the port the panel listens on                                | `PANEL_PORT` in `.env`                                         |
| Image versions         | `0.29.4` / `0.22.23`                    | **May change**: an upgrade means editing these two numbers                                  | `.env`                                                         |
| Headscale data owner   | `965:966`                               | **Must change**: fill in whoever actually owns the data directory                           | `HEADSCALE_UID` / `HEADSCALE_GID` in `.env`                    |
| API key                | `hskey-api-...`                         | **Must change**: created in section 2 and shown only once                                   | The panel's `headscale.api_key`                                |
| cookie secret          | the output of `openssl rand -base64 24` | **Must change**: exactly 32 characters, hand-writing it always goes wrong                   | The panel's `server.cookie_secret`                             |
| Headscale control port | `127.0.0.1:8480`                        | **Do not touch**: the panel reaches Headscale through it                                    | Headscale's `listen_addr`; the panel's `headscale.url`         |
| Timezone               | `Asia/Shanghai`                         | **May change**                                                                              | `TZ` in `.env`                                                 |

## Getting the paths straight: the same path inside and outside

This shape rests on three things:

| Mechanism                  | How                                                                                   | What it gets you                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Host networking**        | Both services set `network_mode: host` and write no `ports:`                          | The panel reaches Headscale at `http://127.0.0.1:8480`; `udp/3478` is directly usable, with no mapping                 |
| **The same absolute path** | The data directory is mounted as `${BASE_DIR}/headscale:${BASE_DIR}/headscale`        | Absolute paths in the configuration need no changes; both containers see the same `config.yaml` and the same map files |
| **Docker integration**     | The panel mounts `/var/run/docker.sock` and finds the Headscale container by its name | Saving the configuration / clicking "Reload" restarts the Headscale container — **no SIGHUP**                          |

Two side conclusions follow: **`security_opt: ["apparmor=unconfined"]` is not needed** (that is only
required to signal a native process, and the container's default AppArmor profile refuses it with
`kill EACCES`), and **`pid: host` is optional** (Docker integration does not need it; it is only kept
so that the Agent inside the panel can see host processes).

The only difference from [fnOS native mode](/en/install/fnos) is that Headscale moves from a host
process into a container, and the integration changes from "send SIGHUP" to "restart the container".
Why the paths need no changes:

```text
host           /vol1/1000/APP/headplaneCN/headscale            ← the data lives here
headscale container   - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
in container   /vol1/1000/APP/headplaneCN/headscale            ← the same path
in config      private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key
```

So "what the configuration says" and "where the file actually is" always agree; backups, snapshots and
the panel's path checks all point at the same place. The one exception is **the configuration file's
own mount point**: Headscale reads its configuration from `/etc/headscale/config.yaml` by default, so
that one file is still mounted at `/etc/headscale/config.yaml`.

## 1. Check Headscale and the ports

```bash
curl -s http://127.0.0.1:8480/health         # {"status":"pass"} when Headscale is already running
ss -lntup | grep -E '8480|8481|50443|4100'   # is any of these ports taken by something else? (-u shows udp/3478)
```

- **A fresh install**: no output from either command is normal; carry on.
- **An existing Headscale** (a native process or the legacy shape): note whether it is running — in
  the dual-image shape it has to give up `8480` (see section 8).
- Scan the ports before you install. A real incident: `8443` was already taken by another container on
  the NAS, which threw both the reverse proxy's port plan and `server_url` into disarray.

## 2. Create an API key

The panel needs a Headscale admin API key (of the form `hskey-api-...`), and it is **shown only once**,
so note it down immediately.

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale apikeys create --expiration 90d
```

This requires the **headscale container to be running already**, so there are two cases:

- **Moving over from native mode** (Headscale is still a host process): create the key with the native
  CLI first, then check it again once the container is up:

  ```bash
  cd /vol1/@appcenter/headscale
  ./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 90d
  ```

- **A fresh install**: follow sections 4–7 to put the files in place and run `docker compose up -d`,
  then come back here and run the command above, put the key into `headscale.api_key` from section 5,
  and run `docker compose up -d` again so the panel reads it.

- Use `sudo` if the permissions are not enough (fnOS's app directories belong to root).
- This key is a **server-side** credential: Agent sync, OIDC sessions and proxy authentication all
  use it, and it is a different thing from the key you type into the login box later.
- If an old key leaked: find its prefix with `apikeys list`, then `apikeys expire --prefix <prefix>`.

## 3. Headscale configuration: only what must change

The effective configuration is `${BASE_DIR}/headscale/config.yaml`. **When you move over from a
native deployment, not a single character changes**; a fresh install needs at least these keys:

```yaml
# /vol1/1000/APP/headplaneCN/headscale/config.yaml

# The address clients actually connect to; changing it makes every registered node log in again
server_url: https://ha.example.com:8443 # ← must change (no path prefix allowed)

listen_addr: 0.0.0.0:8480 # ← do not touch (the panel reaches it at 127.0.0.1:8480)
metrics_listen_addr: 127.0.0.1:8481 # ← do not touch (metrics stay local)
grpc_listen_addr: 127.0.0.1:50443 # ← do not touch (for the local headscale CLI)

trusted_proxies: # ← do not touch (the reverse proxy is on this machine)
  - 127.0.0.1/32
  - 192.168.1.0/24 # ← may change (your LAN subnet)
  - fd00::/8

noise:
  private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key # ← do not touch (must live in the data directory)

database:
  type: sqlite # ← do not touch
  sqlite:
    path: /vol1/1000/APP/headplaneCN/headscale/db.sqlite # ← do not touch

policy:
  mode: database # ← must change (editing the ACL from the web UI requires database)
  path: "" # ← do not touch

unix_socket: /vol1/1000/APP/headplaneCN/headscale/headscale.sock # ← do not touch
unix_socket_permission: "0770" # ← do not touch

dns:
  magic_dns: false # ← may change
  base_domain: example.internal # ← may change
  override_local_dns: false # ← do not touch
  # extra_records_path: /vol1/1000/APP/headplaneCN/headscale/extra-records.json   # ← may change (recommended)
```

::: warning `${BASE_DIR}` cannot appear inside the configuration file
Docker Compose substitutes `${BASE_DIR}` in `.env` and in the compose file, but **`config.yaml` never
goes through Compose**, so every absolute path above must be written out in full (for example
`/vol1/1000/APP/headplaneCN/headscale/...`). Writing `${BASE_DIR}` there produces a literal path and
Headscale cannot find its files, so it will not start.
:::

::: warning Do not write this configuration from memory
When a key is wrong, Headscale refuses to start outright (the log says `unknown key` /
`cannot unmarshal`). After any edit, validate first:

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale configtest    # validates only, does not start
```

:::

::: tip Where the complete configuration comes from
For a fresh install, [the install script](/en/install/dual-image#_12-optional-generate-everything-with-the-install-script)
generates the complete 0.29.4 configuration (`--dry-run` prints it for you first); when migrating from
a native deployment, use the file you already have — see
[Migration & rollback](/en/install/migration). Relays (the embedded DERP server, local `derp.paths`
maps, the official region filter) are not covered here: see [DERP & relays](/en/configuration/derp).
:::

::: tip Moving in or out? (the migration steps are not on this page)

- Your current shape is "a native Headscale process plus a panel container" and you want this
  dual-image shape → see [Migration & rollback](/en/install/migration): the backup, the copy and the
  checks all live there.
- You want to go back from dual-image to fnOS native mode → the rollback part of that same page.
  :::

## 4. Prepare the directories

All paths use `/vol1/1000/APP/headplaneCN` as the example; substitute your actual storage location.
**Three containers, one directory**: configuration, data and backups all live in one place, so a single
`tar` is a complete backup.

| Host path                                          | Purpose                                                                                               | Path inside the container                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/vol1/1000/APP/headplaneCN/docker-compose.yml`    | The definition of all three containers (Headscale, the panel, Caddy)                                  | —                                                                                     |
| `/vol1/1000/APP/headplaneCN/.env`                  | Version numbers, run user, bind addresses                                                             | —                                                                                     |
| `/vol1/1000/APP/headplaneCN/config.yaml`           | HeadplaneCN's own configuration                                                                       | `/etc/headplane/config.yaml` (read-only)                                              |
| `/vol1/1000/APP/headplaneCN/data/`                 | Panel data: sessions, internal database, snapshots, agent state                                       | `/var/lib/headplane`                                                                  |
| `/vol1/1000/APP/headplaneCN/headscale/config.yaml` | **Headscale's effective configuration**                                                               | `/etc/headscale/config.yaml` (read-only for the container / read-write for the panel) |
| `/vol1/1000/APP/headplaneCN/headscale/`            | `db.sqlite`, `noise_private.key`, `derp_server_private.key`, `headscale.sock`, `cache/`, `derp-maps/` | **The same absolute path** (read-write for headscale / read-only for the panel)       |
| `/vol1/1000/APP/headplaneCN/headscale/derp-maps/`  | Local DERP maps                                                                                       | **The same absolute path** (read-write for the panel)                                 |
| `/vol1/1000/APP/headplaneCN/backup/`               | `tar.gz` backups taken before migrations and upgrades                                                 | —                                                                                     |
| `/vol1/1000/APP/headplaneCN/caddy/`                | Caddy's path split: `Caddyfile`, `data/`, `config/` (Lucky layout only)                               | `/etc/caddy/Caddyfile` (read-only) + `/data`, `/config`                               |

```bash
mkdir -p /vol1/1000/APP/headplaneCN/{data,backup} \
         /vol1/1000/APP/headplaneCN/headscale/derp-maps \
         /vol1/1000/APP/headplaneCN/caddy/{data,config}

cd /vol1/1000/APP/headplaneCN
openssl rand -base64 24        # generate the cookie_secret and note it down (exactly 32 characters)
chmod 600 /vol1/1000/APP/headplaneCN/headscale/noise_private.key   # key permissions (when the file already exists)
```

## 5. File ①: the panel's `config.yaml`

Path: `/vol1/1000/APP/headplaneCN/config.yaml`

```yaml
server:
  host: "192.168.1.10" # ← must change (the NAS LAN IP; do not use 0.0.0.0, the proxy goes back to this)
  port: 4100 # ← do not touch (compose overrides it with an environment variable)

  # The full URL the browser uses: scheme + domain + port, with no trailing /admin
  base_url: "https://panel.example.com:8443" # ← must change
  cookie_secret: "generate it with the command above" # ← must change (exactly 32 characters; other lengths keep the container from starting)
  cookie_secure: true # ← must change (true behind an HTTPS proxy; false for plain HTTP)
  data_path: "/var/lib/headplane" # ← do not touch (compose persists it to ./data)

headscale:
  # Under host networking, 127.0.0.1 inside the container is the host, i.e. the Headscale container
  url: "http://127.0.0.1:8480" # ← do not touch
  public_url: "https://ha.example.com:8443" # ← must change (shown in the browser, used by browser SSH)
  api_key: "hskey-api-..." # ← must change (the full key from section 2, not the prefix in the list)
  config_path: "/etc/headscale/config.yaml" # ← do not touch (must match the compose mount point character for character)
  # dns_records_path: "/vol1/1000/APP/headplaneCN/headscale/extra-records.json"   # ← may change

integration:
  docker:
    enabled: true # ← do not touch (restarts the Headscale container when the configuration is saved / "Reload" is clicked)
    container_name: "headscale" # ← do not touch (use either the name or the label; both find it)
    container_label: "me.tale.headplane.target=headscale" # ← do not touch
    socket: "unix:///var/run/docker.sock" # ← do not touch
  proc:
    enabled: false # ← do not touch (only a native process uses it; keep it off in this shape)
  agent:
    enabled: true # ← do not touch (node versions / OS details / DERP regions sync through it)
    host_name: "nas" # ← may change
    cache_ttl: 180000 # ← do not touch (milliseconds, default 3 minutes; too small and the agent re-syncs every time)
    work_dir: "/var/lib/headplane/agent" # ← do not touch
    executable_path: "/usr/libexec/headplane/agent" # ← do not touch (where the agent actually lives in the image)
```

::: tip Want the full-field template?
The repository root ships [`config.example.yaml`](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)
(the file `pnpm run dev:app` uses; every key is commented, including OIDC, Kubernetes and `proxy_auth`).
The snippet above is only the minimum needed to boot — any key you leave out falls back to its default.
:::

::: danger `cookie_secret` must be exactly 32 characters
The validation hard-codes a length of 32; anything else and the container exits with
`The configuration is missing required fields or has invalid values`.
`openssl rand -base64 24` produces exactly 32 characters — do not hand-write it and do not truncate it.
:::

::: tip The compose file already sets these through environment variables
`HEADPLANE_SERVER__HOST/PORT`, `HEADPLANE_HEADSCALE__CONFIG_PATH` and
`HEADPLANE_INTEGRATION__DOCKER__*` in section 6 map one-to-one onto the keys here, and
**environment variables take precedence**. Pick one of the two: write them into compose and leave this
configuration file alone, or write them into the configuration file and delete those environment
variables.
:::

## 6. File ②: `.env` and `docker-compose.yml`

### `.env`

Compose reads the `.env` in the same directory automatically. **The version numbers and the run user
live here**, so an upgrade changes one number.

```ini
# /vol1/1000/APP/headplaneCN/.env

# --- Image versions ---------------------------------------------------------
# Pin the versions; do not use latest: an upgrade means editing these two lines on purpose
HEADSCALE_VERSION=0.29.4        # ← may change (an upgrade edits only this)
HEADPLANE_VERSION=0.22.23       # ← may change

# --- The user that runs the headscale container ------------------------------
# The official image is built as a non-root user, while the data directory is owned by that original headscale user.
# Use `ls -ln /vol1/1000/APP/headplaneCN/headscale` to see the owner and fill it in accordingly:
#   e.g. owner 965:966 → HEADSCALE_UID=965 HEADSCALE_GID=966
# 0 means running as root: it starts fine, but newly created WAL / socket files become owned by root.
HEADSCALE_UID=0                 # ← must change (whoever actually owns the data directory)
HEADSCALE_GID=0                 # ← must change

# --- Host parameters ---------------------------------------------------------
# Base directory: used both inside and outside the container and must be absolute
# (the configuration file needs the full path; it cannot use this variable)
BASE_DIR=/vol1/1000/APP/headplaneCN     # ← may change

# The address and port the panel listens on. Binding a specific IP is safer than 0.0.0.0:
# the panel is an admin console, so there must be a TLS reverse proxy or firewall in front of it;
# never expose it to the internet directly.
PANEL_BIND=192.168.1.10         # ← must change (the NAS LAN IP)
PANEL_PORT=4100                 # ← may change (default 4100)

TZ=Asia/Shanghai                # ← may change

# --- Image proxy -------------------------------------------------------------
# All three images (Headscale, the panel, Caddy) are pulled through this prefix;
# leave it empty to pull straight from ghcr.io / Docker Hub.
# v6 needs IPv6; if the pull fails, comment it out and use the v4 line instead
# (keep only one of the two).
IMAGE_PROXY=v6.gh-proxy.org/docker/                 # ← may change
#IMAGE_PROXY=v4.gh-proxy.org/docker/                # ← use this without IPv6

# --- Caddy: the NAS-side path split -----------------------------------------
# Only the "Lucky + Caddy" layout needs it (see /en/install/reverse-proxy-lucky);
# with the port layout or the two-domain layout delete the line below together
# with the caddy service in the compose file.
CADDY_PORT=8444                                     # ← may change (confirmed free above)
```

::: warning Binding a specific IP means two places must change with it
The panel's `HEADPLANE_SERVER__HOST` and its own health check probe use the same address. The compose
file references `${PANEL_BIND}:${PANEL_PORT}` in both, so editing the one place in `.env` is enough —
when editing the compose file by hand, do not change only one of them, or the container will show
`unhealthy` forever (see troubleshooting, item 1).
:::

### `docker-compose.yml`

Path: `/vol1/1000/APP/headplaneCN/docker-compose.yml`

```yaml
services:
  # ---------------------------------------------------------------------------
  # Headscale server (replaces the native install from the fnOS app centre)
  # ---------------------------------------------------------------------------
  headscale:
    # The proxy prefix comes from IMAGE_PROXY in .env (shared by all three
    # images; empty means a direct pull)
    # For debugging (ships a shell; the binary is at /ko-app/headscale):
    #   ${IMAGE_PROXY-}ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}-debug
    image: "${IMAGE_PROXY-}headscale/headscale:${HEADSCALE_VERSION:?please set HEADSCALE_VERSION in .env}"
    container_name: headscale # ← do not touch (the panel finds the container by this name/label)
    restart: unless-stopped # ← do not touch

    network_mode: host # ← do not touch (host networking forbids ports / extra_hosts)

    read_only: true # ← do not touch (the official recommendation: writable places come from mounts and tmpfs)
    tmpfs:
      - /var/run/headscale
      - /tmp

    user: "${HEADSCALE_UID:-0}:${HEADSCALE_GID:-0}" # ← must change (the data directory's owner, see .env)

    labels:
      me.tale.headplane.target: "headscale" # ← do not touch (the panel's Docker integration finds this container through it)

    volumes:
      # Configuration file: the panel writes the same host file; this container mounts it read-only
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro" # ← path may change
      # [KEY] The data directory is mounted at the same absolute path → absolute paths in config.yaml need no changes
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale" # ← path may change

    command: serve # ← do not touch

    healthcheck:
      test: ["CMD", "headscale", "health"] # ← do not touch
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
    image: "${IMAGE_PROXY-}ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION:-0.22.23}" # ← version may change
    container_name: headplaneCN # ← do not touch
    restart: unless-stopped # ← do not touch

    network_mode: host # ← do not touch (only then does the panel reach the Headscale container at 127.0.0.1:8480)

    pid: host # ← may change (only the Agent needs host processes; Docker integration does not)

    depends_on:
      - headscale # ← do not touch (start order only; the panel retries by itself)

    volumes:
      # The panel's own configuration and data
      - "${BASE_DIR}/config.yaml:/etc/headplane/config.yaml:ro" # ← path may change
      - "${BASE_DIR}/data:/var/lib/headplane" # ← path may change

      # The panel must be able to rewrite Headscale's configuration and DERP maps
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml" # ← path may change
      - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps" # ← path may change
      # The data directory is mounted at the same absolute path (read-only): configuration checks and snapshots see the database and keys
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro" # ← path may change

      # [Optional] When enabling dns.extra_records_path, mount that file too (it needs to be writable):
      # - "${BASE_DIR}/headscale/extra-records.json:${BASE_DIR}/headscale/extra-records.json"

      # Docker integration uses this to restart the headscale container.
      # ⚠️ This is near-root access: :ro only protects the socket file itself and cannot stop API
      #    calls, so do not rely on it to reduce risk — lock down access to the panel instead.
      - "/var/run/docker.sock:/var/run/docker.sock" # ← do not touch

    environment:
      - "TZ=${TZ}" # ← may change
      # Panel listen address (also used for its own health check probe)
      - "HEADPLANE_SERVER__HOST=${PANEL_BIND}" # ← must change (the NAS LAN IP, see .env)
      - "HEADPLANE_SERVER__PORT=${PANEL_PORT}" # ← may change (default 4100)
      # The path of Headscale's effective configuration inside the container, character-for-character the mount point
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml" # ← do not touch

      # Integration mode: restart the Headscale container (instead of sending SIGHUP)
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true" # ← do not touch
      - "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale" # ← do not touch
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false" # ← do not touch

    # The panel ships /bin/hp_healthcheck, which probes 127.0.0.1 unconditionally and is refused when a specific IP is bound
    # (the container stays unhealthy forever) → probe the real address with the image's node instead
    # (/admin/healthz needs no auth and returns {"status":"OK"}).
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

  # ---------------------------------------------------------------------------
  # Caddy: the NAS-side path split (only the Lucky layout of
  # /en/install/reverse-proxy-lucky needs it)
  # ---------------------------------------------------------------------------
  # It serves plain HTTP only, the certificates live on the router; /admin* goes to
  # the panel with the prefix intact and everything else goes to Headscale.
  # With the port layout or the two-domain layout, delete this service together with
  # the CADDY_PORT line in .env.
  caddy:
    image: "${IMAGE_PROXY-}caddy:2-alpine" # the proxy prefix lives in IMAGE_PROXY in .env
    container_name: caddy
    restart: unless-stopped

    # Same as headscale and the panel: host networking — listen on the NAS itself and
    # still reach 127.0.0.1 from inside. In host mode do not add a ports section.
    network_mode: host

    environment:
      - "TZ=${TZ}"
      - "CADDY_PORT=${CADDY_PORT:-8444}" # {$CADDY_PORT:8444} in the Caddyfile reads this

    volumes:
      - "${BASE_DIR}/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" # the routing rules (next subsection)
      - "${BASE_DIR}/caddy/data:/data"
      - "${BASE_DIR}/caddy/config:/config"

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### What each mount does (one line each)

| Mount                                                        | Purpose                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `config.yaml:/etc/headscale/config.yaml:ro` (headscale)      | Headscale's effective configuration, mounted read-only; the panel edits the same host file                                            |
| `headscale:${BASE_DIR}/headscale` (headscale)                | The read-write home of the database, private keys, socket and maps; **the path is character-for-character the same as on the host**   |
| `config.yaml:/etc/headplane/config.yaml:ro` (panel)          | HeadplaneCN's own configuration; read-only is enough                                                                                  |
| `data:/var/lib/headplane` (panel)                            | HeadplaneCN's persisted data (sessions, internal database, snapshots, agent state)                                                    |
| `headscale/config.yaml:/etc/headscale/config.yaml` (panel)   | HeadplaneCN reads and writes Headscale's configuration here (system page, DERP page, ACL, …)                                          |
| `headscale/derp-maps:${BASE_DIR}/.../derp-maps` (panel)      | Viewing/editing/saving DERP maps; Headscale reads that same file                                                                      |
| `headscale:${BASE_DIR}/headscale:ro` (panel)                 | The same absolute path, read-only: configuration checks and snapshots can see `db.sqlite`, the private keys and so on                 |
| `/var/run/docker.sock` (panel)                               | Docker integration uses it to restart the Headscale container; `:ro` does not restrict socket traffic, so treat it as root-equivalent |
| `${BASE_DIR}/caddy/Caddyfile:ro` (caddy)                     | The path split rules; restart the caddy container after editing it                                                                    |
| `${BASE_DIR}/caddy/data`, `${BASE_DIR}/caddy/config` (caddy) | Caddy's own runtime data (the certificates live on the router; this is just state)                                                    |

::: info The read-only data directory is deliberate
HeadplaneCN's user is not Headscale's user. Mounting the data directory read-only makes the "database
directory" item in the configuration check report **cannot verify write permission** — that is the
expected result, not a fault.
:::

### Caddy's routing rules: `caddy/Caddyfile`

Path: `/vol1/1000/APP/headplaneCN/caddy/Caddyfile` (**only the Lucky path-split layout needs it**). Copy it
as-is and change the panel address in `reverse_proxy` to your `${PANEL_BIND}:${PANEL_PORT}`:

```caddyfile
{
	# this container neither issues nor loads certificates (they live on the router)
	auto_https off
}

:{$CADDY_PORT:8444} {
	# opening the root path in a browser lands on the panel; clients never GET /
	@browserRoot {
		path /
		header Accept *text/html*
	}
	redir @browserRoot /admin/ 302

	handle /admin* {
		reverse_proxy 192.168.1.10:4100 {        # ← change to ${PANEL_BIND}:${PANEL_PORT}
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		reverse_proxy 127.0.0.1:8480 {           # ← leave as is (Headscale listens on 8480 on the same host)
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
```

It does three things at once: `auto_https off` says the certificates live on the Lucky layer; `/admin*`
reaches the panel **without rewriting the path** and tells it that the outside is HTTPS (otherwise
`cookie_secure: true` breaks); the catch-all `handle` passes `/ts2021`, `/key`, `/register`, `/verify`,
`/api/v1/*`, `/health` and `/derp` through unchanged, and `flush_interval -1` disables buffering so long
connections survive. After editing the Caddyfile run `docker compose restart caddy`.

### Host networking restrictions

A container with `network_mode: host` must **not** write `ports:`, and must not write `extra_hosts:`
either: under host networking the container uses the host's network namespace directly, so port
mappings are meaningless (Compose refuses or ignores them), and `extra_hosts` does nothing either —
nor is it needed, since `127.0.0.1` inside the container already is the host.

So the externally reachable ports are decided entirely by what is listening inside the containers:

| Port        | Who is listening            | How it is exposed                                                                                                                |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tcp/8480`  | Headscale control service   | The reverse proxy points at `127.0.0.1:8480` (both the control paths and `/derp` are on this port)                               |
| `tcp/8481`  | Headscale metrics           | Listens only on `127.0.0.1` by default; do not publish it to the internet                                                        |
| `tcp/50443` | gRPC (`grpc_listen_addr`)   | Listens only on `127.0.0.1` by default, for the local `headscale` CLI; no external exposure needed                               |
| `udp/3478`  | STUN of the embedded DERP   | Open `udp/3478` straight to this NAS on the router/firewall; it **cannot** go through an HTTP reverse proxy                      |
| `tcp/4100`  | HeadplaneCN                 | The reverse proxy points at `${PANEL_BIND}:${PANEL_PORT}` (the default is `4100`; if you change it, change the backend to match) |
| `tcp/8444`  | Caddy (NAS-side path split) | The router forwards HTTPS here; Caddy does no TLS itself (plain HTTP), see /en/install/reverse-proxy-lucky                       |

> This page uses `8480 / 8481` (the historical ports of many fnOS native installs); the official
> defaults are `8080 / 9090`. Either pair works, as long as you are **consistent all the way
> through**: `listen_addr` in `config.yaml`, the reverse proxy backend and the health check.

::: warning `tcp/4100` is the admin console
It has the largest exposure. When the reverse proxy runs on this same machine, narrowing `PANEL_BIND`
to `127.0.0.1` is safer; in either case, never expose `tcp/4100` directly to the internet.
:::

## 7. Start and self-check

```bash
cd /vol1/1000/APP/headplaneCN
docker compose config --quiet        # are the syntax and every variable in place? (no output means yes)
docker compose up -d
docker compose ps                    # all three services should be Up (healthy) (no caddy in the port / two-domain layout)

docker compose logs headscale | tail -n 50
# expect: version=v0.29.4, DB opened at …/headscale/db.sqlite,
#         stun server started, listening and serving HTTP on 0.0.0.0:8480
curl -s http://127.0.0.1:8480/health              # {"status":"pass"}
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list

docker compose logs headplaneCN | tail -n 50
# expect: Connected to Headscale 0.29.4,
#         Found a valid Headscale configuration file at /etc/headscale/config.yaml,
#         Using Docker integration, Listening on http://192.168.1.10:4100
curl -s http://192.168.1.10:4100/admin/healthz    # {"status":"OK"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8444/admin/   # 302 (Caddy is up; port comes from .env)
```

Open `http://192.168.1.10:4100/admin` in a browser and log in with the API key from section 2. Go to
**Settings → System**: the integration should show **Docker**, and saving the configuration restarts
the Headscale container (the log shows `Found container` / the container restarting).

::: tip Next step: publishing it to the internet
The containers only listen on the LAN; reaching them from outside needs a reverse proxy on top (TLS
terminates there). This compose file already ships Caddy (section 6), so the Lucky layer only owns TLS
and the ports; the two ends meet in
[Lucky reverse proxy](/en/install/reverse-proxy-lucky); domains, certificates and the port plan are in
[Domains & access](/en/install/domains). Two things to remember: the proxy must pass paths through
**unchanged** (`/key`, `/ts2021`, `/api/v1/*`, `/health`), and `udp/3478` (STUN) **cannot** go through
an HTTP reverse proxy — it has to be forwarded on the router separately.
:::

## 8. Troubleshooting (symptom → cause → fix)

### 1. The panel container keeps showing `unhealthy`

**Cause**: the panel image ships a health check at `/bin/hp_healthcheck`, which probes
`127.0.0.1:<port>` unconditionally, while `server.host` binds a **specific IP** (such as
`192.168.1.10`), so nothing is listening on the loopback address:

```text
Health check failed: Get "http://127.0.0.1:4100/admin/healthz": dial tcp 127.0.0.1:4100: connect: connection refused
```

**Fix**: the container works perfectly; only the health status stays red. Replace it with a probe of the
real address exactly as the compose file in section 6 does (using the image's `/nodejs/bin/node`), then
run `docker compose up -d` (it only recreates the panel container).

### 2. There is no shell in the panel container

**Cause**: the published image is distroless and has no `sh`: `docker compose exec headplaneCN sh -c
'...'` fails outright (it prints `Headplane containers do not contain a shell by default.`).
**Fix**: investigate with the image's node:

```bash
docker compose exec headplaneCN /nodejs/bin/node -e "console.log(require('fs').readFileSync('/var/lib/headplane/derp-region-mirror.json','utf8').slice(0,200))"
```

Or temporarily switch `image:` to the `:<version>-shell` debug tag, then switch back.

### 3. A container will not start and the log says the configuration is invalid

**Cause**: most often `cookie_secret` is not exactly 32 characters, then a misspelled key in
`config.yaml` (the log says `unknown key` / `cannot unmarshal`), or an absolute path written as
`${BASE_DIR}/...`.
**Fix**:

```bash
cd /vol1/1000/APP/headplaneCN
docker compose logs headscale | tail -n 30         # read the first error
docker compose exec headscale headscale configtest # the Headscale side: validates only, does not start
```

Regenerate `cookie_secret` with `openssl rand -base64 24`, and write paths out in full.

### 4. Saving the ACL fails with `403 Policy is not writable`

**Cause**: Headscale's `policy.mode` is still `file`, so the policy API is read-only.
**Fix**: change it to `database` as in section 3, then `docker compose restart headscale` (or click
"Reload" in the panel).

### 5. A client never comes online

Work through these from most to least likely:

| Check                                                  | Command / place                                                             | Conclusion                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Has `server_url` been changed?                         | `docker compose exec headscale grep server_url /etc/headscale/config.yaml`  | It must be character-for-character identical to the pre-migration value; if it changed, every node must be re-registered |
| Hostname and certificate                               | From an external machine: `curl -sI https://ha.example.com:8443/health`     | The certificate must be trusted by clients and the hostname must match `server_url`                                      |
| Is the reverse proxy passing long connections through? | In the proxy: is HTTP/2 on, is buffering off, are timeouts ≥300 seconds?    | A buffered or downgraded `/ts2021` makes nodes fail to connect or drop constantly                                        |
| Is the noise private key there?                        | `docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/` | If the key was regenerated, every registered node stops communicating (you must restore it from the backup)              |
| Is the database there?                                 | `docker compose exec headscale headscale nodes list`                        | An empty list means `db.sqlite` is not in place or points at another path                                                |
| Is the port taken by a native process?                 | `ss -lntup \| grep 8480`                                                    | The headscale in the app centre is still running → stop it and turn off start-on-boot                                    |
| Is the service itself alive?                           | `curl -s http://127.0.0.1:8480/health`, `docker compose logs headscale`     | Anything other than `{"status":"pass"}` means reading the first error in the log                                         |

::: tip In one sentence
Clients only trust `server_url` and the certificate and path behind it; the database and the noise
private key are the credentials that prove "it is still the same control server". Get those two right
and no client needs to re-register.
:::

### 6. Saving fails with `Unexpected Server Error`

**Cause**: the reverse proxy rewrote the `Host` header, so the form submission is rejected by the
cross-site check; or the proxy stripped the `POST`'s `Content-Type`.
**Fix**: make the proxy **preserve the original Host**, stop it from rewriting request headers, and
confirm that `server.base_url` is the browser's address (with no `/admin`). See
[Lucky reverse proxy](/en/install/reverse-proxy-lucky).

### 7. DERP (relay) problems

The embedded relay region not being used, the DERP page's **official region filter** reporting that it
**cannot read** `.../derp-maps/...`, Headscale failing to start with
`getting DERPMap: open .../derp-maps/xxx.yaml: no such file or directory`, `/derp` traffic not getting
through — none of these are on this page; they are written up in the same
"symptom → cause → fix" form in [DERP & relays](/en/configuration/derp).

### 8. Anything else

Other save errors, permission problems and missing UI items are in
[Common issues](/en/configuration/common-issues).

## 9. Verification checklist

```bash
cd /vol1/1000/APP/headplaneCN

docker compose ps                                     # all three services Up (healthy) (two without Caddy)
docker compose logs headplaneCN | grep -i 'valid Headscale configuration'
docker compose logs headplaneCN | grep -i 'Using Docker integration'
docker compose logs headplaneCN | grep -i 'Listening on'
docker compose logs headscale | grep -i 'error' | tail
docker compose exec headscale headscale health
curl -s http://127.0.0.1:8480/health                  # {"status":"pass"}
curl -s http://192.168.1.10:4100/admin/healthz        # {"status":"OK"}
```

- [ ] The containers are running (`headscale`, `headplaneCN`, plus `caddy` with Lucky), recover automatically after `docker compose restart`, and `up -d` is idempotent
- [ ] The panel's **Settings → System** shows the integration as **Docker**, and saving the configuration can restart the Headscale container
- [ ] **A registered client comes online without re-registering** (`tailscale status` shows it as connected straight away)
- [ ] **Settings → System → Configuration check** is green overall ("cannot verify write permission" for the read-only data directory is expected)
- [ ] `docker compose exec headscale headscale users list` still shows the original users and nodes
- [ ] `udp/3478` is reachable from the internet (STUN is not "unavailable" in `tailscale netcheck`)
- [ ] `https://panel.example.com:8443/admin` opens through the reverse proxy

## 10. Command reference

```bash
# ---- Looking at the live system ----
cd /vol1/1000/APP/headplaneCN
docker compose ps
docker compose logs headscale | tail -n 30
docker compose logs headplaneCN | tail -n 30
curl -s http://127.0.0.1:8480/health                  # {"status":"pass"}
ss -lntup | grep -E '4100|8480|3478'

# ---- The Headscale CLI inside the container ----
docker compose exec headscale headscale version
docker compose exec headscale headscale users list
docker compose exec headscale headscale nodes list
docker compose exec headscale headscale apikeys list
docker compose exec headscale headscale apikeys create --expiration 90d
docker compose exec headscale headscale apikeys expire --prefix <prefix>

# ---- After editing the configuration ----
docker compose exec headscale headscale configtest    # validates only, does not start
docker compose up -d                                  # start / update
docker compose restart headscale                      # equivalent to clicking "Reload" in the panel
```

## 11. Upgrading, rollback and uninstalling

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
  `docker compose up -d`. Its data lives in its own `data/` and is independent of Headscale's version.
- **Rolling back Headscale**: set `HEADSCALE_VERSION` back to the old version and `up -d` again;
  **if the newer version has already run database migrations, swapping the image back is not enough** —
  run `docker compose down` first, overwrite `headscale/db.sqlite` with the `db.sqlite` from the backup
  (deleting `-wal` / `-shm` alongside it before overwriting), then `up -d`.
- The official upgrade rule: go **one minor version at a time** (0.26 → 0.27 → 0.28 → 0.29); you cannot
  skip versions, and from 0.29 the client must be ≥ v1.80.0.
- The version numbers pinned in `.env` are exactly what "locking the version" means; do not give that up
  just to let `latest` upgrade itself.
- **Uninstalling**: `docker compose down` only stops and removes the containers — the data stays. To wipe
  the data too, **back up first** with the command above: `headscale/` (above all `db.sqlite`,
  `noise_private.key`, `derp_server_private_key`), plus the panel's `data/` and `config.yaml`. Delete
  `db.sqlite` or the noise key and every registered node has to register again.

## 12. Optional: generate everything with the install script

The `.env`, the compose file and both configuration files above can all be produced by one script that
asks for everything up front:
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
- **Fully interactive, with this page's values as the defaults**: base directory, both image tags,
  `server_url`, listen ports, panel bind address, timezone, API key, cookie secret and whether to
  migrate from a native deployment are asked for and validated one by one; an invalid answer is asked
  again.
- **Look before it writes**: `--dry-run` prints every file it would write, every copy it would make and
  every command it would run afterwards, and changes nothing; a real run also prints the full plan first
  and only writes to disk after you confirm — and **without confirmation it will not start any
  container**.
- **It never deletes your data**: an existing configuration only has individual keys rewritten as
  needed (the original file is saved as `.bak`), and migration only **copies**, after a timestamped
  backup; there is no data-deleting action anywhere in the script. Migration details are in
  [Migration & rollback](/en/install/migration).
- After the writes it asks whether to run `docker compose up -d` right away, and along the way runs the
  acceptance commands — `docker compose ps`, the Headscale log, `headscale health` and the panel health
  check.
