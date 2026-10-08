---
title: Mode migration and rollback
description: "Move between fnOS native mode and dual-image mode in either direction: what to back up, what each step does, and how to get back if it fails."
outline: [2, 3]
---

# Mode migration and rollback

This page is only about **moving between the two deployment shapes**: Headscale as a native process with
the panel in a container ([fnOS deployment](/en/install/fnos)) ⇄ Headscale and the panel each in their
own container ([Dual-image deployment](/en/install/dual-image)). Both directions are covered: native →
dual-image first, then dual-image → native. **Installation details are not repeated here** (the full
`.env`, compose file and both configuration files live in
[Dual-image deployment](/en/install/dual-image)); for domains and the reverse proxy see
[Domains and access](/en/install/domains).

**When to migrate**: you want Docker to manage Headscale too (upgrades, restarts, logs) → move from
native to dual-image. You want Headscale back under the fnOS app centre, with the smallest possible
Docker footprint → move from dual-image back to native.

**What the migration cannot lose**: the data is not converted, only **moved**. `server_url`, the public
ports, `db.sqlite`, `noise_private.key` and the DERP private key all stay the same, so **registered
clients need no re-registration and no `tailscale up`**. That is the shared bottom line for both
directions.

**What you must back up first**: Headscale's database and noise key, Headscale's `config.yaml`, the
panel's database and `cookie_secret`, and the DERP map files. See the next section — **do not go any
further until the backup is done**.

::: warning Three things never change along the way

- **`server_url`** (domain and port): change it and every registered node has to log in and register again.
- **`noise_private.key`**: lose it and you have effectively swapped the control server — no node can connect.
- **The panel's `cookie_secret`**: change it and everyone is signed out and has to log in again.
  :::

## Values you need to change

| Placeholder                     | Example                                                               | What it is                                                                         | Must / may / never             | Where to change it                                                 |
| ------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Domain and port in `server_url` | `https://ha.example.com:8443`                                         | The registration address clients use; **verbatim, unchanged, all the way through** | **never**                      | Headscale's `config.yaml`                                          |
| Native data directory           | `/vol1/@appdata/headscale`                                            | The fnOS app's data directory                                                      | may                            | your real path                                                     |
| Dual-image root `BASE_DIR`      | `/vol1/1000/APP/headplaneCN`                                          | Root of the new shape, **the same path inside and outside the container**          | may                            | `BASE_DIR` in `.env`                                               |
| The NAS's LAN IP                | `192.168.1.10`                                                        | The address the panel listens on; the proxy also uses it as its upstream           | **must**                       | `PANEL_BIND` in `.env`, `server.host` in the panel's `config.yaml` |
| Headscale data owner            | `965:966`                                                             | The container runs as this uid:gid, otherwise it cannot write the database         | **must**                       | `HEADSCALE_UID/GID` in `.env` (read the real value with `ls -ln`)  |
| Panel cookie key                | `openssl rand -base64 24`                                             | Encrypts cookies; must be exactly 32 characters                                    | **never** (keep the old value) | `server.cookie_secret` in the panel's `config.yaml`                |
| Headscale API key               | `hskey-api-...`                                                       | How the panel reaches the Headscale API; the full value, not the prefix            | **must**                       | `headscale.api_key` in the panel's `config.yaml`                   |
| Image version numbers           | `0.29.4`, `0.22.23`                                                   | Pinned versions, never `latest`; upgrades change only these                        | may                            | `HEADSCALE_VERSION` / `HEADPLANE_VERSION` in `.env`                |
| DERP map file path              | `/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml` | `derp.paths` and the panel's DERP card must point at the same file                 | may                            | Headscale's `config.yaml`                                          |
| STUN port                       | `udp/3478`                                                            | Must be forwarded by the router on its own; a reverse proxy cannot carry UDP       | **never**                      | router / firewall                                                  |

## 1. Before migrating: back these up

Four things, and losing any one of them can leave you unable to go back:

1. **Headscale's database and noise key** — the whole `/vol1/@appdata/headscale/` directory, above all
   `db.sqlite`, `noise_private.key` and `derp_server_private.key`;
