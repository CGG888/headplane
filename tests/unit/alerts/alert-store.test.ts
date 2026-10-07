import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { emptyAlertState } from "~/server/alerts/events";
import { DEFAULT_ALERT_SETTINGS } from "~/server/alerts/settings";
import {
  ALERTS_FILE,
  ALERT_HISTORY_LIMIT,
  alertsPath,
  appendDelivery,
  defaultAlertsDocument,
  parseAlertsDocument,
  readAlertsDocument,
  serializeAlertsDocument,
  writeAlertsDocument,
  type AlertsDocument,
} from "~/server/alerts/store";
import type { AlertDelivery } from "~/server/alerts/types";
import log from "~/utils/log";

vi.mock("~/utils/log");

function delivery(index: number): AlertDelivery {
  return {
    id: `id-${index}`,
    at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    event: "nodeOffline",
    ok: index % 2 === 0,
    status: index % 2 === 0 ? 200 : 500,
    error: index % 2 === 0 ? null : "HTTP 500",
    target: `node-${index}`,
  };
}

describe("alert document parsing", () => {
  test("a missing or corrupt document reads as the defaults", () => {
    expect(parseAlertsDocument(undefined)).toEqual(defaultAlertsDocument());
    expect(parseAlertsDocument("")).toEqual(defaultAlertsDocument());
    expect(parseAlertsDocument("{not json")).toEqual(defaultAlertsDocument());
    expect(parseAlertsDocument("[1,2,3]")).toEqual(defaultAlertsDocument());
    expect(parseAlertsDocument("null")).toEqual(defaultAlertsDocument());
  });

  test("reports why a stored document was ignored", () => {
    const reasons: string[] = [];
    const report = (reason: string) => reasons.push(reason);

    // No document at all is the normal first-run state and is not reported.
    parseAlertsDocument(undefined, report);
    parseAlertsDocument("{not json", report);
    parseAlertsDocument("null", report);

    expect(reasons).toEqual(["the file is not valid JSON", "the file does not hold a JSON object"]);
  });

  test("normalizes hand-edited settings instead of trusting them", () => {
    const document = parseAlertsDocument(
      JSON.stringify({
        settings: {
          enabled: true,
          webhookUrl: "  https://example.com/hook  ",
          secret: "s3cret",
          notificationLanguage: "zh-Hans",
          events: ["nodeOffline", "notAnEvent", "nodeOffline"],
          intervalSeconds: 5,
          cooldownSeconds: 10_000_000,
          apiKeyExpiryDays: "not a number",
        },
      }),
    );

    expect(document.settings).toEqual({
      enabled: true,
      webhookUrl: "https://example.com/hook",
      secret: "s3cret",
      notificationLanguage: "zh-Hans",
      // A document written before the format setting existed stays on the
      // generic payload, which is what its endpoint already parses.
      webhookFormat: "generic",
      events: ["nodeOffline"],
      intervalSeconds: 15,
      cooldownSeconds: 86_400,
      apiKeyExpiryDays: DEFAULT_ALERT_SETTINGS.apiKeyExpiryDays,
    });
  });

  test("an unknown notification language falls back to the default", () => {
    for (const value of ["klingon", "", 7, undefined]) {
      const document = parseAlertsDocument(
        JSON.stringify({
          settings: { webhookUrl: "https://example.com/hook", notificationLanguage: value },
        }),
      );

      expect(document.settings.notificationLanguage, String(value)).toBe("default");
    }
  });

  test("drops history entries that are not usable", () => {
    const document = parseAlertsDocument(
      JSON.stringify({
        history: [
          delivery(1),
          { id: "x", at: "whenever", event: "unknown", ok: true },
          { id: "y", at: "whenever", event: "test", ok: false, status: null, error: "boom" },
          "nope",
        ],
      }),
    );

    expect(document.history.map((entry) => entry.id)).toEqual(["id-1", "y"]);
    expect(document.history[1]).toEqual({
      id: "y",
      at: "whenever",
      event: "test",
      ok: false,
      status: null,
      error: "boom",
    });
  });

  test("a missing state falls back to the empty state", () => {
    expect(parseAlertsDocument(JSON.stringify({ settings: {} })).state).toEqual(emptyAlertState());
  });

  test("serializes stable JSON with a trailing newline and the capped history", () => {
    const history = Array.from({ length: ALERT_HISTORY_LIMIT + 10 }, (_, index) => delivery(index));
    const raw = serializeAlertsDocument({
      settings: DEFAULT_ALERT_SETTINGS,
      history,
      state: emptyAlertState(),
    });

    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).history).toHaveLength(ALERT_HISTORY_LIMIT);
  });
});

