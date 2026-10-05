---
title: Headscale Settings
description: Edit Headscale's OIDC configuration, trusted proxies, policy mode, node lifetime and DERP settings from Headplane.
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
- To edit the local DERP map files (`derp.paths`) from the DERP tab, the
  directory holding them must be mounted **read-write** too; see
  [Editing local DERP map files](#editing-local-derp-map-files).
- Headscale reads most of this at startup, so changes only take effect after the
  Headscale process restarts. With the process integration enabled Headplane asks
  it to reload or restart for you.

:::

## OIDC

The full single sign-on block:

| Field                             | Notes                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer`                          | The provider's discovery URL. **Headscale treats an empty issuer as "OIDC disabled".**                                                                                                                                                                                                                                        |
| `client_id`                       | Client registered at the provider.                                                                                                                                                                                                                                                                                            |
| `client_secret`                   | Write-only here: Headplane shows whether a secret is set, never its value. Leave the field untouched to keep the current one.                                                                                                                                                                                                 |
| `client_secret_path`              | Read the secret from a file instead of storing it inline. Headscale reads the file when it starts and expands environment variables in the path, which makes this the safer place for the secret. Leave the field empty to remove the key.                                                                                    |
| `scope`                           | Defaults to `openid`, `profile`, `email`.                                                                                                                                                                                                                                                                                     |
| `email_verified_required`         | Default `true`. Turn it off only for providers that never send `email_verified`.                                                                                                                                                                                                                                              |
| `use_expiry_from_token`           | Default `false`. When enabled, OIDC logins use the provider's token expiry and `node.expiry` is ignored for those nodes.                                                                                                                                                                                                      |
| `only_start_if_oidc_is_available` | Default `true`; when off, Headscale starts even if the provider is unreachable.                                                                                                                                                                                                                                               |
| `pkce`                            | `enabled` (default `false`) and `method` (`plain` or `S256`, default `S256`).                                                                                                                                                                                                                                                 |
| `extra_params`                    | Extra parameters sent to the provider's authorization endpoint, for example `domain_hint`, `prompt` or `acr_values`. Edited as key/value rows below the form: both halves are required, keys are trimmed and may not contain whitespace, and duplicate keys are rejected. Saving an empty list removes the key from the file. |

The **allowed domains / users / groups** lists have their own page under
[Settings → Restrictions](/features/sso#login-restrictions), because they are
changed far more often than the rest of the block.

::: warning Inline secret and secret file together
Headscale's own example configuration calls `oidc.client_secret` and
`oidc.client_secret_path` mutually exclusive. When both are present in the file
the page says so, but the save itself is not blocked — keep only one of the two.
:::

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

The same page also edits the settings that usually mean editing the file by hand.
The tab groups them into collapsible cards — node lifecycle, health checks,
logging and features — so every save button stays with the fields it writes:

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

### HA subnet-router health checks

When several nodes advertise the same prefix — an HA subnet router — Headscale
pings each one and marks it unhealthy once a probe times out. The card edits both
knobs, with Headscale's own rules enforced before anything is written:

| Setting                         | Rules                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node.routes.ha.probe_interval` | How often each router is probed. `0` disables probing; any other value must be at least `2s`. Default `10s`.                                                     |
| `node.routes.ha.probe_timeout`  | How long a probe waits for an answer before the router counts as unhealthy. At least `1s`, and shorter than the interval while probing is enabled. Default `5s`. |

## DERP

Tailscale clients reach each other through DERP relays when a direct connection
is impossible. Headscale ships with Tailscale's public DERP map, and this section
edits how that map is used:

| Setting                                              | What it does                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `derp.urls`                                          | Extra DERP map URLs to merge into the built-in one — point this at a custom map file you host.                                                                                                                                                                  |
| `derp.paths`                                         | Local DERP map files to merge, for maps you keep on disk. Each entry can also be viewed and edited right here — see [Editing local DERP map files](#editing-local-derp-map-files).                                                                               |
| `derp.auto_update_enabled` / `derp.update_frequency` | Whether Headscale refreshes the built-in map from Tailscale, and how often (`3h`).                                                                                                                                                                              |
| `derp.server.*`                                      | The embedded DERP server: enable it, give it a region id (900–999), code and name, a STUN listen address, and the private key Headscale uses to sign the region. `verify_clients` controls whether clients must prove they are in your tailnet before relaying. |

### Editing local DERP map files

Each path in `derp.paths` is a map file Headscale merges at startup, and the DERP
tab edits them in place. Every configured path gets its own row:

| Action                  | What it does                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **View**                | Read-only rendering with a line-number gutter and light YAML colouring. Nothing is written.                                 |
| **Edit**                | An editor that validates while you type, with the same rules the server enforces before it writes anything.                 |
| **Save**                | Validates on the server, snapshots the current file, then replaces it atomically (temp file + rename in the same directory). |
| **Roll back**           | Restores the snapshot taken before the last write, and snapshots the content it replaces first.                             |
| **Create from example** | Loads one of three fully commented templates into the editor; nothing is written until you save.                            |

A row also lists what Headplane found on disk: whether the file exists, is
readable, is writable, parses, is a valid DERP map, and keeps its region ids and
codes unique. A path this container cannot see at all is reported as **cannot
check**, exactly like the rest of the configuration checks, because a missing bind
mount is not a broken map.

Nothing is written unless the path is **already listed in `derp.paths`**: the
request may only name one of those entries, the path has to be absolute, and a
`..` segment is refused. Files larger than **256 KiB** are neither loaded into the
editor nor written.

::: warning The map directory has to be mounted read-write
Editing writes through the mount the container was given, so the directory holding
the maps has to be shared **read-write**. Share only that directory rather than the
whole Headscale data directory:

```yaml
volumes:
  - "/vol1/@appdata/headscale/derp-maps:/etc/headscale/derp-maps"
```

With a read-only mount **View** still works while every save reports that the
container cannot write the path. Headscale itself has to be able to read these
files too, because it loads them when it starts.
:::

#### What the editor checks

| Rule       | Detail                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| YAML       | The document parses; a syntax error is reported with the line and column the YAML parser gives.                                |
| Region     | The document is a DERP map (a `regions` mapping), and every region has `regionid`, `regioncode`, `regionname` and `nodes`.     |
| Uniqueness | Region ids and region codes each appear only once.                                                                            |
| Node       | Every node has `name`, `regionid` and `hostname`; `derpport` and `stunport` are integers from 1 to 65535 (`stunport` may be 0). |
| Addresses  | `ipv4`/`ipv6`, when present and non-empty, are valid addresses, and `stunonly` is a boolean.                                   |
| Size       | No more than 256 KiB, so the container can read and write it comfortably.                                                     |

Every problem is shown in your language, next to the line it came from. The server
never sends English prose: it answers with a stable code plus the position, and the
page words it.

#### Taking effect

Headscale reads `derp.paths` files **when it starts**, so a saved map is picked up
after a reload or restart — **Settings → System** has that control when the process
integration is enabled. Headplane deliberately does not reload Headscale for you
here: a reload that does not re-read the map would look like it worked.

The file is snapshotted before **every** write, so it appears on
**Settings → Snapshots** with the reason `DERP map file: <name>` and can be
restored from there or from the row's **Roll back** button. Rolling back snapshots
the content it replaces first, so a rollback is itself reversible.

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

### Is the relay actually reachable over IPv6 (or IPv4)?

`derp.server.ipv4` and `derp.server.ipv6` are what Headscale **advertises** to
clients; they are not proof that the names clients use reach those addresses. The
DERP tab therefore resolves the host in `server_url` (A and AAAA, cached for five
minutes) and compares the two:

| Declared vs resolved                                              | Verdict                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The declared address is among the records                         | **Matches** — clients reach the relay over that family.                                                                                         |
| `derp.server.ipv6` is set, but the hostname has no AAAA record    | **Warning** — clients cannot use the relay over IPv6 at all. Add an AAAA record pointing at the machine running the relay, or accept IPv4-only. |
| `derp.server.ipv4` is set, but no A record matches it             | **Warning** — usually a stale address left behind after the machine's IP changed. Update `derp.server.ipv4` or the hostname's A record.         |
| `derp.server.ipv6` is empty                                       | **Nothing to compare** — a neutral pass with a note. Running the relay over IPv4 only is a valid choice.                                        |
| The embedded server is disabled                                   | **Nothing to check** — the relay is not served from this configuration.                                                                         |
| The lookup timed out, the resolver failed, or `server_url` is bad | **Cannot check** — reported as such rather than as a broken address, so a DNS hiccup never looks like a misconfiguration.                       |

The same comparison appears on the **Overview** dashboard and on each machine's
DERP card, right under the addresses the hostname resolves to now, and
**Settings → System** lists it as the two checks _Embedded relay IPv4_ and
_Embedded relay IPv6_.

A host resolver can legitimately answer with no AAAA for a name that does have one,
so "no record" is a property of the resolver in front of you, not proof about the
zone. Compare `dig @1.1.1.1 +short AAAA <host>` with `dig +short AAAA <host>`: if
the public resolver answers and the local one does not, the name does have a record
and the host's resolver is hiding it. The relay cards state which resolver produced
the answer they show — **System resolver** or **Configured: …** — so an empty row
never leaves you guessing which DNS server was asked.

### Choosing the resolver for relay lookups

Below the embedded-server block, **Relay DNS resolver** lists the DNS servers
Headplane may use for relay lookups instead of the host's own:

- **Empty (the default)** — lookups follow the host's resolver, exactly as
  Headplane has always done. Nothing changes until you add a server.
- **One or more servers** — every relay lookup goes through them, in the order
  listed, up to five. IPv4 and IPv6 literals are accepted, each with an optional
  port (`1.1.1.1`, `[2606:4700:4700::1111]:53`).

The list is Headplane state: it is stored in Headplane's own data directory
(`relay-dns-servers.json`) and never written into Headscale's configuration, so it
also works when the configuration file is mounted read-only. It affects relay
lookups only; everything else Headplane resolves keeps using the host's resolver.

A configured resolver is never silently bypassed: when those servers fail, the
card reports the failure rather than falling back to the host's resolver, because a
lookup you pointed somewhere is a lookup you want the truth about.

**Re-resolve now** clears the cache and runs the lookup again. Positive and
negative answers are cached for five minutes, so a name that had no AAAA before you
changed your DNS keeps reporting "no records" until that cache expires — the button
is how you check immediately, without restarting Headplane.

::: tip The other "IPv6: No" is not about the relay
A machine's **Client Connectivity → IPv6** value is that machine's own
connectivity self-test: it describes whether the machine's network has working
IPv6, and it says nothing about Headscale or about your relay. It cannot be fixed
on the Headscale side. The [fnOS deployment guide](/install/fnos) has a
troubleshooting entry for both symptoms, or check that machine's network
directly.
:::

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

## Configuration overview

The **Overview** tab is the other half of the page: the values Headplane reads
but deliberately never writes, marked **Display only**. A wrong database path or
IP range could lock you out of the server, and the rest are operational or
secret file paths that belong in the file on the host. Looking one up no longer
means opening that file yourself.

| Block        | Shown                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Network      | `server_url`, `listen_addr`, `prefixes.v4`, `prefixes.v6` and the allocation strategy (`sequential` when the key is absent).                 |
| Database     | `database.type` (`sqlite` when the key is absent), `database.sqlite.path` and whether the SQLite write-ahead log is on (`true` when absent). |
| Listeners    | `metrics_listen_addr`, `grpc_listen_addr`, `grpc_allow_insecure`, `unix_socket`, `unix_socket_permission` and `noise.private_key_path`.      |
| TLS and ACME | The Let's Encrypt hostname, the ACME email, and the certificate and certificate-key paths.                                                   |
| Tuning       | Whether a `tuning` block is set at all (any key in it counts), not the individual performance knobs.                                         |

Anything the file does not set is shown as `—` instead of a guessed value, apart
from the three Headscale defaults named above — the allocation strategy, the
database type and the write-ahead log — which are shown as Headscale resolves
them.
