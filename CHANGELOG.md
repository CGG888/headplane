# Next

## Fixes

- **Several places that trusted upstream data now check it instead.** A Headscale response that is missing its node or API-key array, a remote DERP map cache that could grow without bound, a DERP map file swapped between its size check and its read, and a configured DNS records path that is actually a directory are now reported and refused instead of silently treated as empty or read anyway. A misconfigured `dns.extra_records_path` reports a normal error instead of terminating the process from inside a library function.
- **Long-running services stop leaking and stop writing after shutdown.** Alert cooldown state is pruned instead of growing forever, the audit log cannot be asked for an unbounded number of rows, stored latency readings expire after a week, a DERP "check" no longer records the run it only inspected, and a disposed mirror or sync service abandons the run it was in the middle of instead of persisting it.
- **The console login's OIDC path is stricter.** The `info` endpoint's secret is compared in constant time, a UserInfo response whose subject disagrees with the ID token is ignored instead of trusted, the self-test judges `client_secret_jwt` by the value the runtime actually uses, and the login page no longer treats a missing error state or an unparseable session expiration as valid.
- **Smaller corrections.** An API key whose expiration cannot be parsed is treated as expired; the policy editor's comment and trailing-comma stripping no longer corrupts content inside strings; the audit log's "Load more" appends the next page instead of replacing the rows on screen; a machine rename submits the name it validated; bulk machine actions say which machines failed and why; the key-expiry toggle distinguishes "disabled" from "restored" and the uptime history counts the last sample in its window; the notification settings no longer send the stored webhook secret to the browser; and the install script writes its migration backup mode 600, no longer probes the base directory before the plan is confirmed, and can bind the admin UI to `127.0.0.1` with `--admin-bind`.

# 0.22.19 (October 6, 2026)

## Changes

- **The console's own OIDC login can now be configured in the web UI.** Settings → Console login gained a form above its self-test covering the issuer, client id and secret, scopes, PKCE, default role, end-session logout and the allow-lists/pinning that matter for signing in. Every field shows where its current value comes from — an environment variable, what was saved here, the configuration file, or the schema default — and a field pinned by an environment variable is shown read-only with the variable named, because the environment always wins: environment variable, then what was saved here, then the configuration file. Edits are stored in the application's own data directory rather than written into the configuration file, which is frequently mounted read-only; the file is only ever read.
- **The secret stays secret and the form cannot lock you out.** The client secret is never rendered back — the form shows that one is set, lets you replace it or clear it deliberately, and leaves it untouched when you submit the field empty — and it never reaches the audit log, an error message, a URL or a log line. Values are validated against the schema before saving (an enabled configuration needs an absolute HTTPS issuer, a client id, scopes and a secret from some layer), and a change that could leave nobody able to sign in asks for confirmation first, spelling out what will happen and what would still work; it refuses only when there would genuinely be no way in. Every change is audited by field name, including refused ones.
- **You can see whether a restart is still pending.** The page compares the running configuration against what is stored and shows a banner naming the fields that differ, since the configuration is read at start-up, and the self-test now evaluates the merged configuration so a saved edit is checked before you restart.

---

# 0.22.18 (October 6, 2026)

## Changes

- **Signing out can now sign you out of the identity provider as well.** With `oidc.logout_idp: true` (the older `oidc.use_end_session` still works), logging out of the console clears the local session as before and then sends the browser to the provider's end-session endpoint, so the next "sign in with OIDC" really asks for credentials instead of silently signing you back in from the provider's still-live session. `oidc.end_session_endpoint` overrides the endpoint discovered from the issuer and `oidc.post_logout_redirect_uri` sets where the provider returns you. Everything about the attempt is fail-soft: a missing endpoint, a non-HTTPS or malformed URL, a slow or erroring provider, or no stored ID token all end on the login page with the local session already cleared. The default is off, so nothing changes for an existing deployment.
- **A self-test for the console's own OIDC login** (Settings → Console login). It fetches the discovery document and reports, item by item and with the value it saw: whether the issuer is reachable and its HTTP status, whether the document's `iss` matches the configured issuer character for character, whether every configured scope is advertised — with a pointed warning that providers such as Logto require `profile` and `email` to be granted to the application before they may be requested, which is what usually causes `invalid_scope` — whether the runtime can actually verify the advertised ID-token signing algorithm (it performs a real signing probe rather than trusting the list, so an ES384-only provider is answered definitively), whether an end-session endpoint exists for the logout behaviour above, which token-endpoint authentication methods the provider offers, and a reminder that the configuration is read at start-up so a change needs a restart. It runs server-side and never exposes the client secret.

---

# 0.22.17 (October 6, 2026)

## Changes

- **Nodes with a missing address can be fixed from the machines list.** A "fix missing IPs" button (offered to operators who may change machines) asks for confirmation and then reports how many nodes were given an address, or that nothing was missing. The confirmation says what Headscale actually does: it fills the gaps and never rewrites, moves or reassigns an address that already exists — and it also clears the addresses of an address family whose prefix was removed from the configuration, which is why the run has to be confirmed explicitly (Headscale refuses to run without that confirmation).
- **A debug node can be created from the machine page.** In the danger zone, a dialog takes the optional user, registration key, name and routes (routes validated as CIDRs before submitting) and says plainly that this really creates a node on the tailnet, that the node exists until it is deleted and should be removed from the machines list once debugging is done, and that any field left empty is filled in by Headscale itself. On success it names the created node and links to the machines list where it can be deleted.

---

# 0.22.16 (October 6, 2026)

## Changes

