---
title: "Reverse Proxy: Caddy (Cloud Server)"
description: "The cloud-server route: Caddy listens on 443, obtains and renews certificates automatically, and splits by path — /admin to the panel, everything else to Headscale. No Lucky needed."
outline: [2, 3]
---

# Reverse Proxy: Caddy (Cloud Server)

This page covers exactly **one route**: on a cloud server with a public IP, **Caddy listens on `80`/`443`,
obtains and renews the certificate by itself**, and splits by path — `/admin*` to the panel, everything else to
Headscale. **No Lucky**: TLS termination and path splitting happen on the same machine.

The only difference from the [home NAS route](/en/install/reverse-proxy-lucky) is the environment. Home
broadband usually cannot open `80`/`443` and cannot be filed, so there Lucky terminates TLS at the router and
Caddy in the NAS only does **plaintext HTTP splitting**; a cloud server has a public IP, can open `80`/`443` and
can be filed — **one layer is enough**. Read [Domains and access](/en/install/domains) first if you have not
chosen a layout, still need DNS records, or want to know where the certificate lives. This page does **not**
install Headscale or the panel: see [Docker](/en/install/docker) and [dual-image](/en/install/dual-image).

## Values you need to change

| Placeholder            | Example                        | Meaning                                                                | Where to change                                  |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------ |
| Domain                 | `ha.example.com`               | The domain clients connect to, **must change**                         | DNS, Caddyfile site name, Headscale `server_url` |
| Cloud server public IP | `203.0.113.10`                 | The domain must point at it, **must change**                           | DNS, the cloud console's security group          |
| Deployment directory   | `/opt/headplane`               | Where `docker-compose.yml` and `Caddyfile` live, **use your own path** | Shell commands, volume paths                     |
| Panel upstream         | `127.0.0.1:4100`               | The panel on the same machine, **change only if you moved the port**   | `handle /admin*` in the Caddyfile                |
| Headscale upstream     | `127.0.0.1:8480`               | Headscale owns the **root path**, **leave alone**                      | The catch-all `handle` in the Caddyfile          |
| Panel public address   | `https://ha.example.com/admin` | The panel's own address, **must include `/admin`**                     | Panel `server.base_url`                          |
| `server_url`           | `https://ha.example.com`       | The address clients use, **no path prefix allowed**                    | Headscale `config.yaml`                          |
| `server.cookie_secure` | `true`                         | **Keep `true`** whenever the outside world is HTTPS                    | Panel `config.yaml`                              |
| `server.cookie_secret` | `openssl rand -base64 24`      | Replacing it logs everyone out                                         | Panel `config.yaml`                              |
| `headscale.public_url` | `https://ha.example.com`       | Must match `server_url` **character for character**                    | Panel `config.yaml`                              |

## 1. ICP filing first (mainland China servers) {#icp-filing}

On a **mainland Chinese** server the domain must have a completed **ICP filing** before it may serve traffic on
`80`/`443`. Without one, public requests are blocked **somewhere in the middle**: a **connection timeout**, or a
page from the ISP / cloud provider instead of yours — never an error from Caddy. Rule out the filing before you
debug Caddy.

A filing needs a **real-name verified domain** (whitelisted suffix, usually at a domestic registrar) and a
**mainland Chinese server** to attach to; provinces differ, but it **usually takes 1–20 working days**.

**Servers outside mainland China (including Hong Kong, Macao and Taiwan) need no filing** and can use `80`/`443`
with automatic certificates right away — simplest, at the cost of higher latency from mainland China. **Home
broadband cannot be filed at all**, so the home route uses **a non-standard port with your own certificate** —
see the [home NAS route](/en/install/reverse-proxy-lucky).

An unfiled mainland server can **temporarily** use a non-standard port (say `8443`) and usually still answers,
but that is a stopgap that dodges the `80`/`443` block and may stop working at any provider policy change.
**Finish the filing anyway** — this page offers **no** way to bypass it.

## 2. DNS and firewall

Point the domain at this server first: Caddy checks DNS while requesting a certificate, so **DNS must be live
beforehand**.

