import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  clearHostEchoCache,
  createHostEchoProbe,
  DEFAULT_HOST_ECHO_SETTINGS,
  DEFAULT_HOST_ECHO_URL,
  FALLBACK_HOST_ECHO_URLS,
  hostEchoUrls,
  loadHostEcho,
  normalizeHostEchoSettings,
  parseHostEchoBody,
  parseHostEchoUrl,
  readHostEchoSettings,
  writeHostEchoSettings,
} from "~/server/host-echo";

const STABLE = "240e:3b3:4030:1510::793";

describe("parseHostEchoBody", () => {
  test("reads the address out of a JSON answer", () => {
    expect(parseHostEchoBody('{"ip":"240e:3b3:4030:1510::793"}')).toBe(STABLE);
    expect(parseHostEchoBody('{"address":"2001:db8::1"}')).toBe("2001:db8::1");
    expect(parseHostEchoBody('"2001:db8::1"')).toBe("2001:db8::1");
  });

  test("reads the address out of a plain text answer", () => {
    expect(parseHostEchoBody("2001:db8::1\n")).toBe("2001:db8::1");
    expect(parseHostEchoBody("  2001:db8::1  ")).toBe("2001:db8::1");
  });

  test("rejects an IPv4 answer, a mapped address and a captive portal", () => {
    expect(parseHostEchoBody('{"ip":"203.0.113.7"}')).toBeUndefined();
    expect(parseHostEchoBody("203.0.113.7")).toBeUndefined();
    expect(parseHostEchoBody("::ffff:203.0.113.7")).toBeUndefined();
    expect(parseHostEchoBody("<html><body>login</body></html>")).toBeUndefined();
    expect(parseHostEchoBody('{"ip":')).toBeUndefined();
    expect(parseHostEchoBody("")).toBeUndefined();
    expect(parseHostEchoBody("fd9b:d247:c700::793")).toBeUndefined();
  });
});

describe("parseHostEchoUrl", () => {
  test("accepts the two protocols the probe can dial", () => {
    expect(parseHostEchoUrl("https://api64.ipify.org?format=json")).toBe(
      "https://api64.ipify.org?format=json",
    );
    expect(parseHostEchoUrl("  http://echo.example.com/v6 ")).toBe("http://echo.example.com/v6");
  });

  test("rejects anything else, so a stored value cannot become a file read", () => {
    expect(parseHostEchoUrl("file:///etc/passwd")).toBeUndefined();
    expect(parseHostEchoUrl("ftp://example.com")).toBeUndefined();
    expect(parseHostEchoUrl("not a url")).toBeUndefined();
    expect(parseHostEchoUrl("")).toBeUndefined();
    expect(parseHostEchoUrl(undefined)).toBeUndefined();
    expect(parseHostEchoUrl(42)).toBeUndefined();
  });
});

describe("normalizeHostEchoSettings", () => {
  test("is off by default and falls back to the built-in endpoint", () => {
    expect(normalizeHostEchoSettings(undefined)).toEqual({
      enabled: false,
      url: DEFAULT_HOST_ECHO_URL,
    });
    expect(normalizeHostEchoSettings({ enabled: true, url: "junk" })).toEqual({
      enabled: true,
      url: DEFAULT_HOST_ECHO_URL,
    });
    expect(DEFAULT_HOST_ECHO_SETTINGS.enabled).toBe(false);
  });
});

describe("hostEchoUrls", () => {
  test("asks the configured endpoint first and then the fallbacks", () => {
    expect(hostEchoUrls(DEFAULT_HOST_ECHO_URL)).toEqual([
      DEFAULT_HOST_ECHO_URL,
      ...FALLBACK_HOST_ECHO_URLS,
    ]);
  });

  test("a custom endpoint is never asked twice", () => {
    const urls = hostEchoUrls("https://echo.example.com/v6");
    expect(urls[0]).toBe("https://echo.example.com/v6");
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(1 + FALLBACK_HOST_ECHO_URLS.length);
  });
});