describe("alert history cap", () => {
  test("keeps the newest deliveries first and drops the oldest", () => {
    let history: AlertDelivery[] = [];
    for (let index = 0; index < ALERT_HISTORY_LIMIT + 5; index++) {
      history = appendDelivery(history, delivery(index));
    }

    expect(history).toHaveLength(ALERT_HISTORY_LIMIT);
    expect(history[0].id).toBe(`id-${ALERT_HISTORY_LIMIT + 4}`);
    expect(history.at(-1)?.id).toBe("id-5");
  });
});

describe("alert file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-alerts-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lives in the data directory under a fixed name", () => {
    expect(ALERTS_FILE).toBe("alerts.json");
    expect(alertsPath(dir)).toBe(join(dir, ALERTS_FILE));
  });

  test("round-trips a document through an atomic write", async () => {
    const document: AlertsDocument = {
      settings: {
        ...DEFAULT_ALERT_SETTINGS,
        enabled: true,
        webhookUrl: "https://example.com/hook",
        events: ["nodeOffline", "configCheckFailed"],
      },
      history: [delivery(1)],
      state: { ...emptyAlertState(), reachable: false, offlineNodes: ["n1"] },
    };

    expect(await writeAlertsDocument(dir, document)).toBe(true);
    // The temp file is renamed into place, so only the target remains.
    expect(await readdir(dir)).toEqual([ALERTS_FILE]);

    const read = await readAlertsDocument(dir);
    expect(read.settings).toEqual(document.settings);
    expect(read.history).toEqual(document.history);
    expect(read.state).toEqual(document.state);
    expect((await readFile(alertsPath(dir), "utf8")).endsWith("\n")).toBe(true);
  });

  test("a missing file reads as the defaults", async () => {
    expect(await readAlertsDocument(dir)).toEqual(defaultAlertsDocument());
    // A first run has no file yet, so this must not look like a problem.
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("a corrupt file reads as the defaults instead of throwing", async () => {
    await writeFile(alertsPath(dir), "{ half written", "utf8");
    expect(await readAlertsDocument(dir)).toEqual(defaultAlertsDocument());
    expect(log.warn).toHaveBeenCalledWith(
      "server",
      "Ignoring the alerts stored in %s: %s",
      alertsPath(dir),
      "the file is not valid JSON",
    );
  });

  test("an empty file reads as the defaults and says so", async () => {
    await writeFile(alertsPath(dir), "", "utf8");
    expect(await readAlertsDocument(dir)).toEqual(defaultAlertsDocument());
    expect(log.warn).toHaveBeenCalledWith(
      "server",
      "Ignoring the alerts stored in %s: %s",
      alertsPath(dir),
      "the file is empty",
    );
  });

  test("a JSON value that is not an object reads as the defaults and says so", async () => {
    await writeFile(alertsPath(dir), "[1,2,3]", "utf8");
    expect(await readAlertsDocument(dir)).toEqual(defaultAlertsDocument());
    expect(log.warn).toHaveBeenCalledWith(
      "server",
      "Ignoring the alerts stored in %s: %s",
      alertsPath(dir),
      "the file does not hold a JSON object",
    );
  });

  test("an unwritable data directory reports failure instead of throwing", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    expect(await writeAlertsDocument(blocker, defaultAlertsDocument())).toBe(false);
    expect(await readAlertsDocument(blocker)).toEqual(defaultAlertsDocument());
  });

  test("an unreadable file reports why it was ignored", async () => {
    // A directory in the place of the file fails with EISDIR on every
    // platform, unlike a path that runs through a plain file (which Windows
    // reports as a missing file).
    await mkdir(alertsPath(dir), { recursive: true });

    expect(await readAlertsDocument(dir)).toEqual(defaultAlertsDocument());
    expect(log.warn).toHaveBeenCalledWith(
      "server",
      "Cannot read %s: %s",
      alertsPath(dir),
      expect.any(String),
    );
  });
});
