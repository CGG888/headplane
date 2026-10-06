---
title: Alert Notifications
description: Post to a webhook when Headscale, a node, an API key or a configuration check needs attention.
outline: [2, 3]
---

# Alert Notifications

**Settings → Alert Notifications** posts a JSON body to one webhook whenever
something needs attention: Headscale dropping out of reach, a node going offline,
an API key about to expire, a configuration check turning into a failure, or a
DERP address sync run that could not write. It
is the push half of the [System Status](/en/features/system-status) page — that page
tells you what is wrong when you look, this one tells you when you are not
looking.

A background loop does the watching. It is completely inert while notifications
are disabled: no timer is scheduled and no probe is made, so an instance that
never turns this on pays nothing for it. Enabling it also requires a valid
webhook URL — the settings form refuses to save an enabled channel without one.

## Reported events

Every event fires on a **state change**, never repeatedly. HeadplaneCN remembers
what the previous check concluded, so a node that is still offline on the next
tick is not reported again, and a Headscale that stays down is one alert rather
than one per interval.

| Event                      | Severity   | Fires when                                                                                                                                              |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headscale unreachable      | `critical` | A health probe fails after a probe that succeeded.                                                                                                      |
| Headscale recovered        | `info`     | A health probe succeeds again after one that failed.                                                                                                    |
| Node went offline          | `warning`  | A node that was online in the previous check is offline now; the target is the node's name.                                                             |
| Node came back online      | `info`     | A node that was offline in the previous check is no longer offline; the target is its name, or its id if it left the tailnet.                           |
| API key expiring           | `warning`  | A key enters the warning window; the target is the key prefix and `threshold` is the window in days. A key already past its expiration is not reported. |
| Configuration check failed | `warning`  | A configuration check newly reports `fail`; the target is the check id.                                                                                 |
| DERP address sync failed   | `warning`  | A **writing** [address auto-sync](/en/features/headscale-settings#address-auto-sync) or [official region filter](/en/features/headscale-settings#official-region-filter) run fails; see below. |

The DERP sync events are reported by the sync services themselves rather than by
the background check loop, but they go through the same enabled/selected filter,
the same cooldown and the same delivery history:

- It fires only for a run that **writes**. A **Check** never reports anything,
  because its result is on the screen in front of you, and a run that found
  nothing to change is not a failure either.
- It fires when a writing run failed: nothing usable was detected for a family,
  the configuration was not writable, the write itself failed, or the reload
  that follows it failed. The target carries the reason — the failure code for
  the address sync, or `derp-region-mirror:<code>` for the region filter — and
  the payload's title is the one shown above.
- **A later successful writing run clears it.** Nothing is sent for the success;
  the flag is only reset, so the next failure is a new transition and is
  reported again. While the notifier is switched off, a failure is not recorded
  at all, so turning notifications on and seeing another failure is still a real
  transition worth reporting.

The cooldown sits on top of that: when a condition does change back inside the
cooldown window, the repeat is suppressed. It is what stops a flapping node from
turning into a stream of notifications.

Two situations are deliberately silent rather than guessed at:

- **An unreachable Headscale is not a tailnet-wide outage.** While the API cannot
  be reached, the node and API key lists are not fetched at all, and the previous
  conclusions for them are left untouched. Every node is never reported offline
  just because HeadplaneCN cannot ask.
- **An unreadable configuration is not a failing one.** When Headscale's
  configuration file is missing, unreadable or unparseable, the configuration
  checks simply did not run: HeadplaneCN logs a warning and raises no alert, and the
  previous check state is kept.
- **Node and API key events need an API key.** Without `headscale.api_key`
  HeadplaneCN cannot list nodes or keys, so those three events are never detected;
  reachability, the configuration checks and the DERP sync reports still are.

## Settings

| Setting                | Default | Accepted range | Notes                                                            |
| ---------------------- | ------- | -------------- | ---------------------------------------------------------------- |
| Webhook URL            | empty   | —              | Absolute `http` or `https` URL; required to enable or test.      |
| Shared secret          | empty   | —              | Optional; sent as the `X-Headplane-Secret` header on every POST. |
| Reported events        | all seven | —              | At least one must stay selected.                                 |
| Check interval         | 60 s    | 15–3600        | How often HeadplaneCN looks for changes.                           |
| Cooldown               | 300 s   | 30–86400       | Shortest time before the same condition may be reported again.   |
| API key warning window | 7 days  | 1–90           | How far ahead an expiring API key is worth reporting.            |

Values outside those ranges are rejected with an error instead of being silently
changed; a hand-edited `alerts.json` is clamped to the same bounds instead.
Unchecking an event does not stop HeadplaneCN tracking that condition — it only
stops it being sent — so a condition that begins while its event is unchecked is
not reported when you re-check it.

## The payload

Each delivery is one `POST` with `Content-Type: application/json`, aborted after
five seconds so a stalled endpoint cannot hold a check open. The copy is English
and outside the translation catalogs, so automation can match on stable text:

| Field       | Meaning                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `event`     | One of the seven event ids above, or `test`.                                                                                 |
| `title`     | Short headline, e.g. `Node went offline`.                                                                                    |
| `severity`  | `info`, `warning` or `critical`.                                                                                             |
| `summary`   | One line with the target and threshold filled in.                                                                            |
| `details`   | `{ "target": …, "threshold": … }`; either key is absent when the event has no such value — `{}` for the reachability events. |
| `timestamp` | ISO 8601 time the change was **observed**, not when the delivery was attempted.                                              |
| `version`   | The HeadplaneCN build that sent it.                                                                                            |

```json
{
  "event": "nodeOffline",
  "title": "Node went offline",
  "severity": "warning",
  "summary": "laptop is no longer connected to the tailnet.",
  "details": { "target": "laptop" },
  "timestamp": "2026-10-05T08:27:45.000Z",
  "version": "0.20.0"
}
```

That is enough for an n8n workflow, a Matrix or Slack relay, or a monitoring
system: match on `event` and `severity`, quote `title` and `summary`, and use
`details.target` to say which node, key or check it was about.

## Testing and delivery history

**Send test** posts a sample payload right now, using the URL and secret that are
currently in the form — unsaved edits included — so a channel can be verified
before it is enabled. It reports **Delivered (HTTP 200)** or **Not delivered**
with the status and the error text, and the attempt is recorded in the history.

The **Delivery history** card lists the last 50 attempts, newest first, each with
the event, whether it was delivered, the HTTP status when there was a response,
the target and threshold, and a truncated error for the failures. When the newest
attempt failed, the page says so at the top as well. History survives restarts,
because it is kept next to the state rather than in memory.

## Where the state lives

Everything lives in `alerts.json`, directly inside HeadplaneCN's data directory
(`server.data_path`): the settings, the delivery history, and the last-known state
the detector compares against — whether Headscale was reachable, which nodes were
offline, which keys were inside the window, which checks were failing, whether the
last DERP sync run failed, and when each condition was last reported. There is no
database table and no migration to run.

A missing or corrupt file reads as the defaults, and a write goes through a
temporary file plus a rename, so an interrupted write leaves the earlier document
intact.

## What it does not do

- **One channel only.** Every event goes to the single configured webhook; there
  is no second endpoint and no per-event routing.
- **No retries.** A failed delivery is recorded in the history and is not retried
  on its own. The same condition is only reported again when it changes state
  again, and a repeat inside the cooldown window is suppressed.
- **No per-user routing.** Notifications are not sent to the person who owns the
  node or the key; who hears about it is decided by whatever consumes the webhook.
- **Not a replacement for the audit log or the configuration checks.** The
  [Audit Log](/en/features/audit) remains the record of what changed, and the
  configuration checks on [System Status](/en/features/system-status) remain the
  detail view. These notifications are a nudge towards them, not a substitute.
