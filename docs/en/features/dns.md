---
title: DNS
description: Manage MagicDNS, nameservers, search domains and extra records.
outline: [2, 3]
---

# DNS

The DNS page edits the `dns` block of Headscale's configuration:

| Setting                | What it does                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **MagicDNS**           | Gives every machine a name inside your base domain.                                                                             |
| **Base domain**        | The domain MagicDNS names live under.                                                                                           |
| **Nameservers**        | The global resolvers every machine is told to use.                                                                              |
| **Split DNS**          | Per-domain resolvers, for sending one domain to a different server.                                                             |
| **Search domains**     | Domains appended to short names.                                                                                                |
| **Override local DNS** | Whether Headscale's resolvers replace the ones the machine already has.                                                         |
| **Extra records**      | Static `A` and `AAAA` entries published alongside MagicDNS — handy for pointing a name at a service that is not a Tailnet node. |

Editing requires Headscale's configuration file to be mounted read-write, the
same as the other settings pages.

## Importing and exporting records

The record list can be exported to a JSON file and imported back, which is the
quick way to move a set of records between machines or to keep them in version
control:

```json
[
  { "name": "nas.example.com", "type": "A", "value": "192.168.1.10" },
  { "name": "nas.example.com", "type": "AAAA", "value": "fd00::10" }
]
```

Importing shows a preview first and asks whether to **replace** the current
records or **append** to them. Validation is strict — it has to be an array of
objects with string `name`, `type` and `value`, the type must be one the UI
offers (`A` or `AAAA`), and any problem names the offending entry so it can be
fixed. Exact duplicates are skipped rather than added twice.

::: warning One record per name and type
Headplane writes records through Headscale's configuration helpers, which keep a
single record for each `name` + `type` pair. Two different values for the same
name therefore cannot both be imported, and the import says so instead of
silently dropping one; add the second value in Headscale's configuration file
itself if you need round-robin answers.
:::

::: tip Extra records or Split DNS?
Use **extra records** when you want a name to resolve to a fixed address, and
**split DNS** when an entire domain should be resolved by another DNS server.
:::

::: warning Inline records and a records file
Headscale accepts both `dns.extra_records` (inline) and `dns.extra_records_path`
(a JSON file). When both are set, the file wins and the inline records are
ignored; the system status page flags that combination so it does not surprise
you later.
:::
