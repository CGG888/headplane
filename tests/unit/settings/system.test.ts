import { describe, expect, test, vi } from "vitest";

import {
  computeDiagnostics,
  integrationAction,
  isBehindProxy,
  isNewerVersion,
  type Diagnostic,
  type DiagnosticsInput,
} from "~/routes/settings/system/diagnostics";
import {
  createReleaseChecker,
  DEFAULT_RELEASE_MIRRORS,
  RELEASE_MIRROR_ENV,
  RELEASES_URL,
  releaseMirrorPrefixes,
} from "~/routes/settings/system/release-check";
import { authContext, headscaleContext, integrationContext } from "~/server/context";
import { parseServerVersion } from "~/server/headscale/api/server-version";

// The release checker and the action log failures; keep the test output clean.
vi.mock("~/utils/log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    debugEnabled: false,
  },
}));

function healthy(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    reachable: true,
    apiKey: "valid",
    version: parseServerVersion("0.29.2"),
    configReadable: true,
    configWritable: true,
    policyMode: "database",
    oidc: "configured",
    trustedProxies: 1,
    behindProxy: true,
    integrationName: "Docker",
    ...overrides,
  };
}

function status(diagnostics: Diagnostic[], id: Diagnostic["id"]) {
  return diagnostics.find((entry) => entry.id === id)?.status;
}

