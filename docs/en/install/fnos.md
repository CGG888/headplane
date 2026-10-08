---
title: fnOS (飞牛) · Native mode
description: Run headscale as a native fnOS app and HeadplaneCN in Docker on 飞牛 fnOS, with two ready-to-use configuration files and a self-check list.
outline: [2, 3]
---

# fnOS (飞牛) · Native mode install

This page covers **installation and self-check only**: **headscale** runs **natively** from the fnOS
third-party app source (a host process, data in `/vol1/@appdata/headscale`), **HeadplaneCN** runs in
**Docker** (host network, port `4100`), and a reverse proxy publishes both. Relays →
[DERP configuration](/en/configuration/derp); domains and certificates → [Domains](/en/install/domains);
filling in the proxy and opening STUN → [Lucky reverse proxy](/en/install/reverse-proxy-lucky); another
deployment shape → [Migration](/en/install/migration); UI pages → [Feature overview](/en/features/overview);
headscale in Docker too → [Dual-image deployment](/en/install/dual-image).

::: warning Add the third-party app source before installing headscale
The fnOS **official app center does not offer headscale**: open "App Center → Settings → Third-party market
→ Add source", add [github.com/conversun/fnos-store](https://github.com/conversun/fnos-store), refresh, then
install `headscale` (its dependencies come along). Version **0.29.2 or newer** recommended (browser SSH has a
WebSocket regression in 0.29.0 beta – 0.29.1). Use the panel image `ghcr.io/cgg888/headplanecn:0.22.23`; add a
mirror prefix if pulls fail in mainland China.
:::

## Values you need to change

| Placeholder            | Example                             | Notes                                                                               | Where to change it                                              |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Headscale domain       | `ha.example.com`                    | **Must change**: your own domain, used by every `server_url` / `base_url` below     | headscale `server_url`; panel `base_url`, `public_url`          |
| Public port            | `8443`                              | **May change**: the reverse proxy's listening port, must match in all three places  | `server_url`, `public_url`, proxy rule                          |
| NAS LAN IP             | `192.168.1.10`                      | **Must change**: the proxy resolves back to this address; `127.0.0.1` will not work | compose `HEADPLANE_SERVER__HOST`, the proxy's "backend address" |
| API key                | `hskey-api-...`                     | **Must change**: created in section 2, shown once                                   | panel `headscale.api_key`                                       |
| cookie secret          | output of `openssl rand -base64 24` | **Must change**: exactly 32 characters, hand-typing always fails                    | panel `server.cookie_secret`                                    |
| Panel directory        | `/vol1/1000/APP/headplaneCN`        | **May change**: every panel path on this page follows it                            | commands from section 4 on, compose mounts                      |
| Panel port             | `4100`                              | **May change** (default 4100)                                                       | compose `HEADPLANE_SERVER__PORT`                                |
| Headscale control port | `127.0.0.1:8480`                    | **Do not change**: the panel reaches headscale here                                 | headscale `listen_addr`, panel `headscale.url`                  |

## Get the three paths straight first

| Path                          | Role                        | What lives there                                                                                           |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | **Program directory**       | `headscale` (binary / CLI), start script, **seed template** `config/config.yaml`                           |
| `/vol1/@appdata/headscale/`   | **Config + data directory** | the `config.yaml` that **actually takes effect**, `db.sqlite`, `noise_private.key`, `headscale.sock`, logs |
| `/vol1/1000/APP/headplaneCN/` | **HeadplaneCN directory**   | `docker-compose.yml`, the panel's own `config.yaml`, `data/`                                               |

The fnOS start script copies the seed template into `@appdata` **only on first start**, and reads that copy
forever after:

- ✅ Change configuration → edit `/vol1/@appdata/headscale/config.yaml`, then **restart headscale in App Center**
- ❌ Editing `@appcenter/headscale/config/config.yaml` has no effect (an upgrade overwrites it anyway)
- ⚠️ The binary lives in `@appcenter` while data lives in `@appdata`, so running `./headscale` from `@appdata` fails with `No such file or directory`

