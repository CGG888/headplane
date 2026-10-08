---
title: Domains and access
description: The single-domain and multi-domain tutorials, which one fits you, how to fill in DNS, where certificates go, and ICP filing in mainland China.
outline: [2, 3]
---

# Domains and access

This page covers exactly **one thing**: making both the Headscale clients and the
HeadplaneCN panel reachable — three complete layouts, the DNS records, which layer holds
the certificate, and the ICP filing rules in mainland China. How to configure the reverse
proxy itself is **not here**: the Lucky sub-rule fields are in
[Home NAS: Lucky + Caddy](/en/install/reverse-proxy-lucky), and the cloud-server Caddyfile
is in [Cloud server Caddy](/en/install/reverse-proxy-caddy). Every domain, IP address and
certificate path below is a placeholder — substitute your own values.

## Values you need to change

| Placeholder             | Example                                    | Meaning                                                        | Where to change                             |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| Domain                  | `ha.example.com`                           | The domain clients connect to, **must change**                 | Headscale `server_url`, DNS, Lucky / Caddy  |
| Panel domain (layout C) | `panel.example.com`                        | The extra subdomain for the panel, **must change**             | Panel `server.base_url`, DNS, Lucky         |
| NAS LAN IP              | `192.168.1.10`                             | The NAS running Headscale, **must change**                     | Reverse proxy upstream                      |
| Cloud server public IP  | `203.0.113.10`                             | The cloud server's address, **must change**                    | Reverse proxy upstream (usually localhost)  |
| Public port             | `8443`                                     | Public port for layouts A / B, **may change** (`443` default)  | Proxy listen port, `server_url`, `base_url` |
| `server_url`            | `https://ha.example.com`                   | The address clients use, **no path prefix allowed**            | Headscale config                            |
| `server.base_url`       | `https://ha.example.com/admin`             | The panel's own address, layout A **must include `/admin`**    | Panel `config.yaml`                         |
| `server.cookie_secure`  | `true`                                     | `true` for any HTTPS deployment, **leave alone**               | Panel `config.yaml`                         |
| `server.cookie_secret`  | `<paste the value from the command above>` | `openssl rand -base64 24`, exactly 32 chars, **leave alone**   | Panel `config.yaml`                         |
| Certificate / key path  | `/etc/ssl/ha/fullchain.pem`                | Certificates read by the proxy layer, **adjust to your setup** | Lucky / Caddy certificate settings          |

::: warning `server_url` cannot carry a path prefix
Headscale treats `server_url` as a **root** address; clients append `/ts2021`, `/key`,
`/register`, `/verify`, `/api/v1/*`, `/health` and `/derp` to it. Therefore:

- ✅ `https://ha.example.com` or `https://ha.example.com:8443`
- ❌ `https://ha.example.com/headscale`, `https://ha.example.com/ha/`
- With a prefix, clients dial `https://ha.example.com/headscale/ts2021` and **no node can come online**.
- Changing `server_url` means **every registered node has to sign in again** (its control address moved).
  :::

## 1. The hard constraint to understand first

A Headscale client (`tailscaled`) only knows `server_url`, and it **always talks to the
domain root**; the panel is a web page for humans and needs a place of its own. There are
only three ways to separate them:

| What separates them | How it works   | Needs a path-routing proxy? |
| ------------------- | -------------- | --------------------------- |
| Path                | `/admin`       | **Yes** (Caddy / Nginx)     |
| Port                | `8443`         | No                          |
| Domain              | Separate names | No                          |

**Why does the path layout need Caddy or Nginx?** Lucky's custom parameters accept only
`proxy_set_header`, `proxy_hide_header`, `add_header`, `proxy_redirect` and `location` /
`path` groups — it has **no `proxy_pass`**, so it cannot point at a different backend. One
domain with path routing therefore needs a Caddy or Nginx next to it on the NAS; the port
and multi-domain layouts need nothing but **two Lucky sub-rules**.

## 2. Choosing between the three layouts

All three listen on **a single public port** (shown here as `8443`; `443` works just as well).

