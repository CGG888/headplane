// MARK: Alert event detection
//
// The rule engine behind the notifier. It is pure: given the previous state,
// the current snapshot, the settings and the wall clock, it returns the
// transitions worth reporting plus the state the next tick starts from. No
// filesystem, network or clock access happens in here, so every rule below is
// unit tested without a server.
//
// Two guards keep the stream quiet:
//   - an event only fires when something *changed*, tracked per condition, so a
//     node that is still offline never alerts twice;
//   - the cooldown suppresses a condition that flaps back inside the window.
//
// A snapshot section that could not be gathered (`nodesAvailable`,
// `apiKeysAvailable`, `configChecks.available`) leaves the matching slice of the
// state untouched. That is what stops an unreachable Headscale from being
// reported as "every node went offline", and an unreadable configuration file
// from inventing failing checks.

import type { AlertEvent, AlertSettings, AlertSeverity, AlertSnapshot, AlertState } from "./types";

export interface AlertDetection {
  events: AlertEvent[];
  state: AlertState;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const SEVERITIES: Record<string, AlertSeverity> = {
  headscaleUnreachable: "critical",
  headscaleRecovered: "info",
  nodeOffline: "warning",
  nodeOnline: "info",
  apiKeyExpiring: "warning",
  configCheckFailed: "warning",
  derpSyncFailed: "warning",
};

/** The severity one event id is reported with. */
export function alertSeverity(id: AlertEvent["id"]): AlertSeverity {
  return SEVERITIES[id];
}

/** The state a fresh process (or a corrupt document) starts from. */
export function emptyAlertState(): AlertState {
  return {
    // Assume reachable: Headplane boots fine while Headscale is still starting,
    // and the first failed tick should be a real transition into "unreachable".
    reachable: true,
    offlineNodes: [],
    expiringKeys: [],
    failingChecks: [],
    // A run that has not happened yet has not failed.
    derpSyncFailed: false,
    sent: {},
  };
}

/** Stable key for one condition, used by the cooldown map. */
function conditionKey(event: AlertEvent): string {
  return event.target === undefined ? event.id : `${event.id}:${event.target}`;
}

/**
 * Applies the two guards that keep the stream quiet, for one candidate event:
 * the enabled/selected filter, and the cooldown against the same condition.
 * Records the send in `sent` and returns the event, or `undefined` when the
 * event is suppressed. Shared with the DERP sync's out-of-band report, so both
 * paths dedupe and cool down identically.
 */
export function emitAlertEvent(
  sent: Record<string, string>,
  event: AlertEvent,
  settings: AlertSettings,
  now: Date,
): AlertEvent | undefined {
  if (!settings.enabled || !settings.events.includes(event.id)) {
    return undefined;
  }

  const key = conditionKey(event);
  const last = sent[key];
  if (last !== undefined) {
    const lastMs = Date.parse(last);
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < settings.cooldownSeconds * 1000) {
      return undefined;
    }
  }

  sent[key] = event.at;
  return event;
}

/** Compares two states, ignoring array and map ordering. */
export function sameAlertState(a: AlertState, b: AlertState): boolean {
  return (
    a.reachable === b.reachable &&
    a.derpSyncFailed === b.derpSyncFailed &&
    sameIds(a.offlineNodes, b.offlineNodes) &&
    sameIds(a.expiringKeys, b.expiringKeys) &&
    sameIds(a.failingChecks, b.failingChecks) &&
    sameIds(Object.keys(a.sent), Object.keys(b.sent))
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

export function detectAlertEvents(
  previous: AlertState,
  snapshot: AlertSnapshot,
  settings: AlertSettings,
  now: Date,
): AlertDetection {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const sent: Record<string, string> = { ...previous.sent };
  const events: AlertEvent[] = [];

  function emit(id: AlertEvent["id"], extra: Pick<AlertEvent, "target" | "threshold"> = {}) {
    const event = emitAlertEvent(
      sent,
      { id, severity: SEVERITIES[id], at: nowIso, ...extra },
      settings,
      now,
    );
    if (event !== undefined) {
      events.push(event);
    }
  }

  // Reachability: one alert when Headscale drops, one when it comes back.
  if (snapshot.reachable && !previous.reachable) {
    emit("headscaleRecovered");
  } else if (!snapshot.reachable && previous.reachable) {
    emit("headscaleUnreachable");
  }

  let offlineNodes = previous.offlineNodes;
  if (snapshot.nodesAvailable) {
    const offline = new Map(snapshot.nodes.filter((node) => !node.online).map((n) => [n.id, n]));
    const known = new Set(previous.offlineNodes);

    for (const [id, node] of offline) {
      if (!known.has(id)) {
        emit("nodeOffline", { target: node.name });
      }
    }

    for (const id of previous.offlineNodes) {
      if (!offline.has(id)) {
        // The node came back, or it was removed from the tailnet entirely; the
        // name is unknown once it is gone, so the id stands in for it.
        emit("nodeOnline", { target: snapshot.nodes.find((node) => node.id === id)?.name ?? id });
      }
    }

    offlineNodes = [...offline.keys()];
  }

  let expiringKeys = previous.expiringKeys;
  if (snapshot.apiKeysAvailable) {
    const windowMs = settings.apiKeyExpiryDays * DAY_MS;
    const expiring = new Set<string>();

    for (const key of snapshot.apiKeys) {
      const expirationMs = Date.parse(key.expiration);
      if (!Number.isFinite(expirationMs)) {
        continue;
      }

      const remaining = expirationMs - nowMs;
      if (remaining <= 0 || remaining > windowMs) {
        continue;
      }

      expiring.add(key.id);
      if (!previous.expiringKeys.includes(key.id)) {
        emit("apiKeyExpiring", { target: key.prefix, threshold: settings.apiKeyExpiryDays });
      }
    }

    expiringKeys = [...expiring];
  }

  let failingChecks = previous.failingChecks;
  if (snapshot.configChecks.available) {
    failingChecks = [...new Set(snapshot.configChecks.failing)];
    for (const id of failingChecks) {
      if (!previous.failingChecks.includes(id)) {
        emit("configCheckFailed", { target: id });
      }
    }
  }

  return {
    events,
    state: {
      reachable: snapshot.reachable,
      offlineNodes,
      expiringKeys,
      failingChecks,
      // The DERP sync reports its own outcome out of band, so a tick must not
      // clear the flag that remembers whether the last run failed.
      derpSyncFailed: previous.derpSyncFailed,
      sent,
    },
  };
}
