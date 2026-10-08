---
title: "Reverse proxy: Lucky + Caddy (home NAS)"
description: "The recommended route for a home NAS in mainland China: Lucky terminates TLS at the router layer, and the Caddy container on the NAS only splits plain HTTP — /admin goes to the panel, everything else to Headscale."
outline: [2, 3]
---

# Reverse proxy: Lucky + Caddy (home NAS)

This page covers exactly **one route**: DNS points at your home's public IP (or a tunnel), **TLS is
terminated by Lucky on the router / in your LAN**, and a Caddy container inside the NAS **only splits
plain HTTP** — `/admin*` goes to the panel, everything else goes to Headscale. Every command can be
copied as-is, and every step tells you what you should see.

If you have not picked a route yet, read [Domains and access](/en/install/domains) first (the three
path / port / domain layouts, DNS, certificates and ICP filing); for a cloud server, where Caddy
obtains certificates by itself, see [Cloud server Caddy](/en/install/reverse-proxy-caddy). This page
**does not install** Headscale or the panel — how to deploy those is in [fnOS (飞牛)](/en/install/fnos).

## Understand the topology first: why a Caddy must sit in the middle

| Who             | Where                       | What it does                                                                                    |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| **Lucky**       | Router / LAN                | Listens publicly on `8443`, **terminates TLS** (the certificate is here), DDNS                  |
| **Caddy**       | A container on the NAS      | **Plain-HTTP path routing only**: `/admin*` → panel, everything else → Headscale                |
| **Headscale**   | A native process on the NAS | The control service clients connect to, listening on `127.0.0.1:8480`, owning the **root path** |
| **HeadplaneCN** | A container on the NAS      | The web UI people open, listening on `192.168.1.10:4100`, owning `/admin`                       |

How one request travels: browser / client → `https://ha.example.com:8443` → **Lucky** (TLS is
decrypted here) → `http://192.168.1.10:8444` → **Caddy** (looks at the path only) → `/admin*` to the
panel, everything else to Headscale.

**Why must a Caddy sit in the middle?** Because Lucky cannot switch backends: its custom parameters
support only `proxy_set_header` / `proxy_hide_header` / `add_header` / `proxy_redirect` plus
`location` / `path` groups, and there is **no `proxy_pass`**, so one rule can point at only one
backend. Headscale must own the root path (clients only ever request `server_url + /ts2021`, `/key`,
`/derp` …), while the panel needs a place of its own — so "one domain + `/admin` split" can only be
done by the Caddy inside the NAS.

::: warning `server_url` cannot carry a path prefix, and changing it re-registers every machine
Headscale's `server_url` must be a root address: ✅ `https://ha.example.com:8443`; ❌ `https://ha.example.com:8443/headscale`.
In this page's topology the panel is separated by the `/admin` prefix, so the panel's `server.base_url` must be written as
`https://ha.example.com:8443/admin` (with `/admin`, no trailing `/`).
:::

## Values you need to change

| Placeholder             | Example                                                | Meaning                                                                                                             | Where to change                                      |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Domain                  | `ha.example.com`                                       | Clients and the panel share this one domain, **must change**                                                        | DNS, Lucky's frontend domain, Headscale `server_url` |
| Public port             | `8443`                                                 | The non-standard port for public access, **may change** (a home line cannot get an ICP filing, so do not use `443`) | Lucky's listen port, `server_url`, `base_url`        |
| NAS LAN IP              | `192.168.1.10`                                         | The NAS running Headscale and the panel, **must change**                                                            | Caddyfile upstreams, Lucky's backend address         |
| Caddy listen port       | `8444`                                                 | Used only inside the LAN and between containers, **may change** (do not collide with `8443`)                        | `CADDY_PORT` in `.env`                               |
| Caddy image             | `v6.gh-proxy.org/docker/caddy:2-alpine`                | The mirror proxy prefix for pulling images in mainland China, **may change** (another mirror edits only this line)  | `CADDY_IMAGE` in `.env`                              |
| Headscale `server_url`  | `https://ha.example.com:8443`                          | The address clients connect to, **no path prefix allowed**                                                          | Headscale's `config.yaml`                            |
| Panel `server.base_url` | `https://ha.example.com:8443/admin`                    | The panel's own address, **must include `/admin`**                                                                  | The panel's `config.yaml`                            |
| Certificate / key path  | `/etc/ssl/ha/fullchain.pem`, `/etc/ssl/ha/privkey.pem` | **Used by Lucky only**; the Caddy inside the NAS never touches certificates                                         | Lucky's certificate settings                         |

