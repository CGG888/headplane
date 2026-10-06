---
title: Access Control
description: Edit the Headscale ACL policy, tags and groups from the HeadplaneCN UI.
---

# Access Control

Headscale stores its Access Control List (ACL) as a single HuJSON policy. The
**Access Control** page in HeadplaneCN exposes that policy in two ways: a
structured editor for the parts most people change day to day, and the raw file
editor for everything else.

## Requirements

The policy can only be written through the web UI when Headscale runs in
database policy mode:

```yaml
# Headscale config.yaml
policy:
  mode: database
```

In `file` mode the policy lives in a file that only Headscale reads, so its API
refuses the write. HeadplaneCN cannot tell which mode Headscale uses without being
able to read Headscale's configuration, so the editor stays usable and the save
is rejected with an explanation of how to switch modes or edit the file
directly. Editing also requires the `write_policy` capability, which the
`owner`, `admin` and `network_admin` roles have.

## Rules

The **Rules** tab renders the policy as three lists:

- **Access rules** — the `acls` section. Each rule allows traffic from a set of
  sources to a set of destinations. Destinations include a port range, for
  example `tag:web:80,443`. A destination entered without one gets `:*`
  appended, since Headscale rejects a destination that has no port.
- **SSH rules** — the `ssh` section, including `check` mode and its check
  period.
- **Hosts** — the `hosts` section, which names an IP address or CIDR range so
  rules can reference it.

Adding or editing an entry opens a dialog where sources and destinations are
built from chips. Every group, tag, host and Headscale user already known to
your tailnet is offered as a one-click suggestion, so rules can be written
without memorising the syntax.

## Tags and groups

The **Tags & Groups** tab manages the `groups` and `tagOwners` sections.

- **Groups** bundle Headscale users so rules can refer to a team. Members are
  written as `username@`, which is how Headscale references users in a policy.
- **Tags** identify machines by role rather than by owner. Each tag lists the
  users and groups allowed to assign it. The list also shows which machines
  currently carry the tag.

Tags must exist under `tagOwners` before they mean anything: assigning an
undeclared tag to a machine is allowed by Headscale, but no rule will ever match
it. The tag dialog on the **Machines** page flags such tags with a warning and
links back here.

Group membership can also be edited from the **Users** page: the row menu has an
**Edit groups** entry, and the groups a user belongs to are shown under their
name. Both surfaces write to the same `groups` section of the policy.

## Grants, auto-approvers and node attributes

Beyond ACL rules, the structured editor also covers the sections Headscale uses
for its newer policy features:

- **Grants** — the syntax Headscale recommends over `acls`. A grant is a
  `src` → `dst` pair plus the `ip` it allows, written the way Headscale parses
  it: `*`, a port (`443`), a list or range (`80,443`, `1000-2000`) or a protocol
  and port (`tcp:443`, `udp:*`). An empty `ip` is only valid when the grant
  carries an `app` field, which the editor keeps untouched but does not build.
- **Auto-approvers** — subnet routes advertised by the listed users, groups or
  tags are approved without an admin clicking anything, and the same list
  controls who may advertise an exit node.
- **Node attributes** — `nodeAttrs` grants a capability to a set of targets, for
  example Taildrive (`drive:share`, `drive:access`), NextDNS
  (`nextdns:<profile>`), MagicDNS AAAA records (`magicdns-aaaa`) or
  `randomize-client-port`. Targets accept users, groups, tags, hosts, prefixes
  and the `autogroup:*` values, exactly like an ACL source.

### Application grants and connectors

A grant can also carry an **`app`** — an application served by connector nodes
instead of an open port range, which is the one case where a grant needs no `ip`
— and a **`via`** list naming the sources allowed to reach it. Both are edited in
the same grant dialog.

Headscale stores `app` as a capability map, so a policy written elsewhere can
hold keys the editor does not know; only the entry the editor writes (`name`
plus its `connectors`) is touched, and everything else in the map is kept as it
was. A grant whose `app` came from somewhere else therefore survives a save
untouched.

### Tailnet-wide options

`randomizeClientPort` is a policy-level option that makes machines pick a random
source port for outgoing connections. It is a switch on the same page; if your
policy never had the key, HeadplaneCN leaves it that way rather than inventing one.

Anything HeadplaneCN does not model inside these sections — a future key inside
`autoApprovers`, an unknown field inside a grant — is preserved verbatim when a
policy is saved.

::: warning `postures` and `ipSets` are Tailscale features
Headscale does not implement them. If a policy contains either section the
editor shows a warning and keeps the section exactly as written, so nothing is
lost, but do not expect the rules to have any effect.
:::

## Validating before saving

Headscale can validate a policy without storing it, and the editor uses that:
saving runs the policy through Headscale's own parser first, so a rule with a
typo is reported — in Headscale's own words — instead of being written and
silently ignored. A **validate** button does the same check on demand, which is
worth doing before a large rewrite.

If Headscale cannot run the check at all (an older release, an unreachable
server), HeadplaneCN saves exactly as it always did rather than blocking you.

## Editing the file directly

The **Edit file** tab is the original CodeMirror editor over the raw policy, and
**Preview changes** shows a diff against the saved version. The structured
editors write into the same buffer, so a change made visually shows up in the
file editor and in the diff before it is saved.

Nothing is sent to Headscale until **Save** is pressed.

::: warning Comments are not preserved
HuJSON allows comments and trailing commas. HeadplaneCN reads them, but the
structured editors regenerate the policy text, which drops comments. The Rules
and Tags & Groups tabs show a notice when the loaded policy contains comments —
use the file editor if you want to keep them.
:::

Unknown top-level keys such as `autoApprovers` and `nodeAttrs` are preserved
untouched, so using the visual editor never silently drops parts of a policy
that HeadplaneCN does not model.