2. **Headscale's `config.yaml`** — `server_url`, `derp.paths` and friends live in it, packed up with the
   same directory;
3. **The panel's database and `cookie_secret`** — the panel's `data/` directory (sessions, internal
   database, snapshots, agent state) and its own `config.yaml` (`server.cookie_secret` is in there);
4. **The DERP map files** — `derp-maps/`, including the `official-mirror.yaml` that "official region
   selection" writes.

```bash
# ① Headscale data. For an absolutely consistent database copy, stop headscale in the fnOS app centre first
sudo mkdir -p /vol1/1000/APP/headplaneCN/backup
sudo tar -czf /vol1/1000/APP/headplaneCN/backup/native-headscale-$(date +%Y%m%d-%H%M%S).tar.gz \
  --exclude=headscale/headscale.log \
  -C /vol1/@appdata headscale

# ② The panel's own data and configuration (cookie_secret is in there, so back it up too)
sudo tar -czf /vol1/1000/APP/headplaneCN/backup/headplane-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /vol1/1000/APP/headplaneCN data config.yaml
```

A native install's `headscale.log` can be several hundred MB — that is what the `--exclude` above is for.

**Check the backup before continuing**, however slow it feels:

```bash
tar -tzf /vol1/1000/APP/headplaneCN/backup/native-headscale-*.tar.gz \
  | grep -E 'db.sqlite|noise_private.key|config.yaml'
tar -tzf /vol1/1000/APP/headplaneCN/backup/headplane-*.tar.gz | head
```

If the directory already holds a "single panel container + native headscale" compose file, keep a copy:

```bash
cp /vol1/1000/APP/headplaneCN/docker-compose.yml \
   /vol1/1000/APP/headplaneCN/docker-compose.yml.bak-native-$(date +%Y%m%d-%H%M%S)
```

**Where to keep them**:

- Both go into `${BASE_DIR}/backup/` with a timestamp in the name, so `ls -lh backup/` lines up with each
  operation you ran;
- The backups contain `noise_private.key` and `cookie_secret`, which are the control server's
  credentials: keep them at mode `600` and out of public or synced cloud storage;
- One copy on the same machine is not a backup — copy it to another disk or machine with `scp`;
- After migrating, do **not** delete `/vol1/@appdata/headscale` straight away; leave it for a few weeks.

## 2. Stop the old shape (order matters)

```bash
# 1) Stop headscale in the fnOS app centre first (not the panel)
# 2) Confirm the process really is gone
ps -ef | grep '[h]eadscale serve'             # expect: no output

# 3) Confirm the ports are free (-u is needed to see udp/3478)
ss -lntup | grep -E '8480|8481|3478|50443'    # expect: no output

# 4) Only then stop the panel container
cd /vol1/1000/APP/headplaneCN
docker compose down
```

Why that order:

- **Stop Headscale first**: SQLite flushes and `-wal` is merged, so the database you pack up afterwards
  is a clean copy;
- **Prove the ports are free early**: while the native process still holds `8480`, the containerised
  Headscale cannot start and the log only says `address already in use`, which looks like a
  configuration mistake;
- **Stop the panel container last**: running `down` first easily makes you forget the native headscale,
  and the occupied-port problem then only surfaces when you start the new shape.

In the other direction (dual-image → native) the container side stops first: `docker compose down` stops
the stack's containers in dependency order (three with the Lucky path split: `headscale`, `headplaneCN`,
`caddy`), and section 4 moves the data.

## 3. Native → dual-image

### 3.1 Directory layout: three containers, one directory

| Host path                                            | What lives there                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `${BASE_DIR}/headscale/`                             | Headscale's data and configuration: `db.sqlite`, `noise_private.key`, `derp_server_private.key`, `config.yaml`, `derp-maps/`, `headscale.sock` |
| `${BASE_DIR}/data/`                                  | The panel's own data: sessions, internal database, snapshots, agent state                                                                      |
| `${BASE_DIR}/config.yaml`                            | The panel's own configuration                                                                                                                  |
| `${BASE_DIR}/backup/`                                | The `tar.gz` files from before migrations and upgrades (the output of section 1)                                                               |
| `${BASE_DIR}/.env`, `${BASE_DIR}/docker-compose.yml` | Version numbers, run-as user, the three container definitions (drop the `caddy:` block unless you use the Lucky path split)                    |

