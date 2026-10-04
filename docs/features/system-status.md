---
title: System Status
description: Headscale version, update hints, diagnostics and a reload/restart button.
outline: [2, 3]
---

# System Status

**Settings → System** answers the questions that otherwise mean SSHing into the
Headscale host: is it healthy, which version is it, is anything misconfigured,
and can it be restarted from here?

## Version and updates

The card shows the running Headscale version and, when it can tell, whether a
newer release exists. The update hint is looked up from GitHub with a short
timeout and cached for a few hours; on an offline or restricted network the
lookup simply yields nothing and no badge is shown, so the page never depends on
internet access.

## Diagnostics

Each row is a check with a pass / warning / failure state, an explanation, and
where it helps a link to the page that fixes it:

| Check                     | Why it matters                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Headscale reachable       | `GET /health` — if this fails, nothing else on the page is meaningful.                                                       |
| API key valid             | Headplane's `headscale.api_key` must still work; an expired key breaks every page.                                           |
| Version new enough        | The Headplane Agent and browser SSH need Headscale 0.28+; newer releases fix real bugs, 0.29.2 is the recommended baseline.  |
| Policy mode               | With `policy.mode: file` the Access Control editor cannot save through the API; `database` lets it.                          |
| OIDC configured           | Browser SSH requires users to sign in through OIDC, so it needs a working OIDC block.                                        |
| Trusted proxies           | Behind a reverse proxy, Headscale only sees the real client address when the proxy's network is listed in `trusted_proxies`. |
| Headscale config readable | The DNS and Headscale settings pages can only read (or write) when `headscale.config_path` is mounted.                       |
| Integration enabled       | Without an integration Headplane cannot reload or restart Headscale for you.                                                 |

## Configuration checks

The page also reads Headscale's configuration file itself and reports the
problems that otherwise only show up as a server that will not start or a
setting that quietly does nothing:

::: tip Paths a container cannot see
Headplane can only inspect the paths it can actually reach. When it is given
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