function check(diagnostics: Diagnostic[], id: Diagnostic["id"]) {
  const found = diagnostics.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Missing diagnostic: ${id}`);
  }

  return found;
}

describe("system diagnostics", () => {
  test("a fully healthy server passes every check", () => {
    const diagnostics = computeDiagnostics(healthy());

    expect(diagnostics.map((entry) => entry.id)).toEqual([
      "reachable",
      "apiKey",
      "version",
      "policyMode",
      "oidc",
      "trustedProxies",
      "configAccess",
      "integration",
    ]);
    expect(diagnostics.every((entry) => entry.status === "pass")).toBe(true);
  });

  test("reports Headscale as a failure when /health does not answer", () => {
    const diagnostics = computeDiagnostics(healthy({ reachable: false }));
    const reachable = check(diagnostics, "reachable");

    expect(reachable.status).toBe("fail");
    expect(reachable.bodyKey).toBe("settings.system.checks.reachable.fail");
    expect(reachable.link).toBeUndefined();
  });

  test("keys the version check off the features Headplane documents", () => {
    const tooOld = check(
      computeDiagnostics(healthy({ version: parseServerVersion("0.27.1") })),
      "version",
    );
    expect(tooOld.status).toBe("fail");
    expect(tooOld.vars).toEqual({ version: "0.27.1", minimum: "0.28.0" });

    // 0.28 works, but browser SSH only works from 0.29.2.
    for (const version of ["0.28.0", "0.29.0", "0.29.1"]) {
      const entry = check(
        computeDiagnostics(healthy({ version: parseServerVersion(version) })),
        "version",
      );
      expect(entry.status, version).toBe("warning");
      expect(entry.bodyKey, version).toBe("settings.system.checks.version.recommended");
      expect(entry.vars, version).toEqual({ version, recommended: "0.29.2" });
    }

    for (const version of ["0.29.2", "0.30.0"]) {
      expect(
        check(computeDiagnostics(healthy({ version: parseServerVersion(version) })), "version")
          .status,
        version,
      ).toBe("pass");
    }
  });

  test("never nags an untagged development build", () => {
    const diagnostics = computeDiagnostics(
      healthy({ version: parseServerVersion("v0.0.0-20260703052708-048308511c72") }),
    );

    expect(status(diagnostics, "version")).toBe("pass");
    expect(isNewerVersion(parseServerVersion("dev"), parseServerVersion("v0.29.2"))).toBe(false);
  });

  test("distinguishes an invalid API key from an unverifiable one", () => {
    const invalid = check(computeDiagnostics(healthy({ apiKey: "invalid" })), "apiKey");
    expect(invalid.status).toBe("fail");
    expect(invalid.bodyKey).toBe("settings.system.checks.apiKey.invalid");

    const unknown = check(computeDiagnostics(healthy({ apiKey: "unknown" })), "apiKey");
    expect(unknown.status).toBe("warning");
    expect(unknown.bodyKey).toBe("settings.system.checks.apiKey.unknown");
  });

  test("warns when the ACL policy lives in a file and links to the settings page", () => {
    const entry = check(computeDiagnostics(healthy({ policyMode: "file" })), "policyMode");

    expect(entry.status).toBe("warning");
    expect(entry.bodyKey).toBe("settings.system.checks.policyMode.file");
    expect(entry.link?.to).toBe("/settings/headscale");
  });

  test("does not warn about a proxy when Headplane is not behind one", () => {
    const direct = check(
      computeDiagnostics(healthy({ behindProxy: false, trustedProxies: 0 })),
      "trustedProxies",
    );
    expect(direct.status).toBe("pass");

    const proxied = check(
      computeDiagnostics(healthy({ behindProxy: true, trustedProxies: 0 })),
      "trustedProxies",
    );
    expect(proxied.status).toBe("warning");
    expect(proxied.link?.to).toBe("/settings/headscale");

    const configured = check(
      computeDiagnostics(healthy({ behindProxy: true, trustedProxies: 2 })),
      "trustedProxies",
    );
    expect(configured.status).toBe("pass");
  });

  test("treats an unreadable config file as a failure, not as missing OIDC", () => {
    const diagnostics = computeDiagnostics(
      healthy({ configReadable: false, configWritable: false, oidc: "unknown" }),
    );

    const config = check(diagnostics, "configAccess");
    expect(config.status).toBe("fail");
    expect(config.bodyKey).toBe("settings.system.checks.configAccess.unreadable");

    const policy = check(diagnostics, "policyMode");
    expect(policy.status).toBe("warning");
    expect(policy.bodyKey).toBe("settings.system.checks.policyMode.unknown");
  });

  test("warns about a read-only config file but still passes the OIDC check", () => {
    const diagnostics = computeDiagnostics(healthy({ configWritable: false }));
    const config = check(diagnostics, "configAccess");

    expect(config.status).toBe("warning");
    expect(config.bodyKey).toBe("settings.system.checks.configAccess.readOnly");
    expect(status(diagnostics, "oidc")).toBe("pass");
  });

  test("reports missing OIDC and a missing integration as warnings", () => {
    const diagnostics = computeDiagnostics(
      healthy({ oidc: "missing", integrationName: undefined }),
    );

    expect(status(diagnostics, "oidc")).toBe("warning");
    expect(check(diagnostics, "oidc").link?.to).toBe("/settings/headscale");

    const integration = check(diagnostics, "integration");
    expect(integration.status).toBe("warning");
    expect(integration.bodyKey).toBe("settings.system.checks.integration.missing");
  });

  test("names the integration in the explanation", () => {
    const entry = check(
      computeDiagnostics(healthy({ integrationName: "Native Linux (/proc)" })),
      "integration",
    );

    expect(entry.status).toBe("pass");
    expect(entry.vars).toEqual({ name: "Native Linux (/proc)" });
  });

  test("detects a reverse proxy from the forwarding headers", () => {
    const headers = (values: Record<string, string>) => ({
      get: (name: string) => values[name] ?? null,
    });

    expect(isBehindProxy(headers({ "x-forwarded-for": "10.0.0.1" }))).toBe(true);
    expect(isBehindProxy(headers({ "x-forwarded-proto": "https" }))).toBe(true);
    expect(isBehindProxy(headers({ forwarded: "for=10.0.0.1" }))).toBe(true);
    expect(isBehindProxy(headers({ host: "headplane.example.com" }))).toBe(false);
  });

  test("labels the process action per integration semantics", () => {
    expect(integrationAction("Native Linux (/proc)")).toBe("reload");
    expect(integrationAction("Docker")).toBe("restart");
    expect(integrationAction("Kubernetes (k8s)")).toBe("restart");
  });

  test("only reports an update when the release is strictly newer", () => {
    const newer = (running: string, latest: string) =>
      isNewerVersion(parseServerVersion(running), parseServerVersion(latest));

    expect(newer("0.29.1", "v0.29.2")).toBe(true);
    expect(newer("0.29.2", "v0.29.2")).toBe(false);
    expect(newer("0.29.2", "v0.29.2-beta.1")).toBe(false);
    expect(newer("0.30.0", "v0.29.2")).toBe(false);
    expect(newer("0.29.2", "v0.30.0-rc.1")).toBe(true);
    expect(newer("0.29.2", "dev")).toBe(false);
  });
});

describe("headscale release check", () => {
  /** GitHub answers `releases/latest` with a 302 whose Location holds the tag. */
  function redirectResponse(location: string, status = 302) {
    return {
      ok: false,
      status,
      url: RELEASES_URL,
      headers: { get: (name: string) => (name === "location" ? location : null) },
      text: () => Promise.resolve(""),
    } as unknown as Response;
  }

  function errorResponse(status: number) {
    return {
      ok: false,
      status,
      url: RELEASES_URL,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
    } as unknown as Response;
  }

  /** Some mirrors answer with the API payload instead of the redirect. */
  function jsonResponse(payload: unknown, status = 200) {
    return {
      ok: status < 400,
      status,
      url: RELEASES_URL,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as Response;
  }

  /** Others follow the redirect and hand back the release page itself. */
  function pageResponse(html: string, status = 200, url = RELEASES_URL) {
    return {
      ok: status < 400,
      status,
      url,
      headers: { get: () => null },
      text: () => Promise.resolve(html),
    } as unknown as Response;
  }

  function releaseTag(tag: string) {
    return `https://github.com/juanfont/headscale/releases/tag/${tag}`;
  }

  test("reads the latest release tag from the redirect", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectResponse(releaseTag("v0.29.2")));
    const checker = createReleaseChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const latest = await checker.latest();
    expect(latest?.raw).toBe("v0.29.2");
    expect(latest?.minor).toBe(29);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // The HTML endpoint is asked for the redirect itself, never for the API.
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(RELEASES_URL);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  test("fails soft on a blocked network, a bad status, and an unusable answer", async () => {
    const blocked = createReleaseChecker({
      mirrors: [],
      fetchImpl: vi
        .fn()
        .mockRejectedValue(
          new Error("getaddrinfo ENOTFOUND github.com"),
        ) as unknown as typeof fetch,
    });
    expect(await blocked.latest()).toBeUndefined();

    // "API rate limit exceeded" is a 403 with no Location to read.
    const refused = createReleaseChecker({
      mirrors: [],
      fetchImpl: vi.fn().mockResolvedValue(errorResponse(403)) as unknown as typeof fetch,
    });
    expect(await refused.latest()).toBeUndefined();

    // A redirect that does not point at a tag is just as useless.
    const notATag = createReleaseChecker({
      mirrors: [],
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          redirectResponse("https://github.com/juanfont/headscale/releases"),
        ) as unknown as typeof fetch,
    });
    expect(await notATag.latest()).toBeUndefined();

    const unusable = createReleaseChecker({
      mirrors: [],
      fetchImpl: vi
        .fn()
        .mockResolvedValue(redirectResponse(releaseTag("nightly"))) as unknown as typeof fetch,
    });
    expect(await unusable.latest()).toBeUndefined();

    // A mirror that also refuses leaves the page without a version.
    const allBlocked = createReleaseChecker({
      mirrors: ["https://mirror.example/"],
      fetchImpl: vi.fn().mockRejectedValue(new Error("fetch failed")) as unknown as typeof fetch,
    });
    expect(await allBlocked.latest()).toBeUndefined();
  });

  test("caches a hit and shares one request between concurrent callers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectResponse(releaseTag("v0.29.2")));
    const checker = createReleaseChecker({
      mirrors: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [first, second] = await Promise.all([checker.latest(), checker.latest()]);
    expect(first?.raw).toBe("v0.29.2");
    expect(second?.raw).toBe("v0.29.2");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A page reload within the cache window does not talk to GitHub again.
    await checker.latest();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("retries a failure sooner than a success", async () => {
    let now = 1_000;
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(redirectResponse(releaseTag("v0.29.2")));
    const checker = createReleaseChecker({
      mirrors: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      successTtlMs: 6 * 60 * 60 * 1000,
      failureTtlMs: 60_000,
      now: () => now,
    });

    expect(await checker.latest()).toBeUndefined();
    expect(await checker.latest()).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 61_000;
    expect((await checker.latest())?.raw).toBe("v0.29.2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("falls back to a mirror when github.com is unreachable", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND github.com"))
      .mockResolvedValue(redirectResponse(releaseTag("v0.29.2")));
    const checker = createReleaseChecker({
      mirrors: ["https://mirror.example/"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect((await checker.latest())?.raw).toBe("v0.29.2");

    // The original address is still asked first; the mirror is the fallback.
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(RELEASES_URL);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(`https://mirror.example/${RELEASES_URL}`);
  });

  test("reads the tag out of the API payload a mirror serves", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(errorResponse(403))
      .mockResolvedValueOnce(jsonResponse({ tag_name: "v0.29.4" }));
    const checker = createReleaseChecker({
      mirrors: ["https://mirror.example/"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect((await checker.latest())?.raw).toBe("v0.29.4");
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      "https://mirror.example/https://api.github.com/repos/juanfont/headscale/releases/latest",
    );
  });

  test("scans the page a mirror hands back instead of a redirect", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        pageResponse('<a href="/juanfont/headscale/releases/tag/v0.29.4">v0.29.4</a>'),
      );
    const checker = createReleaseChecker({
      mirrors: ["https://mirror.example/"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect((await checker.latest())?.raw).toBe("v0.29.4");
  });

  test("tries the route that worked first on the next lookup", async () => {
    const calls: string[] = [];
    let now = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      calls.push(input);
      if (input === RELEASES_URL) {
        throw new Error("offline");
      }

      return redirectResponse(releaseTag("v0.29.2"));
    });
    const checker = createReleaseChecker({
      mirrors: ["https://mirror.example/"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      successTtlMs: 1_000,
    });

    expect((await checker.latest())?.raw).toBe("v0.29.2");
    expect(calls).toEqual([RELEASES_URL, `https://mirror.example/${RELEASES_URL}`]);

    now += 2_000;
    expect((await checker.latest())?.raw).toBe("v0.29.2");
    expect(calls[2]).toBe(`https://mirror.example/${RELEASES_URL}`);
  });

  test("takes the mirror list from the environment", () => {
    expect(releaseMirrorPrefixes({})).toEqual(DEFAULT_RELEASE_MIRRORS);
    expect(releaseMirrorPrefixes({ [RELEASE_MIRROR_ENV]: "https://my.example" })).toEqual([
      "https://my.example/",
    ]);
    expect(
      releaseMirrorPrefixes({ [RELEASE_MIRROR_ENV]: "https://a.example/, https://b.example/" }),
    ).toEqual(["https://a.example/", "https://b.example/"]);
    expect(releaseMirrorPrefixes({ [RELEASE_MIRROR_ENV]: "off" })).toEqual([]);
  });
});

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

async function submit(options: {
  allowed?: boolean;
  integration?: { name: string; onConfigChange: (headscale: unknown) => unknown } | undefined;
  actionId?: string;
}) {
  const { systemAction } = await import("~/routes/settings/system/actions");

  const headscale = { health: () => Promise.resolve(true) };
  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          require: () => Promise.resolve({ id: 1 }),
          can: () => options.allowed ?? true,
        };
      }
      if (key === headscaleContext) {
        return headscale;
      }
      if (key === integrationContext) {
        return options.integration;
      }
      return undefined;
    },
  };

  const formData = new FormData();
  formData.set("action_id", options.actionId ?? "process_config_change");

  let result: ActionResult;
  try {
    result = (await systemAction({
      request: mockRequest(formData),
      context,
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    // A 403 comes back as a thrown data() payload with the same shape.
    result = thrown as ActionResult;
  }

  return result;
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

describe("system process action", () => {
  test("asks the integration to reload Headscale exactly once", async () => {
    const onConfigChange = vi.fn().mockResolvedValue({ ok: true, stage: "healthy" });
    const result = await submit({ integration: { name: "Native Linux (/proc)", onConfigChange } });

    expect(statusOf(result)).toBe(200);
    expect(result.data).toEqual({ success: true, reload: { stage: "healthy" } });
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  test("surfaces the stage a refused reload stopped at", async () => {
    const onConfigChange = vi.fn().mockResolvedValue({ ok: false, stage: "permission" });
    const result = await submit({ integration: { name: "Docker", onConfigChange } });

    expect(statusOf(result)).toBe(502);
    expect(result.data).toMatchObject({
      success: false,
      errorCode: "reloadFailed",
      reloadStage: "permission",
    });
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  test("refuses without the IAM capability", async () => {
    const onConfigChange = vi.fn();
    const result = await submit({
      allowed: false,
      integration: { name: "Docker", onConfigChange },
    });

    expect(statusOf(result)).toBe(403);
    expect((result.data as { localized: { key: string } }).localized.key).toBe(
      "errors.permission.modifyIam",
    );
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  test("explains that no integration is available", async () => {
    const result = await submit({ integration: undefined });

    expect(statusOf(result)).toBe(409);
    expect((result.data as { errorCode: string }).errorCode).toBe("notAvailable");
  });

  test("rejects an unknown action without touching the integration", async () => {
    const onConfigChange = vi.fn();
    const result = await submit({
      actionId: "restart_everything",
      integration: { name: "Docker", onConfigChange },
    });

    expect(statusOf(result)).toBe(400);
    expect((result.data as { errorCode: string }).errorCode).toBe("invalidAction");
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  test("reports an integration that cannot reach Headscale", async () => {
    const onConfigChange = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const result = await submit({ integration: { name: "Docker", onConfigChange } });

    expect(statusOf(result)).toBe(502);
    expect((result.data as { errorCode: string }).errorCode).toBe("failed");
    // A throw is not a staged refusal, so there is no stage to show.
    expect((result.data as { reloadStage?: string }).reloadStage).toBeUndefined();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });
});