`BASE_DIR` is that directory's absolute path, `/vol1/1000/APP/headplaneCN` in the examples — substitute
your real storage location. **The same path is used inside and outside the container**, which is the
premise for "the absolute paths stay unchanged" below.

```bash
mkdir -p /vol1/1000/APP/headplaneCN/{data,backup} \
         /vol1/1000/APP/headplaneCN/headscale/derp-maps \
         /vol1/1000/APP/headplaneCN/caddy/{data,config}   # only the Lucky layout needs it
```

### 3.2 Copy the data into the new directory

```bash
sudo cp -a /vol1/@appdata/headscale/. /vol1/1000/APP/headplaneCN/headscale/

# Delete only runtime leftovers: log, pid and the old socket (the container recreates the socket)
sudo rm -f /vol1/1000/APP/headplaneCN/headscale/headscale.log \
           /vol1/1000/APP/headplaneCN/headscale/headscale.pid \
           /vol1/1000/APP/headplaneCN/headscale/headscale.sock

# Keep the private keys at 600; note the owner, you need it for .env in the next step
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/noise_private.key
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
ls -ln /vol1/1000/APP/headplaneCN/headscale | head
```

This is **`cp` (a copy), not `mv`**: `/vol1/@appdata/headscale` stays as it is, so a migration that goes
wrong immediately can be handed straight back (see section 6).

### 3.3 `.env`: only these keys move

The full `.env` and `docker-compose.yml` are in [Dual-image deployment](/en/install/dual-image); these are
the keys a migration touches:

```ini
# /vol1/1000/APP/headplaneCN/.env
HEADSCALE_VERSION=0.29.4              # ← may change: a pinned version, upgrades edit this line
HEADPLANE_VERSION=0.22.23             # ← may change: same here

HEADSCALE_UID=965                     # ← must change: the uid you saw in `ls -ln` during 3.2
HEADSCALE_GID=966                     # ← must change: the matching gid (0 means run as root)

BASE_DIR=/vol1/1000/APP/headplaneCN   # ← may change: must be an absolute path, used inside and outside
PANEL_BIND=192.168.1.10               # ← must change: your NAS's IP
PANEL_PORT=4100                       # ← may change (defaults to 4100)
TZ=Asia/Shanghai                      # ← may change

IMAGE_PROXY=v6.gh-proxy.org/docker/                 # ← may change: all three images use it (empty = direct; use v4.gh-proxy.org/docker/ without IPv6)
CADDY_PORT=8444                                     # ← may change: only the Lucky layout needs it
```

::: warning When you bind a specific IP, two places move together
The panel's listen address and its own health-check probe use the same address. The compose file refers
to `${PANEL_BIND}:${PANEL_PORT}` in both, so editing `.env` in one place is enough; change only one of
them by hand and the container reports `unhealthy` for ever.
:::

### 3.4 The compose file: three mounts + two environment variables

```yaml
# an excerpt; the full file is in /en/install/dual-image
services:
  headscale:
    network_mode: host
    labels:
      me.tale.headplane.target: "headscale" # ← how the panel finds the container
    volumes:
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro"
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale" # ← the key line: the same absolute path
  headplaneCN:
    network_mode: host
    volumes:
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
      - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps"
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"
      - "/var/run/docker.sock:/var/run/docker.sock" # ← the Docker integration restarts the container with it
    environment:
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true" # ← switch to the Docker integration
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false" # ← turn the native SIGHUP integration off
```

::: tip The two things dual-image does not need — the rollback does
`pid: host` is **optional** in dual-image (it only lets the agent see host processes), and
`security_opt: ["apparmor=unconfined"]` is not needed at all — that belongs to the proc integration, see
section 4.
:::

### 3.5 Keys to change on each side

