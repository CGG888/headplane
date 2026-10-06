---
title: System Status
description: Headscale version, update hints, diagnostics, metrics and a reload/restart button.
outline: [2, 3]
---

# System Status

**Settings → System** answers the questions that otherwise mean SSHing into the
Headscale host: is it healthy, which version is it, is anything misconfigured,
and can it be restarted from here?

The [Overview](/en/features/overview) page carries the at-a-glance version of this:
the diagnostics and configuration checks as pass/warning/fail tallies, next to
versions, the embedded DERP region and the tailnet counts. Open this page for the
individual checks, the metrics panel and the reload/restart control.

## Version and updates

The card shows the running Headscale version and, when it can tell, whether a
newer release exists. The update hint is looked up from GitHub with a short
timeout and cached for a few hours; on an offline or restricted network the
lookup simply yields nothing and no badge is shown, so the page never depends on
internet access.

HeadplaneCN runs the same comparison for **itself**, against the latest HeadplaneCN
release on GitHub and with the same timeout and cache. The notice appears above
the page only when the version this build reports — stamped in at build time —
is strictly older, and it links to the release. A failed lookup, an untagged
development build and a build that already reports that version or a newer one
all stay silent, so a custom build is not nagged about an upstream release.

## Diagnostics

Each row is a check with a pass / warning / failure state, an explanation, and
where it helps a link to the page that fixes it:

| Check                     | Why it matters                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Headscale reachable       | `GET /health` — if this fails, nothing else on the page is meaningful.                                                       |
| API key valid             | HeadplaneCN's `headscale.api_key` must still work; an expired key breaks every page.                                           |
| Version new enough        | The HeadplaneCN Agent and browser SSH need Headscale 0.28+; newer releases fix real bugs, 0.29.2 is the recommended baseline.  |
| Policy mode               | With `policy.mode: file` the Access Control editor cannot save through the API; `database` lets it.                          |
| OIDC configured           | Browser SSH requires users to sign in through OIDC, so it needs a working OIDC block.                                        |
| Trusted proxies           | Behind a reverse proxy, Headscale only sees the real client address when the proxy's network is listed in `trusted_proxies`. |
| Headscale config readable | The DNS and Headscale settings pages can only read (or write) when `headscale.config_path` is mounted.                       |
| Integration enabled       | Without an integration HeadplaneCN cannot reload or restart Headscale for you.                                                 |

## Configuration checks

The page also reads Headscale's configuration file itself and reports the
problems that otherwise only show up as a server that will not start or a
setting that quietly does nothing:

::: tip Paths a container cannot see
HeadplaneCN can only inspect the paths it can actually reach. When it is given
Headscale's `config.yaml` but not the directories that file points at, a path
like `/vol1/@appdata/headscale/db.sqlite` does not exist _inside the container_
even though it is perfectly healthy on the host. Those checks are reported as
**unverifiable** — with the path and a hint to mount the directory — instead of
being called failures. Mount the directory read-only into the container to turn
them into real checks.
:::

| Check                | Why it matters                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Removed keys         | `oidc.expiry`, `oidc.strip_email_domain` and `oidc.map_legacy_users` are gone in 0.29 and Headscale **refuses to start** while they are present.                         |
| Trusted proxy ranges | `0.0.0.0/0` and `::/0` are configuration errors.                                                                                                                         |
| TLS and ACME         | A configured certificate or Let's Encrypt hostname whose files do not exist cannot be served; `server_url` over `http` alongside TLS configuration is usually a mistake. |
| Database             | A missing or read-only SQLite directory stops Headscale from writing anything.                                                                                           |
| Policy file          | With `policy.mode: file`, an empty `policy.path` means _allow everything_.                                                                                               |
| DNS records          | Both `dns.extra_records` and `dns.extra_records_path` set means the inline records are silently ignored.                                                                 |
| OIDC coherence       | An issuer without a client ID, an unknown PKCE method, or a secret and a secret file at the same time.                                                                   |
| Noise key            | A configured `noise.private_key_path` that is not there (Headscale generates it on first start).                                                                         |
| Local DERP map files | Every entry in `derp.paths` gets its own rows — the file exists, is readable, is writable, is inside the size cap, parses as YAML, validates as a DERP map, and keeps its region ids and codes unique. A path this container cannot see is **unverifiable**. |

The local-map rows are the same checks the DERP card shows next to each path in
[Settings → Headscale → DERP](/en/features/headscale-settings#editing-local-derp-map-files);
here they are part of the one list you can read top to bottom, and each row names
the file it inspected.

A check that turns into a failure can also be pushed to a webhook instead of
waiting to be read here; see [Alert Notifications](/en/features/notifications).

## Metrics

The **Metrics** tab reads Headscale's Prometheus endpoint for you. Everything on
it is read-only — nothing is written back to Headscale — and it fails softly:
when it cannot show numbers it explains why instead of breaking the page.

The address comes from Headscale's own `metrics_listen_addr`. A missing or empty
value means the listener is off, and the tab says exactly that; a value that is
not `host:port` is reported as unparseable. When HeadplaneCN cannot read the
configuration file at all it says it cannot tell where the listener is, rather
than claiming the listener is disabled. Headscale often binds the listener to
`0.0.0.0` or `[::]`, which cannot be dialled as written — in that case HeadplaneCN
uses the host of your configured Headscale URL. It then fetches
`http://<address>/metrics` server-side with a short timeout, so the listener has
to be reachable from HeadplaneCN itself, not just from the machine running
Headscale.

On success the tab shows:

| Shown                                                              | Source                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uptime                                                             | `process_start_time_seconds` against the current time.                                                                                                        |
| Goroutines                                                         | `go_goroutines`.                                                                                                                                              |
| Nodes, Users, DERP and relays, Policy and Process (one group each) | The metric families whose names match that group, each summed across the samples it was reported with; the series count is shown when there is more than one. |

Everything else is still available under **Raw metrics**, which shows the
exposition text exactly as HeadplaneCN received it.

A refused connection, a timeout, a non-200 answer or a body with no parsable
samples all end as the same warning notice, which names the endpoint HeadplaneCN
tried and the address it derived — most often because the listener binds loopback
and HeadplaneCN runs in another container.

::: info What the panel leaves out

Histograms and summaries are dropped — their `_bucket`, `_sum` and `_count`
series are not numbers anyone reads off a status page without a query language.
Each group also keeps at most 12 families, so a busy endpoint cannot turn the tab
into a wall of numbers, and the raw view keeps the first 16,000 characters and
says so when the response was longer.

:::

## Reloading or restarting Headscale

The button follows whatever integration is configured:

| Integration                          | What the button does                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `integration.proc` (native installs) | Sends **SIGHUP** to the `headscale serve` process — Headscale reloads its configuration without dropping connections. |
| `integration.docker`                 | Restarts the Headscale container.                                                                                     |
| `integration.kubernetes`             | Restarts the Headscale pod.                                                                                           |

With no integration enabled the button is disabled and the page says so; restart
Headscale however your service manager does it.

::: tip Native installs and reloads
A SIGHUP reload happens in place, so it is the safe choice after changing DNS,
OIDC or `trusted_proxies`. Changes that swap the database or the policy mode are
worth a full restart instead, which the native integration cannot do for you.
:::