Check the process (the expected tail is `./headscale serve --config /vol1/@appdata/headscale/config.yaml`):

```bash
ps -ef | grep '[h]eadscale serve'
```

## 1. Confirm Headscale is running

```bash
curl -s http://127.0.0.1:8480/health      # expect {"status":"pass"}
ss -lntp | grep -E '8480|8481|50443'      # 8480 control port; 8481 metrics and 50443 gRPC stay local
```

Scan the ports before you install (`ss -lntp`, or `netstat -ltnp`): in one real incident `8443` on the NAS
was already taken by another container, which scrambled both the proxy port plan and `server_url`.

## 2. Create an API key

```bash
cd /vol1/@appcenter/headscale
./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 90d
# prints something like hskey-api-xxxxxxxx..., shown once — write it down immediately
```

Run this as root if you get a permission error (the fnOS app directory belongs to root). This key goes into
the panel's `headscale.api_key` and is a **server-side** credential (agent sync, OIDC sessions, proxy auth);
it is not the key you type into the login box. Leaked key: find its prefix with `apikeys list` → revoke it
with `apikeys expire --prefix <prefix>`.

## 3. Headscale settings you must change (only the essentials)

Edit **the copy that takes effect**: `/vol1/@appdata/headscale/config.yaml`

```yaml
server_url: https://ha.example.com:8443 # ← must change (what clients connect to; no path prefix)
listen_addr: 0.0.0.0:8480 # ← leave as is (the panel reaches it at 127.0.0.1:8480)
policy:
  mode: database # ← must change (web-based ACL editing needs database)
  path: "" # ← leave as is
dns:
  magic_dns: true
  base_domain: headscale.internal # ← may change
  extra_records_path: /vol1/@appdata/headscale/extra-records.json # ← may change (recommended, see below)
unix_socket: /vol1/@appdata/headscale/headscale.sock # ← leave as is
```

Restart afterwards: **stop headscale, then start it again in the fnOS App Center**. If you enabled
`extra_records_path`, create that file first (`printf '[]\n' > /vol1/@appdata/headscale/extra-records.json`),
otherwise headscale fails to start.

::: warning Two traps: `server_url` and `policy.mode`

- `server_url` **must not carry a path prefix**, and it decides the client login address — **changing it
  makes already registered nodes register again**.
- `policy.mode` defaults to `file`, which keeps the policy API read-only → saving ACLs fails with
  `403 Policy is not writable`; switch to `database` to edit ACLs in the browser, which does not affect
  existing connectivity.
  :::

To use relays (embedded DERP server, local `derp.paths` map, official region filtering) add a `derp:`
section here — the full syntax, UDP/STUN and the `derp.paths` requirements are in
[DERP configuration](/en/configuration/derp).

## 4. Prepare the directory

```bash
mkdir -p /vol1/1000/APP/headplaneCN/data
cd /vol1/1000/APP/headplaneCN
openssl rand -base64 24        # generates cookie_secret — write it down (exactly 32 characters)
```

## 5. Setting file ①: `config.yaml`

Path: `/vol1/1000/APP/headplaneCN/config.yaml`

```yaml
server:
  host: "192.168.1.10" # ← must change (NAS LAN IP; not 0.0.0.0 — the proxy resolves back to it)
  port: 3000 # ← leave as is (compose overrides it to 4100)
  base_url: "https://ha.example.com:8443" # ← must change (browser address, no /admin)
  cookie_secret: "paste the command output" # ← must change (exactly 32 characters, or the container exits)
  cookie_secure: true # ← must change (true behind HTTPS; false for plain HTTP)
  data_path: "/var/lib/headplane" # ← leave as is (compose persists it to ./data)
headscale:
  url: "http://127.0.0.1:8480" # ← leave as is (under host networking 127.0.0.1 is the host)
  public_url: "https://ha.example.com:8443" # ← must change (display and browser SSH; falls back to url)
  api_key: "hskey-api-..." # ← must change (the full key from section 2, not the listed prefix)
  config_path: "/etc/headscale/config.yaml" # ← leave as is (must match the compose mount point)
  # dns_records_path: "/etc/headscale/extra-records.json"   # ← may change (headscale needs extra_records_path first)
integration:
  proc: { enabled: true } # ← leave as is (headscale is a host process; SIGHUP reloads it)
  agent: { enabled: true } # ← leave as is (version / OS / relay columns come from it)
# Optional: SSO (required for browser SSH) → /en/features/sso; proxy auth (only if the proxy authenticates) → /en/features/proxy-auth
# oidc: { issuer: "https://your-idp/realms/xxx", client_id: "headplane", client_secret: "******" }
# proxy_auth: { enabled: true, user_header: "Remote-User", trusted_proxy_cidrs: ["127.0.0.1/32"] }
```