| Type   | Host | Value          | Meaning                                                               |
| ------ | ---- | -------------- | --------------------------------------------------------------------- |
| `A`    | `ha` | `203.0.113.10` | The cloud server's public IPv4 address, **must change**               |
| `AAAA` | `ha` | `2001:db8::1`  | Optional: only with a public IPv6 address, otherwise **leave it out** |

Two layers must **both** allow traffic — the cloud console's **security group / firewall** and `ufw` /
`firewalld` inside the server; forgetting one is the most common reason no certificate is ever issued.

| Port   | Protocol | Public?         | Purpose                                                       |
| ------ | -------- | --------------- | ------------------------------------------------------------- |
| `80`   | TCP      | **Required**    | ACME HTTP-01 validation plus the HTTP → HTTPS redirect        |
| `443`  | TCP      | **Required**    | Public HTTPS (the panel and Headscale both enter here)        |
| `443`  | UDP      | Optional        | HTTP/3; leaving it closed costs speed, not availability       |
| `3478` | UDP      | **Required**    | The client's `netcheck` STUN; without it it stays unavailable |
| `8480` | TCP      | **Do not open** | Headscale itself, reached by Caddy over the loopback only     |
| `4100` | TCP      | **Do not open** | The panel itself, reached by Caddy over the loopback only     |

With `ufw` as an example (adjust to your distribution):

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw status
```

Keep `8480` and `4100` **out** of the security group: Caddy reaches both over `127.0.0.1` on the **same
machine**, so publishing them only adds an entry point.

## 3. Directories and compose

One directory is all you need; every command below assumes you are in it:

```text
/opt/headplane/
├── docker-compose.yml     # panel + Headscale + Caddy (the first two: see /install/dual-image)
├── config.yaml            # panel config (see /install/docker)
├── Caddyfile              # the core of this page, next section
└── caddy-data/            # ← never delete: certificates and the ACME account live here
```

The panel and Headscale containers — images, environment, health checks — are in
[dual-image](/en/install/dual-image); this page shows only the **Caddy service**:

```yaml
services:
  caddy:
    image: caddy:2-alpine # ← may change: use a mirror prefix if the pull is blocked
    container_name: caddy
    restart: unless-stopped
    network_mode: host # ← leave alone: with host networking 127.0.0.1 is the host itself
    volumes:
      - "./Caddyfile:/etc/caddy/Caddyfile:ro"
      - "./caddy-data:/data" # ← leave alone: certificates and the ACME account live here