describe("the stored settings", () => {
  test("a missing or corrupt file reads as off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "headplane-echo-"));
    try {
      expect(await readHostEchoSettings(dir)).toEqual(DEFAULT_HOST_ECHO_SETTINGS);

      await writeFile(join(dir, "host-echo.json"), "{ not json", "utf8");
      expect(await readHostEchoSettings(dir)).toEqual(DEFAULT_HOST_ECHO_SETTINGS);

      await writeFile(join(dir, "host-echo.json"), '{ "enabled": "yes" }', "utf8");
      expect(await readHostEchoSettings(dir)).toEqual(DEFAULT_HOST_ECHO_SETTINGS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a saved setting is read back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "headplane-echo-"));
    try {
      expect(
        await writeHostEchoSettings(dir, { enabled: true, url: "https://echo.example.com/v6" }),
      ).toBe(true);
      expect(await readHostEchoSettings(dir)).toEqual({
        enabled: true,
        url: "https://echo.example.com/v6",
      });
      // The file is plain JSON, so an operator can read and edit it by hand.
      expect(await readFile(join(dir, "host-echo.json"), "utf8")).toContain(
        '"url": "https://echo.example.com/v6"',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createHostEchoProbe", () => {
  test("does nothing at all while it is disabled", async () => {
    let calls = 0;
    const probe = createHostEchoProbe({
      fetchText: async () => {
        calls += 1;
        return '{"ip":"2001:db8::1"}';
      },
    });

    expect(await probe.probe({ enabled: false, url: DEFAULT_HOST_ECHO_URL })).toEqual({
      reason: "disabled",
      attempted: [],
    });
    expect(calls).toBe(0);
  });

  test("returns the address a JSON endpoint reports", async () => {
    const probe = createHostEchoProbe({
      fetchText: async () => `{"ip":"${STABLE}"}`,
    });

    expect(await probe.probe({ enabled: true, url: DEFAULT_HOST_ECHO_URL })).toMatchObject({
      address: STABLE,
      url: DEFAULT_HOST_ECHO_URL,
    });
  });

  test("falls back to the next endpoint when the first one fails", async () => {
    const attempted: string[] = [];
    const probe = createHostEchoProbe({
      fetchText: async (url) => {
        attempted.push(url);
        if (url === DEFAULT_HOST_ECHO_URL) {
          throw new Error("ECONNREFUSED");
        }

        return STABLE;
      },
    });

    const result = await probe.probe({ enabled: true, url: DEFAULT_HOST_ECHO_URL });
    expect(result).toMatchObject({ address: STABLE, url: FALLBACK_HOST_ECHO_URLS[0] });
    expect(attempted).toEqual([DEFAULT_HOST_ECHO_URL, FALLBACK_HOST_ECHO_URLS[0]]);
  });

  test("a timeout is reported as a timeout", async () => {
    const probe = createHostEchoProbe({
      fetchText: (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      timeoutMs: 5,
      budgetMs: 0,
    });

    expect(await probe.probe({ enabled: true, url: DEFAULT_HOST_ECHO_URL })).toMatchObject({
      reason: "timeout",
      attempted: [DEFAULT_HOST_ECHO_URL],
    });
  });

  test("an unreachable endpoint is reported as unreachable", async () => {
    const probe = createHostEchoProbe({
      fetchText: async () => {
        throw Object.assign(new Error("nope"), { code: "ENETUNREACH" });
      },
      budgetMs: 0,
    });

    expect(await probe.probe({ enabled: true, url: DEFAULT_HOST_ECHO_URL })).toMatchObject({
      reason: "unreachable",
      attempted: [DEFAULT_HOST_ECHO_URL],
    });
  });

  test("a garbage body is reported instead of a wrong address", async () => {
    const probe = createHostEchoProbe({
      fetchText: async () => "<html>captive portal</html>",
      budgetMs: 0,
    });

    expect(await probe.probe({ enabled: true, url: DEFAULT_HOST_ECHO_URL })).toMatchObject({
      reason: "invalid",
    });
  });

  test("an answer is cached, and the cache can be dropped", async () => {
    let calls = 0;
    const probe = createHostEchoProbe({
      fetchText: async () => {
        calls += 1;
        return STABLE;
      },
    });

    const settings = { enabled: true, url: DEFAULT_HOST_ECHO_URL };
    expect((await probe.probe(settings)).address).toBe(STABLE);
    expect((await probe.probe(settings)).address).toBe(STABLE);
    expect(calls).toBe(1);

    probe.clearCache();
    expect((await probe.probe(settings)).address).toBe(STABLE);
    expect(calls).toBe(2);
  });

  test("changing the endpoint is never served from the previous cache", async () => {
    const asked: string[] = [];
    const probe = createHostEchoProbe({
      fetchText: async (url) => {
        asked.push(url);
        return STABLE;
      },
      budgetMs: 0,
    });

    await probe.probe({ enabled: true, url: DEFAULT_HOST_ECHO_URL });
    await probe.probe({ enabled: true, url: "https://echo.example.com/v6" });

    expect(asked).toEqual([DEFAULT_HOST_ECHO_URL, "https://echo.example.com/v6"]);
  });

  test("a failure is cached briefly, so a broken probe cannot slow every render", async () => {
    let calls = 0;
    let now = 0;
    const probe = createHostEchoProbe({
      fetchText: async () => {
        calls += 1;
        throw new Error("ECONNREFUSED");
      },
      budgetMs: 0,
      now: () => now,
      failureTtlMs: 1_000,
    });

    const settings = { enabled: true, url: DEFAULT_HOST_ECHO_URL };
    await probe.probe(settings);
    await probe.probe(settings);
    expect(calls).toBe(1);

    now = 2_000;
    await probe.probe(settings);
    expect(calls).toBe(2);
  });

  test("the shared probe is off unless an operator turned it on", async () => {
    clearHostEchoCache();
    // The default settings never reach the network at all, which is what keeps
    // a third-party request off unless somebody asked for it.
    expect(await loadHostEcho(DEFAULT_HOST_ECHO_SETTINGS)).toEqual({
      reason: "disabled",
      attempted: [],
    });
  });
});
