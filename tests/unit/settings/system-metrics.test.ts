import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  deriveMetricsTarget,
  formatMetricValue,
  parseMetrics,
  summarizeMetrics,
} from "~/routes/settings/system/metrics";
import { loadMetrics, RAW_METRICS_LIMIT } from "~/routes/settings/system/metrics-probe";
import {
  createReleaseChecker,
  HEADPLANE_RELEASES_URL,
} from "~/routes/settings/system/release-check";
import { selfUpdateNotice } from "~/routes/settings/system/self-update";
import { parseServerVersion } from "~/server/headscale/api/server-version";

import { clearFakeFiles, createFakeFile } from "../setup/overlay-fs";

// The probe and the release checker log their failures; keep the test output clean.
vi.mock("~/utils/log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    debugEnabled: false,
  },
}));

describe("metrics address derivation", () => {
  test("keeps a loopback address exactly as Headscale configured it", () => {
    const target = deriveMetricsTarget(
      { metrics_listen_addr: "127.0.0.1:9090" },
      "http://headscale.example.com:8080",
    );

    expect(target).toEqual({
      kind: "ok",
      address: "127.0.0.1:9090",
      url: "http://127.0.0.1:9090/metrics",
    });
  });

  test("substitutes the Headscale host when the listener binds every interface", () => {
    for (const value of ["0.0.0.0:9090", "[::]:9090"]) {
      const target = deriveMetricsTarget(
        { metrics_listen_addr: value },
        "http://headscale.example.com:8080",
      );

      expect(target, value).toEqual({
        kind: "ok",
        address: "headscale.example.com:9090",
        url: "http://headscale.example.com:9090/metrics",
      });
    }
  });

  test("keeps brackets around an IPv6 host taken from the Headscale URL", () => {
    const target = deriveMetricsTarget(
      { metrics_listen_addr: "[::]:9090" },
      "http://[fd00::1]:8080",
    );

    expect(target).toEqual({
      kind: "ok",
      address: "[fd00::1]:9090",
      url: "http://[fd00::1]:9090/metrics",
    });
  });

  test("leaves an unspecified host alone when Headplane has no usable URL", () => {
    for (const url of [undefined, "not a url", "http://0.0.0.0:8080"]) {
      const target = deriveMetricsTarget({ metrics_listen_addr: "0.0.0.0:9090" }, url);

      expect(target, String(url)).toEqual({
        kind: "ok",
        address: "0.0.0.0:9090",
        url: "http://0.0.0.0:9090/metrics",
      });
    }
  });

  test("reads a missing or empty key as the listener being disabled", () => {
    expect(deriveMetricsTarget({}, "http://headscale:8080")).toEqual({ kind: "disabled" });
    expect(deriveMetricsTarget({ metrics_listen_addr: null }, undefined)).toEqual({
      kind: "disabled",
    });
    expect(deriveMetricsTarget({ metrics_listen_addr: "  " }, undefined)).toEqual({
      kind: "disabled",
    });
  });

  test("reports an unparsable value as invalid and keeps it for the message", () => {
    const garbage = [
      "not an address",
      "127.0.0.1",
      ":9090",
      "127.0.0.1:0",
      "127.0.0.1:99999",
      "fd00::1:9090",
      "[::]9090",
    ];

    for (const value of garbage) {
      expect(deriveMetricsTarget({ metrics_listen_addr: value }, undefined), value).toEqual({
        kind: "invalid",
        raw: value,
      });
    }

    expect(deriveMetricsTarget({ metrics_listen_addr: 9090 }, undefined)).toEqual({
      kind: "invalid",
      raw: "9090",
    });
  });

  test("says nothing rather than 'disabled' when the config is unreadable", () => {
    for (const config of [undefined, null, "a scalar", [1, 2]]) {
      expect(deriveMetricsTarget(config, undefined)).toEqual({ kind: "unknown" });
    }
  });
});

