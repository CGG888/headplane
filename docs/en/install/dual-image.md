---
title: Dual-Image Deployment
description: "Run Headscale and HeadplaneCN as two containers — shared absolute paths, one-command upgrades, Lucky reverse proxy notes and migration steps."
outline: [2, 3]
---

# Dual-image deployment: Headscale and HeadplaneCN as two containers

This guide describes the **settled deployment shape**: Headscale and HeadplaneCN each run in their
own container, and Headscale is no longer managed by the NAS app centre. The old shape —
"Headscale as a native host process next to a containerised HeadplaneCN" — is not coming back; if
this deployment ever changes, it changes to the two-container shape described here.

Both containers use **host networking**, so `127.0.0.1` inside a container is this NAS itself.
Headscale's `8080` (control), `9090` (metrics) and `udp/3478` (STUN) land directly on the NAS, and
no port mapping is involved.

::: tip Environment this assumes

- A NAS (fnOS, …) with Docker and Docker Compose ready
- Lucky as the reverse proxy (it may run on a different machine than these two containers)
- Clients already registered against a **fixed `server_url`** — the migration never changes it
  :::

If your current deployment is still "native Headscale process plus a HeadplaneCN container" —
[fnOS deployment](/en/install/fnos) or [native mode](/en/install/native-mode) — then the
[migration section below](#migrating-from-the-current-setup) is written for you.

## Running the installer (optional)

The directory layout, the compose file, both configuration files and the migration steps above
can be produced by one script that asks for every environment-specific value first:
[`scripts/dual-image-install.sh`](https://github.com/CGG888/headplaneCN/blob/main/scripts/dual-image-install.sh).

```bash
# on the NAS (or, from a clone: bash scripts/dual-image-install.sh)
curl -fsSL -o dual-image-install.sh \
  https://raw.githubusercontent.com/CGG888/headplaneCN/main/scripts/dual-image-install.sh

bash dual-image-install.sh --help      # every prompt and flag, documented
bash dual-image-install.sh --dry-run   # print the whole plan, write nothing
bash dual-image-install.sh             # the real install
```

- **Interactive, with this guide's defaults**: base directory, both image tags, `server_url`, the
  DERP and admin hostnames, ports, timezone, API key, cookie secret and whether to migrate are all
  asked for and validated; a typo is re-asked instead of aborting.
- **You define the layout**: the HeadplaneCN config file and data directory, the Headscale config
  and data directories and the DERP map directory (inside the config directory) are asked for with
  defaults derived from the base directory, validated, printed back once as the resolved layout,
  and used verbatim in both containers' `volumes:` entries.
- **Look before it writes**: `--dry-run` prints every file it would write, every copy it would
  make and every follow-up command, and changes nothing. A real run prints the same plan and only
  writes after you confirm it — and it never starts a container without asking.
- **It never deletes your data**: an existing configuration is patched key by key with the
  original kept as `.bak`, and migration only ever _copies_, after a timestamped backup.
- Afterwards it offers to run `docker compose up -d` and then runs the verification commands
  (`docker compose ps`, the Headscale log, `headscale version`).

## Why this shape

- **The path and mount pitfalls are gone.** `derp.paths` used to require "the host path, mounted at
  exactly the same absolute path in the container", because Headscale lived outside the container.
  With both components containerised, Headscale reads the container path it was given, so
  `derp.paths` simply holds container paths; as long as both containers mount the same directory at
  the same absolute path, the configuration and the map files are visibly the same files.
- **The components restart independently.** Changing HeadplaneCN's settings or upgrading its image
  never restarts Headscale, and reloading Headscale does not disturb HeadplaneCN's sessions. Their
  lifecycles are decoupled.
- **Upgrading is still one command.** Versions are pinned in the two tags in the compose file, and
  `docker compose pull && docker compose up -d` handles both images at once; rolling back means
  changing a tag back and running `up -d` again.
- **The cost: Headscale is managed by compose.** The app centre no longer offers a start/stop
  button and will not update it for you. Version, upgrade window and backups are yours to own at
  the compose layer (see the upgrade and rollback section).

## Directory layout

All paths use `/vol1/1000/APP/` as an example; substitute your own storage location.

| Host path                                  | Role                                                               | Path inside both containers                   |
| ------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------- |
| `/vol1/1000/APP/headplane/`                | Compose file, HeadplaneCN configuration, HeadplaneCN data          | —                                             |
| `/vol1/1000/APP/headplane/config.yaml`     | HeadplaneCN's own configuration                                    | `/etc/headplane/config.yaml` (read-only)      |
| `/vol1/1000/APP/headplane/data/`           | Sessions, internal database, config snapshots, agent state         | `/var/lib/headplane`                          |
| `/vol1/1000/APP/headscale/etc/`            | Headscale's configuration directory (mounted into both containers) | `/etc/headscale` (read-write)                 |
| `/vol1/1000/APP/headscale/etc/config.yaml` | Headscale's effective configuration                                | `/etc/headscale/config.yaml` (read-write)     |
| `/vol1/1000/APP/headscale/etc/derp-maps/`  | Local DERP maps, including the one the region filter writes        | `/etc/headscale/derp-maps/` (read-write)      |
| `/vol1/1000/APP/headscale/data/`           | `db.sqlite`, `noise_private.key`, `derp_server_private.key`        | `/var/lib/headscale` (read-write / read-only) |

```bash
mkdir -p /vol1/1000/APP/headplane/data \
         /vol1/1000/APP/headscale/etc/derp-maps \
         /vol1/1000/APP/headscale/data
```

## The compose file

Path: `/vol1/1000/APP/headplane/docker-compose.yml`

```yaml
services:
  headscale:
    # Pin the version; never use latest. Upgrading means editing this line on purpose
    image: headscale/headscale:0.29.2
    container_name: headscale
    restart: unless-stopped
    command: serve
    # Host networking: the container uses the NAS's 8080 / 9090 / udp 3478 directly, no port mapping
    network_mode: host
    # No pid: host here: the proc integration runs inside the HeadplaneCN container,
    # which already shares the host PID namespace and sees headscale serve (only the
    # headplane service needs that line)
    volumes:
      # Configuration and local DERP maps. Both containers see them at /etc/headscale,
      # and HeadplaneCN has to be able to rewrite them
      - "/vol1/1000/APP/headscale/etc:/etc/headscale"
      # Database, noise key and DERP key: Headscale reads and writes these
      - "/vol1/1000/APP/headscale/data:/var/lib/headscale"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  headplane:
    # Matches the HeadplaneCN release; in China an acceleration prefix works too, e.g.
    # v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:0.22.11
    image: ghcr.io/cgg888/headplanecn:0.22.11
    container_name: headplane
    restart: unless-stopped
    depends_on:
      - headscale
    network_mode: host
    # REQUIRED: integration.proc reads /proc to find headscale serve and send it SIGHUP
    pid: host
    volumes:
      # HeadplaneCN's own configuration (read-only is enough)
      - "/vol1/1000/APP/headplane/config.yaml:/etc/headplane/config.yaml:ro"
      # HeadplaneCN's own data: sessions, internal database, config snapshots, agent state
      - "/vol1/1000/APP/headplane/data:/var/lib/headplane"
      # KEY: the same absolute path as in the headscale container. The configuration check,
      # saving the configuration and editing DERP maps all depend on it
      - "/vol1/1000/APP/headscale/etc:/etc/headscale"
      # RECOMMENDED: the data directory at the same absolute path, read-only, so path checks
      # and snapshots can see db.sqlite, noise_private.key and friends. Read-only is deliberate;
      # see "Configuration deltas on both sides"
      - "/vol1/1000/APP/headscale/data:/var/lib/headscale:ro"
    environment:
      - "TZ=Asia/Shanghai"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### What each mount is for (one line each)

| Mount                                                                | Purpose                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/vol1/1000/APP/headscale/etc` (headscale)                           | Configuration directory: `config.yaml`, `derp-maps/`, DNS records file; read-write                                              |
| `/vol1/1000/APP/headscale/data:/var/lib/headscale` (headscale)       | Read-write home of the database and the private keys, so recreating the container loses nothing                                 |
| `/vol1/1000/APP/headplane/config.yaml:/etc/headplane/config.yaml:ro` | HeadplaneCN's own configuration; read-only is enough                                                                            |
| `/vol1/1000/APP/headplane/data:/var/lib/headplane`                   | HeadplaneCN's persisted data (sessions, internal database, snapshots, agent state)                                              |
| `/vol1/1000/APP/headscale/etc:/etc/headscale` (headplane)            | The **same absolute path**: `headscale.config_path`, configuration saves and DERP map view/edit/save all land on these files    |
| `/vol1/1000/APP/headscale/data:/var/lib/headscale:ro` (headplane)    | **Same absolute path, read-only**: path checks and snapshots can see `db.sqlite` and `noise_private.key` without risk of writes |

::: info The read-only data directory is deliberate
HeadplaneCN's user is not Headscale's user. Mounting the data directory read-only makes the
"database directory" item in the configuration check report **cannot verify write permission** —
that is the expected result, not a fault. Only intervene if Headscale itself reports it cannot
write.
:::

### Host networking restrictions

Do **not** write `ports:` or `extra_hosts:` for a container using `network_mode: host`. With host
networking the container shares the host's network namespace, so port mappings are meaningless
(Compose refuses or ignores them) and `extra_hosts` does nothing either — nor is it needed, since
`127.0.0.1` inside the container already is the host.

The reachable ports are therefore decided entirely by what each container listens on:

| Port       | Listener                  | How it is published                                                                    |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `tcp/8080` | Headscale control service | Lucky points at `127.0.0.1:8080` (both the control paths and `/derp` live here)        |
| `tcp/9090` | Headscale metrics         | Keep it local; do not expose it to the internet                                        |
| `udp/3478` | STUN of the embedded DERP | Open `udp/3478` straight to this NAS on the router/firewall — **never** via HTTP proxy |
| `tcp/4100` | HeadplaneCN               | Lucky points at `127.0.0.1:4100` (the default is `3000`; change both together)         |

> [!IMPORTANT]
> `tcp/4100` is the admin console, so it has the largest exposure: `server.host` defaults to
> `0.0.0.0`, which makes it reachable from the whole LAN. When the reverse proxy runs on this
> machine, narrowing it to `127.0.0.1` is safer — the installer's `--admin-bind 127.0.0.1` writes
> `server.host: "127.0.0.1"` under host networking and, under bridge networking, publishes the port
> as `127.0.0.1:4100` instead (inside the container it still listens on `0.0.0.0`, otherwise docker
> could not forward it). Either way, never expose `tcp/4100` to the internet: put a TLS reverse
> proxy or a firewall in front of it.

## Configuration deltas on both sides

### HeadplaneCN: `/vol1/1000/APP/headplane/config.yaml`

```yaml
server:
  host: "0.0.0.0"
  port: 4100 # Keep your current 4100; the default is 3000, and the proxy backend must match

  # The URL the browser uses: scheme + hostname + port, with no /admin suffix
  base_url: "https://admin.<domain>:8443"
  # Exactly 32 characters: openssl rand -base64 24
  cookie_secret: "<32-character random string>"
  cookie_secure: true
  data_path: "/var/lib/headplane"

headscale:
  # Under host networking, 127.0.0.1 inside the container is the host, i.e. the Headscale container
  url: "http://127.0.0.1:8080"

  # Public address used for display and for browser SSH (falls back to the url above)
  public_url: "https://ha.<domain>:8443"

  # REQUIRED: the full API key, not the prefix shown in the list
  api_key: "hskey-api-..."

  # REQUIRED: the path of Headscale's effective configuration inside the container, identical
  # to the mount point
  config_path: "/etc/headscale/config.yaml"

  # Optional: the same file as headscale's dns.extra_records_path, so DNS edits need no restart
  # dns_records_path: "/etc/headscale/extra-records.json"

integration:
  # The reload button on the settings and system pages sends SIGHUP to headscale serve.
  # Prerequisite: the HeadplaneCN container must run with pid: host (see the compose file)
  proc:
    enabled: true

  # Agent: syncs node versions, OS details and each machine's DERP region and latency
  agent:
    enabled: true
```

Only five settings must change: `headscale.url`, `headscale.config_path`, `headscale.api_key`,
`integration.proc.enabled` and `server.base_url`.

### Headscale: `/vol1/1000/APP/headscale/etc/config.yaml`

```yaml
# MOST IMPORTANT: the address clients registered against. Keep it byte-for-byte identical
server_url: https://ha.<domain>:8443

# Listen address inside the container; with host networking this is the NAS's 8080
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 0.0.0.0:9090

# Keys and database all live under /var/lib/headscale (the host's .../headscale/data)
noise_private_key_path: /var/lib/headscale/noise_private.key
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite

# Optional: when DNS records live in a file, use the copy both containers can see
# dns:
#   extra_records_path: /etc/headscale/extra-records.json

derp:
  server:
    enabled: true
    region_id: 999
    region_code: headscale
    region_name: "Headscale Embedded DERP"
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: /var/lib/headscale/derp_server_private.key
  # These entries are now **container paths**, no longer host paths
  paths:
    - /etc/headscale/derp-maps/official-mirror.yaml
```

| Change                                                                           | Why                                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `listen_addr: 0.0.0.0:8080`                                                      | Inside the container; with host networking it is directly the NAS's `8080`. Clients never care about this port, only about `server_url` |
| `server_url` **stays the same**                                                  | Clients registered against it and verify it. Changing it forces every registered node to log in again                                   |
| `noise_private_key_path` / `database.sqlite.path` under `/var/lib/headscale/...` | Both files now come from the mounted data directory, so the paths must be container paths                                               |
| `derp.paths` rewritten as **container paths**                                    | Headscale runs in a container and sees the paths it was given; `/etc/headscale/derp-maps/...` is the same file HeadplaneCN sees         |
| `stun_listen_addr: 0.0.0.0:3478`                                                 | STUN of the embedded DERP; with host networking it takes the NAS's `udp/3478` directly                                                  |
| `derp.server.enabled: true` plus `private_key_path`                              | The self-hosted embedded relay; the key lives in the writable data directory and is generated if missing                                |
| `derp.urls`                                                                      | Keep your current value (keep `[]` if the embedded relay is the only relay)                                                             |
| `policy.mode`                                                                    | Keep it as it is (`database` is required to edit ACLs in the web UI)                                                                    |

### Why the old "host path + identical absolute path" rule disappears

That rule existed because **Headscale read a path on the host** while HeadplaneCN ran in a
container: only by mounting the host directory at exactly its host absolute path could both sides
point at the same file. That is why `derp.paths` had to contain
`/vol1/@appdata/headscale/derp-maps/...` and why the container mount point had to match it
verbatim.

Now that **Headscale is containerised too**, it reads the container path it was mounted. So:

- `derp.paths` holds **container paths** (`/etc/headscale/derp-maps/official-mirror.yaml`);
- both containers mount the shared directories at the **same absolute path** (`/etc/headscale`,
  `/var/lib/headscale`) — that is agreement _between the two containers_, no longer "the container
  path must equal the host path";
- the old failure `getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or
directory` was then **guaranteed**; today it only appears when the file genuinely does not exist
  in the container (never created, mount missing, path mistyped). See troubleshooting.

::: warning The DERP region filter's target path changes too
The "official region node filter" card defaults its target file to the old-shape host path
(`/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`). In the two-container shape, change it
to `/etc/headscale/derp-maps/official-mirror.yaml` and make sure **that same path** appears in
Headscale's `derp.paths` — otherwise Headscale will not find the file on its next reload. The full
rules for that card live in [Headscale Settings](/en/features/headscale-settings).
:::

## Migrating from the current setup

Work through this in order. Never change `server_url` along the way.

**1. Back up the data directory**

```bash
# Database, noise key, configuration, policy files, DERP maps and the DERP key
cd /vol1/@appdata
tar -czf /vol1/1000/APP/headscale-migration-$(date +%F).tar.gz headscale
```

For a guaranteed-consistent database copy, stop headscale in the fnOS app centre first and take
this backup afterwards.

**2. Stop the native Headscale and confirm the ports are free**

```bash
# fnOS app centre → headscale → stop
ps -ef | grep '[h]eadscale serve'      # expect no output
ss -lntup | grep -E '8080|9090|3478'   # expect no output (-u is needed to see udp/3478)
```

**3. Copy the data and configuration into the new directories**

```bash
mkdir -p /vol1/1000/APP/headscale/data /vol1/1000/APP/headscale/etc/derp-maps

cp -a /vol1/@appdata/headscale/config.yaml       /vol1/1000/APP/headscale/etc/config.yaml
cp -a /vol1/@appdata/headscale/db.sqlite         /vol1/1000/APP/headscale/data/
cp -a /vol1/@appdata/headscale/noise_private.key /vol1/1000/APP/headscale/data/
cp -a /vol1/@appdata/headscale/derp_server_private.key \
      /vol1/1000/APP/headscale/data/ 2>/dev/null || true
cp -a /vol1/@appdata/headscale/derp-maps/.       /vol1/1000/APP/headscale/etc/derp-maps/ 2>/dev/null || true
cp -a /vol1/@appdata/headscale/extra-records.json /vol1/1000/APP/headscale/etc/ 2>/dev/null || true
# With policy.mode: file, copy the policy file named by policy.path in config.yaml as well

# Both images run as root, so root-owned directories are fine; keep the keys at 600
chown -R 0:0 /vol1/1000/APP/headscale
chmod 600 /vol1/1000/APP/headscale/data/noise_private.key
chmod 600 /vol1/1000/APP/headscale/data/derp_server_private.key 2>/dev/null || true
```

**4. Rewrite the paths inside `config.yaml` to container paths**

Walk the table in the Headscale section above item by item: `noise_private_key_path`,
`database.sqlite.path`, `derp.server.private_key_path`, `derp.paths`, `dns.extra_records_path`,
`policy.path`, `unix_socket` (if used) and any certificate or file path that pointed at a host
absolute path. Change `listen_addr` to `0.0.0.0:8080`. **Leave `server_url` alone.**

**5. Bring the stack up**

```bash
cd /vol1/1000/APP/headplane
mkdir -p data
# with config.yaml and docker-compose.yml in place
docker compose up -d
docker compose ps
```

**6. Read the logs and the UI**

```bash
docker compose logs headscale | tail -n 50
# expect: listening on 8080, DERP enabled, and no getting DERPMap error

curl -s  http://127.0.0.1:8080/health           # {"status":"pass"}
curl -si http://127.0.0.1:8080/derp | head -3   # a 400/426-style answer, not 404

docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale apikeys list

docker compose logs headplane | grep -iE 'valid Headscale configuration|Found headscale serve|Agent'
# expect: Found a valid Headscale configuration file at /etc/headscale/config.yaml
#         Found headscale serve (PID ...)
```

Open `https://admin.<domain>:8443/admin` and go to **Settings → System → Configuration check**:
the database directory, noise key, policy file and TLS paths should each report a verdict (the data
directory is mounted read-only, so "cannot verify write permission" is expected). Then open
**Settings → Headscale → DERP** and confirm the map and region-filter cards already point at
`/etc/headscale/...`.

**7. Clients need no re-registration**

`server_url` and the public ports (Lucky's `8443`, `udp/3478`) are unchanged, and the database,
`noise_private.key` and the DERP key were carried over, so registered nodes need to do nothing:

```bash
# on any client machine
tailscale status        # should show as connected; no tailscale up required
tailscale debug derp-map
```

Do not run `tailscale up --login-server ...` or re-register at this point — that would bring the
node into the tailnet as a new identity.

## Upgrade and rollback

```bash
cd /vol1/1000/APP/headplane

# MANDATORY before touching the Headscale image: database migrations are one-way
docker compose stop headscale
tar -czf /vol1/1000/APP/headscale-backup-$(date +%F).tar.gz \
  -C /vol1/1000/APP headscale headplane
docker compose start headscale

# Edit the tag(s) in the compose file (either one alone is fine), then
docker compose pull
docker compose up -d

# Check
docker compose ps
docker compose logs headscale | tail -n 30
docker compose exec headscale headscale version
```

- **Rolling back HeadplaneCN**: set the `image:` tag back to the previous version and run
  `docker compose up -d`. Its data lives in its own `data/` and is independent of Headscale's
  version.
- **Rolling back Headscale**: set the tag back and run `docker compose up -d`; **if the newer
  version already ran database migrations, swapping the image back is not enough** — run
  `docker compose down`, overwrite `headscale/data/db.sqlite` with the copy from the backup (while
  the container is stopped), then `docker compose up -d`.
- The pinned tags in the compose file _are_ the version lock. Do not give it up to let `latest`
  upgrade itself.

## Reverse proxy notes

There is a single public port, `8443`, with two hostnames (plus an optional `admin.`). Lucky splits
them by Host header, and every route points back at this NAS:

| Public hostname          | Backend                 | Traffic it carries                                                                                        |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `ha.<domain>:8443`       | `http://127.0.0.1:8080` | The `server_url` hostname: client control traffic (`/key`, `/ts2021`, `/api/v1/*`, `/health`) and `/derp` |
| `derp.<domain>:8443`     | `http://127.0.0.1:8080` | A second entrance to `/derp` relay traffic on the same container                                          |
| `admin.<domain>:8443`    | `http://127.0.0.1:4100` | The HeadplaneCN UI (`/admin`, including the browser SSH WebSocket)                                        |
| `udp/3478` (not proxied) | the NAS's `udp/3478`    | STUN, which must be reachable directly                                                                    |

### Client control traffic (`ha.`)

- It must **support HTTP/2 and pass it through to the container**: the `/ts2021` control tunnel is a
  long-lived connection, and downgrading to HTTP/1.1 or buffering it makes nodes flap.
- Raise read/write timeouts to **300 seconds or more** (or disable them) and **turn off response
  buffering / gzip rewriting**.
- **Do not rewrite paths**: `/api/v1/*`, `/ts2021`, `/key`, `/health` and `/verify` must reach
  `127.0.0.1:8080` unchanged.
- The certificate must be trusted by clients and match the `server_url` hostname.

### DERP relay traffic (`/derp`)

- The relay address clients receive is derived from `server_url` (its hostname, its port, path
  `/derp`). So **the `server_url` hostname must serve `/derp`**; `derp.<domain>` is only a second
  entrance on the same container and must not become the only way clients can reach the relay.
- Preserve the **Upgrade / WebSocket** headers, **do not buffer**, keep timeouts at 300 seconds or
  more, and never rewrite or strip the path.
- Both hostnames need valid certificates. TLS terminates at Lucky; the container stays plain HTTP.

### STUN (`udp/3478`)

An HTTP reverse proxy **cannot forward UDP**. The DERP map advertises STUN on `udp/3478`, and
clients send to `<server_url hostname>:3478/udp`, so open it directly on the machine running Lucky
or on the router:

```
udp/3478  →  <NAS IP>:3478/udp
```

### Verification (three steps, in order)

```bash
# 1. Direct to Headscale: the /derp route must exist (expect a 400/426-style answer, not 404)
curl -si http://127.0.0.1:8080/derp | head -3

# 2. Through the proxy: the status code must match step 1
curl -si https://ha.<domain>:8443/derp | head -3

# 3. Client side (the decisive evidence)
tailscale debug derp-map | grep -A 12 -i headscale
tailscale debug derp headscale
```

## Verification checklist

```bash
cd /vol1/1000/APP/headplane

docker compose ps                                   # both containers Up / healthy
docker compose logs headplane | grep -i 'valid Headscale configuration'
docker compose logs headplane | grep -i 'Found headscale serve'
docker compose logs headplane | grep -iE 'Agent|Tailnet'
docker compose logs headscale | grep -iE 'error|derp' | tail
curl -s http://127.0.0.1:8080/health                # {"status":"pass"}
```

- [ ] Both containers are running and come back after `docker compose restart`
- [ ] **Settings → System → Configuration check** is green overall (the read-only data directory's
      "cannot verify write permission" is expected)
- [ ] **Settings → Headscale** can save the configuration and triggers a successful reload (the log
      shows `Sent SIGHUP to Headscale`)
- [ ] **A registered client comes online without re-registering** (`tailscale status` shows it as
      connected straight away)
- [ ] The embedded relay is actually used: `tailscale debug derp-map` lists the region,
      `tailscale debug derp headscale` connects, and the machine detail relay card shows that region
- [ ] The UI is reachable through Lucky at `https://admin.<domain>:8443/admin`
- [ ] The region filter card's target path is `/etc/headscale/derp-maps/official-mirror.yaml`,
      **that same path** appears in `derp.paths`, and the file exists
- [ ] `udp/3478` is reachable from the internet (`tailscale netcheck` does not report STUN as
      unavailable)

## Troubleshooting

### `getting DERPMap: open /etc/headscale/derp-maps/xxx.yaml: no such file or directory`

Headscale cannot read one of the files listed in `derp.paths` while starting or reloading, so it
shuts down. In the two-container shape there are only three causes:

1. **The file does not exist**: create a placeholder first, then add it to the configuration.

   ```bash
   printf 'regions: {}\n' > /vol1/1000/APP/headscale/etc/derp-maps/official-mirror.yaml
   ```

2. **`derp.paths` does not hold a container path**: it still contains the old-shape host path
   (`/vol1/@appdata/...`). Change it to `/etc/headscale/derp-maps/...`.
3. **The mount did not take effect**: the compose file is missing
   `/vol1/1000/APP/headscale/etc:/etc/headscale`, or the host directory name is wrong. Recreate the
   containers with `docker compose up -d` and check:

   ```bash
   docker compose exec headscale ls -l /etc/headscale/derp-maps/
   ```

To get it running again first, comment out that line under `derp.paths`, or roll back to the config
snapshot taken before the write in **Settings → Snapshots**, restart, and then redo it in order:
create the file in the shared host directory, confirm the mount, put the path into `derp.paths`.

### A client will not come online

Work down this list, most likely first:

| Check                                  | Command / place                                                            | What it means                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Was `server_url` changed?              | `docker compose exec headscale grep server_url /etc/headscale/config.yaml` | It must match the pre-migration value byte for byte; if it changed, re-register nodes |
| Hostname and certificate               | From outside: `curl -sI https://ha.<domain>:8443/health`                   | The certificate must be trusted and the hostname must match `server_url`              |
| Is the proxy passing long connections? | In Lucky: HTTP/2 enabled, buffering off, timeouts ≥300 seconds             | A buffered or downgraded `/ts2021` makes nodes fail or flap                           |
| Was the noise key carried over?        | `docker compose exec headscale ls -l /var/lib/headscale/`                  | If it was regenerated, every registered node stops communicating (restore the backup) |
| Was the database carried over?         | `docker compose exec headscale headscale nodes list`                       | An empty list means `db.sqlite` was not copied correctly or points elsewhere          |
| Node is registered but offline         | The last-seen value in `headscale nodes list`                              | Registration is fine; the problem is the network/proxy path — back to the rows above  |
| Is the service itself alive?           | `curl -s http://127.0.0.1:8080/health`, `docker compose logs headscale`    | Anything other than `{"status":"pass"}` means reading the first error in the log      |

::: tip In one sentence
Clients only trust `server_url` plus the certificate and path behind it; the database and the noise
key are what make it "still the same control server". Get those right and no client needs to
re-register.

For other symptoms (`Unexpected Server Error` on save, `403 Policy is not writable`, …) see
[Common Issues](/en/configuration/common-issues).
:::
