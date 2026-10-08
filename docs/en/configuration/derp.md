---
title: DERP & Relays
description: Decide whether to self-host DERP, choose between an embedded relay and the official-region mirror, get the map file paths and mounts right, and keep relay addresses and STUN working.
outline: [2, 3]
---

# DERP & Relays

Tailscale clients **prefer a direct connection**; only when hole punching fails (both peers behind
NAT, a strict firewall, a provider that mangles UDP) does traffic fall back to a **DERP relay**.
DERP is the safety net, not a fast lane — running your own relay will not beat a working direct
connection.

Headscale ships with Tailscale's **public DERP map**, so doing nothing already works. This page
covers **deployment and file paths**: when self-hosting is worth it, how the two approaches differ,
where `derp.paths` files live, what the container has to mount, where relay addresses come from and
how to open STUN. What the cards look like, what the buttons are called and which checks each row
shows all live in
[Headscale Settings → DERP](/en/features/headscale-settings#derp); this page does not repeat them.

## Values you need to change

| Placeholder                 | Example                                                   | What to do                               | Where                                  |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------- | -------------------------------------- |
| Headscale public hostname   | `ha.example.com`                                          | **Must change** to your own domain       | `server_url`                           |
| Relay port                  | `8443`                                                    | May change (443 is the upstream default) | port in `server_url`                   |
| Embedded region ID          | `999`                                                     | May change; use `900–999`                | `derp.server.region_id`                |
| Embedded region code        | `headscale`                                               | May change; clients use this name        | `derp.server.region_code`              |
| Embedded region name        | `Headscale Embedded DERP`                                 | May change                               | `derp.server.region_name`              |
| Local map file              | `/vol1/@appdata/headscale/derp-maps/home.yaml`            | **Must change** to an absolute host path | `derp.paths`                           |
| Official-region mirror file | `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml` | May change (this is the default)         | the "official region node filter" card |
| Dual-image data directory   | `/vol1/1000/APP/headplaneCN/headscale`                    | Leave alone (compose `BASE_DIR`)         | `docker-compose.yml`                   |
| STUN port                   | `udp/3478`                                                | Leave alone                              | `derp.server.stun_listen_addr`         |
| Headscale listen address    | `127.0.0.1:8480`                                          | Leave alone (the historic fnOS port)     | `listen_addr`                          |

::: warning `server_url` takes no path, and changing it means re-registering
`server_url` is the address clients connect to: it **must be `https://` and must not carry a path
prefix**. Change it and every registered node has to log in again, because the login address moved.
The relay address is derived from it: the hostname from its hostname, the port from its port, and
the path is always `/derp`.
:::

## 1. Decide whether you need to self-host DERP at all

**The default needs nothing from you.** Headscale hands out Tailscale's public DERP map, which has
regions all over the world, and clients pick the nearest one themselves.

Self-hosting is only worth it when:

- the public regions are **unreachable or far away** for you (common on mainland Chinese networks:
  high latency, heavy packet loss);
- you want relay traffic to run **through your own machine** (auditing, privacy, control);
- you find the public map **too large and English-only** and want to keep only a few regions.

First separate two **completely different** things:

|                        | Embedded DERP relay (`derp.server`)        | Official-region mirror (900-range numbering) |
| ---------------------- | ------------------------------------------ | -------------------------------------------- |
| What you get           | a **relay server of your own**             | a **trimmed** public-region map file         |
| Needs a public address | yes (HTTPS + `udp/3478`)                   | no, it only writes a local file              |
| Solves                 | public regions unusable / wanting control  | too many regions, unreadable names           |
| What clients see       | one more region (e.g. `headscale`)         | official regions, numbered from 901          |
| Upkeep                 | high: ports, certificates, proxy, firewall | low: tick boxes in the panel                 |

You can use **both**, or neither (a hand-written local map file on its own is fine). The rule is
simple: **first check whether the public regions are actually reachable and how fast they are**, then
decide whether to stand up your own. A working direct connection always wins over a relay.

## 2. Two routes: embedded DERP relay vs official-region mirror

**Route A — embedded DERP relay.** Headscale can be the relay itself; you do not install a separate
DERP server. It **shares one HTTPS endpoint** with the control service and serves the relay on the
`/derp` path. You need:

1. an address reachable from the internet with a **valid HTTPS certificate** (DERP is TLS-based);
2. a reverse proxy that **forwards `/derp` untouched**, passes HTTP Upgrade, disables buffering and
   uses timeouts of 300 seconds or more;
3. `udp/3478` (STUN) opened **directly** on the router/firewall towards the machine running
   Headscale.

The configuration goes into Headscale's `config.yaml` (see section 3). Key points:

- **The relay port is the port in `server_url`**: write `https://ha.example.com:8443` and clients
  use 8443; omit the port and it is 443.
- The file in `private_key_path` **does not have to exist beforehand** — Headscale generates it if
  missing, as long as the directory is writable by Headscale and any existing file is readable.
- With `derp.urls: []` your relay is the **only** relay: if it is unreachable, clients cannot reach
  each other through DERP at all. Confirm the region shows up with `tailscale debug derp-map` on a
  client **before** you empty the public map.

**Route B — official-region mirror.** No server of your own: you tick the Tailscale public regions
you want to keep in the panel, and it renumbers them into the **900 range**, writing a local map file
that Headscale hands to clients. This fixes "too many regions, unreadable names"; it does **not**
fix "the public regions are unreachable". Details in section 6.

Both routes depend on one thing: **Headscale must be able to read that local map file**, which is why
the paths and mounts in section 3 are a shared prerequisite.

## 3. Paths and configuration in native mode

Native mode means **Headscale runs as a host process while HeadplaneCN runs in a container**
([fnOS native install](/en/install/fnos) is that shape). One rule is absolute here:

::: danger `derp.paths` must hold **host** paths, and the mount must use the **same** path
This list is read by **Headscale**; it runs on the host and only understands absolute host paths.
HeadplaneCN lives in a container, and only sees — and writes — the same file when **the same host
directory is mounted at the same absolute path inside the container**. A container-only path such
as `/etc/headscale/derp-maps` fools HeadplaneCN alone: the host's Headscale cannot see it and exits
on the next reload or restart (see section 10).
:::

### 3.1 Create the directory and file on the host first

```bash
# the user running headscale needs read and write access
mkdir -p /vol1/@appdata/headscale/derp-maps
printf 'regions: {}\n' > /vol1/@appdata/headscale/derp-maps/home.yaml
```

An empty `regions: {}` placeholder is fine for now; you can overwrite it later with "create from
example" in the panel. The point is that **the file must exist first**: once `derp.paths` is in the
configuration, Headscale has to be able to open it on every reload or restart.

### 3.2 Mount the directory back at its own path

```yaml
volumes:
  # host directory : the exact same absolute path inside the container (read-write, no :ro)
  - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"
```

Then rebuild the container with `docker compose up -d`. Docker honours the **more specific** mount
point, so this line overrides the read-only data-directory mount
(`- "/vol1/@appdata/headscale:/vol1/@appdata/headscale:ro"`) and applies read-write to
`derp-maps` — you do **not** need to change that read-only mount, and you should not flip the whole
data directory to read-write for convenience. With a read-only mount "view" still works, but
**saving fails**.

### 3.3 Write the host path into `derp.paths`

Edit the effective configuration (`/vol1/@appdata/headscale/config.yaml` on fnOS):

```yaml
server_url: https://ha.example.com:8443 # ← must become your domain; https only, no path

derp:
  server:
    enabled: true
    region_id: 999 # ← may change (900–999 for an embedded relay)
    region_code: headscale # ← may change (clients use this name)
    region_name: "Headscale Embedded DERP" # ← may change
    stun_listen_addr: "0.0.0.0:3478" # ← leave alone; use "[::]:3478" for dual stack
    private_key_path: /vol1/@appdata/headscale/derp_server_private.key # ← may change
  urls: [] # ← may change: keep [] for your relay only; drop the line to keep public regions too
  paths:
    - /vol1/@appdata/headscale/derp-maps/home.yaml # ← must change: absolute path on the host
```

Adding the path from the panel alone is equivalent: the DERP card's "add path" field wants **the
absolute path on the Headscale host**, and the configuration ends up looking like the above.

### 3.4 Reload or restart Headscale

Headscale reads these files **at startup**, so nothing takes effect without a reload. Use the
reload/restart buttons under **Settings → System**, or restart headscale in the fnOS app centre.

## 4. Paths and mounts in dual-image mode

[The dual-image deployment](/en/install/dual-image) puts Headscale in a container too. It **mounts
host directories at the same absolute path inside the container**, so `derp.paths` in `config.yaml`
**needs not one character changed**:

```text
host            /vol1/1000/APP/headplaneCN/headscale            ← map data lives here
headscale container  - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
inside container     /vol1/1000/APP/headplaneCN/headscale       ← the same path
in the configuration derp.paths: /vol1/1000/APP/headplaneCN/headscale/derp-maps/…yaml
```

The panel side of the compose file:

```yaml
volumes:
  # the panel has to rewrite Headscale's configuration and the DERP maps
  - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
  - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps"
  # the data directory at the same absolute path (read-only): config checks and snapshots can see db.sqlite and the keys
  - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"
```

The mounts that matter for DERP, one line each:

| Mount                                                   | Purpose                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headscale:${BASE_DIR}/headscale` (headscale container) | read-write home of the database, keys, socket and maps, **character-for-character the host path**                                                  |
| `headscale/derp-maps:${BASE_DIR}/.../derp-maps` (panel) | view/edit/save DERP maps; the official-region mirror writes its file here too, and Headscale reads that same file                                  |
| `headscale:${BASE_DIR}/headscale:ro` (panel)            | same absolute path, read-only: config checks and snapshots can see `db.sqlite`, keys and so on; read-only keeps the panel from writing by accident |

A (partial) Headscale configuration in the dual-image shape:

```yaml
derp:
  server:
    enabled: true
    region_id: 999
    region_code: "headscale"
    region_name: "Headscale Embedded DERP"
    verify_clients: true # clients must prove tailnet membership before relaying
    stun_listen_addr: "[::]:3478" # dual stack; "0.0.0.0:3478" for IPv4 only
    private_key_path: /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true # add the embedded region to the map handed to clients
    ipv4: 203.0.113.10 # optional advertised address; leave "" with no public address
    ipv6: "" # optional
  urls: [] # keep [] when your relay is the only one
  paths:
    - /vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml
```

### The official-region mirror's target path follows the deployment shape

The panel's **official region node filter** writes the map it generates to a file and adds that file
to `derp.paths`. That file's default location is **derived from Headscale's live configuration** and
is no longer hard-coded:

1. the directory of the first absolute path in `derp.paths` + `official-mirror.yaml`;
2. failing that, the Headscale data directory (inferred in order from `noise.private_key_path` →
   `database.sqlite.path` → `derp.server.private_key_path` → `unix_socket`) +
   `derp-maps/official-mirror.yaml`;
3. and only when neither can be inferred does it fall back to the old native default
   `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`.

So in the dual-image shape, as long as the file listed in `derp.paths` exists, the card points
automatically at
`/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml`. **If you have changed the path
by hand, yours wins**; only a value still on the old default is re-derived by the rules above.

If the card still reports "cannot read `/vol1/@appdata/...`" after migrating from a native
deployment, the panel's data file still stores the old path (in the dual-image shape the container
does **not** mount `/vol1/@appdata`). Fix it either way:

- change the path to the new one in the card and save;
- or edit the panel's data file directly (**back it up first**, then restart the panel):

  ```bash
  cd /vol1/1000/APP/headplaneCN/data
  cp -a derp-region-mirror.json derp-region-mirror.json.bak-$(date +%Y%m%d-%H%M%S)
  sed -i "s#/vol1/@appdata/headscale/derp-maps/official-mirror.yaml#/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml#g" \
    derp-region-mirror.json
  cd .. && docker compose restart headplaneCN
  ```

The "DERP map file mount hint" on the page is derived from `derp.paths` too
(`- "<directory>:<directory>"`) and no longer shows the hard-coded `/vol1/@appdata/...`.

### Ports: the relay shares the control service's port

Under `network_mode: host` the exposed ports are whatever the containers listen on; these two
concern DERP:

| Port       | Who listens               | How it faces the internet                                                                                    |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tcp/8480` | Headscale control service | reverse-proxy to `127.0.0.1:8480`; **the control paths and `/derp` are both on this port**                   |
| `udp/3478` | the embedded DERP's STUN  | open it directly on the router/firewall towards this machine; it **cannot** go through an HTTP reverse proxy |

## 5. Editing and validating DERP maps online

**Settings → Headscale → DERP** lists every path in `derp.paths` and supports **view / edit / save /
roll back**, plus "create from example", which loads one of three fully commented templates (one
region with one node; two regions, one of them STUN-only; and a commented skeleton). **"Create from
example" writes nothing until you save.**

Each row reports what HeadplaneCN found on disk: whether the file exists, is readable, is writable,
parses as YAML, is a valid DERP map, and whether region IDs and region codes are unique. A path the
container **can neither see nor write** shows as "cannot check" rather than silently swallowing the
failure.

Before saving, HeadplaneCN validates once more on the server: valid YAML, a `regions` mapping,
regions with `regionid`/`regioncode`/`regionname`/`nodes`, unique region IDs and codes, nodes with
`name`/`regionid`/`hostname`, and legal ports and addresses.

- **Snapshots**: every write leaves a snapshot first, visible and restorable under
  `/settings/snapshots` (look for entries such as `DERP map file: …`).
- **A read-only mount cannot save**: with a `:ro` mount, "view" still works but saving reports that
  the container cannot write — add the read-write mount from section 3 or 4 first.
- **Hand edits get overwritten**: the file written by the official-region mirror is maintained by a
  background job, so give it a file of its own and do not point it at a hand-maintained map.
- **Saving needs a reload**: Headscale loads these files at startup, and the panel tells you to
  reload or restart.

For the interface itself (what each button does, how the checks are shown) see
[Headscale Settings → Editing local DERP map files](/en/features/headscale-settings#editing-local-derp-map-files).

::: tip The official map is "wire format"; both spellings are accepted
Tailscale's official map uses capitalised fields (`Regions`, `RegionID`, `HostName`, `IPv4`…), while
Headscale's local files use lowercase (`regions`, `regionid`, `hostname`, `ipv4`). The same reader
accepts and normalises both. Remote fetches have a **10-second** timeout; a connection-level failure
(timeout, refused) is **retried once**, while an error status code or content that is not a DERP map
at all is not retried.
:::

## 6. The official-region mirror and 900-range numbering

If you would rather not maintain map files, and find Tailscale's public regions too numerous and
English-only, use the **official region node filter** card directly below "address auto-sync" in
**Settings → Headscale → DERP** (collapsed by default, its summary reads like "N official regions ·
M selected · file path").

It mirrors **Tailscale's public DERP regions** (not your own nodes), keeps only the regions you tick,
renumbers them into the **900 range**, and writes a local map file that Headscale hands to clients:

- selected regions are numbered from **901** upwards in **ascending measured latency**; on a tie the
  smaller official ID comes first. **Nothing is fixed, both boxes can be unticked, and the default is
  nothing selected.**
- numbering is **sticky**: once assigned, later runs do not swap numbers over a latency wobble, which
  keeps client path selection stable. Only "renumber" re-sorts everything, and its dialog warns that
  clients may briefly re-select a relay.
- settings: an enable switch (**off by default**), the target file path (default
  `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`, which **must be an absolute host path**
  and its directory must be mounted read-write into the container), the refresh interval (6 / 12 /
  24 hours, default 24) and auto-reload after writing (on by default; reloading briefly interrupts
  online clients).
- four buttons: **save** writes the settings; **check** only fetches, filters and compares and writes
  **nothing** (no snapshot, no reload, no notification, and it does not touch stored numbers);
  **update now** writes what actually changed; **renumber** discards stored numbers and re-sorts by
  the current measurements.
- when it cannot write, it **does not** touch the existing file on disk and the card explains why
  (no regions selected, official map unavailable, target path not absolute or containing `..`, not
  writable, generated map failed validation, reload failed…); failures are pushed through the
  "DERP address sync failed" notification event.

## 7. Relay address sync

`derp.server.ipv4` / `ipv6` are the relay addresses Headscale **publishes to clients**. Left empty,
auto-sync probes and writes them. The two families are found differently:

- **IPv4**: the **A record** of the `server_url` hostname (private, CGNAT, loopback and link-local
  answers are rejected). A machine behind NAT cannot see its own public address anyway, so DNS has
  the right answer.
- **IPv6**: **the host's own global unicast address** — there is no NAT for IPv6, the public address
  is on the machine itself; a stable address beats a rotating privacy one, and the one the domain's
  AAAA points at comes first. The optional **IPv6-only echo** is authoritative when the router
  forwards or translates IPv6. A DNS answer is only a **fallback** when the two disagree, and it is
  labelled "unverified", because a domain's AAAA may be a temporary privacy address, a stale record
  from an old prefix, or even another machine.

How sync behaves:

- **"Check" only rehearses and writes nothing**: it runs both families' probes and comparisons and
  changes nothing. **"Run now"** runs the same checks and **writes only the keys that actually
  changed** (the family that changed is the one written), after taking a configuration snapshot and
  recording an audit entry.
- **Auto-reload is on by default**: a write only reaches clients through a reload, and a reload
  **briefly interrupts connected clients**; a run with no changes never reloads.
- **The probe result is authoritative**: it overwrites a value you set by hand next time it sees a
  different address. A failed probe (no usable address for a family, a failed write, a failed
  reload) raises an alert through the notification system; a run with no changes raises none.
- **Lookups are cached for five minutes**, negative results included: after fixing DNS, click
  **"re-resolve"** in the relay settings to clear the cache and query again immediately, without
  waiting five minutes or restarting HeadplaneCN.

For the full rules see
[Headscale Settings → Address auto-sync](/en/features/headscale-settings#address-auto-sync) and
[Where the relay addresses come from](/en/features/headscale-settings#where-the-relay-addresses-come-from).

## 8. STUN: `udp/3478` needs its own port forward

An HTTP reverse proxy **cannot forward UDP**. The STUN port advertised in the DERP map is
`udp/3478`, and clients send packets to `<the server_url hostname>:3478/udp`, so forward it
**separately on the router or firewall**:

```text
udp/3478  →  192.168.1.10:3478/udp        # the machine running Headscale
```

(If the public entry point is the router: public `udp/3478` → that machine's `udp/3478`.)

For the relay to work over **IPv6** as well, check that the listeners are dual stack:

```yaml
listen_addr: "::" # or 0.0.0.0 for IPv4 only
derp:
  server:
    stun_listen_addr: "[::]:3478" # or "0.0.0.0:3478" for IPv4 only
```

Otherwise the relay and STUN still listen on IPv4 only, even when the hostname resolves to an IPv6
address.

## 9. Verification and self-checks

```bash
# ① Direct to Headscale: the /derp route exists
#    expect a protocol-upgrade style 4xx (400/426), **not 404**
curl -si http://127.0.0.1:8480/derp | head -3

# ② Through the reverse proxy: the status code should match ①
#    a 404 here while ① is fine means the path is not being forwarded (section 10)
curl -si https://ha.example.com:8443/derp | head -3

# ③ Which ports the machine listens on (-u is required to see udp/3478)
ss -lntup | grep -E '8480|3478'

# ④ Did DERP come up? Search the service log
docker compose logs headscale | grep -iE 'error|derp' | tail
```

Headscale's startup log should show something like `DERP region 999` and `stun server started`.

On a client (any machine already in the tailnet — the **decisive evidence**):

```bash
tailscale debug derp-map | grep -A 12 -i headscale   # the region is being handed out
tailscale debug derp headscale                       # it is actually reachable
tailscale netcheck                                   # STUN must not be "unavailable"
```

Tick each item:

- [ ] the system self-check shows **embedded relay** as green; an empty IPv6 field with no public IPv6 is normal
- [ ] `curl -si http://127.0.0.1:8480/derp` answers 426-style, **not 404**
- [ ] `/derp` through the reverse proxy matches the direct answer and the certificate is valid
- [ ] `tailscale debug derp-map` on a client shows your region, with `hostname:port` matching `server_url`
- [ ] `tailscale debug derp <region code>` connects
- [ ] the DERP page's target file path matches `derp.paths`, the file exists and is readable, and the row is not "cannot check"
- [ ] saving a map once produces a `DERP map file: …` entry under `/settings/snapshots`
- [ ] `tailscale netcheck` on a client reports STUN as available, and `ss -lntup | grep 3478` shows output

## 10. Common problems

### The embedded DERP region is never used

**Symptom**: the region appears in the client's map, but no machine relays through it.

**Cause**: a port, a firewall rule or the certificate is not right.

**Fix**: work through them in order — is `server_url` `https`; can clients reach the port
`server_url` names (the port you wrote, or 443 if you wrote none); is `udp/3478` blocked by a
firewall; does the reverse proxy forward `/derp` and allow Upgrade. Confirm the region is being
handed out with `tailscale debug derp-map` first, then walk sections 2, 3 and 8.

### A client shows "IPv6: No", or the relay cannot resolve an IPv6 address

**Symptom**: a machine's detail page shows "client connectivity → IPv6: No", or the relay card's
IPv6 field stays empty.

**Cause**: these are **two different things**.

- That machine detail value comes from the machine's **own** Tailscale connectivity self-test
  (`WorkingIPv6`): whether that machine's network can use IPv6, **nothing to do with Headscale**, and
  no Headscale-side change moves it. Fix it on that machine's network: does the ISP/router hand out
  an IPv6 prefix (PD), is the ONT in bridge mode, is IPv6 enabled on the interface (`ip -6 addr`
  shows a global address), does the firewall/security group allow IPv6. If the network is IPv4-only,
  "No" is entirely normal — the `fd7a:…` addresses Tailscale hands out inside the tailnet keep
  working.
- An empty IPv6 field in the relay card means the host has no public IPv6 **and** the `server_url`
  hostname has no AAAA record. With neither, clients cannot reach your relay over IPv6 at all — not
  "slow", simply unusable.

**Fix**: **check both sides**:

```bash
dig +short AAAA ha.example.com            # local resolver: no output = it believes there is no AAAA
dig @1.1.1.1 +short AAAA ha.example.com   # public resolver: output = the record does exist
```

A local resolver may return nothing even when the name really has an AAAA record (it does not answer
AAAA queries, its upstream forwards A only, or DNS filtering). If the public resolver finds it and the
local one does not, the problem is DNS, not Headscale: change the host's or router's DNS, or set the
resolver used for relay lookups in the panel (empty = follow the host) and click "re-resolve", so you
do not have to touch the host's DNS (that setting is used for relay lookups only and affects nothing
else).

Then pick one of the two:

- **You want IPv6**: add an AAAA record for that hostname pointing at the machine running
  Headscale/the relay (i.e. the reverse proxy's upstream); it must match **the host's own global IPv6
  address** (a mismatch turns the DERP page's warning yellow), because covering for an address
  elsewhere is pointless. Also confirm `listen_addr` and `derp.server.stun_listen_addr` are dual
  stack (section 8).
- **IPv4 only**: accept IPv4-only and clear `derp.server.ipv6`; the notice stops appearing.

Additionally: the "embedded relay IPv4 / IPv6" checks under **Settings → System** reach the same
verdict, and an alert for `derp.server.ipv4` usually means the machine's address changed and a stale
one is declared.

### Saving a local DERP map reports "cannot see that path / cannot write"

**Cause**: only `config.yaml` was mounted, not the directory `derp.paths` points at; or the mount
point in the container was set to a **container-only path** such as `/etc/headscale/derp-maps`; or
the directory was mounted read-only. The root cause is that `derp.paths` is read by **Headscale on
the host**, so it must hold host paths.

**Fix**: mount **the host directory** read-write at **the same absolute path**, and write that
**host path** into `derp.paths`:

```yaml
# compose: host directory : the same absolute path inside the container
volumes:
  - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"
```

```yaml
# headscale configuration: the path is identical to the host's
derp:
  paths:
    - /vol1/@appdata/headscale/derp-maps/home.yaml
```

After rebuilding the container (`docker compose up -d`) that row in the DERP page turns from "cannot
check" into a real check result. Mind the permissions on the host: the file must be readable and
writable by both the user running headscale and the container. The dual-image deployment mounts the
whole data directory at the same absolute path, so it has no such mismatch.

### `getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory`

**Symptom**: Headscale fails to start or reload and exits (HeadplaneCN is separate, so the panel
container is unaffected):

```text
Error: headscale ran into an error and had to shut down:
getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory
```

**Cause**: `derp.paths` holds a **container-only path** (such as
`/etc/headscale/derp-maps/derp.yaml`), or the file simply does not exist on the host. This list is
read by **Headscale on the host**, and paths that exist only in the container mean nothing to it.

**Fix (get it running first, then redo it)** — either of:

1. **Comment that `paths:` entry out** so Headscale starts. Edit
   `/vol1/@appdata/headscale/config.yaml`:

   ```yaml
   derp:
     # paths:
     #   - /etc/headscale/derp-maps/derp.yaml
   ```

   You can also remove the path in the panel's DERP card, which writes the same configuration back;
   restart headscale afterwards.

2. **Roll back to the configuration snapshot taken before the write**: HeadplaneCN snapshots
   Headscale's configuration before every write. Pick the entry from before the write under
   `/settings/snapshots`, restore it, and restart headscale.

Then redo section 3, in this order: **create the directory and file on the host → mount it
read-write at the same absolute path → write the host path into `derp.paths` → reload/restart**. The
paths in the list must be absolute paths that really exist on the host.

In the dual-image shape two more causes are common: `derp.paths` and the panel card's path
**disagree** (they must be the same file), or the mount did not take effect (the compose file is
missing `"${BASE_DIR}/headscale:${BASE_DIR}/headscale"`, or the path is wrong). Confirm with:

```bash
docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
```

### The official region filter reports "cannot read /vol1/@appdata/headscale/derp-maps/..."

**Cause**: the panel's data file still stores the old native path, and in the dual-image shape the
container **does not mount** `/vol1/@appdata`.

**Fix**: change it to the new path as described in section 4 (in the card, or by editing
`data/derp-region-mirror.json` and restarting the panel).

### `/derp` behaves wrongly through the reverse proxy

| Symptom                                                              | Cause                                                                         | Fix                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/derp` through the proxy returns 404 while a direct request is fine | only whitelisted paths (`/api`, `/ts2021`, …) are forwarded                   | leave the match empty or use `/*`, do not list specific paths                            |
| the `/derp` path is rewritten or stripped                            | "URL replace / prefix rewrite" is enabled                                     | disable path rewriting                                                                   |
| DERP fails intermittently, latency is high                           | the proxy buffers, or timeouts are too short, killing the upgraded connection | disable buffering and use timeouts of 300 seconds or more                                |
| the address/port in the client map is wrong                          | `server_url` disagrees with the real external port                            | write `server_url` as the full address with the port, e.g. `https://ha.example.com:8443` |
| STUN never works                                                     | `udp/3478` was never forwarded separately                                     | do the UDP port forward (section 8)                                                      |
| the embedded region is in the map but unused                         | a port, firewall rule or certificate is not right                             | work through section 9; keep the public DERP map as a fallback if needed                 |

The one-line rule: **the hostname in `server_url` has to be able to accept `/derp`** — this
reverse-proxy route is a **transparent pipe**: no path rewriting, no buffering, long connections
allowed. You may point a second hostname such as `derp.example.com` at the same container and the
same `127.0.0.1:8480` as another entrance, but clients use `server_url`, so a second entrance is
only a spare
([Settings → DERP → Behind a reverse proxy](/en/features/headscale-settings#behind-a-reverse-proxy)).

## 11. Quick reference

```bash
# ---- on the host (native mode: Headscale is a host process) ----
CFG=/vol1/@appdata/headscale/config.yaml
ls -l /vol1/@appdata/headscale/derp-maps/
ss -lntup | grep -E '8480|3478'        # -u is required to see the embedded DERP's udp/3478
ip -6 addr show scope global          # does the host have public IPv6?
dig +short AAAA ha.example.com        # what the local resolver sees
dig @1.1.1.1 +short AAAA ha.example.com

# ---- dual-image mode: inspect the same file inside the headscale container ----
docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
docker compose logs headscale | grep -iE 'error|derp' | tail

# ---- proxy and route self-checks ----
curl -si http://127.0.0.1:8480/derp | head -3          # expect 400/426, not 404
curl -si https://ha.example.com:8443/derp | head -3    # should match the line above

# ---- on a client ----
tailscale debug derp-map | grep -A 12 -i headscale
tailscale debug derp headscale
tailscale netcheck
```

After editing Headscale's configuration, remember to **reload or restart** (the buttons under the
panel's **Settings → System**, or restart headscale in the fnOS app centre) — otherwise changes to
the map files do not take effect.