const EXPOSITION = `# HELP headscale_nodes_total Nodes known to Headscale.
# TYPE headscale_nodes_total gauge
headscale_nodes_total{status="online"} 3
headscale_nodes_total{status="offline"} 2
# TYPE headscale_users_total counter
headscale_users_total 4
# TYPE headscale_derp_connections_total counter
headscale_derp_connections_total{region="eu",relay="ams"} 1.5e+03
# TYPE headscale_policy_updates_total counter
headscale_policy_updates_total 2
go_goroutines 42
process_start_time_seconds 1.7e+09
process_cpu_seconds_total 12.5
# TYPE headscale_http_duration_seconds histogram
headscale_http_duration_seconds_bucket{le="0.1"} 9
headscale_http_duration_seconds_sum 1.2
headscale_http_duration_seconds_count 10
this is not a metric
`;

describe("metrics exposition parser", () => {
  test("parses samples, labels, types, and scientific notation", () => {
    const parsed = parseMetrics(EXPOSITION);

    expect(parsed.samples).toHaveLength(11);
    expect(parsed.types.headscale_nodes_total).toBe("gauge");
    expect(parsed.types.headscale_http_duration_seconds).toBe("histogram");

    const relay = parsed.samples.find((sample) =>
      sample.name.startsWith("headscale_derp_connections_total"),
    );
    expect(relay?.labels).toEqual({ region: "eu", relay: "ams" });
    expect(relay?.value).toBe(1500);

    expect(parsed.samples.find((sample) => sample.name === "go_goroutines")?.value).toBe(42);
  });

  test("skips comments, blank lines, and malformed lines", () => {
    const parsed = parseMetrics(
      [
        "# HELP something A help text.",
        "# TYPE something counter",
        "",
        "something 1",
        "broken line here",
        "no_value{}",
        'unterminated{label="x} 1',
        "trailing 3",
      ].join("\n"),
    );

    expect(parsed.samples.map((sample) => sample.name)).toEqual(["something", "trailing"]);
    expect(parsed.types.something).toBe("counter");
  });

  test("unwraps escaped label values", () => {
    const parsed = parseMetrics('metric{path="/a\\"b",note="line\\nbreak"} 1');

    expect(parsed.samples[0].labels).toEqual({ path: '/a"b', note: "line\nbreak" });
  });
});

describe("metrics summary", () => {
  test("groups the useful families and derives uptime and goroutines", () => {
    const summary = summarizeMetrics(parseMetrics(EXPOSITION), (1_700_000_000 + 90_000) * 1000);

    expect(summary.groups.map((group) => group.id)).toEqual([
      "nodes",
      "users",
      "relay",
      "policy",
      "process",
    ]);

    const nodes = summary.groups.find((group) => group.id === "nodes")?.families[0];
    expect(nodes).toEqual({ name: "headscale_nodes_total", value: 5, series: 2 });

    // The histogram is not a number anyone reads off a status page.
    const names = summary.groups.flatMap((group) => group.families.map((family) => family.name));
    expect(names).not.toContain("headscale_http_duration_seconds_bucket");
    expect(names).not.toContain("go_goroutines");

    expect(summary.goroutines).toBe(42);
    expect(summary.uptimeSeconds).toBe(90_000);
  });

  test("reports nothing it did not find", () => {
    const summary = summarizeMetrics(parseMetrics(""));

    expect(summary.groups).toEqual([]);
    expect(summary.goroutines).toBeUndefined();
    expect(summary.uptimeSeconds).toBeUndefined();
  });

  test("formats numbers the same way on the server and in the browser", () => {
    expect(formatMetricValue(1234567)).toBe("1,234,567");
    expect(formatMetricValue(1500)).toBe("1,500");
    expect(formatMetricValue(12.5)).toBe("12.50");
    expect(formatMetricValue(Number.NaN)).toBe("—");
  });
});

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const CONFIG_PATH = "/etc/headscale/config.yaml";