::: tip Want the full-field template?
The repository root ships [`config.example.yaml`](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)
(the file `pnpm run dev:app` uses; every key is commented, including OIDC, Kubernetes and `proxy_auth`).
The snippet above is only the minimum needed to boot — any key you leave out falls back to its default.
:::

::: danger `cookie_secret` must be exactly 32 characters
The length check is hard-coded to 32; anything shorter or longer makes the container exit with
`The configuration is missing required fields or has invalid values`. `openssl rand -base64 24` produces
exactly 32 characters — do not hand-write or truncate it.
:::

::: warning Setting only `dns_records_path` makes the panel exit
`headscale.dns_records_path` is only allowed when Headscale's own config has `dns.extra_records_path`;
setting just the former prints `Using separate DNS config file but dns.extra_records_path is not set in
Headscale config` and exits immediately. Set both or neither.
:::

## 6. Setting file ②: `docker-compose.yml`

Path: `/vol1/1000/APP/headplaneCN/docker-compose.yml`

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:0.22.23 # ← may change (add a mirror prefix; use :<version>-shell to debug)
    container_name: headplane
    restart: unless-stopped
    network_mode: host # ← leave as is (no ports / extra_hosts with host networking)
    pid: host # ← leave as is (integration.proc reads /proc to find headscale serve)
    security_opt: ["apparmor=unconfined"] # ← leave as is (otherwise signalling fails with kill EACCES)
    volumes:
      - "/vol1/1000/APP/headplaneCN/config.yaml:/etc/headplane/config.yaml:ro" # ← may change: panel config, read-only
      - "/vol1/1000/APP/headplaneCN/data:/var/lib/headplane" # ← may change: sessions, DB, agent state
      - "/vol1/@appdata/headscale/config.yaml:/etc/headscale/config.yaml" # ← must change: read-write, never :ro
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale:ro" # ← must change: read-only, same path inside
    environment:
      - "TZ=Asia/Shanghai" # ← may change
      - "HEADPLANE_SERVER__HOST=192.168.1.10" # ← must change (NAS LAN IP)
      - "HEADPLANE_SERVER__PORT=4100" # ← may change (default 4100)
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml" # ← leave as is
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true" # ← leave as is
      - "HEADPLANE_INTEGRATION__AGENT__ENABLED=true" # ← leave as is
    # The image's own /bin/hp_healthcheck always probes 127.0.0.1, which is refused as soon as the panel
    # binds a specific IP (the container then stays unhealthy forever); probe the real address instead
    # (/admin/healthz needs no auth and returns {"status":"OK"}) — keep this line in sync with IP / port.
    healthcheck:
      {
        test:
          [
            "CMD",
            "/nodejs/bin/node",
            "-e",
            "fetch('http://192.168.1.10:4100/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ],
        interval: 30s,
        timeout: 5s,
        retries: 3,
      }
    logging: { driver: "json-file", options: { max-size: "10m", max-file: "3" } }
```

This shape does not mount `/var/run/docker.sock` (headscale is a host process; the panel never restarts
containers). `HEADPLANE_*` variables override `config.yaml`; array-valued options (such as
`allowed_action_origins`) **cannot** be set from the environment and belong in `config.yaml`.

::: warning The official image has no shell
`docker compose exec headplane sh` fails: the image is distroless and `/bin/sh` is a stub (exit code 127)
that prints `Headplane containers do not contain a shell by default.` To debug inside the container, switch
`image:` to `ghcr.io/cgg888/headplanecn:0.22.23-shell` for a moment; host-side `ls`, `ss` and `curl` need no
container access at all.
:::

## 7. Start and self-check

```bash
cd /vol1/1000/APP/headplaneCN
docker compose up -d
docker compose ps                                     # container and health status
docker compose logs headplane | grep -i 'Headscale configuration'
#    expect: Found a valid Headscale configuration file at /etc/headscale/config.yaml
docker compose logs headplane | grep -i 'Found headscale serve'   # expect: Found headscale serve (PID ...)
docker compose logs headplane | grep -iE 'Agent|Tailnet'
#    expect: Connecting to Tailnet at http://127.0.0.1:8480 as headplane-agent
curl -I http://192.168.1.10:4100/admin                # the local panel answers
```

Open `http://192.168.1.10:4100/admin` in a browser and log in with the API key from section 2. The navigation
bar should then show **Machines / Users / Access Control / DNS / Settings** — that is this page's whole goal;
for what each page offers see [Feature overview](/en/features/overview).

## 8. Troubleshooting (symptom → cause → fix)

### 1. `Unexpected Server Error` when saving or switching

**Cause**: the reverse proxy rewrote the `Host` header, so the cross-site check rejects the form submission.
**Fix**: make the proxy **keep the original Host**, and confirm `server.base_url` is exactly the browser address (no `/admin`); upgrade to **0.8.4+** if needed. See [Lucky reverse proxy](/en/install/reverse-proxy-lucky).

### 2. Form saves fail / clicking "Log out" errors

**Cause**: form failures mean the proxy stripped the `Content-Type` of `POST` requests; the log-out error is an old-version bug.
**Fix**: upgrade to **0.8.3+** (forms) and **0.8.2+** (log-out); do not rewrite request headers in the proxy.

### 3. No DNS / Settings in the navigation bar at all

**Cause**: the panel cannot read Headscale's configuration file (`config_path` missing, or the mount is `:ro`).
**Fix**: set `headscale.config_path` as in sections 5 and 6 and mount it **read-write**; locate problems with `docker compose logs headplane | grep -i 'Headscale configuration'` and check `ls -l /vol1/@appdata/headscale/config.yaml` on the host.

### 4. Saving ACLs fails with `403 Policy is not writable`

**Cause**: Headscale still uses `policy.mode: file`, so its policy API is read-only.
**Fix**: switch to `database` and restart the headscale app in fnOS (section 3).

### 5. The container cannot reach headscale

**Cause**: the panel is not on host networking, or headscale listens only on `127.0.0.1`.
**Fix**: keep `network_mode: host` + `headscale.url: http://127.0.0.1:8480`; only with bridge networking do you need `extra_hosts: ["host.docker.internal:host-gateway"]`, and then `listen_addr` must not bind to localhost only.

### 6. Logged out right after logging in

**Cause**: `cookie_secure` does not match the protocol you actually browse with, or `base_url` does not match the browser address.
**Fix**: HTTPS behind the proxy → `cookie_secure: true`; plain HTTP → `false`; the protocol, domain and port in `base_url` must match exactly.

### 7. The container will not start and logs say the configuration is invalid

**Cause**: most often `cookie_secret` is not exactly 32 characters, followed by malformed URLs.
**Fix**: regenerate it with `openssl rand -base64 24` — never hand-write or truncate; URLs must be complete and include a scheme.

### 8. Configuration check says "unable to verify", or a data directory looks read-only

**Cause**: mounting the data directory `:ro` as in section 6 is **intentional** — the panel's permissions are not Headscale's permissions.
**Fix**: leave it as it is; that is expected, not a fault. Only act if Headscale itself reports write failures.

### 9. The agent page reports a rejected API key (401)

**Cause**: the agent uses `headscale.api_key` **from the configuration file**, not the key you logged in with.
**Fix**: create a fresh full key, put it in `config.yaml`, then restart the container; pasting only the prefix shown in the list also yields 401.

### 10. The browser SSH button errors out

**Cause**: the agent is disabled, you are not signed in with OIDC, or the OIDC user is not linked to a Headscale user (the message says which).
**Fix**: enable `integration.agent.enabled`, sign in with OIDC, and link the account on the user page; details in [Browser SSH](/en/features/ssh).

### 11. Relay (DERP) related problems

Nobody uses the embedded relay region, `derp.paths` reports "cannot see that path / cannot write to it", headscale fails to start with `getting DERPMap: open … no such file or directory`, or the relay cannot resolve an IPv6 address — all of these are written up in the same "symptom → cause → fix" format in [DERP configuration](/en/configuration/derp).

## 9. Acceptance checklist

```bash
cd /vol1/1000/APP/headplaneCN
docker compose ps                                          # container Up (healthy)
curl -sI http://192.168.1.10:4100/admin | head -n 1         # the panel answers
curl -s http://127.0.0.1:8480/health                        # {"status":"pass"}
```

Tick these off in the browser:

- [ ] After logging in, the navigation bar has **Machines / Users / Access Control / DNS / Settings**
- [ ] `/settings/system` shows the Headscale version and the **configuration check** returns output ("unable to verify" due to the read-only mount is fine)
- [ ] `/settings/headscale` saves and takes effect (e.g. switch `policy.mode`, then hit reload)
- [ ] Adding a DNS record on the DNS page succeeds; `cat /vol1/@appdata/headscale/extra-records.json` shows it
- [ ] `/settings/agent` shows a "last sync" time and a node count; `/settings/api-keys`, `/settings/audit` and `/settings/snapshots` all open

## 10. Command reference

```bash
# ---- headscale (native process on the host) ----
cd /vol1/@appcenter/headscale
CFG=/vol1/@appdata/headscale/config.yaml
./headscale --config $CFG nodes list
./headscale --config $CFG apikeys create --expiration 90d
./headscale --config $CFG apikeys expire --prefix <prefix>
# ---- HeadplaneCN (container) and on-site checks ----
cd /vol1/1000/APP/headplaneCN
docker compose ps && docker compose logs -f headplane
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health
```

## 11. Upgrading, backing up and uninstalling

```bash
# ---- Upgrade HeadplaneCN (the panel container) ----
cd /vol1/1000/APP/headplaneCN
cp docker-compose.yml docker-compose.yml.bak-$(date +%F)
# after editing HEADPLANE_VERSION in .env:
docker compose pull && docker compose up -d
docker compose logs --tail=30 headplane    # expect: Found a valid Headscale configuration

# ---- Upgrade headscale (managed by the fnOS app centre, not by Docker) ----
# fnOS app centre → headscale → stop → update → start
# Back up first (see below). Headscale requires upgrading one minor version at a time
# (0.26 → 0.27 → 0.28 → 0.29).

# ---- Backup: four things, and losing any one of them can be fatal ----
tar -czf /vol1/1000/APP/headplaneCN-backup-$(date +%F).tar.gz \
  -C /vol1/1000/APP headplane \
  -C /vol1/@appdata headscale
```

- **What matters most**: `db.sqlite`, `noise_private.key` and `derp_server_private_key` under `/vol1/@appdata/headscale/`, plus HeadplaneCN's `data/` and `config.yaml` (`cookie_secret` lives there). For a perfectly consistent database copy, **stop headscale in the app centre before packing**.
- **A configuration snapshot is not a database backup**: `/settings/snapshots` only stores Headscale's configuration file (and the policy file in file mode); `db.sqlite` must be backed up separately.
- **Uninstalling**: the panel is just a container, so `docker compose down` stops it; Headscale belongs to the fnOS app centre — stop or uninstall it there. **Back up first**: delete `db.sqlite` or the noise key and every registered node has to register again.
- **Version rollback**: before rolling Headscale back, `down` the stack and overwrite `headscale/db.sqlite` from the backup (delete `-wal` / `-shm` alongside it). Database migrations are one-way, so swapping the image alone is not enough.

::: tip Want Headscale under Docker too?
One place for upgrades, restarts and logs → [Mode migration and rollback](/en/install/migration).
:::