| Where                   | Key                                                                                                           | Change it to                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Panel `config.yaml`     | `server.host` / `server.port`                                                                                 | What `.env` says in `PANEL_BIND` / `PANEL_PORT`                                                           |
| Panel `config.yaml`     | `server.base_url`                                                                                             | The full address browsers use for **the panel**, with no trailing `/admin`                                |
| Panel `config.yaml`     | `server.cookie_secret`                                                                                        | The same string as before the migration (32 characters)                                                   |
| Panel `config.yaml`     | `headscale.url`                                                                                               | `http://127.0.0.1:8480` (on host networking, `127.0.0.1` inside the container _is_ the host)              |
| Panel `config.yaml`     | `headscale.public_url`                                                                                        | The public address browsers use for Headscale, matching `server_url`                                      |
| Panel `config.yaml`     | `headscale.api_key`                                                                                           | The full `hskey-api-...`                                                                                  |
| Panel `config.yaml`     | `headscale.config_path`                                                                                       | `/etc/headscale/config.yaml`, character-for-character the mount point                                     |
| Panel `config.yaml`     | `integration.docker.enabled`                                                                                  | `true`; set `integration.proc.enabled` to `false` at the same time                                        |
| Headscale `config.yaml` | `noise.private_key_path`, `database.sqlite.path`, `derp.server.private_key_path`, `derp.paths`, `unix_socket` | **only if they still say `/vol1/@appdata/headscale/...`** — rewrite them into `${BASE_DIR}/headscale/...` |
| Headscale `config.yaml` | `server_url`                                                                                                  | **leave it alone**                                                                                        |

::: tip The compose file already sets these through environment variables
`HEADPLANE_SERVER__HOST/PORT`, `HEADPLANE_HEADSCALE__CONFIG_PATH` and
`HEADPLANE_INTEGRATION__DOCKER__*` map one-to-one onto keys in the configuration file, and
**environment variables win**. Pick one style: put them in compose and leave `config.yaml` alone, or put
them in the configuration file and delete those environment variables.
:::

::: tip Let the install script rewrite the paths for you (optional)
`scripts/dual-image-install.sh` in [Dual-image deployment](/en/install/dual-image) asks "are you
migrating from a native deployment?" and rewrites those stale `/vol1/@appdata/headscale/...` paths into
`${BASE_DIR}/headscale/...` (only there — never to `/etc/headscale` or `/var/lib/headscale`). A manual
migration follows the table above.
:::

### 3.6 Mount-path rule: why the absolute paths stay unchanged

```text
host               /vol1/1000/APP/headplaneCN/headscale   ← the data lives here
headscale container   - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
inside the container  /vol1/1000/APP/headplaneCN/headscale   ← the same path
in the configuration  private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key
```

So "what the configuration says" and "where the file is" always agree, and backups, snapshots and the
panel's path checks all point at the same place. The one exception is the **configuration file's own
mount point**: Headscale reads its configuration from `/etc/headscale/config.yaml` by default, so that
one is still mounted there.

::: warning Do not write the Headscale configuration from memory
A wrong key makes Headscale refuse to start (the log says `unknown key` / `cannot unmarshal`). Validate
before starting:

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale configtest   # validation only, starts nothing
```

:::

### 3.7 Bring it up and self-check

```bash
cd /vol1/1000/APP/headplaneCN
docker compose config --quiet        # is the syntax fine and is every variable set?
docker compose up -d
docker compose ps                    # expect: all three services Up (healthy) (two without Caddy)
```

```bash
docker compose logs headscale | tail -n 50
# expect: version=v0.29.4, DB opened at …/headscale/db.sqlite, DERP region 999,
#         stun server started, listening and serving HTTP on 0.0.0.0:8480

docker compose logs headplaneCN | tail -n 50
# expect: Connected to Headscale 0.29.4,
#         Found a valid Headscale configuration file at /etc/headscale/config.yaml,
#         Using Docker integration, Listening on http://<PANEL_BIND>:4100
```

Then open the panel (`https://ha.example.com:8443/admin`): **Settings → System** should show the
integration as **Docker**, and saving the configuration restarts the Headscale container;
**Settings → Headscale → DERP** should show the new path on the map card.

## 4. Dual-image → native

The data needs no conversion — it just moves back and the integration switches back to process-based.

### 4.1 Stop the stack and back up