- **A pending registration can now be rejected instead of only approved.** The machines list's registration menu gained a separate, destructive "reject registration" item with a confirmation that spells out what happens: the device will not join the tailnet, its pending request disappears, and it stays unregistered until someone registers it again. It takes the registration key (never a node id), so it cannot be confused with approving a device or deleting an existing machine, and it is only offered on a Headscale version that supports it.
- **Keys can be deleted, not only expired.** Both the pre-auth key list and the API key list now offer a delete beside the existing expire, behind a confirmation that says the record is removed permanently and cannot be recovered — and that a key which should merely stop working can be expired instead, which revokes it immediately and keeps the record. Deleting a key never exposes or logs the secret; the audit log records who deleted what.
- **The diagnostics card on a machine now shows data that actually exists.** It summarises what the page already knows about the machine — the agent-reported version, operating system, hostname and end-points, the network facts (NAT behaviour, hair-pinning, IPv4/IPv6 and UDP reachability, UPnP/PCP/NAT-PMP, the preferred and home relay region), the per-region latency table with its sources, and the relay regions this deployment serves — as humanised grouped rows, with addresses hidden by default and identifiers copyable, bounded so a large payload cannot take over the card, and saying plainly when something has not been reported. It reads nothing extra: no new request, no per-node debug endpoint (that one does not exist — the HTTP API's debug endpoint creates a node).

## Fixes

- **The latency list on a machine now aligns.** The region id and its name are separate columns instead of running together, the relay source and the measurement source each sit in their own fixed column as a coloured badge, the number stays right-aligned, and "not measured" reads as such with a dash rather than a blank — with the five-row bound, the coverage summary and the in-use badge unchanged.
- The audit page labels the new actions (rejecting a registration, deleting a pre-auth key, deleting an API key) instead of printing their raw codes.

---

# 0.22.15 (October 6, 2026)

## Changes

- **Webhook messages can be sent in the shape your chat platform expects.** Choose DingTalk, WeCom, Feishu, Slack or Discord on the notifications page and the alert arrives as that platform's own message: a coloured card or embed with an icon for the severity, the human title, the sentence explaining what happened, the specifics on labelled lines, the time in your local timezone and the version, plus a link to the page where you can act on it. The generic JSON format is unchanged down to the byte for anything already consuming it, the notification language setting applies to the formatted body too, and the event ids, severity mapping, dedupe, cooldown, history and request shape are all untouched.
- **The machine detail page's latency list shows five regions and scrolls for the rest**, with the header and the coverage summary staying visible above it and no scrollbar at all when five or fewer regions have been measured.

---

# 0.22.14 (October 6, 2026)

## Changes

- **Alert notifications now speak your language and in plain words.** Every alert's title and body come from the interface catalogues instead of being fixed English, so the alert list and the delivery history re-render in whichever language you are using — switch the interface to English and the same alert reads in English. The webhook has its own **notification language** setting (follow the site default, Simplified Chinese, Traditional Chinese or English) so the message that arrives in WeChat, DingTalk or Feishu is in the language you want, while the structured fields stay exactly as they were for anything automating on them. The wording was rewritten to be readable in one pass: what happened, which node, key or check it concerns, what to do about it, and what happens next — for example a node offline notice says the device can no longer receive traffic or policies, suggests checking that it is powered on and running its client, and promises a notice when it reconnects.
- **A complete interactive installer for the two-container deployment** (`scripts/dual-image-install.sh`, documented on the dual-image page). It asks for the image tags, the client-facing URL, optional DERP and admin hostnames and ports, host or bridge networking, the STUN port, the timezone, the API key, a cookie secret and **every directory** (base, Headplane config and data, Headscale config and data, DERP maps) and writes a compose file whose volume mounts are derived from those answers, with both containers sharing the same host paths. It runs a full **dry run** that prints every file, copy and command and changes nothing, backs everything up before migrating an existing installation (copying, never moving or deleting), writes atomically, keeps secrets at mode 600 and masked, patches an existing Headscale config key by key with a `.bak` and a change summary, and finishes with the commands to start, upgrade and roll back.

## Fixes

- **The automations that only served the upstream community are gone**, so nothing runs on a schedule any more: the dependency-bot workflow, the stale-issue closer, the triage and milestone helpers, the PR labeller, the manual agent workflow and the superseded docs build. The build, the release (images and GitHub Release) and the documentation deploy are untouched and still run on the same triggers.

---

# 0.22.13 (October 6, 2026)

## Fixes

- **A settings card carrying an error now opens itself, everywhere.** The earlier pass made every settings card start closed and open on error, but the Headscale cards were missed: a failed save, run, probe or reload, an invalid value, a paste or source error, or a map file the checks mark as failing now expands the card that holds it — and so do the forms inside those cards (trusted proxies, OIDC, policy mode, region names and the map-file rows), which previously rendered their errors inside a card that stayed shut. The sync card also shows the failure of its Check and Run buttons now instead of swallowing it, and opens when either fails. Cards that cannot fail were left alone and a healthy card still stays closed.
- **The settings destination pages and the DNS page fill the page like the rest of the interface.** They were still capped at a narrower container than the hub, the Overview and the machines list, which left their right edge short of the header's controls by up to 448px on a wide screen; the shared cap is gone, so every settings page and the DNS page use the same content width, and both areas were tidied to use it — field rows in two columns so labels stop drifting, filters in their own card, the audit and notification lists on proper grids, readable line lengths instead of full-width paragraphs, and on the DNS page a card shell with the tailnet name beside MagicDNS, the nameservers grouped global-first, and the records laid out as a type/name/value/remove grid. Address masking and its reveal badges are untouched.

---

# 0.22.12 (October 6, 2026)

## Changes

- **The region filter can get its map from several places now.** Give it an ordered list of source URLs and it tries them in turn, use your own mirror or proxy of the official map, or paste the map JSON by hand when the official endpoint is unreachable — a pasted map goes through exactly the same normalisation, filtering, renumbering, validation, snapshot and write path as a fetched one, and stays in use until you clear it. When nothing works the card lists **which source failed and why**, and the previous file is kept rather than replaced.
- **A complete dual-image deployment guide** now exists in both languages (`/install/dual-image` and `/en/install/dual-image`): why to run Headscale and HeadplaneCN as two containers — the host-path/identical-path rule for `derp.paths` disappears, the two restart independently, upgrades stay one command — the copy-pasteable compose file, the configuration deltas on both sides, the migration steps from a native install, upgrade and rollback with the mandatory pre-upgrade backup, the reverse-proxy requirements (HTTP/2 and no buffering for client traffic, the upgrade path preserved for DERP, STUN over UDP opened directly), a verification checklist and the troubleshooting for the failure mode already seen in practice.

## Fixes

- **The Overview and the settings hub use the same content width as the machines list**, so their right-hand edge lines up with the header controls instead of stopping far short of them — the pages are no longer capped at a narrower container than the rest of the interface.
- **The Overview's cards are laid out by size.** Four per row was squeezing them into clipped values; the grid now takes as many columns as fit their content, cards in a row share a height, values that used to ellipsize are shown in full, and the paddings that the narrower layout had forced are back to comfortable values.

---

# 0.22.11 (October 6, 2026)

## Changes

- **Addresses are hidden by default and revealed on demand.** IP addresses, IPv6 addresses and hostnames in the interface render as a mask until you reveal them — per value with the eye badge beside it, or all at once from the address-visibility menu on the Overview, machines list and machine detail pages. The preference is per user and remembered in the browser; copying still copies the real value, tooltips do not leak it while hidden, and inputs, key material, ports shown alone and the audit log are left alone.
- **The machines list shows the relay each machine is actually using**, as `#id · 中文名` between the status and last-seen columns, resolved through the same chain the machine page uses, with a muted "not reported" when a machine has not reported one. The column has a fixed width and truncates with a tooltip, so the existing columns, row heights and narrow-viewport behaviour are unchanged.
- **Setting the region filter up now wires itself in.** Saving it as enabled adds its map file to `derp.paths` when it is missing — idempotently, without touching other entries — after a snapshot and with an audit entry, and the card reflects the new state at once. Disabling the filter does not remove the entry, a read-only configuration skips the step with the reason shown, and the hover hint names the expected path beside what `derp.paths` currently lists.
- **The machine detail page was reworked.** The client-connectivity card lists its seven facts two per row and is about 45% shorter, sharing its height with the ACL tags card whatever either holds. The DERP relay card spans the full row, its facts sit in an aligned two-column layout, and "latency by region" now covers **every region this deployment serves** — measured here, reported by a machine, or an honest "not measured" — with the source labelled per row, server-side measurements translated onto the mirrored numbering, and a summary of the coverage.
- **Both the settings hub and the Overview now lay their cards out four per row**, and the Overview's cards no longer carry the section labels above them — the cards read as one grid. The "manage cards" panel still lists every card, hidden cards stay hidden, and a card that is alerting still stays visible.

---

# 0.22.10 (October 6, 2026)

## Fixes

- **The latency test no longer fails with a 502 through a reverse proxy.** The probe now runs in the background of the region-mirror service instead of inside the request: the button answers immediately, the card follows the run with a light status poll that stops as soon as it finishes, the run has a 25-second budget that keeps whatever it measured, Stop cancels it, and results are merged over earlier runs so the numbering still prefers what this server measured. Every request made while a run is in progress is an in-memory read, so no proxy timeout can be hit again.
- **The region filter's helper row lines up.** The latency threshold field had its label rendered twice (a visible span plus a hidden field label) and the help text under one field pushed the neighbouring controls out of line; there is now exactly one associated label, the sort control and the threshold field share one height and baseline, the input has a fixed width, and the explanation sits under the row.
- **The console's help points at this fork's documentation.** The header's question-mark badge and every documentation helper link under `/headplaneCN/`, the badge now has an accessible name for screen readers, and no interface string or link still sends anyone to the upstream site.

---

# 0.22.9 (October 6, 2026)

## Changes

- **Every settings card starts closed now**, so opening a settings tab shows you what is available instead of a wall of open panels. A card opens itself only when it is carrying an error or a failed action, and collapsing is local state, so nothing reloads or refetches as you open and close cards.
- **The DERP node card stays in line with its neighbours and reads the filtered map before it is in use.** Its source rows scroll inside a bounded box, an expanded node list scrolls instead of stretching the card, the official-filter row reads the mirror file directly and counts its nodes even while that file is not yet listed in `derp.paths` (marked as not served here, still counted in the total, never counted twice), and the long explanations became hover hints.
- **The health summary can be hidden** like the other Overview cards. Cards that are themselves an alert stay visible, and a failing health check still reaches you through alert notifications.
- **Official regions can be tested from this server.** A button in the region filter probes each node with a STUN request over UDP and a TLS fallback, for each address family, cached, cancellable and limited so a page load never probes anything; the numbering order now prefers what was measured here over what machines reported, and every row says which of the two a number came from.
- **Official regions all have Chinese names** — including São Paulo, Dubai, Honolulu, Nairobi and Nuremberg — and the region list scrolls inside a bounded area with a sticky header, so a long list can neither stretch nor clip the card.

---

# 0.22.8 (October 6, 2026)

## Changes

- **This fork is now called HeadplaneCN.** The name changed everywhere a person reads it — the interface, the page titles, the documentation site and the package name — while everything a machine reads stayed exactly as it was: environment variables, `/etc/headplane`, `/var/lib/headplane`, container and image names, the API header, and the credit to the upstream project, which is still named and linked in the footer and the README.
- **The documentation site is Chinese-first now and readable in both languages.** Simplified Chinese serves the site root, English lives under `/en/`, and the two trees are page-for-page equal: the same 34 pages, the same sidebar in the same order, and paired headings so the language switch keeps you in the same place. The site is published by GitHub Pages, the documentation links and image references point at this repository and its own registry, and there is a **sponsor page** with WeChat and Alipay QR codes.
- **The official region filter is usable end to end.** You can clear the selection or restore the default (Hong Kong 901 and Singapore 902), the latency column explains itself when there is nothing to measure — either the agent is not reporting, with a link to its settings, or nothing has been measured yet — and one button adds the mirrored regions and their Chinese names to the manual region-name mapping, adding only what is missing, after a snapshot and with an audit entry.
- **The Overview DERP card shows every node source at once**: embedded, local map files, the official mirror and the official upstream map, each with its node count, expandable to the node names, with the upstream rows marked as not served here. Cards on the Overview page can be **hidden per user**, and any card that is carrying a warning stays visible no matter what.
- **The machine detail relay card shows addresses instead of prose**: the IPv4 and IPv6 values with copy buttons, the currently used relay marked as in use with a badge, and a badge per row saying which source serves it. The IPv6-versus-DNS explanation and the resolver line with its re-resolve button are gone from this card; the settings page still owns the resolver.

## Fixes

- Alert notifications use the new name, and their tests now assert that no payload still says the old brand alone.
- Latency rows keep their measured order but no longer leave the column silently blank, and a stored region assignment that no longer matches the selected regions is pruned instead of being kept.
- The documentation no longer links the site to the upstream registry image; install pages use this repository image.

---

# 0.22.7 (October 6, 2026)

## Fixes

- **The official Tailscale map can be read again, and the region filter knows where it lives.** The official map is served in Tailscale's wire format (`Regions` and PascalCase fields), but the remote reader was reusing the local-map reader, which only understands Headscale's lowercase shape — so it parsed to zero regions and the feature appeared to read nothing (a `curl` from the operator's host returned the JSON in under a second, which is what pointed at parsing rather than the network). One reader now accepts **both** shapes and normalises them into the same internal structure, so the local-map editor, the region-name chain and the mirror all keep working unchanged, and the remote fetch got a longer deadline (10 s) with a single retry before giving up.

## Changes

- **The official region filter moved into the DERP tab.** It is no longer a separate tab: it is a card titled **"Official region filter"** (官方区域节点筛选) placed directly under the address auto-sync card, closed by default and summarising how many official regions exist, how many are selected and which file it maintains. Everything it did is unchanged — the region table with Chinese names and measured latency, the sort/filter/"fastest three" helpers, the 900-series renumbering (901 Hong Kong and 902 Singapore fixed, the rest by latency, numbers kept stable), the schedule, the savings of Check/Run now/Re-rank — and when the official map cannot be read at all, the card says so with the reason instead of showing an empty table.

---

# 0.22.6 (October 6, 2026)

## Changes

- **A new "Region mirror" tab that keeps only the official relays you want, and keeps them current.** Tailscale's public DERP relays are the ones listed; the tab mirrors the official map into a **local map file** that Headscale hands to your clients, dropping the regions you do not select and **renumbering them into the 900s** so they cannot collide with the official numbering. **901 is always Hong Kong and 902 always Singapore**; the rest are numbered from 903 **in order of the latency your machines actually measure** (through the agent), unmeasured regions last. Numbers already assigned stay put, so a scheduled refresh never shuffles what clients see — "Re-rank" is an explicit action with a confirmation, because clients may briefly re-select relays. Region names are shown in Chinese (Hong Kong, Singapore, Tokyo …) with the official name kept as a fallback, the table sorts and filters by latency and offers a "fastest three" preset, and the settings give the enable switch, the target file (a dedicated `official-mirror.yaml`, maintained by this task — manual edits are overwritten), the 6/12/24-hour schedule and the auto-reload switch with its client-interruption warning.
- The tab starts by saying what these are: **Tailscale's official public relays, not self-hosted nodes**, mirrored and filtered into your own map file, refreshed automatically because the official addresses change.

## Fixes

- The mirror never writes an unusable map: an empty selection, a relative or escaping path, an unreachable official map, a selection that matches nothing, a schema failure or an unwritable file all keep the previous file and record the reason. A write compares the rendered file first (no change, no write, no reload), takes a single-file snapshot before replacing it, records an audit entry, and only then reloads if the switch allows it. **Check** previews the whole thing and writes nothing.

---

# 0.22.5 (October 6, 2026)

## Changes

- **The relay addresses are configured in one place now.** Everything — the schedule (6/12/24 hours), which families to sync, the auto-reload switch, the **external IPv6 echo** with its URL, and the detection panel listing every candidate with its origin and why it was or was not chosen — lives in **Settings → Headscale → DERP → address auto-sync**. **Check** runs both detections and the comparison and writes nothing; **Run now** writes only the key that changed, after snapshotting the configuration and recording an audit entry. The detected address is authoritative (state it plainly), **auto-reload defaults to on** so clients see a change immediately — with the warning that it briefly interrupts them, and a run that changes nothing never reloads. A failing run raises a notification through the existing alert system (a successful change does not), and the temporary/privacy-address hint lives only here.
- **The Overview relay card is read-only.** It shows the resulting IPv4 and IPv6 with the copy affordance, the STUN row, a one-line last-run status and a link to the settings card, with amber warnings only when something is genuinely wrong. The resolver pill, the re-resolve button, the echo switch, the candidate list and the namespace explanations are gone.

## Fixes

- **"Latency by region" no longer says "unknown".** The agent reports its measurements under keys of the shape `<regionID>-v4` / `<regionID>-v6`, not bare ids, so every row used to fall back to the unknown label; the parser now accepts string, numeric, suffixed and code-like keys, still resolves names through the existing chain, shows the raw key when nothing matches, and collapses a region measured over both families into one row.
- **A host running Docker is recognised as the host again.** `docker0`, `br-*` and `veth*` are always visible in a `network_mode: host` container, so their presence is no longer treated as evidence that the container has its own network namespace — a device-backed NIC carrying a global address is what says "host". The auto-sync accordingly never writes an address whose provenance is not trustworthy: a family is skipped when the namespace is not the host's, unless the external echo (the authority when a router forwards or translates) provided the value.
- The page no longer reloads in a loop when a route chunk is missing during hydration: the client checks the guard before hydrating and shows the localized "your page is out of date" notice with a manual reload instead of letting the router reload again.
- The local DERP map file checks (exists, readable, writable, size, parses, schema, unique region ids and codes) now also appear in the system page's configuration check list.
- The machine detail relay card shows the relay's IPv4 and IPv6 with the same copy affordance, taken from the same configuration values the settings page manages, so the three views always agree.

---

# 0.22.4 (October 6, 2026)

## Fixes

- **The relay's IPv6 detection is honest in every environment now.** Candidates are collected from all readable sources — the interface list, `/proc/net/if_inet6` (which tells a **temporary/privacy** address apart from a stable one) and `/sys/class/net/.../device` (which tells a real NIC from a bridge) — with link-local, ULA, loopback and IPv4-mapped addresses excluded. A stable address is preferred over a privacy address that rotates, the address your domain's AAAA names wins when it matches, and every candidate comes with its origin and the reason it was or was not chosen. When the container's network namespace cannot be confirmed, the candidates are **still shown** (labelled as possibly-the-host, with the reason) instead of disappearing, and a machine with no public IPv6 still says so plainly.
- **Contradictions are surfaced instead of hidden.** A `derp.server.ipv6` that no local interface holds, or a domain AAAA that points at a different machine, now raises an amber note with both values and a copy button for the address that should be used — so a configured value can no longer quietly mask the real one. Picking a temporary address is called out as rotating.
- **An optional external IPv6 echo** (off by default) answers the question that matters when a router forwards or translates IPv6: what address the internet actually sees. It queries well-known echo endpoints over IPv6 only, with short timeouts, caching and fallbacks, and the UI says whether the answer matches a local interface or is a forwarded address no interface holds.

## Changes

- The automatic address sync uses the same selection, so it writes the stable address rather than a rotating privacy address, and it shows which source it used.

---

# 0.22.3 (October 6, 2026)

## Changes

- **The embedded relay's advertised addresses can now keep themselves current.** The addresses are dynamic — IPv4 through DNS because a machine behind NAT cannot know its own public address, IPv6 from the host itself — so a schedule (every 6, 12 or 24 hours, or on demand with "run now") checks them and writes `derp.server.ipv4`/`ipv6` **only when a value actually changed**, patching just the changed key, after taking a configuration snapshot and recording an audit entry. Values that are not public (private ranges, CGNAT, loopback, link-local, ULA) are refused, a detection failure keeps the previous value and says why, and a read-only configuration skips the write with a reason. Reaching clients immediately needs a reload, so there is a default-off switch to trigger the existing reload/restart automatically, with the warning that it briefly interrupts them. Last run, what changed and what was skipped are shown in the card; the setting lives in Headplane's own data directory, so no migration and no config-file key.

## Fixes

- The "Local DERP nodes" box no longer nests: its regions are listed in the collapsed state as `#id · code · name · N nodes · source`, and opening it shows each region's nodes directly — `hostname:derpport`, STUN, a `stunonly` marker, the declared map addresses and the addresses they resolve to — capped per region so the card stays compact. Fail-soft notes stay as single muted lines.
- Every address in that box — the node endpoints, the declared map addresses and the resolved answers — can be copied with one click.

---

# 0.22.2 (October 6, 2026)

## Fixes

- **The relay's IPv6 address now comes from the host, not from DNS.** A domain's AAAA can be a temporary privacy address, a prefix that rotates, or a different machine entirely, so advertising it makes clients fail intermittently. The address block now prefers `derp.server.ipv6` when you declare it, then the **host machine's own global unicast IPv6** (the container sees the host's interfaces under `network_mode: host`), and only then the DNS answer, clearly labelled as unverified. Link-local, ULA, loopback and IPv4-mapped addresses are ignored, an address that matches the DNS answer is preferred for consistency, a mismatch raises an amber note with a copy button for pasting the right address into `derp.server.ipv6`, and if the machine has no public IPv6 the page says so instead of guessing. IPv4 is unchanged — behind NAT only the configuration or DNS can know the public address.

## Changes

- The "Local DERP nodes" box lists its regions while collapsed — `#id · code · name · N nodes · source` (capped, with a "+N more" line) — instead of only a count, keeping the same card geometry as its siblings.
- Documentation: a new "Where the relay addresses come from" passage (and the Chinese equivalent in the fnOS guide) explains the per-family rule, the three source labels, the mismatch warning and the no-public-IPv6 case.

# 0.22.1 (October 6, 2026)

## Fixes

- **Relay regions are named, not "unknown".** The per-region latency rows on a machine used to fall back to an unnamed label whenever the operator had not manually mapped the region, so a healthy client showed rows like "unknown · 39ms". A region's name is now resolved through one chain — your manual mapping first, then the local map files listed in `derp.paths`, then the remote maps from `derp.urls` (fetched with a short timeout and cached in-process), then the embedded region, and finally `#id` — and the same helper labels the home region, the preferred region, the latency rows and the Overview, so the wording cannot drift. Failures anywhere in the chain stay quiet, and manual names still win when you want to rename something.

## Changes

- **The Overview shows what the configured maps actually describe.** A new box lists each region from those maps with its code, name, node count and where it came from, and expanding a region shows its nodes — `hostname:derpport`, whether STUN is offered, a `stunonly` marker, the declared addresses, and the addresses the hostname actually resolves to. A path the container cannot read says so, with the same "mount it at the same absolute path" wording the settings card uses.
- The machine DERP card's description and its "ids only" note were tightened, and the redundant label above the relay endpoint is gone.
- Documentation: the local DERP map section now states that `derp.paths` is read by Headscale — on fnOS the host process — so an entry must be a **host path** with the directory mounted into the container **at the identical absolute path**, that a container-only path is fatal at the next restart, how to recover from `getting DERPMap: open …: no such file or directory` (remove the entry or roll back the pre-write snapshot, then restart), a JSON→YAML conversion table for pasting a region out of Tailscale's map, and the reminder that the official regions arrive through `derp.urls` and need no local copy.

---

# 0.22.0 (October 5, 2026)

## Changes

- **Local DERP map files can be viewed, edited and created from an example in the UI.** Each path under "Local map files" now offers View (with a line gutter), Edit (validated inline as you type), Save, Roll back, and Create from example with three fully commented templates: one region with one node, two regions where one node is STUN-only, and a minimal skeleton. Saving is protected end to end — the path has to be one of the entries already listed in `derp.paths` (resolved on the server, never taken from the request), the file is capped at 256 KiB, the YAML is parsed and validated (a DERP map, unique region ids and codes, each node's region, hostname and ports, addresses), the file and its directory must be writable, a snapshot of that single file is taken first, and the write is a temp file plus rename that keeps the old mode. Every write, including a rollback, snapshots what it replaces, so the previous content is one click away. Headscale reads these files at startup, so the copy says a reload or restart is needed — and that editing requires the map directory (not the whole data directory) mounted read-write.
- The configuration checks cover the same rules per map file: it exists, is readable and writable, its YAML parses, the schema is valid, and region ids and codes are unique — downgrading to "cannot check" when the container cannot see the path.
- Removed the "machines homed in this region" line from the relay card together with its source chip and explanation.

---

# 0.21.11 (October 5, 2026)

## Changes

- **The machines list is a device list now.** Each row leads with a tile for the reported operating system, the online state reads at a glance with a dot and a chip, tags render as uniform chips that collapse into a "+N" with the rest on hover, a key expiring within a month stands out in amber, and IPv4 sits above IPv6 in one aligned block with a copy affordance on hover. The name column stays visible while the table scrolls, row actions appear only on hover or keyboard focus without shifting anything, and on a narrow screen each machine becomes a compact card instead of a cramped table.
- Wording clean-up: the relay statistics are no longer labelled "derived" anywhere — the label now says where the numbers come from (the configuration and what the agent reports).

---

# 0.21.10 (October 5, 2026)

## Changes

- The machines list finished its visual pass: the table header has consistent typography, the sorted column and direction are legible at a glance, the search field and the filters sit on one baseline at the same height, the empty state is centred and roomy, and a refresh never flashes a placeholder over rows that are already there.

---

# 0.21.9 (October 5, 2026)

## Changes

- **The relay address block is shorter and smarter.** It now shows one client connect address (host and port together) with a single IPv4 line and a single IPv6 line, and each family shows the address configured in `derp.server` when you have set one, otherwise the address that was actually resolved for the relay hostname. The explanatory captions, the separate resolved-values section and the rows that only said "not configured" are gone; the verdicts, the resolver pill, the re-resolve button and the relay usage from the agent stay.
- **The machines list got a visual pass.** The name is the clear primary line with the hostname and ID quieter underneath, tags are uniform chips, IPv4 and IPv6 use fixed leading and tabular numerals so the block no longer jitters, and every column shares one row rhythm without unexpected wrapping. Row dividers are lighter, hovering or focusing a row is obvious and keyboard-visible, the checkbox keeps its own focus ring without stealing the row click, the filter controls are all one height matching the search field with a clear active state and an explicit Clear filters button, and the row's SSH shortcut floats instead of stretching the row.

---

# 0.21.8 (October 5, 2026)

## Fixes

- **Fixed the machines page reloading on hover or on a click, introduced in 0.21.2.** The machine detail and the Overview imported the relay lookup — a server module that reaches for Node's DNS and the logger — straight into the browser bundle, so the page's client graph failed to evaluate with `process is not defined`; React Router answers a route module that fails to load by reloading the document, and because every internal link also prefetched its target on hover, merely moving the mouse over a machine name reloaded the page. The relay verdicts are now prepared by the loaders and passed as plain values, only type imports remain on the client, and internal links no longer prefetch on hover. Verified in a browser: hovering makes no request and logs nothing, clicking navigates in-app with no document request.

---

# 0.21.7 (October 5, 2026)

## Fixes

- **The app can no longer reload itself in a loop when a route chunk is missing.** If a reverse proxy caches the HTML shell, an upgrade leaves the browser asking for route files that no longer exist; the router reloads the document, receives the same stale shell and repeats forever — which looked like a page that refreshes on its own, and it fired even on hover because hovering prefetches a route chunk. The HTML document is now served with `Cache-Control: no-store` (hashed assets keep their year-long immutable caching, data requests and the event stream are untouched), and a small guard allows one automatic reload for a failed chunk, then replaces the app with a clear explanation and a manual reload button instead of looping again.

# 0.21.6 (October 5, 2026)

## Fixes

- **Clicking a filter, a search box or a row no longer re-runs the page's data.** Writing the query string (filters, search, clearing them) made React Router revalidate the route's loader by default, even though the machines list never read the query string — so every click re-fetched the policy, the nodes and the users and re-rendered the whole table, which felt like the page refreshing itself. The machines list and machine detail now declare a `shouldRevalidate` that keeps view-only changes silent and still revalidates for real navigations and mutations.
- The access-control page had the same problem in a different place: its **"Check policy"** button submits the parse-only check, and that submission revalidated the ACL loader even though nothing was stored. It is now exempt, while saving a policy still revalidates.

# 0.21.5 (October 5, 2026)

## Changes

- **The relay cards say which resolver answered, and can re-resolve there.** Both the machine detail card and the Overview show a "Relay lookup" pill — the system resolver, or the configured servers with their addresses — and, when the system resolver returned nothing for an address family, the hint that a configured resolver is how to find out whether the name really has that record, with a link to the settings page. A **Re-resolve** button clears the cached answer and runs the lookup again from the card itself, so a fresh record shows up without waiting out the five-minute cache or visiting the settings page.

# 0.21.4 (October 5, 2026)

## Fixes

- **Live updates are now opt-in, with a switch.** They previously reloaded whatever page you had open every few seconds: Headscale restamps each node's `last_seen` whenever a node checks in, so an idle tailnet looked changed on almost every poll and every open page revalidated continuously. Change detection now compares a stable projection that drops the self-updating fields and sorts collections, so only something a person can see — a node going offline, a rename, a tag, an expiry, an address — counts as a change, and bursts are coalesced into one update per twenty seconds. The background alert and node-history loops read the snapshot without waking the stream. Turn live updates on from the user menu; the choice is remembered.
- A revalidation is also skipped while a field has focus, so typing or choosing an option is never interrupted.

# 0.21.3 (October 5, 2026)

## Fixes

- **Fixed: pages reloaded themselves constantly.** The live store compared the raw node payload between polls, and Headscale refreshes fields such as `last_seen` on every poll — so "unchanged" data looked changed, a change event was sent to every open page every few seconds, and the interface revalidated out from under you. Change detection now compares a stable projection that ignores the fields which move on their own, so a reload only happens when something a person can see actually changes. The stored snapshot still holds the full payload.
- The page also refuses to revalidate while you are typing in a field or choosing from a dropdown, so a background update can no longer drop your focus or your input.

# 0.21.2 (October 5, 2026)

## Changes

- **The relay's IPv6 readiness is now a verdict, not a mystery.** Two configuration checks compare the addresses declared in `derp.server.ipv4`/`ipv6` with the addresses the relay hostname actually resolves to, and report a match, a declared address that does not resolve, no records at all, or that the check could not run (never a false failure). The relay cards on the machine detail page and the Overview show the same verdict with a one-line fix.
- **The client connectivity card explains itself.** Every row says where its value comes from, and the IPv6 row states plainly that it is the node's own self-report — the machine's network, not Headscale — and what to look at when it says no.
- A real-world cause is called out explicitly: a server whose DNS resolver filters AAAA records sees "no IPv6" even when the name has one. The hint gives the comparison to run (`dig @1.1.1.1 +short AAAA <host>` against the local `dig`), the fix (point the host's DNS at a resolver that answers AAAA) and the fact that the empty answer is cached for five minutes.

---

# 0.21.1 (October 5, 2026)

## Changes

- **The agent page now shows what the agent actually synced.** A coverage card reports how many nodes have reported host info against how many the tailnet has (a mismatch stands out), the freshest and oldest report times, and a bounded table of the synced nodes with their reported version, OS and last update; a runtime card shows the executable path, work directory, cache TTL (and that the page is served from that cache), whether the network namespace mode is on and whether the agent already has its Tailscale state, plus the agent's reported version. The absolute last-sync time is shown next to the relative one, with the refresh cadence.
- **Expired keys are easier to live with.** The API keys page gained the same status filter the pre-auth keys page has plus an count of expired ones, both pages explain on expired or already-used rows that Headscale keeps the record and that expiring is the way to revoke a key (there is no delete endpoint), and keys can now be **expired in bulk** — with already-expired keys excluded, since that would be a no-op.

---

# 0.21.0 (October 5, 2026)

## Changes

- **Node availability history.** A sampler records when each node goes offline and comes back (7 days, sparse, in a JSON file beside the other state), the machine detail page shows a 24-hour availability bar with an uptime percentage, and the Overview shows the fleet-wide 7-day trend. Time before the sampler existed, or while it was down, is drawn as unknown rather than counted as uptime or downtime.
- **OIDC self-test.** The OIDC tab can test the configuration for real: the issuer and its discovery document, that the document's issuer matches, the required endpoints and JWKS, the requested scopes, PKCE support, credentials (including a secret set both inline and as a path), that at least one allow-list is configured, and the callback URL to register with your provider, each with a pass/warning/fail/skip result and a summary.
- **A backup of Headplane's own data.** The snapshots page can download a consistent copy of Headplane's SQLite database: local users and their sessions, the audit log and the host info the agent collects. The page states plainly what is not in it: secrets stay in config.yaml, the JSON state files are separate, and there is no one-click restore.
- The relay cards show the **real addresses**: the relay hostname from server_url is resolved to its A and AAAA records (cached, and a literal address is used as-is) and shown next to the addresses declared in the configuration.
- The header wordmark now reads **Headplane Console**.

---

# 0.20.0 (October 5, 2026)

## Changes

- **Alerts.** A new notifications page and a background notifier: point it at a webhook and it reports Headscale becoming unreachable (and recovering), nodes going offline and coming back, API keys nearing expiry and configuration checks turning into failures, with a cooldown so the same condition is not repeated every tick, a delivery history with the HTTP result and a Test button. Settings live in a JSON file in Headplane's data directory, and the loop is inert while notifications are disabled.
- The machine detail page leads with its details card, and the DERP relay panel now sits inside the same card grid as its neighbours, so the whole page reads as one family of cards.
- The Overview dashboard's boxes were unified: one card geometry, icon tiles, status chips, definition lists that stack on narrow screens, count tiles with tabular numbers, per-tally pass/warning/fail chips and clearly separated Derived and Configured values for the relay addresses.

---

# 0.19.0 (October 5, 2026)

## Changes

- A new **Overview** page is the first tab in the navigation (`/overview`) and answers "what am I running, and is it healthy?" in one read-only place. It shows the version of Headplane itself, of Headscale (from its `/version` endpoint) and of the Headplane Agent (the Tailscale version it reports, its last sync, its node count and its last error), with a notice when Headplane or Headscale has a newer release. The embedded DERP region is described by id, code, name, enabled state, whether clients are handed the embedded server, the public map or both, and the `derp.urls`/`derp.paths` counts; the **derived** public `host:port` clients dial (from `server_url`) stands next to the **configured** `derp.server.ipv4`/`ipv6` and STUN address, together with how many machines use the region and a warning when `derp.server.ipv6` is set while STUN is bound to an IPv4-only address. Service facts (the Headscale URL and whether it answers, `base_domain`, the policy mode, the DNS switches, the extra-records file, the metrics listener and whether it is reachable, the trusted-proxy count), the counts (nodes with their online/offline split, users, pre-auth keys, API keys, audit entries, snapshots and their total size) and a health summary of the configuration checks and diagnostics finish it. Everything is read-only and fail-soft: a value that cannot be read becomes an em dash with a short reason instead of an error page.
- The **machines list and the machine detail page** were reworked visually. The list has one clear primary column (the name, with the OS hostname and the machine ID under it) and an always-visible status dot next to a status chip; the rest of the columns appear as the window widens — owner, then the IPv4 and IPv6 addresses (truncated, with a copy menu), then last seen, then the client version, which needs the agent. Rows carry tag chips, the header sticks to the page, the bulk-action bar shows how many machines are selected, and the empty state now tells "no machines yet" apart from "nothing matches the current filters". The detail page uses the settings-style header and icon cards — Addresses, Subnets & Routing, ACL tags, Machine Details, Client Connectivity, DERP Relays and a Danger zone — with the values in a tidy definition list. Nothing about what Headplane reads or writes changed.
- DERP help is now **IPv6-aware**: the STUN listen address explains that `0.0.0.0:3478` is IPv4-only while `[::]:3478` is dual-stack (subject to `net.ipv6.bindv6only`), so an IPv6-only or dual-stack tailnet needs the bracketed form, and it adds that Headscale's own `listen_addr` — which serves both the control API and the relay — needs the same treatment. The validation error repeats it when the field is rejected.

---

# 0.18.0 (October 5, 2026)

## Changes

- The Headscale settings page covers the last configuration Headplane was missing: **`oidc.extra_params`** (the parameters sent to your identity provider, e.g. `domain_hint`), **`oidc.client_secret_path`** (reading the secret from a file, the safer alternative to an inline secret) and the **HA subnet-router probing** options (`node.routes.ha.probe_interval` / `probe_timeout`), with Headscale's own rules enforced (an interval below 2s, a timeout that is not smaller than the interval, and so on).
- A new **read-only overview** in the same section shows the settings Headplane deliberately does not write — `server_url`, `listen_addr`, IP `prefixes` and the allocation strategy, the database type and SQLite path, the metrics/gRPC listeners, the unix socket, the noise key path, the TLS/ACME summary and whether `tuning` is set — so looking something up no longer means opening the file on the host.
- The **audit log can be exported** as CSV or JSON, honouring the active filters (actor, action, time range), capped and clearly labelled.
- The system status page now says when **Headplane itself** has a newer release, and shows a **Prometheus metrics panel** for Headscale: key counters (nodes, users, DERP, policy reloads, uptime) parsed from the metrics listener, with the raw text available, and a clear explanation when that listener is not reachable from Headplane.

---

# 0.17.1 (October 5, 2026)

## Changes

- The **settings overview** is no longer a wall of text. Its entries are cards in a responsive grid — icon, title, one line about what the page does, and the whole card is the link — grouped into Headscale and Headplane, and the "settings page is still under construction" placeholder is gone.

---

# 0.17.0 (October 5, 2026)

## Changes

- The settings section got a visual pass so its pages look like one product: every page now shares the same header, one segmented tab bar (the shape of the top navigation, with scrolling on narrow screens), cards that expand and collapse, and a status chip wherever a state is worth seeing at a glance — OIDC configured, policy mode, trusted-proxy count, the embedded relay's state, keys created, last agent sync, snapshot size and check results. Primary actions sit in the same place on every page, and light/dark contrast is consistent across the section.

---

# 0.16.0 (October 5, 2026)

## Changes

- **Settings navigation now matches the top navigation.** Every settings page uses the same pill tabs as the app header (one tab per group), and a group with several sub-topics expands and collapses in place instead of sliding in from the right. The right-side drawers introduced in 0.15.0 are gone; confirmations (expiring a key, restoring a snapshot) are ordinary centred dialogs again.
- The DERP tab shows the **public port clients will actually use** for the embedded relay, derived from Headscale's `server_url` (so `https://host:8443` means relays on 8443, and no port means 443), with a note that Tailscale's documentation recommends 443 because clients assume it in some situations.
- The DERP tab also carries a short **reverse-proxy checklist**: the proxy has to forward `/derp`, allow the HTTP Upgrade DERP needs without buffering, present valid HTTPS, and udp/3478 for STUN has to reach Headscale directly.

---

# 0.15.0 (October 5, 2026)

## Changes

- **Settings are now groups that open in a drawer.** Every settings page — Headscale, system status, API keys, the agent, login restrictions, the audit log and snapshots — shows a short list with a one-line summary of the current state, and the form itself slides in from the right. Pages that used to be one very long scroll are readable at a glance.
- **The DERP preset can make your own relay the only one.** A checkbox in the preset writes `derp.urls: []` alongside enabling the embedded server, with the single-point-of-failure warning Headscale itself gives. The DERP row now also states where relays actually come from: only the embedded server, embedded plus Tailscale's public map, or only the public map.
- The embedded DERP server can be given its **public IPv4 and IPv6 addresses** (`derp.server.ipv4`/`ipv6`), which Headscale recommends for connection stability. Emptying a field removes the key again.
- DERP help text now matches Headscale's own documentation: the private key is **generated when missing** (only its directory has to be writable), `server_url` has to be **https**, and clients need **tcp/443** and **udp/3478** (the embedded server cannot serve the tcp/80 captive-portal check).

---

# 0.14.1 (October 5, 2026)

## Fixes

- The configuration checks no longer call an unmounted host directory a **first start**. A path whose whole tree is missing (the usual case for a container that is only given `config.yaml`) is reported as unverifiable, while a directory that exists but has not been populated yet is still treated as a first start — which is what the noise-key check now says.

---

# 0.14.0 (October 5, 2026)

## Changes

- The DERP section of the Headscale settings page can now **enable the embedded DERP server in one step**: a preset dialog fills the region id, code, name, STUN address and private-key path, and explains that it publishes a new region to every client.
- Relay regions are easier to read: the region name is shown next to its code, and a **manual region id → name mapping** lets you label the external regions Headplane cannot resolve (stored in Headplane's own data directory, never in Headscale's config).
- The DERP section (and the preset dialog) now states what has to be reachable for a self-hosted region to work: UDP 3478 for STUN and the Headscale HTTPS port for the relay protocol.

## Fixes

- Fixed the audit log, the snapshots pages and the API key actions answering **Unexpected Server Error**. The two contexts those pages read were never registered for requests, so asking for them failed at runtime (and only in those pages, which is why it slipped through). A unit test now fails whenever a context Headplane exports is not registered.

---

# 0.13.1 (October 5, 2026)

## Fixes

- When Headscale rejects the API key in **Headplane's own configuration** (`401 Unauthorized`), the Headplane Agent page now says exactly that, with a link to the API keys page, instead of leaving the operator with a raw request dump. The rest of the UI keeps working in this state — a signed-in user authenticates with their own key — which is what made the failure easy to miss.

---

# 0.13.0 (October 5, 2026)

## Changes

- Machine details now show which **DERP relay** the machine is using: its home and preferred region, whether that region is Headscale's own embedded DERP server, and the measured latency to each region (fastest first, the rest summarised). This needs the Headplane Agent, since Headscale's API does not carry client relay measurements; without it the page says so instead of showing an empty table.

## Fixes

- A failing Headplane Agent sync no longer reports itself as `[object Object]`. The agent sends its errors as JSON, and that object is now turned into readable text for both the settings page and the log, so an agent that cannot start can actually be diagnosed.

---

# 0.12.0 (October 5, 2026)

## Changes

- Added a **DERP** section to the Headscale settings page: custom DERP map URLs and files, the automatic update interval, and the embedded DERP server (region, STUN address, key and verification). The page also lists which relay region each machine is using, with latency, when the Headplane Agent is enabled.
- Added an **operation audit log**: the changes made through Headplane (settings, DNS, policy, machines, API keys, reloads) are recorded with who did them, and `/settings/audit` shows them newest first with filters.
- Added **configuration snapshots**: Headplane backs up Headscale's `config.yaml` (and the policy file in file mode) before it writes anything, and `/settings/snapshots` lists them with download and one-click restore.

## Fixes

- The configuration checks no longer report a Headscale directory as missing when the container simply cannot see it. A path whose parent is invisible to Headplane (the usual case when only `config.yaml` is mounted) is now reported as **unverifiable**, with a hint to mount the directory, instead of claiming a healthy server has lost its database. Real missing paths are still reported.

---

# 0.11.0 (October 5, 2026)

## Changes

- The Headscale settings page now also edits the remaining day-to-day configuration: the default node expiry, the ephemeral-node inactivity timeout, the log level and format, and the Taildrop, node auto-update, logtail and update-check switches.
- The system status page checks Headscale's own configuration file as well: keys that newer Headscale refuses to start with, rejected trusted-proxy ranges, TLS/ACME paths that do not exist, a missing or read-only database directory, an unusable policy file, the `extra_records` / `extra_records_path` conflict, incoherent OIDC settings and a missing noise key.
- Access Control can now edit a grant's `app` (with its connectors) and `via`, and the tailnet-wide `randomizeClientPort` option; policy sections Headscale does not support (`postures`, `ipSets`) are now called out instead of being silently kept.
- DNS extra records can be exported to JSON and imported again, with a preview, an append-or-replace choice and per-index validation.

---

# 0.10.0 (October 5, 2026)

## Changes

- Machines can now be selected in bulk on the machines page and given tags, an expiry or a new owner — or deleted — in a single action, with a summary of how many of them were updated.
- The Access Control editor validates a policy **before** saving it (and has its own validate button), so Headscale's own parser message is shown instead of a save that fails halfway.
- Added a **system status** page under Settings: the Headscale version, an update hint, a diagnostics list for the most common misconfigurations, and a button that reloads or restarts Headscale through the configured integration.

---

# 0.9.0 (October 4, 2026)

## Changes

- Added a **Headscale API key** page under Settings: list the keys, create one (the full key is shown once) and expire the ones you no longer need, without dropping into the server shell.
- Machine expiry can now be set to a **specific date and time**, alongside the existing "never expires" and "default expiry" choices.
- The Access Control editor can now edit **`grants`** (the policy syntax Headscale recommends over `acls`), **`autoApprovers`** (automatic route and exit-node approval) and **`nodeAttrs`** (Taildrive, NextDNS, MagicDNS AAAA and the other node attributes). Unknown keys inside those sections and everywhere else are still preserved untouched.
- Added a **Headscale settings** page: the full OIDC block (issuer, client ID, secret, scopes, PKCE, login restrictions), `trusted_proxies`, and switching `policy.mode` between `file` and `database` so the ACL editor can write through the API.

---

# 0.8.6 (October 4, 2026)

## Changes

- Reworded the footer in all three languages: it now credits the upstream Headplane project (linking to it) and links to this repository, and the upstream sponsorship link was removed.

---

# 0.8.5 (October 4, 2026)

## Fixes

- The ACL editor now explains what happened when Headscale refuses to save a policy because it is reading it from a file (`Policy is not writable`), instead of showing the raw status text in every language.

---

# 0.8.4 (October 4, 2026)

## Fixes

- Fixed every form submission being rejected with "Unexpected Server Error" when Headplane runs behind a reverse proxy that rewrites the `Host` header. React Router treats the mismatch between `Origin` and `Host` as a cross-site request and refuses the action; Headplane now also accepts the hosts named in `server.base_url` and the new `server.allowed_action_origins` option. The server log now says so explicitly, which is described in the new "Saving gives Unexpected Server Error" section of the documentation.

---

# 0.8.3 (October 4, 2026)

## Fixes

- Fixed every form submission failing (adding users, creating pre-auth keys, saving the ACL policy) when a reverse proxy forwards the request without a `Content-Type` header. Headplane now restores a form content type when one is missing, logs a warning naming the request, and no longer turns those saves into an "Unexpected Server Error".

---

# 0.8.2 (October 4, 2026)

## Fixes

- Fixed logging out when Headplane runs behind a reverse proxy that mangles form submissions. Logout is now a plain navigation instead of a form POST, an unreachable OIDC end-session endpoint no longer blocks it, and cross-site logout requests are ignored.

---

# 0.8.1 (October 4, 2026)

## Fixes

- Fixed switching the language or color scheme when Headplane runs behind a reverse proxy that drops the body of a POST. The switch is now sent as a GET request, and a request that arrives without a usable body is ignored (with a warning in the logs) instead of failing, so the browser can no longer end up on an API URL showing a server error.

---

# 0.8.0 (October 4, 2026)

Building Headplane from source now requires Go 1.27.1 or newer.

## Changes

- Added a language switcher for English, Simplified Chinese, and Traditional Chinese. The choice is cached in a `locale` cookie and applied server-side, so the whole interface — including the login page, error pages, and permission failures — renders in the selected language, and timestamps follow the selected locale. On a first visit the language is picked from the browser's `Accept-Language` header.
- Added `config.oidc.jwks_endpoint` to allow manually setting the JWKs keyset for OIDC (via [#620](https://github.com/tale/headplane/pull/620)).

## Fixes

- Fixed copying code, attributes, and machine addresses over plain HTTP, and added feedback when copying fails (closes [#597](https://github.com/tale/headplane/issues/597)).
- Updated NPM & Go dependencies to fix vulnerabilities.
- Fixed the Native installation documentation as it was outdated and missing steps (via [#633](https://github.com/tale/headplane/pull/633)).

---

# 0.7.1 (August 27, 2026)

## Changes

- **Rebuilt the Browser SSH module to use Tailscale's `tsconnect`**, which should result in fewer bugs and better compatibility with future Tailscale releases.
- Added `integration.agent.tailscale_netns`, an agent-only opt-out from Tailscale's routing-loop socket handling for deployments where its fallback pins the agent's Headscale connection to the wrong interface. Existing behavior remains enabled by default.
- Added a Disable/Enable key expiry action to the machine menu (via [#554](https://github.com/tale/headplane/pull/554)). Headscale does not keep the toggle state apart from the expiry date, so re-enabling expiry marks the node expired as of that moment.
- Headplane now supports Docker API version 1.24+ (Engine 1.12+, including Podman's Docker-compatible socket).
- Usernames are now validated before a user is created or renamed, so Headplane rejects names that Headscale accepts but ACL policy can never match (closes [#502](https://github.com/tale/headplane/issues/502)).

## Fixes

- Fixed untagged Headscale builds being read as version 0.0.0. The per-commit `main-*` and `development` images report a Go pseudo-version from `/version`, which is now treated as an unknown version instead of an ancient one (via [#590](https://github.com/tale/headplane/pull/590)).
- Fixed the Browser SSH WASM module not building under Nix (via [#588](https://github.com/tale/headplane/pull/588)).
- Fixed `server.data_path`, `headscale.config_path`, `headscale.dns_records_path` and `headscale.tls_cert_path` being silently lowercased, which pointed Headplane at a different location for any path containing a capital letter (closes [#612](https://github.com/tale/headplane/issues/612)).
- Fixed the Headplane agent falling back to an interactive Tailscale login. The agent now starts with a pre-auth-key, preserves its existing state across restarts, and auto-approves itself when Headscale requires manual approval (closes [#582](https://github.com/tale/headplane/issues/582)).
- Fixed creating pre-auth keys with an expiry of 1000 days or more. The number input submitted its locale-formatted value (`365,000`, `365 000`, `365.000`), which either failed with a 500 or silently created a key with a truncated expiry. The raw value is now submitted and the server rejects malformed expiries with a 400 (closes [#596](https://github.com/tale/headplane/issues/596)).

---

# 0.7.0

- Switched to structured JSON logging (closes [#279](https://github.com/tale/headplane/issues/279)).
- Added suggestions to pick existing tags to the machine tag dialog (closes [#560](https://github.com/tale/headplane/issues/560)).
- Headplane correctly handles `dns.extra_records_path` from the Headscale configuration (closes [#543](https://github.com/tale/headplane/issues/543)).
- Fixed Headscale PostgreSQL config validation so `pass` is not required when `password_file` is supplied (closes [#528](https://github.com/tale/headplane/issues/528)).
- Fixed Browser SSH's WASM DERP probe to account for custom DERP ports (closes [#552](https://github.com/tale/headplane/issues/552)).
- Fixed Browser SSH pre-auth key handling by increasing the temporary key expiry window and showing key creation errors in the UI (closes [#565](https://github.com/tale/headplane/issues/565)).
- Fixed machine rename submission by validating names before sending the rename request (closes [#564](https://github.com/tale/headplane/issues/564)).
- Fixed OIDC token exchange fallback when retrying with `client_secret_basic` (closes [#493](https://github.com/tale/headplane/issues/493)).
- Added support for proxy authentication via `server.proxy_auth` (closes [#353](https://github.com/tale/headplane/issues/353)).
- Added automatic role assignment for new OIDC users via `oidc.default_role` and IdP-provided role claims via `oidc.role_claim` (closes [#352](https://github.com/tale/headplane/issues/352)).
- Fixed the DNS page crashing when Headscale has no Split DNS nameservers configured (closes [#570](https://github.com/tale/headplane/issues/570)).
- User lists now show Headscale display names while preserving usernames as secondary text (closes [#571](https://github.com/tale/headplane/issues/571)).
- Fixed the Register Machine Key dialog so it accepts registration URLs and full `hskey-authreq-...` registration keys (closes [#579](https://github.com/tale/headplane/issues/579)).
- Fixed assigning ACL tags to tag-only (no-user) nodes from the UI. The "Add" and "Remove" tag buttons in the tag dialog lacked `type="button"`, so clicking them submitted the form before the local state update was applied and Headscale received the unchanged tag list. Tag modifications now reach Headscale as intended (closes [#574](https://github.com/tale/headplane/issues/574)).

---

# 0.7.0-beta.4 (May 31, 2026)

> This is a beta release. Please report any issues you encounter.

- **Headplane now requires Headscale 0.27.0 or newer.** Support for 0.26.x has been dropped. If `/version` returns 404 (the endpoint was added in 0.27.0), Headplane logs an error and keeps retrying so an in-place Headscale upgrade is picked up without a restart.
- **Replaced the OpenAPI hash detection with `/version`.** Capabilities are now derived from the version reported by `/version` instead of fingerprinting the OpenAPI schema. This dramatically simplifies version detection and works with every supported release out of the box.
- **Made Headscale boot resilient.** Headplane now boots even when Headscale is unreachable; capabilities default permissively and a background retry settles them once Headscale responds. No more cold-start ordering problems with docker-compose.
- **Added optional in-process TLS termination.** Setting `server.tls_cert_path` and `server.tls_key_path` makes Headplane serve HTTPS/1.1 on `server.port` directly — no reverse proxy required. `server.cookie_secure` is auto-forced to `true` (with a warning) whenever TLS is enabled, since browsers refuse `Secure`-less cookies over HTTPS. HTTP/2 and HTTP/3 are intentionally not supported in-process; terminate those at a reverse proxy if you need them (closes [#403](https://github.com/tale/headplane/issues/403)).
- **Made the bundled Docker healthcheck zero-config across HTTP and HTTPS.** Headplane writes its loopback URL (scheme, port, and basename included) to `/tmp/headplane-listen` on startup, and `hp_healthcheck` reads that file and probes the URL verbatim. Enabling TLS or changing `server.port` no longer requires any healthcheck-specific configuration. Native installs are unaffected — the listen file is only written when `HEADPLANE_LISTEN_FILE` is set, which the Dockerfile does automatically.
- Added Rename and Delete actions for unlinked Headscale users on the Users page so admins can manage Headscale users that have no Headplane account (closes [#525](https://github.com/tale/headplane/issues/525)).
- Documented [Custom Certificate Authorities](/configuration/tls#custom-certificate-authorities) for trusting private or self-signed CAs across every outbound TLS connection (OIDC, Headscale, Docker, etc.) via Node's `NODE_EXTRA_CA_CERTS`. This replaces the previous workaround of rebuilding the Docker image to extend the system trust store (closes [#313](https://github.com/tale/headplane/issues/313)).
- Fixed user-management actions (link, change role, transfer ownership) using the wrong ID type for unlinked Headplane users. Form fields are now explicitly `headplane_user_id` vs. `headscale_user_id`, and the auth layer no longer round-trips through Headscale to recover the OIDC subject.
- Fixed the "Register Machine Key" dialog passing the Headscale numeric user id instead of the username. Headscale's `RegisterNodeRequest.user` proto field is a `string` looked up via `GetUserByName` (no numeric fallback), so registration was failing whenever the selected owner's display name differed from their numeric id (closes [#532](https://github.com/tale/headplane/issues/532)).
- Fixed pre-auth key expiration on Headscale 0.27.x. The pre-0.28 expire endpoint takes a `uint64 user` field which the API layer reads from `key.user?.id`, but the caller was wrapping the id as `{ name: user }`, causing the request to send an empty user field. Headplane now correctly passes the numeric Headscale user id.
- Fixed dialog panels growing beyond the viewport; dialog content is now constrained and scrollable (via [#556](https://github.com/tale/headplane/pull/556)).
- Fixed focus rings on inputs and buttons inside dialogs being clipped by the scrollable content container.
- Fixed tooltips on the last row of the machines table being clipped by the viewport; tooltips now anchor above the trigger with collision padding (closes [#508](https://github.com/tale/headplane/issues/508)).
- Corrected the Docker healthcheck example in the docs to use the required `CMD` prefix so reverse proxies don't see the container as unhealthy (closes [#535](https://github.com/tale/headplane/issues/535)).

---

# 0.7.0-beta.3 (May 14, 2026)

> This is a beta release. Please report any issues you encounter.

- Fixed GHSA-vgj6-hcf2-fqf6, a path traversal / RBAC bypass in Headscale node and user rename API calls.

---

# 0.6.3 (May 14, 2026)

- Fixed GHSA-vgj6-hcf2-fqf6, a path traversal / RBAC bypass in Headscale node and user rename API calls.

---

# 0.7.0-beta.2 (April 9, 2026)

> This is a beta release. Please report any issues you encounter.

- **Rebuilt the user model to enable "account linking" between Headplane and Headscale.** OIDC users are automatically linked to their Headscale counterparts based on subject and email. Users who cannot be automatically linked can claim an unlinked Headscale user during onboarding. See the [SSO docs](/features/sso) for details (via [#489](https://github.com/tale/headplane/pull/489)).
- **Rebuilt Browser SSH** with a new terminal powered by [Ghostty WASM](https://restty.pages.dev), improved session handling, and support for custom DERP ports. See the [Browser SSH docs](/features/ssh) for details (closes [#515](https://github.com/tale/headplane/issues/515), closes [#386](https://github.com/tale/headplane/issues/386)).
- **Rearchitected the Headplane Agent** with a periodic sync model and extensive caching. The agent now auto-generates ephemeral pre-auth keys (requires Headscale 0.28+). See the [Agent docs](/features/agent) for details (closes [#350](https://github.com/tale/headplane/issues/350), closes [#455](https://github.com/tale/headplane/issues/455)).
- **Replaced `openid-client` with a new OIDC implementation.** Fixes `client_secret_basic` not working with Google SSO and other providers (closes [#493](https://github.com/tale/headplane/issues/493), closes [#516](https://github.com/tale/headplane/issues/516)).
- **Migrated all UI components from react-aria to [Base UI](https://base-ui.com).**
- **Consolidated the Headscale API key** under `headscale.api_key` (and `headscale.api_key_path`). Deprecated `oidc.headscale_api_key` — it is still read as a fallback but will be removed in a future release.
- Added machine list filters for user, tag, status, and route (via [#507](https://github.com/tale/headplane/pull/507), closes [#506](https://github.com/tale/headplane/issues/506)).
- Added self-service pre-auth key creation for auditor role users (via [#478](https://github.com/tale/headplane/pull/478), closes [#453](https://github.com/tale/headplane/issues/453)).
- Added an agent status page at `/settings/agent` showing sync status, node count, and errors.
- Added local endpoint and address information to the machine detail page.
- Improved the ACL editor appearance and fixed a CodeMirror version mismatch.
- Store OIDC profile pictures in the database to prevent cookie overflow (via [#510](https://github.com/tale/headplane/pull/510), closes [#326](https://github.com/tale/headplane/issues/326)).
- Detect unsupported Docker API versions early with a clear error message (via [#497](https://github.com/tale/headplane/pull/497)).
- Fixed "No expiry" badge not displaying for nodes with zero-time expiry values (via [#527](https://github.com/tale/headplane/pull/527), closes [#526](https://github.com/tale/headplane/issues/526)).
- Fixed first user not being assigned the owner role on OIDC login (via [#480](https://github.com/tale/headplane/pull/480), closes [#266](https://github.com/tale/headplane/issues/266)).
- Fixed login errors throwing a server error instead of showing form validation (via [#475](https://github.com/tale/headplane/pull/475), closes [#474](https://github.com/tale/headplane/issues/474)).
- Fixed pre-auth key expiration on Headscale 0.28+ (closes [#519](https://github.com/tale/headplane/issues/519)).
- Fixed OIDC subject matching for providers with special characters in user IDs, e.g. Auth0 (closes [#428](https://github.com/tale/headplane/issues/428)).
- Fixed `headscale.api_key` not being used consistently across all code paths.
- Fixed agent HostInfo not refreshing periodically using `cache_ttl` (via [#477](https://github.com/tale/headplane/pull/477), closes [#427](https://github.com/tale/headplane/issues/427)).
- Fixed agent working directory being wiped on restart.
- Fixed a race condition where the SSE controller could be used after being closed.
- Fixed cookie secret generation using incorrect byte length (via [#501](https://github.com/tale/headplane/pull/501)).
- Fixed OIDC configuration error troubleshooting link (via [#518](https://github.com/tale/headplane/pull/518), closes [#517](https://github.com/tale/headplane/issues/517)).
- Fixed deprecated Nix package attributes (via [#521](https://github.com/tale/headplane/pull/521)).
- Updated NixOS module options: removed deprecated agent fields, added `headscale.api_key_path` and `integration.agent.executable_path`.

---

# 0.6.2 (February 26, 2026)

- **Added support for Headscale 0.28.0** including all API and data model changes.
- Added search and sortable columns to the machines list page (closes [#351](https://github.com/tale/headplane/issues/351)).
- Added support for Headscale 0.27.0 and 0.27.1
- Bundle all `node_modules` aside from native ones to reduce bundle and container size (closes [#331](https://github.com/tale/headplane/issues/331)).
- Allow conditionally compiling the SSH WASM integration when building (closes [#337](https://github.com/tale/headplane/issues/337)).
- Implemented the ability to customize the build with a custom script (see `./build.sh --help` for more information).
- Attempt to warn against misconfigured cookie settings on the login page.
- Made `server.cookie_max_age` and `server.cookie_domain` configurable (closes [#348](https://github.com/tale/headplane/issues/348)).
- Re-worked the configuration loading system with several enhancements:
  - It is now possible to skip a configuration file and only use environment variables (closes [#150](https://github.com/tale/headplane/issues/150)).
  - Secret path loading has been reworked from the ground up to be more reliable (closes [#334](https://github.com/tale/headplane/issues/334)).
  - Added better testing and validation for configuration loading
- Re-worked the OIDC integration to adhere to the correct standards and surface more errors to the user.
  - Deprecated `oidc.redirect_uri` and automated callback URL detection in favor of setting `server.base_url` correctly.
  - Explicitly added `oidc.use_pkce` to correctly determine PKCE configuration.
  - `oidc.token_endpoint_auth_method` is now optional and will attempt to be auto-detected, defaulting to `client_secret_basic` if unavailable (closes [#410](https://github.com/tale/headplane/issues/410)).
  - Added `oidc.enabled` config option to explicitly control OIDC availability (via [#463](https://github.com/tale/headplane/pull/463)).
- Removed several unnecessarily verbose or spammy log messages.
- Updated the minimum Docker API used to support the latest Docker versions (via [#370](https://github.com/tale/headplane/pull/370)).
- Enhanced the node tag dialog to show a dropdown of assignable tags (via [#362](https://github.com/tale/headplane/pull/362)).
- Fixed an issue where the website favicon would not load correctly (closes [#323](https://github.com/tale/headplane/issues/323)).
- Correctly handle invalid ACL policy inserts on Headscale 0.27+ (closes [#383](https://github.com/tale/headplane/issues/383)).
- Prevent a machine from changing its owner to itself (closes [#373](https://github.com/tale/headplane/issues/373)).
- Added an `/admin/api/info` route that can expose sensitive information if `server.info_secret` is set in the configuration (closes [#324](https://github.com/tale/headplane/issues/324)).
- Correctly apply Gravatar profile pictures on the user page if applicable (closes [#405](https://github.com/tale/headplane/issues/405)).
- Machine key registration no longer works if the key isn't 24 characters long (closes [#415](https://github.com/tale/headplane/issues/415)).
- Fixed some mobile CSS issues across the application (closes [#401](https://github.com/tale/headplane/issues/401)).
- Added a Docker healthcheck to the container (closes [#411](https://github.com/tale/headplane/issues/411)).
- Strengthened the validation for the `/proc` integration to correctly discover the Headscale PID.
- Added lazy retry logic for OIDC providers if they initially fail to respond (closes [#423](https://github.com/tale/headplane/issues/423)).
- Fixed API key login on Headscale 0.28.0-beta.1+ (closes [#429](https://github.com/tale/headplane/issues/429)).
- Fixed an issue that prevented the pre-auth-key UI from being usable on Headscale 0.28 and later.
- Added support for creating tag-only pre-auth keys on Headscale 0.28+ (via [#465](https://github.com/tale/headplane/pull/465)).
- Pre-auth keys are now listed without a user filter on Headscale 0.28+, with a fallback to per-user fetching on older versions (via [#466](https://github.com/tale/headplane/pull/466)).
- Fixed handling of tag-only nodes that have no user on Headscale 0.28+ (via [#467](https://github.com/tale/headplane/pull/467)).
- Adapted to the removal of Node Ownership Change in Headscale 0.28 (via [#436](https://github.com/tale/headplane/pull/436)).
- Fixed pre-auth keys not showing for OIDC users without a username (via [#470](https://github.com/tale/headplane/pull/470)).
- Fixed truncated pre-auth key display with longer Headscale 0.28 bcrypt tokens (closes [#435](https://github.com/tale/headplane/issues/435)).
- Fixed Nix systemd service to use user-specified package (via [#454](https://github.com/tale/headplane/pull/454)).
- Version displayed in the UI is now derived from git tags and build args instead of `package.json`, fixing incorrect versions shown on beta and nightly builds.
- Improved the no-access user page on the UI (via [#469](https://github.com/tale/headplane/pull/469)).

---

# 0.6.1 (October 12, 2025)

- **Headplane now supports connecting to machines via SSH in the web browser.**
  - This is an experimental feature and requires the `integration.agent` section to be set up in the config file.
  - This is built on top of a Go binary that runs in WebAssembly, using Xterm.js for the terminal interface.
- Begin using a new SQLite database file in `/var/lib/headplane/hp_persist.db`.
  - The database is created automatically if it does not exist.
  - It currently stores SSH connection details and HostInfo for the agent.
  - User information is automatically migrated from the previous database.
- The docker container now runs in a distroless image (closes [#255](https://github.com/tale/headplane/issues/255)).
  - A debug version of the container that runs as root and has a shell is available as `ghcr.io/tale/headplane:<version>-shell`.
- Removing a Split DNS record will no longer make the split domain unresolvable by clients (closes [#231](https://github.com/tale/headplane/issues/231)).
- Reintroduce the toggle for overriding local DNS settings in the Headscale config (closes [#236](https://github.com/tale/headplane/issues/236)).
- Prefer cross-compiling in the Dockerfile to speed up builds while still supporting multiple architectures.
- Add a build attestation to validate SLSA provenance for the Docker image.
- Implement more accurate guessing on the PID with the `/proc` integration (via [#219](https://github.com/tale/headplane/pull/219)).
- Usernames will now correctly fall back to emails if not provided (via [#257](https://github.com/tale/headplane/pull/257)).
- Configuration loading via paths is now supported for sensitive values (via [#283](https://github.com/tale/headplane/pulls/283))
  - Options like `server.cookie_secret_path` can override `server.cookie_secret`
  - Environment variables are interpolatable into these paths
  - See the full reference in the [docs](https://github.com/tale/headplane/blob/main/docs/Configuration.md#sensitive-values)
- The nix overlay build is fixed for the SSH module (via [#282](https://github.com/tale/headplane/pull/282))
- Switch our build processes to use TypeScript Go and Rolldown Vite for better build and type-check performance.
- Cookies are now encrypted JWTs, preserving API key secrets (_GHSA-wrqq-v7qw-r5w7_)
- OIDC profile pictures are now available from Gravatar by setting `oidc.profile_picture_source` to `gravatar` (closes [#232](https://github.com/tale/headplane/issues/232)).
- OIDC now allows passing many custom parameters:
  - `oidc.authorization_endpoint`, `oidc.token_endpoint`, and `oidc.userinfo_endpoint` can be overridden to support non-standard providers or scenarios without discovery (closes [#117](https://github.com/tale/headplane/issues/117)).
  - `oidc.scope` can be set to specify custom scopes (defaults to `openid email profile`).
  - `oidc.extra_params` can be set to pass arbitrary query parameters to the authorization endpoint (closes [#197](https://github.com/tale/headplane/issues/197)).

---

# 0.6.0 (May 25, 2025)

- Headplane 0.6.0 now requires **Headscale 0.26.0** or newer.
  - Breaking API changes with routes and pre auth keys are now supported (closes [#204](https://github.com/tale/headplane/issues/204)).
  - Older versions of Headscale will not work with Headplane.

- OIDC authorization restrictions can now be controlled from the settings UI. (closes [#102](https://github.com/tale/headplane/issues/102))
  - The required permission role for this is **IT Admin** or **Admin/Owner** and require the Headscale configuration.
  - Changes made will modify the `oidc.allowed_{domains,groups,users}` fields in the Headscale config file.
- The Pre-Auth keys page has been fully reworked (closes [#179](https://github.com/tale/headplane/issues/179), [#143](https://github.com/tale/headplane/issues/143)).
- The Headplane agent is now available as an integration (closes [#65](https://github.com/tale/headplane/issues/65)).
  - The agent runs as an embedded process alongside the Headplane server and reports host information and system metrics.
  - Refer to the `integrations.agent` section of the config file for more information and how to enable it.
- Requests to `/admin` will now be redirected to `/admin/` to prevent issues with the React Router (works with custom prefixes, closes [#173](https://github.com/tale/headplane/issues/173)).
- The Login page has been simplified and separately reports errors versus incorrect API keys (closes [#186](https://github.com/tale/headplane/issues/186)).
- The machine actions backend has been reworked to better handle errors and provide more information to the user (closes [#185](https://github.com/tale/headplane/issues/185)).
- Machine tags now show states when waiting for subnet or exit node approval and when expiry is disabled.
- Expiry status on the UI was incorrectly showing as never due to changes in the Headscale API.
- Added validation for machine renaming to prevent invalid submissions (closes [#192](https://github.com/tale/headplane/issues/192)).
- Unmanaged (non-OIDC) users cannot have a role assigned to them so the menu option was disabled.
- Support Docker container discovery through labels (via [#194](https://github.com/tale/headplane/pull/194)).
- AAAA records are now supported on the DNS page (closes [#189](https://github.com/tale/headplane/issues/189)).
- Add support for `dns.extra_records_path` in the Headscale config (closes [#144](https://github.com/tale/headplane/issues/144)).
- Tighten `proc` integration logic by checking for the `headscale serve` command (via #[195](https://github.com/tale/headplane/pull/195)).
- Strip newlines in the OIDC `client_secret_path` file if provided (closes [#199](https://github.com/tale/headplane/issues/199)).

---

# 0.5.10 (April 4, 2025)

- Fix an issue where other preferences to skip onboarding affected every user.

---

# 0.5.9 (April 3, 2025)

- Filter out empty users from the pre-auth keys page which could possibly cause a crash with unmigrated users.
- OIDC users cannot be renamed, so that functionality has been disabled in the menu options.
- Suppress hydration errors for any fields with a date in it.

---

# 0.5.8 (April 3, 2025)

- You can now skip the onboarding page if desired.
- Added the UI to change user roles in the dashboard.
- Fixed an issue where integrations would throw instead of loading properly.
- Loading the ACL page no longer spams blank updates to the Headscale database (fixes [#151](https://github.com/tale/headplane/issues/151))
- Automatically create `/var/lib/headplane` in the Docker container (fixes [#166](https://github.com/tale/headplane/issues/166))
- OIDC logout with `disable_api_key_login` set to true will not automatically login again (fixes [#149](https://github.com/tale/headplane/issues/149))

---

# 0.5.7 (April 2, 2025)

- Hotfix an issue where assets aren't served under `/admin` or the prefix.

---

# 0.5.6 (April 2, 2025)

### IMPORTANT

> **PLEASE** update to this ASAP if you were using Google OIDC. This is because previously _ANY_ accounts have admin access to your Tailnet if they discover the URL that Headplane is being hosted on. This new change enforces that new logins by default are not given any permissions. You will need to re-login to Headplane to generate an owner account and prevent unauthorized access.

Implemented _proper_ authentication methods for OIDC.
This is a large update and copies the permission system from Tailscale.
Permissions are not automatically derived from OIDC, but they can be configured via the UI.
Additionally, certain roles give certain capabilities, limiting access to parts of the dashboard.
By default, new users will have a `member` role which forbids access to the UI.
If there are no users, the first user will be given an `owner` role which cannot be removed.

**Changes**:

- Switched the internal server to use `hono` for better performance.
- Fixed an issue that caused dialogs to randomly refocus every 3 seconds.
- Headplane will not send API requests when the tab is not focused.
- Continue loosening the configuration requirements for Headscale (part of an ongoing effort).
- Unknown values in the Headplane config no longer cause a crash.
- Fixed an issue that caused copied commands to have a random space (fixes [#161](https://github.com/tale/headplane/issues/161))

---

# 0.5.5 (March 18, 2025)

- Hotfix an issue that caused Headplane to crash if no agents are available

---

# 0.5.4 (March 18, 2025)

- Fixed a typo in the Kubernetes documentation
- Handle split and global DNS records not being set in the Headscale config (via [#129](https://github.com/tale/headplane/pull/129))
- Stop checking for the `mkey:` prefix on machine registration (via [#131](https://github.com/tale/headplane/pull/131))
- OIDC auth was not using information from the `user_info` endpoint.
- Support the picture of the user who is logged in via OIDC if available.
- Rewrote the Agent implementation to better utilize disk space and perform better (coming soon).
- Loosened checking for the Headscale configuration as it was too strict and required certain optional fields.
- Deleting a node will now correctly redirect back to the nodes page (fixes [#137](https://github.com/tale/headplane/issues/137))
- Supports connecting to Headscale via TLS and can accept a certificate file (partially fixes [#82](https://github.com/tale/headplane/issues/82))
- Add support for running Headplane through Nix, though currently unsupported (via [#132](https://github.com/tale/headplane/pull/132))
- You can now pass in an OIDC client secret through `oidc.client_secret_path` in the config (fixes [#126](https://github.com/tale/headplane/issues/126))
- Correctly handle differently localized number inputs (fixes [#125](https://github.com/tale/headplane/issues/125))

---

# 0.5.3 (March 1, 2025)

- Fixed an issue where Headplane expected the incorrect config value for OIDC scope (fixes [#111](https://github.com/tale/headplane/issues/111))
- Added an ARIA indicator for when an input is required and fixed the confirm buttons (fixed [#116](https://github.com/tale/headplane/issues/116))
- Fixed a typo in the docs that defaulted to `/var/run/docker.dock` for the Docker socket (via [#112](https://github.com/tale/headplane/pull/112))

---

# 0.5.2 (February 28, 2025)

- Hotfixed an issue where the server bundle got reloaded on each request

---

# 0.5.1 (February 28, 2025)

- Fixed an issue that caused the entire server to crash on start
- Fixed the published semver tags from Docker
- Fixed the Kubernetes integration not reading the config

---

# 0.5 (February 27, 2025)

> This release is a major overhaul and contains a significant breaking change.
> We now use a config file for all settings instead of environment variables.
> Please see [config.example.yaml](/config.example.yaml) for the new format.

- Completely redesigned the UI from the ground up for accessibility and performance.
- Switched to a config-file setup (this introduces breaking changes, see [config.example.yaml](/config.example.yaml) for the new format).
- If the config is read-only, the options are still visible, just disabled (fixes [#48](https://github.com/tale/headplane/issues/48))
- Added support for Headscale 0.25.0 (this drops support for any older versions).
- Fixed issues where renaming, deleting, and changing node owners via users was not possible (fixes [#91](https://github.com/tale/headplane/issues/91))
- Operations now have significantly less moving parts and better error handling.
- Updated to `pnpm` 10 and Node.js 22.
- Settings that were previously shared like `public_url` or `oidc` are now separate within Headplane/Headscale. This is a rather large breaking change but fixes cases where a user may choose to utilize Headscale OIDC for Tailscale but not for the Headplane UI.
- Deprecate the `latest` tag in Docker for explicit versioning and `edge` for nightly builds.

---

# 0.4.1 (January 18, 2025)

- Fixed an urgent issue where the OIDC redirect URI would mismatch.

---

# 0.4.0 (January 18, 2025)

- Switched from Remix.run to React-Router
- Fixed an issue where some config fields were marked as required even if they weren't (fixes [#66](https://github.com/tale/headplane/issues/66))
- Fixed an issue where the toasts would be obscured by the footer (fixes [#68](https://github.com/tale/headplane/issues/68))
- The footer now blurs your Headscale URL as a privacy measure
- Updated to the next stable beta of the React Compiler
- Changed `/healthz` to use a well-known endpoint instead of trying an invalid API key
- Support `OIDC_REDIRECT_URI` to force a specific redirect URI
- Redo the OIDC integration for better error handling and configuration
- Gracefully handle when Headscale is unreachable instead of crashing the dashboard
- Reusable Pre-Auth Keys no longer show expired when used (PR [#88](https://github.com/tale/headplane/pull/88))
- Tweaked some CSS issues in the UI

---

# 0.3.9 (December 6, 2024)

- Fixed a race condition bug in the OIDC validation code

---

# 0.3.8 (December 6, 2024)

- Added a little HTML footer to show the login page and link to a donation page.
- Allow creating pre-auth keys that expire past 90 days (fixes [#58](https://github.com/tale/headplane/issues/58))
- Validates OIDC config and ignores validation if specified via variables or Headscale config (fixes [#63](https://github.com/tale/headplane/issues/63))

---

# 0.3.7 (November 30, 2024)

- Allow customizing the OIDC token endpoint auth method via `OIDC_CLIENT_SECRET_METHOD` (fixes [#57](https://github.com/tale/headplane/issues/57))
- Added a `/healthz` endpoint for Kubernetes and other health checks (fixes [#59](https://github.com/tale/headplane/issues/59))
- Allow `HEADSCALE_PUBLIC_URL` to be set if `HEADSCALE_URL` points to a different internal address (fixes [#60](https://github.com/tale/headplane/issues/60))
- Fixed an issue where the copy machine registration command had a typo.

---

# 0.3.6 (November 20, 2024)

- Fixed an issue where select dropdowns would not scroll (fixes [#53](https://github.com/tale/headplane/issues/53))
- Added a button to copy the machine registration command to the clipboard (fixes [#52](https://github.com/tale/headplane/issues/52))

---

# 0.3.5 (November 8, 2024)

- Quickfix a bug where environment variables are ignored on the server.
- Remove a nagging error about missing cookie since that happens when signed out.

---

# 0.3.4 (November 7, 2024)

- Clicking on the machine name in the users page now takes you to the machine overview page.
- Completely rebuilt the production server to work better outside of Docker and be lighter. More specifically, we've switched from the `@remix-run/serve` package to our own custom built server.
- Fixed a bunch of silly issues introduced by me not typechecking the codebase.
- Improve documentation and support when running Headplane outside of Docker.
- Removing Split DNS records will no longer result in an error (fixes [#40](https://github.com/tale/headplane/issues/40))
- Removing the last ACL tag on a machine no longer results in an error (fixes [#41](https://github.com/tale/headplane/issues/41))
- Added full support for Exit Nodes in the UI and redesigned the machines page (fixes [#36](https://github.com/tale/headplane/issues/36))
- Added a basic check to see if the API keys passed via cookies are invalid.

---

# 0.3.3 (October 28, 2024)

- Added the ability to load a `.env` file from the PWD when `LOAD_ENV_FILE=true` is set as an environment variable.
- Fixed an issue where non-English languages could not create Pre-auth keys due to a localization error
- Improved ACL editor performance by switching back to CodeMirror 6
- Fixed an issue where editing the ACL policy would cause it to revert on the UI (fixes [#34](https://github.com/tale/headplane/issues/34))
- Updated to the next stable beta of the React 19 Compiler ([See More](https://react.dev/learn/react-compiler))

---

# 0.3.2 (October 11, 2024)

- Implement the ability to create and expire pre-auth keys (fixes [#22](https://github.com/tale/headplane/issues/22))
- Fix machine registration not working as expected (fixes [#27](https://github.com/tale/headplane/issues/27))
- Removed more references to usernames in MagicDNS hostnames (fixes [#35](https://github.com/tale/headplane/issues/35))
- Handle `null` values on machine expiry when using a database like PostgreSQL.
- Use `X-Forwarded-Proto` and `Host` headers for building the OIDC callback URL.

---

# 0.3.1 (October 3, 2024)

- Fixed the Docker integration to properly support custom socket paths. This regressed at some point previously.
- Allow you to register a machine using machine keys (`nodekey:...`) on the machines page.
- Added the option for debug logs with the `DEBUG=true` environment variable.

---

# 0.3.0 (September 25, 2024)

- Bumped the minimum supported version of Headscale to 0.23.
- Updated the UI to respect `dns.use_username_in_magic_dns`.

---

# 0.2.4 (August 24, 2024)

- Removed ACL management from the integration since Headscale 0.23-beta2 now supports it natively.
- Removed the `ACL_FILE` environment variable since it's no longer needed.
- Introduce a `COOKIE_SECURE=false` environment variable to disable HTTPS requirements for cookies.
- Fixed a bug where removing Split DNS configurations would crash the UI.

---

# 0.2.3 (August 23, 2024)

- Change the minimum required version of Headscale to 0.23-beta2
- Support the new API policy mode for Headscale 0.23-beta1
- Switch to the new DNS configuration in Headscale 0.23-beta2 (fixes [#29](https://github.com/tale/headplane/issues/29))
- If OIDC environment variables are defined, don't use configuration file values (fixes [#24](https://github.com/tale/headplane/issues/24))

---

# 0.2.2 (August 2, 2024)

- Added a proper Kubernetes integration which utilizes `shareProcessNamespace` for PIDs.
- Added a new logger utility that shows categories, levels, and timestamps.
- Reimplemented the integration system to be more resilient and log more information.
- Fixed an issue where the /proc integration found `undefined` PIDs.

---

# 0.2.1 (July 7, 2024)

- Added the ability to manage custom DNS records on your Tailnet.
- ACL tags for machines are now able to be changed via the machine menu.
- Fixed a bug where the ACL editor did not show the diffs correctly.
- Fixed an issue that stopped the "Discard changes" button in the ACL editor from working.

---

# 0.2.0 (June 23, 2024)

- Fix the dropdown options for machines not working on the machines page.
- Add an option to change the machine owner in the dropdown (aside from the users page).

---

# 0.1.9 (June 2, 2024)

- Switch to Monaco editor with proper HuJSON and YAML syntax highlighting.
- Utilize magic DNS hostnames for the machine overview page.
- Fixed the expiry issue once and for all.
- Add a nightly build with the `ghcr.io/tale/headplane:edge` tag

---

# 0.1.8 (June 2, 2024)

- Built basic functionality for the machine overview page (by machine ID).
- Possibly fixed an issue where expiry disabled machines' timestamps weren't handled correctly.
- Prevent users from being deleted if they still have ownership of machines.
- Fixed some type issues where `Date` was being used instead of `string` for timestamps.

---

# 0.1.7 (May 30, 2024)

- Added support for the `HEADSCALE_INTEGRATION` variable to allow for advanced integration without Docker.
- Fixed a bug where the `expiry` field on the Headscale configuration could cause crashes.
- Made the strict configuration loader more lenient to allow for more flexibility.
- Added `HEADSCALE_CONFIG_UNSTRICT`=true to revert back to a weaker configuration loader.
- Headplane's context now only loads once at start instead of being lazy-loaded.
- Improved logging and error propagation so that it's easier to debug issues.

---

# 0.1.6 (May 22, 2024)

- Added experimental support for advanced integration without Docker.
- Fixed a crash where the Docker integration tried to use `process.env.API_KEY` instead of context.
- Fixed a crash where `ROOT_API_KEY` was not respected in the OIDC flow.

---

# 0.1.5 (May 20, 2024)

- Robust configuration handling with fallbacks based on the headscale source.
- Support for `client_secret_path` on configuration file based OIDC.
- `DISABLE_API_KEY_LOGIN` now works as expected (non 'true' values work).
- `API_KEY` is renamed to `ROOT_API_KEY` for better clarity (old variable still works).
- Fixed button responders not actually being invoked (should fix the ACL page).

---

# 0.1.4 (May 15, 2024)

- Users can now be created, renamed, and deleted on the users page.
- Machines can be dragged between users to change their ownership.
- The login page actually respects the `DISABLE_API_KEY_LOGIN` variable.
- Implemented some fixes that should stop dialogs from hanging a webpage.
- Upgrade to React 19 beta to take advantage of the compiler (may revert if it causes issues).
- Upgrade other dependencies

---

# 0.1.3 (May 4, 2024)

- Switched to a better icon set for the UI.
- Support stable scrollbar gutter if supported by the browser.
- Cleaned up the header which fixed a bug that could crash the entire application on fetch errors.

---

# 0.1.2 (May 1, 2024)

- Added support for renaming, expiring, removing, and managing the routes of a machine.
- Implemented an expiry check for machines which now reflect on the machine table.
- Fixed an issue where `HEADSCALE_CONTAINER` was needed to start even without the Docker integration.
- Removed the requirement for the root `API_KEY` unless OIDC was being used for authentication.
- Switched to [React Aria](https://react-spectrum.adobe.com/react-aria/) for better accessibility support.
- Cleaned up various different UI inconsistencies and copied components that could've been abstracted.
- Added a changelog for any new versions going forward.
