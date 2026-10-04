---
title: Headscale Settings
description: Edit Headscale's OIDC configuration, trusted proxies and policy mode from Headplane.
outline: [2, 3]
---

# Headscale Settings

**Settings → Headscale** edits the parts of Headscale's own `config.yaml` that
Headplane can safely change for you, instead of leaving you to SSH in.

Every settings page uses the same pill tabs as the top navigation — one tab per
group — and a group with several sub-topics expands and collapses in place, so
nothing is buried in one long scroll and nothing is hidden behind a panel.

::: warning Requirements

- Headscale's configuration file must be mounted **read-write** into Headplane
  and `headscale.config_path` must point at it. Without it Headplane can neither
  show nor save these values (see [Network Management](/install/docker#network-management)).
- Headscale reads most of this at startup, so changes only take effect after the
  Headscale process restarts. With the process integration enabled Headplane asks
  it to reload or restart for you.
  :::

## OIDC

The full single sign-on block:

| Field                             | Notes                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issuer`                          | The provider's discovery URL. **Headscale treats an empty issuer as "OIDC disabled".**                                                                                                                                         |
| `client_id`                       | Client registered at the provider.                                                                                                                                                                                             |
| `client_secret`                   | Write-only here: Headplane shows whether a secret is set, never its value. Leave the field untouched to keep the current one. Setting `client_secret_path` instead of an inline secret is respected and shown as "configured". |
| `scope`                           | Defaults to `openid`, `profile`, `email`.                                                                                                                                                                                      |
| `email_verified_required`         | Default `true`. Turn it off only for providers that never send `email_verified`.                                                                                                                                               |
| `use_expiry_from_token`           | Default `false`. When enabled, OIDC logins use the provider's token expiry and `node.expiry` is ignored for those nodes.                                                                                                       |
| `only_start_if_oidc_is_available` | Default `true`; when off, Headscale starts even if the provider is unreachable.                                                                                                                                                |
| `pkce`                            | `enabled` (default `false`) and `method` (`plain` or `S256`, default `S256`).                                                                                                                                                  |

The **allowed domains / users / groups** lists have their own page under
[Settings → Restrictions](/features/sso#login-restrictions), because they are
changed far more often than the rest of the block.

::: danger Removed in Headscale 0.29
`oidc.expiry`, `oidc.strip_email_domain` and `oidc.map_legacy_users` are no
longer supported: Headscale refuses to start when they are present. Node
lifetime now lives in the top-level `node.expiry`. Headplane warns about these
keys instead of silently writing around them.
:::

## Trusted proxies

`trusted_proxies` is a list of CIDRs (for example `127.0.0.1/32`,
`172.16.0.0/12`). Only connections whose source address falls inside one of
those ranges have their `True-Client-IP`, `X-Real-IP` and `X-Forwarded-For`
headers honoured — for everyone else Headscale deletes those headers, so a
client cannot spoof its own address in the logs and in node registration.

Headplane rejects `0.0.0.0/0` and `::/0`: Headscale treats them as a
configuration error, and trusting every peer would defeat the point.

## Node lifetime, logs and switches

The same page also edits the settings that usually mean editing the file by hand:

| Setting                             | What it does                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `node.expiry`                       | How long a machine's key stays valid by default. `0` means machines never expire. Written as a Go duration (`720h`, `8760h`). |
| `node.ephemeral.inactivity_timeout` | How long an ephemeral machine may be offline before Headscale removes it (`30m`).                                             |
| `log.level`                         | `debug`, `info`, `warn` or `error` — `debug` is the first thing to try when behaviour is odd, and it applies after a reload.  |
| `log.format`                        | `text` for humans, `json` for log shipping.                                                                                   |
| `taildrop.enabled`                  | Whether machines may send files to each other with Taildrop.                                                                  |
| `auto_update.enabled`               | Whether machines are told to update themselves by default.                                                                    |
| `logtail.enabled`                   | Whether node logs are sent to Tailscale's log service. Off keeps everything on your own hardware.                             |
| `disable_check_updates`             | Stops Headscale from checking for its own updates.                                                                            |

Values shown are Headscale's own defaults when a key is absent, so the page
describes what your server is actually doing rather than only what the file
happens to say.

## DERP

Tailscale clients reach each other through DERP relays when a direct connection
is impossible. Headscale ships with Tailscale's public DERP map, and this section
edits how that map is used:

| Setting                                              | What it does                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `derp.urls`                                          | Extra DERP map URLs to merge into the built-in one — point this at a custom map file you host.                                                                                                                                                                  |
| `derp.paths`                                         | Local DERP map files to merge, for maps you keep on disk.                                                                                                                                                                                                       |
| `derp.auto_update_enabled` / `derp.update_frequency` | Whether Headscale refreshes the built-in map from Tailscale, and how often (`3h`).                                                                                                                                                                              |
| `derp.server.*`                                      | The embedded DERP server: enable it, give it a region id (900–999), code and name, a STUN listen address, and the private key Headscale uses to sign the region. `verify_clients` controls whether clients must prove they are in your tailnet before relaying. |

### Enabling your own relay in one step

The **preset** button fills the whole embedded-server block for you — region id
`999`, code `headscale`, the example STUN address, and a private-key path next to
Headscale's configuration file — and saves it once you confirm. It never
overwrites a region code or name you already set: those are prefilled so you can
edit them. Enabling the embedded server publishes a new region to every client,
so the dialog says so before you commit.

Two details worth knowing:

- The **private key does not have to exist**: Headscale generates it when it is
  missing, so only the directory it lives in has to be writable by Headscale.
- `derp.server.ipv4` / `ipv6` are optional but recommended — Headscale's own
  configuration suggests your server's public addresses for connection
  stability, especially with exit nodes. Clearing a field removes the key again.

### Making your own relay the default

By default the embedded server is _added_ to Tailscale's public DERP map, so
clients still have the public regions available and pick between them. To make
your relay the only one, the preset also offers to clear the public map at the
same time — it is the `derp.urls: []` setting:

```yaml
derp:
  server:
    enabled: true
    region_id: 999
    region_code: GDDG
    region_name: "GDDG Embedded DERP"
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: /vol1/@appdata/headscale/derp_server_private.key
  urls: [] # no fallback relays
```

The DERP row always states which relay source is in play: _only the embedded
server_, _embedded plus the public map_, or _only the public map_.

::: warning A single relay is a single point of failure
With `derp.urls: []` there is nothing to fall back to, which is why Headscale's
documentation warns about it. Verify the region works first (`tailscale debug
derp headscale` on a client), and remember clients switch over on reconnect
rather than instantly.
:::

### What has to be reachable

A self-hosted region is only used if clients can actually reach it:

| Port                                          | Why                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **The public port of `server_url`**           | The relay protocol itself; Headscale serves it on the same listener as the control server. |
| **UDP 3478** (`derp.server.stun_listen_addr`) | STUN, so clients can discover each other through the relay.                                |

**Which port is that?** The embedded relay is served on the same HTTPS endpoint
as Headscale, so clients use whatever `server_url` names: `https://host` means
**443**, `https://host:8443` means **8443**. Both work — Tailscale's own
documentation just recommends 443, because clients assume that port in some
situations. The DERP tab states the value Headplane derives from your
configuration, and one more from Headscale's documentation: the embedded server
cannot answer Tailscale's captive-portal check on **tcp/80**, which is a
documented limitation rather than a misconfiguration.

### Behind a reverse proxy

Headscale is often served through nginx, Caddy, Traefik or a NAS gateway. The
embedded relay keeps working only if the proxy passes it through properly:

| Requirement                                  | Why                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Forward the **`/derp`** path                 | The relay endpoint lives there; forwarding only the API, `/ts2021` and `/health` leaves DERP unreachable — and it fails quietly. |
| Allow the **HTTP Upgrade** and do not buffer | DERP runs as an upgraded connection; buffering or stripping `Upgrade` breaks it.                                                 |
| Present valid **HTTPS** to clients           | Clients verify the certificate of `server_url`.                                                                                  |
| Let **udp/3478** reach Headscale directly    | STUN cannot pass through an HTTP proxy.                                                                                          |

Clients also have to reach the region's public address, so firewall and NAT rules
are the usual reason a freshly enabled region never appears in use. The page
repeats this next to the controls.

### Region names

Headscale only hands Headplane the region **ids** a machine reports — its own
relay endpoint is not a public DERP map — so an external region shows as `#901`.
The embedded region gets its name from your configuration automatically, and
**Settings → Headscale → DERP** has a small editor for naming the others (a
region id → name mapping kept in Headplane's own data directory, never written
into Headscale's configuration). Names then appear on the machine details too.

Below the form, the page lists which relay region each machine is currently
using, with the latency it measured. That live view needs the Headplane Agent,
because the Headscale API does not expose client measurements; without the agent
the section explains that instead of showing nothing.

::: tip Running your own relay
Enable the embedded server when your machines cannot reach Tailscale's public
DERP servers, or when you would rather relay through your own network. Keep the
private key file outside the config directory and make sure Headscale can read
it — the page warns when it cannot.
:::

## Policy mode

| Mode             | Meaning                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file` (default) | The policy is a HuJSON file that Headscale reads. Its API is **read-only**, so the Access Control editor can only save when Headplane can write that file itself. |
| `database`       | The policy lives in Headscale's database and is writable through the API — this is what lets the [Access Control editor](/features/acls) save changes.            |

Switching modes **does not copy the policy**:

- `file` → `database`: restart Headscale, then import the file once with
  `headscale policy set -f <path>` (or save it from the Headplane editor) —
  until then the database policy is empty, which means _allow all_.
- `database` → `file`: write the current policy to a file and point
  `policy.path` at it before restarting, otherwise the policy is empty.