```bash
cd /vol1/1000/APP/headplaneCN
docker compose down
sudo tar -czf backup/dual-image-headscale-$(date +%Y%m%d-%H%M%S).tar.gz -C . headscale
```

### 4.2 Move the data back to the native directory

```bash
sudo cp -a /vol1/1000/APP/headplaneCN/headscale/. /vol1/@appdata/headscale/
sudo rm -f /vol1/@appdata/headscale/headscale.sock      # let the native process recreate it
# Change the owner back to fnOS's headscale user (use `id headscale` for the real uid:gid)
sudo chown -R "$(id -u headscale):$(id -g headscale)" /vol1/@appdata/headscale
```

The absolute paths in `config.yaml` have to go back to the **native data directory**: in the dual-image
shape they point at `${BASE_DIR}/headscale/...` (for example
`/vol1/1000/APP/headplaneCN/headscale/...`), while the native fnOS process reads
`/vol1/@appdata/headscale/...`. Rewrite `noise.private_key_path`, `database.sqlite.path`,
`derp.server.private_key_path`, `derp.paths` and `unix_socket` (if you set it) one by one.

The install script rewrites those old paths onto the new directory during the forward migration; **this
reverse step is manual**.

### 4.3 Start the native Headscale

fnOS app centre → headscale → start (and restore "start on boot").

```bash
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health        # expect {"status":"pass"}
```

### 4.4 Switch the panel back to the process integration

The panel no longer has a Headscale container to restart, so the integration goes from Docker to proc and
the compose file changes the way native mode requires:

```yaml
services:
  headplaneCN:
    image: "${IMAGE_PROXY-}ghcr.io/cgg888/headplanecn:<version>"
    container_name: headplaneCN
    restart: unless-stopped
    network_mode: host
    pid: host # ← required: proc reads /proc to find headscale serve
    security_opt:
      - "apparmor=unconfined" # ← required: without it, SIGHUP fails with kill EACCES
    volumes:
      - "/vol1/1000/APP/headplaneCN/config.yaml:/etc/headplane/config.yaml:ro"
      - "/vol1/1000/APP/headplaneCN/data:/var/lib/headplane"
      # The native configuration directory is mounted at the same absolute path so the panel can rewrite it
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale"
      # /var/run/docker.sock is no longer needed
    environment:
      - "TZ=Asia/Shanghai"
      - "HEADPLANE_SERVER__HOST=192.168.1.10"
      - "HEADPLANE_SERVER__PORT=4100"
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/vol1/@appdata/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=false"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true"
      - "HEADPLANE_INTEGRATION__PROC__ALLOW_RESTART=false"
```

Why `pid: host` and `apparmor=unconfined` are needed: the proc integration reads `/proc` to find the
`headscale serve` process and then sends it a SIGHUP to reload ACLs. Docker's default AppArmor profile
only allows signalling processes that carry **the same profile**, so signalling a native (unconfined)
process is refused:

```text
Failed to send SIGHUP to PID ...: Error: kill EACCES
```

::: warning The "Restart Headscale" button needs a supervising process
`HEADPLANE_INTEGRATION__PROC__ALLOW_RESTART` controls the "Restart Headscale" button in the UI, and it
is only safe when Headscale is supervised — the fnOS app centre (this route), systemd, s6 and the like,
where the supervisor starts the process again. A process you started yourself with
`./headscale serve &` has no supervisor, and one press kills it for good; in that case leave
`ALLOW_RESTART=false` and only restart the panel itself.
:::