| Item                 | Layout A: one domain + paths                   | Layout B: one domain + two ports | Layout C: two domains              |
| -------------------- | ---------------------------------------------- | -------------------------------- | ---------------------------------- |
| Public address       | `https://ha.example.com:8443/`                 | same, on port `443`              | same, on port `443`                |
| Panel address        | `https://ha.example.com:8443/admin`            | `https://ha.example.com:8443`    | `https://panel.example.com`        |
| `server_url`         | `https://ha.example.com:8443`                  | `https://ha.example.com`         | `https://ha.example.com`           |
| `server.base_url`    | `https://ha.example.com:8443/admin`            | `https://ha.example.com:8443`    | `https://panel.example.com`        |
| Certificates         | 1, covering `ha.example.com`                   | 1, one certificate on both ports | 2, or one `*.example.com`          |
| Proxy rules          | root → Headscale, `/admin*` → panel            | two sub-rules, split by **port** | two sub-rules, split by **domain** |
| Caddy inside the NAS | **required**                                   | not required                     | not required                       |
| Best for             | hiding the panel under `/admin`, one open port | one NAS, no extra software       | tidy names, one host each          |

::: tip The least-effort choices
Home NAS + Lucky: **layout B** (one domain, split by port, two Lucky sub-rules).
Cloud server + Caddy: **layout A** (Caddy is already there, routing is free, one open port).
:::

## 3. Layout A: one domain + path routing

**What the addresses look like**: clients connect to `https://ha.example.com:8443`, the
panel lives at `https://ha.example.com:8443/admin`.

```yaml
# Headscale config: the clients' address, at the root, without /admin
server_url: https://ha.example.com:8443 # ← must change to your domain + public port
```

```yaml
# HeadplaneCN's config.yaml: the panel's own address, which must include /admin
server:
  base_url: "https://ha.example.com:8443/admin" # ← must change (note the trailing /admin)
  cookie_secure: true # ← cannot change on public HTTPS
  cookie_secret: "<paste the value from the command above>" # ← use openssl rand -base64 24
```

**Proxy rules**: two of them, inside **one path-routing block**, and that block lives in a
second proxy process inside the NAS (Caddy or Nginx) — Lucky cannot do it alone:

| Match           | Backend (upstream)         | Key requirement                             |
| --------------- | -------------------------- | ------------------------------------------- |
| `/admin*`       | `http://192.168.1.10:4100` | No path rewrite (the panel is at `/admin`)  |
| everything else | `http://192.168.1.10:8480` | `/ts2021` and `/derp` pass through verbatim |