```

**Host networking** is why the Caddyfile can use `127.0.0.1:4100` / `127.0.0.1:8480` and why there is **no
`ports:` entry**: Caddy binds the host's `80`/`443` directly. On a bridge network instead, the upstreams must use
the host's address on that bridge (`host.docker.internal` needs
`extra_hosts: ["host.docker.internal:host-gateway"]`). Do **not** run Nginx or Apache on `80`/`443`, or Caddy
fails with `bind: address already in use`.

## 4. The Caddyfile

Keep `Caddyfile` next to `docker-compose.yml` and copy this as-is:

```caddyfile
ha.example.com {
	# a browser hitting the root path goes to the panel; clients never GET /
	@browserRoot {
		path /
		header Accept *text/html*
	}
	redir @browserRoot /admin/ 302

	handle /admin* {
		# hand it to the panel untouched: the panel already lives under /admin, do not rewrite the path
		reverse_proxy 127.0.0.1:4100 {
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		# everything else goes to Headscale: /ts2021, /key, /register, /verify, /api/v1/*, /health, /derp
		reverse_proxy 127.0.0.1:8480 {
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
```

What matters here:

- **Automatic HTTPS**: the site name _is_ the domain, so Caddy **obtains the certificate by itself** — no `tls`
  directive. It proves ownership over **HTTP-01** (port `80`) or **TLS-ALPN-01** (port `443`) and renews before
  expiry. Certificate and ACME account live in `/data`, i.e. `caddy-data/`: keep `80` reachable and never delete
  that directory, or issuance starts over. Add a global `{ email you@example.com }` block above the site if you
  want expiry warnings by email.
- **Path splitting**: `/admin*` is more specific than the catch-all `handle`, so the panel wins those paths and
  `/ts2021`, `/key`, `/register`, `/verify`, `/api/v1/*`, `/health`, `/derp` fall through to Headscale.
- **`flush_interval -1`** disables response buffering and flushes immediately, so long-lived connections and log
  streams are not stalled.
- **`header_up X-Forwarded-Proto https`** tells the upstream the outside world is HTTPS; without it the panel
  misbehaves under `cookie_secure: true` (login redirects, callback URLs).
- **Leave `Host` alone**: Caddy passes the client's `Host` through **unchanged** by default (unlike Nginx), and
  the panel's CSRF check relies on it — do **not** add `header_up Host ...`.
- The root-path `302` is for humans only: the `tailscale` client never does `GET /`.

## 5. The two sides must agree

Panel, Headscale and Caddy must line up, or you get "login returns 403", "the registration link points at
`localhost`" or "clients cannot connect":

| Where                   | Key                    | Value                          | Meaning                                                         |
| ----------------------- | ---------------------- | ------------------------------ | --------------------------------------------------------------- |
| Headscale `config.yaml` | `server_url`           | `https://ha.example.com`       | The address clients use, **no path prefix allowed**             |
| Panel `config.yaml`     | `server.base_url`      | `https://ha.example.com/admin` | The panel's own address, **must include `/admin`**              |
| Panel `config.yaml`     | `server.cookie_secure` | `true`                         | Must be `true` whenever the outside world is HTTPS              |
| Panel `config.yaml`     | `headscale.public_url` | `https://ha.example.com`       | Must match Headscale's `server_url` **character for character** |
| Panel `config.yaml`     | `headscale.url`        | `http://127.0.0.1:8480`        | The API address inside the machine: no public network, no HTTPS |

Headscale calls it `server_url`, the panel's matching field is `headscale.public_url`: **the two must be
identical** (scheme + domain + port, neither with a path), because registration links are built from them. In a
container, `headscale.url` follows the network: `http://127.0.0.1:8480` on host networking, or the container name
(`http://headscale:8080`) on a bridge.

::: warning Changing `server_url` forces every registered node to register again
`server_url` is written into each **client's local state**, so once the domain, scheme or port changes, machines
that already ran `tailscale up` keep retrying the old address and fail — run `tailscale logout`, then
`tailscale up --login-server https://ha.example.com`, or delete the node in the panel and register it again.
:::

## 6. Start and self-check

```bash
cd /opt/headplane
docker compose up -d                 # starts Headscale, the panel and Caddy
docker compose ps                    # expect: all three containers running / healthy
docker compose logs caddy --tail=50  # expect: certificate obtained / serving, no error
```

Then confirm three things, bottom-up:

```bash
# 1) does DNS already point at this server? (expect 203.0.113.10)
dig +short ha.example.com            # no dig? use getent hosts ha.example.com
# 2) bypass Caddy and check both backends are alive
curl -s http://127.0.0.1:8480/health         # expect {"status":"pass"}
curl -s http://127.0.0.1:4100/admin/healthz  # expect {"status":"OK"}
# 3) finally through the public domain (the certificate is Caddy's)
curl -sI  https://ha.example.com/health      # expect HTTP/2 200 and no certificate warning
curl -si  https://ha.example.com/admin | head -3   # expect 302 → /admin/
```

If step 3 works, the whole chain — DNS → security group → Caddy → certificate → panel — is correct. The first
issuance can take ten seconds to a minute; while the log shows no `error`, do not restart anything.

## 7. Acceptance checklist

- [ ] `dig +short ha.example.com` returns `203.0.113.10`
- [ ] `https://ha.example.com/admin` opens over mobile data (not your LAN) with **no** certificate warning
- [ ] `curl -sI https://ha.example.com/health` returns `200`
- [ ] `https://ha.example.com/derp` is **not** `404` (`426` and the like are fine)
- [ ] The panel logs in normally and never returns 403
- [ ] `tailscale up --login-server https://ha.example.com` registers successfully
- [ ] `tailscale netcheck` reports STUN available (the security group allows `udp/3478`)
- [ ] `docker compose logs caddy` shows no validation or renewal errors

## 8. Troubleshooting

### 1. Certificate issuance fails / port `80` is unreachable

The log shows `could not get certificate`, `challenge failed` or `timeout`, and the browser reports an invalid
certificate. Check in this order:

- **DNS not live**: `dig +short ha.example.com` must return this server's IP; issuance is refused while the name does not resolve.
- **`80` blocked**: from outside, `curl -I http://ha.example.com` should show Caddy's `301`/`308`; a timeout means the security group or host firewall is closed — **test over mobile data**.
- **Filing**: on a mainland server read [section 1](#icp-filing) first; `80`/`443` are cut off in the middle and Caddy only sees timeouts.
- **Port taken**: `sudo ss -lntp | grep -E ':80|:443'` should list `caddy` only.
- **Do not restart in a loop**: Let's Encrypt rate-limits issuance; wait a minute or two and re-read the log.
- **No `80` available**: you would need **DNS-01**, but stock `caddy:2-alpine` ships **no** DNS provider plugins — this page uses HTTP-01 / TLS-ALPN-01 only.

### 2. The filing is not finished yet

`80`/`443` time out, or you get a page from the cloud provider / ISP, while the Caddy log shows only timeouts and
no configuration error: not Caddy's fault — check the filing progress in the provider's console. A non-standard
port usually works meanwhile, but treat it as temporary and **finish the filing**.

### 3. The panel returns 403 (wrong `Host`)

The panel performs a CSRF / cross-site check, so reaching it through an address other than `server.base_url`
returns 403. Verify each item:

- The browser address must match `server.base_url` **character for character**: scheme + domain + `/admin`, no IP, no other subdomain, no extra port.
- The Caddyfile site name must be that domain, and `Host` must **not** be rewritten (no `header_up Host ...`).
- A CDN or another proxy in front must forward the **original `Host`**.

### 4. `/ts2021` or `/derp` returns 404

The request never reached Headscale. Check that the catch-all `handle` is still there (do not turn `handle
/admin*` into `handle /*`, which sends every path to the panel), that the upstream has no `https://` and no
trailing `/`, and reload Caddy after the fix.

### 5. `udp/3478` was never opened

`tailscale netcheck` keeps reporting STUN unavailable and hole punching fails. `3478/udp` must be allowed in
**both** the security group and the host firewall; it is a separate rule from `443`, and TCP alone does not count.

### 6. Every node went offline after changing `server_url`

Expected, not a fault: `server_url` lives in each client's local state, so already-registered machines must
**register again** — `tailscale logout`, then `tailscale up --login-server https://ha.example.com`, or delete the
old node and re-register. A new domain, scheme (`http` → `https`) or port all count.

## 9. Command reference

| Goal                         | Command                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| Start / recreate             | `cd /opt/headplane && docker compose up -d`                              |
| Status / logs                | `docker compose ps` / `docker compose logs caddy --tail=50`              |
| Apply a Caddyfile edit       | `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`   |
| Validate the Caddyfile       | `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` |
| Backend directly (Headscale) | `curl -s http://127.0.0.1:8480/health`                                   |
| Backend directly (panel)     | `curl -s http://127.0.0.1:4100/admin/healthz`                            |
| Whole public chain           | `curl -sI https://ha.example.com/health`                                 |
| Port usage                   | `sudo ss -lntp \| grep -E ':80\|:443'`                                   |
| Issued certificates          | `docker compose exec caddy ls /data/caddy/certificates`                  |
| Generate `cookie_secret`     | `openssl rand -base64 24`                                                |
| Re-register a client         | `tailscale logout && tailscale up --login-server https://ha.example.com` |

## Next

- Three layouts, DNS, certificates and filing: [Domains and access](/en/install/domains)
- What to do when home broadband gives you no `80`/`443`: [Lucky + Caddy (Home NAS)](/en/install/reverse-proxy-lucky)
- Installing Headscale and the panel: [Docker](/en/install/docker) / [dual-image](/en/install/dual-image)