Full details (native mode's permissions and supervision requirements) are in
[fnOS deployment](/en/install/fnos) and [Native mode](/en/install/native-mode).

### 4.5 Verify

```bash
docker compose up -d
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve'
# expect: Found headscale serve (PID ...)
```

The panel's **Settings → System** shows the integration as **native process**, and saving the
configuration logs `Sent SIGHUP to Headscale`.

## 5. Verifying after the migration

Both directions are accepted the same way:

```bash
cd /vol1/1000/APP/headplaneCN

# 1) The services are up: dual-image has three containers (two without Caddy); native has one container plus a host process
docker compose ps
ps -ef | grep '[h]eadscale serve'

# 2) Headscale is alive
curl -s http://127.0.0.1:8480/health        # expect {"status":"pass"}

# 3) The data really moved: nodes and users are listed
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list

# 4) The panel recognises the configuration (the integration differs by shape)
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve|Using Docker integration'

# 5) The DERP map is readable inside the container, at the path derp.paths points to
docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
```

- **The panel signs you in**: open `https://ha.example.com:8443/admin` and use the same account
  (`cookie_secret` is unchanged, so the session usually survives); **Settings → System** shows
  **Docker** (dual-image) or **native process** (native).
- **Nodes are still online**: on any client machine, `tailscale status` should show it as connected
  straight away — **no** `tailscale up`, and no re-registration.
- **`headscale nodes list`** contains every node you had before the migration (an empty list means
  `db.sqlite` did not land in the right place).
- **`/health`** returns `{"status":"pass"}`.
- **The DERP map is readable**: the card under **Settings → Headscale → DERP** points at the same file as
  `derp.paths`; the decisive client-side evidence is
  `tailscale debug derp-map | grep -A 12 -i <your region_code>`.

## 6. Rollback and troubleshooting

### 6.1 The migration failed: how to get back

**It broke right after migrating (you have not changed any data in the new shape yet)**: the native
directory was never touched, so hand it straight back.

```bash
cd /vol1/1000/APP/headplaneCN
docker compose down
# Put the backed-up compose file back and start the stack
mv docker-compose.yml docker-compose.yml.failed-$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml.bak-native-* docker-compose.yml
docker compose up -d
# Then start headscale in the fnOS app centre (and restore start-on-boot)
```

**You have been running the new shape for a while**: the old directory's data is stale now, so do not
use it — work through section 4 (4.1 → 4.3) to move the **current** data back into the native
directory, then switch the panel integration over.

A failed reverse migration works the same way: the dual-image `headscale/` directory is still there
(4.2 is a copy too), so put the dual-image compose file back, `docker compose up -d`, then stop headscale
in the fnOS app centre and turn its start-on-boot off.

### 6.2 Rolling back a version (independent of the shape)

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
docker compose ps
docker compose exec headscale headscale version
```

- **Rolling back HeadplaneCN**: set `HEADPLANE_VERSION` back to the older version and run
  `docker compose up -d`. Its data lives in its own `data/` and does not depend on the Headscale
  version.
- **Rolling back Headscale**: set `HEADSCALE_VERSION` back and `up -d`; **if the newer version has
  already run database migrations, swapping the image back is not enough** — run `docker compose down`
  first, overwrite `headscale/db.sqlite` with the `db.sqlite` from your backup (delete the `-wal` /
  `-shm` files along with it, then copy), and `up -d` again.
- The official upgrade rule: **one minor version at a time** (0.26 → 0.27 → 0.28 → 0.29), never skip a
  release; from 0.29 on, clients must be ≥ v1.80.0.
- The version numbers pinned in `.env` are how you lock versions: do not give them up just so `latest`
  can upgrade on its own.

### 6.3 Symptom → cause → fix

| Symptom                                                                                                         | Cause                                                                                                                                              | Fix                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The panel container is permanently `unhealthy`, log says `dial tcp 127.0.0.1:4100: connect: connection refused` | The panel's built-in probe always hits `127.0.0.1`, but `server.host` is bound to a specific IP (`192.168.1.10`)                                   | Probe the real address using the node in the image: `fetch('http://192.168.1.10:4100/admin/healthz')`, then `docker compose up -d`                                                                            |
| Saving the configuration fails with `Failed to send SIGHUP to PID ...: Error: kill EACCES`                      | After rolling back to native you missed `security_opt: ["apparmor=unconfined"]` (or `pid: host`)                                                   | Add both as in 4.4 and run `docker compose up -d`                                                                                                                                                             |
| Headscale exits on start or reload: `getting DERPMap: open .../derp-maps/xxx.yaml: no such file or directory`   | The file in `derp.paths` does not exist, or it differs from the path on the panel's DERP card, or that directory is not mounted into the container | Get it running first: comment out the `derp.paths` entry or roll back from **Settings → Snapshots**; then redo it in the order "create the file on the host → confirm the mount → write it into `derp.paths`" |
| "Official region selection" says it cannot read `/vol1/@appdata/headscale/derp-maps/...`                        | The panel's data file still holds the old native path, and the dual-image container does not mount `/vol1/@appdata`                                | Change the path on the card and save; or edit `data/derp-region-mirror.json` and `docker compose restart headplaneCN`                                                                                         |
| Running `sh` in the container fails: `Headplane containers do not contain a shell by default.`                  | The published image has no shell                                                                                                                   | Debug with the node in the image: `docker compose exec headplaneCN /nodejs/bin/node -e "..."`; or temporarily switch to the `:<version>-shell` image variant                                                  |
| After editing the configuration Headscale refuses to start, log says `unknown key` / `cannot unmarshal`         | A key name in the YAML is wrong                                                                                                                    | `docker compose exec headscale headscale configtest` (validation only), then compare character by character against the full configuration in [Dual-image deployment](/en/install/dual-image)                 |
| Clients never come online                                                                                       | See the checklist below                                                                                                                            |                                                                                                                                                                                                               |

If clients never come online, work down this list:

| Check                                   | Command / location                                                         | Conclusion                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Has `server_url` changed?               | `docker compose exec headscale grep server_url /etc/headscale/config.yaml` | It must match the pre-migration value character for character; if it changed, every node has to be registered again                         |
| Did the noise key come across?          | `docker compose exec headscale ls -l ${BASE_DIR}/headscale/`               | If the key was regenerated, every registered node stops working and the key must be restored from the backup                                |
| Did the database come across correctly? | `docker compose exec headscale headscale nodes list`                       | An empty list means `db.sqlite` did not land in the right place or points somewhere else                                                    |
| Is the port held by the native process? | `ss -lntup \| grep 8480`                                                   | headscale in the app centre is still running: stop it and turn start-on-boot off                                                            |
| Domain, certificate and proxy behaviour | from an outside machine, `curl -sI https://ha.example.com:8443/health`     | The certificate must be trusted by clients and the domain must match `server_url`; `/ts2021` must not be buffered or downgraded to HTTP/1.1 |

Other symptoms (saving reports `Unexpected Server Error`, `403 Policy is not writable`, …) are in
[Common issues](/en/configuration/common-issues).

## 7. Command cheat sheet

```bash
# ---- Backups (do this first in either direction) ----
cd /vol1/1000/APP/headplaneCN
sudo tar -czf backup/native-headscale-$(date +%Y%m%d-%H%M%S).tar.gz \
  --exclude=headscale/headscale.log -C /vol1/@appdata headscale
sudo tar -czf backup/headplane-$(date +%Y%m%d-%H%M%S).tar.gz -C . data config.yaml

# ---- Native → dual-image ----
cd /vol1/1000/APP/headplaneCN
mkdir -p data backup headscale/derp-maps caddy/{data,config}
sudo cp -a /vol1/@appdata/headscale/. headscale/
ls -ln headscale | head                  # the owner → HEADSCALE_UID/GID in .env
docker compose config --quiet
docker compose up -d
docker compose ps                        # expect: all three services Up (healthy) (two without Caddy)

# ---- Dual-image → native ----
cd /vol1/1000/APP/headplaneCN
docker compose down
sudo cp -a headscale/. /vol1/@appdata/headscale/
sudo chown -R "$(id -u headscale):$(id -g headscale)" /vol1/@appdata/headscale
# Then rewrite the absolute paths in config.yaml back to /vol1/@appdata/headscale/... and:
# fnOS app centre → headscale → start

# ---- Verification ----
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list
curl -s http://127.0.0.1:8480/health      # expect {"status":"pass"}
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve|Using Docker integration'

# ---- Upgrades and version rollback ----
docker compose stop headscale
tar -czf backup/before-upgrade-$(date +%F-%H%M%S).tar.gz \
  --exclude=backup -C . headscale data config.yaml docker-compose.yml .env
docker compose start headscale
# Edit HEADSCALE_VERSION / HEADPLANE_VERSION in .env, then:
docker compose pull && docker compose up -d
```