## 1. Check the ports are free first

Look at the ports before installing anything — both real-world accidents on this route came from
skipping that glance: `8443` on the NAS was once held by **another container**; installing Nginx on
the router takes over `80/443` and knocks out OpenWrt's LuCI (`uhttpd`), so the admin page refuses to
open at all.

```bash
ss -lntp                      # or netstat -ltnp
# expect: 8480 (Headscale) and 4100 (the panel) are listed,
#         but 8443 and 8444 are not — any output means the port is taken

ss -lntp | grep -E ':8443|:8444'
# expect: no output (both ports are free)
```

- `8443` is taken → pick another public port and update `server_url` and `base_url` with it (`8443` is only this page's example).
- `8444` is taken → change only `CADDY_PORT` in `.env`; nothing on the Lucky side moves.
- **The router's ports and the NAS's ports are separate things**: Lucky listens on `8443` on the router, Caddy listens on `8444` on the NAS, and they never collide.

## 2. Install Caddy on the NAS

::: tip Rather not run one more container?
Then skip path routing and use **layout B (one domain + two ports)** or **layout C (two domains)** from
[Domains and access](/en/install/domains): two Lucky sub-rules are enough and no Caddy is needed. The
price is that the panel is no longer hidden under `/admin`, and layout C needs a second certificate.
:::

```bash
mkdir -p /vol1/1000/APP/caddy
cd /vol1/1000/APP/caddy
```

**① `.env`** (`/vol1/1000/APP/caddy/.env`) — two values only; changing the mirror or the port edits this one file:

```bash
# A direct connection to registry-1.docker.io usually does not work in mainland China; this line is the mirror proxy prefix
CADDY_IMAGE=v6.gh-proxy.org/docker/caddy:2-alpine   # ← may change (use a proxy prefix that works for you)
CADDY_PORT=8444                                       # ← may change (confirmed free in the previous section)
```

**② `docker-compose.yml`** (`/vol1/1000/APP/caddy/docker-compose.yml`):

```yaml
services:
  caddy:
    image: ${CADDY_IMAGE} # ← may change (comes from .env; another mirror edits only that line)
    container_name: caddy
    restart: unless-stopped

    # host networking: the container shares the NAS's network namespace
    # 8444 is therefore listened on directly on the NAS, and 127.0.0.1 can still
    # reach the natively running Headscale
    # in host mode, do not add a ports section
    network_mode: host

    environment:
      # {$CADDY_PORT:8444} in the Caddyfile reads this — the port has one single source
      - "CADDY_PORT=${CADDY_PORT}"

    volumes:
      - "./Caddyfile:/etc/caddy/Caddyfile:ro" # the routing rules (section 3)
      - "./caddy-data:/data" # Caddy's own runtime data
```

::: warning Do not mount `docker.sock` into Caddy
It does not need it, and mounting it hands out root on the NAS. The Caddy on this page only proxies.
:::

## 3. Caddyfile {#path-routing}

Path: `/vol1/1000/APP/caddy/Caddyfile`. This is the file that **only splits plain HTTP**; copy it as-is:

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
		reverse_proxy 192.168.1.10:4100 {        # ← must change to your NAS's LAN IP (the panel port 4100 usually stays)
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		reverse_proxy 127.0.0.1:8480 {           # ← do not touch (Headscale listens on 8480 on this same NAS)
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
```

These rules do three things: `auto_https off` means **do not let Caddy request a certificate** (that
happens on the Lucky layer); `/admin*` is forwarded to the panel **without rewriting the path**, and
the panel is told "the outside is HTTPS" (otherwise `cookie_secure: true` misbehaves); the catch-all
`handle` passes `/ts2021`, `/key`, `/register`, `/verify`, `/api/v1/*`, `/health` and `/derp` through
to Headscale verbatim, and `flush_interval -1` turns buffering off so long-lived connections are not
cut.

## 4. Start it and check it yourself

```bash
cd /vol1/1000/APP/caddy
docker compose up -d

docker compose ps                     # expect: caddy is running / Up
docker compose logs caddy --tail=30   # expect: serving ... on :8444, no error
ss -lntp | grep 8444                  # expect: *:8444 (both v4 and v6 are listening)
```

Four curls from the NAS itself, compared against the status codes:

```bash
# ① open the root path the way a browser does → the panel
curl -si -H 'Accept: text/html' http://192.168.1.10:8444/ | head -5
#    expect: 302, Location: /admin/

# ② a client (no Accept: text/html) opens the root path → Headscale
curl -si http://192.168.1.10:8444/ | head -5
#    expect: 200 (Headscale's blank page, not 404)

# ③ the panel's liveness check
curl -s http://192.168.1.10:8444/admin/healthz
#    expect: {"status":"OK"}

# ④ the paths clients use must get through
curl -si http://192.168.1.10:8444/derp | head -3
#    expect: 426 (protocol upgrade required) — a 404 means the path was swallowed
```

## 5. Add the rule in Lucky

Lucky's UI differs slightly between versions (it is in Chinese); fill in the **fields** below:

| Field                              | What to enter                             | Why / watch out                                                                                                        |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Frontend domain                    | `ha.example.com`                          | The domain already resolves to your home's public IP (or tunnel endpoint)                                              |
| Listen port + TLS                  | `8443`, **tick TLS**                      | **The certificate lives on this Lucky layer**; `443` is not used because a home line is not eligible for an ICP filing |
| IPv4 / IPv6                        | **tick both**                             | With IPv4 only, pure-IPv6 networks (some mobile carriers) cannot connect                                               |
| Sub-rule type                      | `Reverse proxy`                           | Routing is left to Caddy; this rule only forwards to `8444`                                                            |
| Backend address                    | `http://192.168.1.10:8444`                | **Host:port only** — no path, no trailing `/`, scheme `http`                                                           |
| Match / path                       | empty or `/*`                             | Empty catches everything; do not allow-list only `/api` and `/ts2021`                                                  |
| Path rewrite / URL replace         | **all off**                               | Once rewritten, `/admin`, `/ts2021` and `/derp` get changed or stripped                                                |
| Preserve original Host             | **on** (keep the domain the browser sent) | The panel's CSRF / cross-site checks depend on it                                                                      |
| Custom parameters (Host rewritten) | `proxy_set_header Host $http_host;`       | Only needed when Lucky rewrites `Host` to an internal IP and the panel answers 403                                     |
| Allow Upgrade                      | **on**                                    | Browser SSH's WebSocket and the `/derp` long connection both need it                                                   |
| Disable response buffering         | **on (buffering off)**                    | Buffering cuts long connections, so DERP works only intermittently                                                     |
| Timeout                            | **≥ 300 seconds**                         | Clients and DERP are long-lived; too short a timeout disconnects them over and over                                    |

::: warning You must press "restart rules" after editing
Lucky does **not** apply field changes by itself: press **"restart rules"** once. A new certificate, a
new rule, a new backend — none of it shows up until that rule is restarted. This is the most common
reason for "I changed it correctly and it still behaves the old way".
:::

## 6. Acceptance checklist

Do these in order; each one says what you should see:

```bash
# 1) on the NAS itself, both stacks answer
curl -s http://[::1]:8444/health
#    expect: 200, {"status":"pass"}

# 2) the public layer answers (substitute your domain and port)
curl -si https://ha.example.com:8443/health
#    expect: 200, {"status":"pass"}; a certificate warning means the certificate is not in effect
curl -si https://ha.example.com:8443/ | head -5
#    expect: 200 (Headscale's blank page, not 404)

# 3) the paths clients use must not be 404
curl -si -X POST https://ha.example.com:8443/ts2021 | head -3
#    expect: not 404 (any 4xx/5xx from a wrong protocol is fine; only 404 means the path was not forwarded)
curl -si https://ha.example.com:8443/derp | head -3
#    expect: 426 (protocol upgrade required), not 404

# 4) the panel sits where it should
curl -si https://ha.example.com:8443/admin | head -3     # expect: 302, Location: /admin/
curl -s  https://ha.example.com:8443/admin/healthz       # expect: {"status":"OK"}
```

Opening `https://ha.example.com:8443` in a browser should land on `/admin/` automatically, and an API
key should log you in; change a setting and save it — you should not see `Unexpected Server Error`.
Finally, on any machine with Tailscale installed, confirm a machine can register:

```bash
tailscale up --login-server https://ha.example.com:8443
# expect: a login link appears, and opening it in the browser confirms this machine
```

## 7. Troubleshooting

### 1. The domain opens Headscale, not the panel

Lucky's backend **points straight at Headscale's `8480`** (or `/admin` is in that branch too). The
backend must be **Caddy's `http://192.168.1.10:8444`**, the match must be empty or `/*`, and the Caddy
container must be running.

### 2. 502 Bad Gateway

Lucky cannot find the backend. Check three things in order: whether Caddy is running in
`docker compose ps`, whether the port is listening in `ss -lntp | grep 8444`, and whether the backend
address was mistyped as `https://` or given an extra `/`. When `8444` is held by another container,
Caddy fails to start and its log says `bind: address already in use`.

### 3. The panel opens, but logging in returns 403 / saving reports `Unexpected Server Error`

Lucky rewrote `Host` to an internal IP and the panel's CSRF / cross-site checks reject it: turn on
**preserve original Host**, or add `proxy_set_header Host $http_host;` under **custom parameters**;
then check that `server.base_url` matches the browser address **character for character** (scheme +
domain + port + `/admin`).

### 4. `/ts2021` and `/derp` return 404

The path was swallowed: the match allow-lists only `/api` and `/ts2021`, or "path rewrite / URL
replace" is on, or the backend address has an extra `/`. Set the match to empty or `/*`, turn all path
rewriting off, write the backend as `http://192.168.1.10:8444` only, and press **"restart rules"**
afterwards.

### 5. The certificate is still the old one / the new rule seems ignored

Lucky's rules **must be restarted** after editing; after swapping certificate files, also confirm the
rule points at the new one. When the browser cache is stubborn, verify once more in a private window.

### 6. IPv6 does not connect

Rule these out in order: the rule **has only IPv4 ticked** (tick IPv6 as well, so `ss -lntp` shows the
dual-stack `*:8444`); the domain has no AAAA record; the router's firewall does not allow inbound
`8443` (IPv6 has **no NAT and no port forwarding**, so it must be allowed inbound on its own); the NAS
has no global IPv6 address at all (check with `ip -6 addr show scope global`, and ask your carrier to
enable it if there is none).

## 8. Command cheat sheet

| Goal                    | Command                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| Are the ports taken?    | `ss -lntp \| grep -E ':8443\|:8444'`                                        |
| Start / rebuild Caddy   | `cd /vol1/1000/APP/caddy && docker compose up -d`                           |
| Status / logs           | `docker compose ps` / `docker compose logs caddy --tail=30`                 |
| Apply a Caddyfile edit  | `docker compose restart caddy`                                              |
| Test routing on the NAS | `curl -si http://192.168.1.10:8444/derp \| head -3` (expect `426`)          |
| Panel liveness          | `curl -s http://192.168.1.10:8444/admin/healthz` (expect `{"status":"OK"}`) |
| Dual stack (IPv6)       | `curl -s http://[::1]:8444/health`                                          |
| The whole public chain  | `curl -si https://ha.example.com:8443/health`                               |

## Next

- Choosing between the three access layouts, plus DNS / certificates / ICP filing: [Domains and access](/en/install/domains)
- Letting Caddy obtain certificates by itself on a cloud server: [Cloud server Caddy](/en/install/reverse-proxy-caddy)
- How to install Headscale and the panel themselves: [fnOS (飞牛)](/en/install/fnos)