describe("metrics fetch", () => {
  beforeEach(() => {
    clearFakeFiles();
  });

  test("reads the address from Headscale's config file and fetches it", async () => {
    createFakeFile(CONFIG_PATH, "metrics_listen_addr: 127.0.0.1:9090\n");
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(EXPOSITION));

    const report = await loadMetrics(CONFIG_PATH, "http://headscale:8080", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_700_090_000_000,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:9090/metrics",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(report.state).toBe("ok");
    if (report.state !== "ok") return;

    expect(report.address).toBe("127.0.0.1:9090");
    expect(report.truncated).toBe(false);
    expect(report.summary.goroutines).toBe(42);
    expect(report.raw).toContain("headscale_nodes_total");
  });

  test("fails soft on an unreachable, timed out, or non-200 listener", async () => {
    createFakeFile(CONFIG_PATH, 'metrics_listen_addr: "0.0.0.0:9090"\n');
    const url = "http://headscale.example.com:9090/metrics";
    const address = "headscale.example.com:9090";

    const attempts = [
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:9090")),
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError")),
      vi.fn().mockResolvedValue(textResponse("nope", 404)),
      vi.fn().mockResolvedValue(textResponse("this is not exposition text")),
    ];

    for (const fetchImpl of attempts) {
      const report = await loadMetrics(CONFIG_PATH, "http://headscale.example.com:8080", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(report).toEqual({ state: "unreachable", address, url });
    }
  });

  test("never dials when Headscale does not configure a listener", async () => {
    createFakeFile(CONFIG_PATH, "server_url: http://headscale:8080\n");
    const fetchImpl = vi.fn();

    const report = await loadMetrics(CONFIG_PATH, "http://headscale:8080", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report).toEqual({ state: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("explains a garbage address and an unreadable config file", async () => {
    createFakeFile(CONFIG_PATH, "metrics_listen_addr: 9090\n");
    expect(await loadMetrics(CONFIG_PATH, undefined)).toEqual({
      state: "invalid",
      raw: "9090",
    });

    expect(await loadMetrics("/does/not/exist.yaml", undefined)).toEqual({ state: "unknown" });
    expect(await loadMetrics(undefined, undefined)).toEqual({ state: "unknown" });
  });

  test("truncates the raw view instead of shipping the whole endpoint", async () => {
    createFakeFile(CONFIG_PATH, "metrics_listen_addr: 127.0.0.1:9090\n");
    const body = `headscale_nodes_total 1\n# ${"x".repeat(RAW_METRICS_LIMIT * 2)}`;

    const report = await loadMetrics(CONFIG_PATH, undefined, {
      fetchImpl: vi.fn().mockResolvedValue(textResponse(body)) as unknown as typeof fetch,
    });

    expect(report.state).toBe("ok");
    if (report.state !== "ok") return;

    expect(report.truncated).toBe(true);
    expect(report.raw).toHaveLength(RAW_METRICS_LIMIT);
  });
});

describe("headplane self-update notice", () => {
  const latest = (tag: string) => parseServerVersion(tag);

  test("reports only a strictly newer release", () => {
    expect(selfUpdateNotice("0.6.0", latest("v0.6.1"))).toEqual({
      current: "0.6.0",
      latest: "0.6.1",
      url: "https://github.com/CGG888/headplane/releases/latest",
    });

    expect(selfUpdateNotice("0.6.1", latest("v0.6.1"))).toBeUndefined();
    expect(selfUpdateNotice("0.7.0", latest("v0.6.1"))).toBeUndefined();
  });

  test("never nags a development or custom build", () => {
    expect(selfUpdateNotice("dev", latest("v0.6.1"))).toBeUndefined();
    expect(
      selfUpdateNotice("v0.0.0-20260703052708-048308511c72", latest("v0.6.1")),
    ).toBeUndefined();
  });

  test("renders nothing when the lookup failed or the tag was unusable", () => {
    expect(selfUpdateNotice("0.6.0", undefined)).toBeUndefined();
    expect(selfUpdateNotice("0.6.0", latest("nightly"))).toBeUndefined();
  });

  test("looks up Headplane's own repository", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v0.6.1" }),
    } as unknown as Response);

    const checker = createReleaseChecker({
      url: HEADPLANE_RELEASES_URL,
      label: "Headplane",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect((await checker.latest())?.raw).toBe("v0.6.1");
    expect(HEADPLANE_RELEASES_URL).toBe(
      "https://api.github.com/repos/CGG888/headplane/releases/latest",
    );
    expect(fetchImpl.mock.calls[0][0]).toBe(HEADPLANE_RELEASES_URL);
  });
});