That block is **plain HTTP routing**: TLS is terminated further out, on Lucky or the
router, hence `auto_https off`, and the port and upstreams follow your environment. The
full field-by-field walkthrough is in
[Home NAS: Lucky + Caddy](/en/install/reverse-proxy-lucky#path-routing).

**What to watch out for**: omitting `/admin` in `base_url` makes every save fail with
`Unexpected Server Error`; match `/admin*` and **do not rewrite the path** (`/admin`
redirects to `/admin/`); the catch-all branch feeds Headscale, so it cannot be an
allow-list of API paths.

## 4. Layout B: one domain + two ports

**What the addresses look like**: clients connect to `https://ha.example.com` (443), the
panel is at `https://ha.example.com:8443`.

```yaml
server_url: https://ha.example.com # ← must change (clients' address; no port for 443)
```

```yaml
server:
  base_url: "https://ha.example.com:8443" # ← must change (panel address, no path)
  cookie_secure: true
  cookie_secret: "<paste the value from the command above>"
```

**Proxy rules**: **two Lucky sub-rules**, no Caddy or Nginx.

| Sub-rule | Frontend domain  | Listen port | Upstream                   | Match | Path rewrite |
| -------- | ---------------- | ----------- | -------------------------- | ----- | ------------ |
| ①        | `ha.example.com` | `8443`      | `http://192.168.1.10:4100` | empty | off          |
| ②        | `ha.example.com` | `443`       | `http://192.168.1.10:8480` | empty | off          |

**What to watch out for**: it is **one** certificate — attach the same one to both the
`443` and `8443` listeners; tick both IPv4 and IPv6 on each listener, or an IPv6-only
network cannot connect; the upstream is **host:port only**, never with a trailing `/` or
path; press "restart rules" in Lucky before the change takes effect.

## 5. Layout C: two domains

**What the addresses look like**: clients connect to `https://ha.example.com`, the panel is
at `https://panel.example.com`.

```yaml
server_url: https://ha.example.com # ← must change (Headscale's own domain)
```

```yaml
server:
  base_url: "https://panel.example.com" # ← must change (the panel's own domain, no path)
  cookie_secure: true
  cookie_secret: "<paste the value from the command above>"
```

**Proxy rules**: **two Lucky sub-rules**, split by domain.

| Sub-rule | Frontend domain     | Listen port | Upstream                   | Match | Path rewrite |
| -------- | ------------------- | ----------- | -------------------------- | ----- | ------------ |
| ①        | `ha.example.com`    | `443`       | `http://192.168.1.10:8480` | empty | off          |
| ②        | `panel.example.com` | `443`       | `http://192.168.1.10:4100` | empty | off          |

**What to watch out for**: **two certificates** (`ha.example.com` and `panel.example.com`),
or one `*.example.com` wildcard, and both must renew automatically; each domain needs its
own DNS record; moving the panel to a subdomain means settings such as the **OIDC callback
URL** must move to the new domain too.

## 6. How to fill in DNS

Point the domain at the machine running the proxy (the router or software router for a home
NAS, the server itself for a VPS).

| Type  | Hostname            | Points to        | Used for                       |
| ----- | ------------------- | ---------------- | ------------------------------ |
| A     | `ha.example.com`    | `203.0.113.10`   | Layouts A / B / C, IPv4        |
| AAAA  | `ha.example.com`    | `2001:db8::10`   | Add when you have public IPv6  |
| A     | `panel.example.com` | `203.0.113.10`   | Layout C only                  |
| CNAME | `panel.example.com` | `ha.example.com` | Optional alternative to that A |

- **A / AAAA is the normal case**: a home line's public IP changes, so use **DDNS** (Lucky
  has one built in, and most routers do too). A hard-coded IP record breaks the next time
  the line reconnects.
- **Do not use wildcard DNS**: `*.example.com` points typos and scanner-generated hostnames
  at your server as well; certificates and virtual hosts do not cover them, so all you gain
  is misconfigured panel entries and attack surface. **Write one record per way you
  actually serve.**
- **CNAME** just saves you an IP: use it when your provider changes addresses or when
  several names must follow one target. The target must still be a domain you own.
- **IPv6**: an AAAA record only helps IPv6-only networks (some mobile carriers, IPv6-only
  VPS) when the proxy really listens on IPv6. Remember that **IPv6 has no NAT and no port
  forwarding**: the router / NAS firewall has to **allow inbound** `443` / `8443` (and
  `udp/3478`) on its own, or the address DNS hands out is simply unreachable.

## 7. Which layer holds the certificate

One sentence: **the certificate belongs to whichever layer listens publicly and terminates
TLS**; the panel and Headscale themselves never deal with it.

| Layout | Where the certificate lives                                                | How many                     |
| ------ | -------------------------------------------------------------------------- | ---------------------------- |
| A      | The outermost layer (router / Lucky), forwarded on to Caddy inside the NAS | 1, covering `ha.example.com` |
| B      | The outermost layer, the same certificate on two listen ports              | 1, covering `ha.example.com` |
| C      | The outermost layer, one per domain                                        | 2 (or one `*.example.com`)   |

Pick one source according to your environment:

| Source              | How                                                                       | Best for                                  |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| **Apply in Lucky**  | DNS API (required for wildcards) or file-based issuance, auto-renewed     | Home NAS                                  |
| **Caddy automatic** | Name the domain; Caddy runs the ACME challenge and renews (Let's Encrypt) | A VPS with public 80/443                  |
| **Self-signed**     | Generate it yourself; browsers warn and clients may refuse outright       | **LAN experiments only**, never long-term |

::: warning Wildcards need a DNS API
Let's Encrypt issues wildcard certificates only through the **DNS-01** challenge, so the
**DNS provider's API credentials** must be configured in Lucky (or Caddy). File- or
HTTP-based issuance cannot produce a `*.example.com` certificate.
:::

## 8. ICP filing (mainland China)

| Where the server is                               | Filing needed? | Can you use 80 / 443 directly?    | What home users do       |
| ------------------------------------------------- | -------------- | --------------------------------- | ------------------------ |
| Mainland China                                    | **Yes**        | Only after the filing is approved | Not eligible (see below) |
| Outside mainland (incl. Hong Kong, Macau, Taiwan) | No             | Yes, with automatic certificates  | Use `443` directly       |

- **A mainland server requires ICP filing** before a domain may serve traffic on `80` /
  `443`; without it, requests time out or land on an interstitial notice. Filing requires a
  **real-name domain plus a mainland server** and typically takes **1–20 business days**;
  requirements vary by provincial authority, so follow your provider's instructions.
- **A home broadband line cannot be filed**: it is not a server offering public information
  services, and no filing entity can be attached to it. Home users therefore take the
  **non-standard port (such as `8443`) plus self-managed certificate** route — not a
  workaround, simply the only shape that network allows. See
  [Home NAS: Lucky + Caddy](/en/install/reverse-proxy-lucky).
- **An unfiled mainland server on a non-standard port usually still answers**, but that is
  a **non-compliant** state: an inspection can interrupt the service and there is no
  stability to speak of. **Working is not the same as being allowed — file as soon as you
  can.**
- This page states the rules and their cost; it **does not offer any way to bypass filing**.

## 9. Acceptance checklist

1. **Resolution** (run these on your own computer, `192.168.1.20`):

   ```bash
   dig +short ha.example.com          # expect: 203.0.113.10 (or your IPv6 address)
   ```

2. **Certificate trust**:

   ```bash
   curl -sI https://ha.example.com:8443/ | head -3
   # expect: no certificate warning; Headscale answers 200 (a blank page, not 404)
   ```

3. **Client paths** (the critical one: not 404):

   ```bash
   curl -si https://ha.example.com:8443/ts2021 | head -3
   # expect: not 404 (a protocol-upgrade error is normal)
   curl -si https://ha.example.com:8443/health
   # expect: 200 with {"status":"pass"}
   ```

4. **The panel sits where it should**:

   ```bash
   curl -si https://ha.example.com:8443/admin | head -3   # expect: 302, Location: /admin/
   curl -s  https://ha.example.com:8443/admin/healthz     # expect: {"status":"OK"}
   ```

5. **A client can register** (on any machine with Tailscale installed):

   ```bash
   tailscale up --login-server https://ha.example.com:8443
   # expect: a login link you can open and confirm
   ```

6. **The panel logs in and saves**: open the panel address, log in, change any setting and
   save it. An `Unexpected Server Error` sends you to question 1 below.

## 10. Troubleshooting

### 1. The panel opens, but every save after login fails

`server.base_url` is not **exactly** the browser address (protocol, domain, port and
`/admin` must all match), or the proxy rewrote `Host` to an internal IP. In layout A the
usual mistake is the missing `/admin`.

### 2. The browser opens the panel but clients never connect

Check whether the proxy **rewrites paths**. Headscale needs `/ts2021`, `/key`, `/register`,
`/verify`, `/api/v1/*`, `/health` and `/derp` forwarded verbatim; an allow-list of API paths
makes clients see 404.

### 3. After changing `server_url`, every existing machine must register again

That is **expected**: the control address moved, so clients sign in again. Back up first,
then bring machines back one at a time, or run
`tailscale up --login-server <new address>` on each (with `tailscale logout` first if needed).

### 4. A home line dies after a while and works again after reconnecting

The public IP changed while DNS still holds the old address. Set up **DDNS** (Lucky's or
your router's) so the A / AAAA records follow it.

### 5. 80 / 443 fails on a mainland server but `8443` works

The domain has no ICP filing. Follow your provider's filing process; this page neither
recommends nor provides any way around it (see section 8).

Next: the panel's own certificate settings are in
[TLS & Certificates](/en/configuration/tls), and post-install troubleshooting is in
[Common Issues](/en/configuration/common-issues).
