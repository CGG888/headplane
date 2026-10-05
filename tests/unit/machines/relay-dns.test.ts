import { describe, expect, test } from "vitest";

import {
  buildRelayView,
  classifyRelayHost,
  createRelayResolver,
  loadRelayResolution,
  RELAY_DNS_CACHE_TTL_MS,
  RELAY_DNS_MAX_ADDRESSES,
  RELAY_DNS_TIMEOUT_MS,
  type RelayResolution,
  type RelayResolverOptions,
} from "~/server/relay-dns";

interface DnsCall {
  hostname: string;
}

interface StubAnswers {
  ipv4: string[] | Error;
  ipv6: string[] | Error;
  /** Reject when the resolver aborts the lookup, as `node:dns` does. */
  abortable?: boolean;
}

/**
 * A resolver whose DNS entry points are stubs, so no test ever touches the
 * network. Every lookup is logged so cache and coalescing behaviour is visible.
 */
function stubResolver(overrides: Partial<RelayResolverOptions> = {}) {
  const log: DnsCall[] = [];
  let answers: StubAnswers = { ipv4: [], ipv6: [] };

  const answer = (
    family: keyof Pick<StubAnswers, "ipv4" | "ipv6">,
    hostname: string,
    signal: AbortSignal,
  ): Promise<string[]> => {
    log.push({ hostname });
    if (answers.abortable) {
      // Mirrors `node:dns`, which rejects a lookup that is aborted: the
      // resolver's own deadline is what settles this case.
      return new Promise<string[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(dnsError("ABORT_ERR")), { once: true });
      });
    }

    const value = answers[family];
    return Promise.resolve().then(() => {
      if (value instanceof Error) {
        throw value;
      }

      return value;
    });
  };

  const resolver = createRelayResolver({
    cacheTtlMs: 1_000,
    timeoutMs: 20,
    ...overrides,
    resolve4: overrides.resolve4 ?? ((hostname, signal) => answer("ipv4", hostname, signal)),
    resolve6: overrides.resolve6 ?? ((hostname, signal) => answer("ipv6", hostname, signal)),
  });

  return {
    resolver,
    log,
    setAnswers(next: Partial<StubAnswers>) {
      answers = { ipv4: [], ipv6: [], ...next };
    },
  };
}

function dnsError(code: string): Error {
  return Object.assign(new Error(`queryA ${code}`), { code });
}

describe("classifyRelayHost", () => {
  test("passes a bracketed IPv6 literal through without a lookup", () => {
    expect(classifyRelayHost("[2001:db8::1]")).toEqual({ kind: "literal", host: "[2001:db8::1]" });
  });

  test("lowercases a hostname so the cache key is stable", () => {
    expect(classifyRelayHost(" Derp.Example.COM ")).toEqual({
      kind: "hostname",
      host: "derp.example.com",
    });
  });

  test("reports empty and malformed hosts as invalid", () => {
    expect(classifyRelayHost(undefined)).toEqual({ kind: "invalid", host: "" });
    expect(classifyRelayHost("   ")).toEqual({ kind: "invalid", host: "" });
    expect(classifyRelayHost("2001:db8::1")).toEqual({ kind: "invalid", host: "2001:db8::1" });
    expect(classifyRelayHost("[not-an-address]")).toEqual({
      kind: "invalid",
      host: "[not-an-address]",
    });
    expect(classifyRelayHost("derp example.com")).toEqual({
      kind: "invalid",
      host: "derp example.com",
    });
  });
});

describe("relay DNS resolution", () => {
  test("never looks up a bracketed IPv6 literal", async () => {
    const stub = stubResolver();
    const result = await stub.resolver.resolve("[2001:db8::1]");

    expect(result).toEqual({ host: "[2001:db8::1]", kind: "literal", ipv4: [], ipv6: [] });
    expect(stub.log).toEqual([]);
  });

  test("resolves both families for a hostname", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: ["198.51.100.7"], ipv6: ["2001:db8::7"] });
    const result = await stub.resolver.resolve("derp.example.com");

    expect(result).toEqual({
      host: "derp.example.com",
      kind: "hostname",
      ipv4: ["198.51.100.7"],
      ipv6: ["2001:db8::7"],
    });
    expect(result.reason).toBeUndefined();
    expect(stub.log.map((call) => call.hostname)).toEqual(["derp.example.com", "derp.example.com"]);
  });

  test("keeps the family that answers when the other one has no records", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: dnsError("ENOTFOUND"), ipv6: ["2001:db8::9"] });
    const result = await stub.resolver.resolve("v6.example.com");

    expect(result.ipv4).toEqual([]);
    expect(result.ipv6).toEqual(["2001:db8::9"]);
    expect(result.reason).toBeUndefined();
  });

  test("trims real records and caps what one family may return", async () => {
    const many = Array.from(
      { length: RELAY_DNS_MAX_ADDRESSES + 4 },
      (_, index) => `10.0.0.${index}`,
    );
    const stub = stubResolver();
    stub.setAnswers({ ipv4: [" 198.51.100.7 ", ...many] });
    const result = await stub.resolver.resolve("many.example.com");

    expect(result.ipv4).toHaveLength(RELAY_DNS_MAX_ADDRESSES);
    expect(result.ipv4[0]).toBe("198.51.100.7");
  });

  test("a name with no records is a result with a reason, never a throw", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: dnsError("ENOTFOUND"), ipv6: dnsError("ENODATA") });
    const result = await stub.resolver.resolve("nx.example.com");

    expect(result.reason).toBe("no-records");
    expect(result.detail).toMatchObject({ ipv4Empty: true, ipv6Empty: true });
    expect(result.ipv4).toEqual([]);
    expect(result.ipv6).toEqual([]);
  });

  test("a resolver failure is reported as a resolver error", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: dnsError("ESERVFAIL"), ipv6: dnsError("ESERVFAIL") });
    const result = await stub.resolver.resolve("broken.example.com");

    expect(result.reason).toBe("resolver-error");
    expect(result.detail?.failed).toBe(true);
  });

  test("a lookup that outlives the deadline reports a timeout", async () => {
    const stub = stubResolver({ timeoutMs: 10 });
    stub.setAnswers({ ipv4: [], ipv6: [], abortable: true });
    const result = await stub.resolver.resolve("slow.example.com");

    expect(result.reason).toBe("timeout");
    expect(result.detail?.timedOut).toBe(true);
  });

  test("a DNS error that carries no code still fails soft", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: new Error("getaddrinfo EAI_FAIL"), ipv6: [] });
    const result = await stub.resolver.resolve("weird.example.com");

    expect(result.reason).toBe("resolver-error");
  });

  test("caches a hostname answer until the ttl expires", async () => {
    let now = 1_000;
    const stub = stubResolver({ cacheTtlMs: 1_000, now: () => now });
    stub.setAnswers({ ipv4: ["198.51.100.7"] });

    const first = await stub.resolver.resolve("cache.example.com");
    const second = await stub.resolver.resolve("cache.example.com");
    expect(stub.log).toHaveLength(2);
    expect(second).toEqual(first);

    now += 1_001;
    const third = await stub.resolver.resolve("cache.example.com");
    expect(stub.log).toHaveLength(4);
    expect(third.ipv4).toEqual(["198.51.100.7"]);
  });

  test("caches a negative answer but not a timeout", async () => {
    const noRecords = stubResolver();
    noRecords.setAnswers({ ipv4: dnsError("ENOTFOUND"), ipv6: dnsError("ENOTFOUND") });
    await noRecords.resolver.resolve("empty.example.com");
    await noRecords.resolver.resolve("empty.example.com");
    expect(noRecords.log).toHaveLength(2);

    const timedOut = stubResolver({ timeoutMs: 10 });
    timedOut.setAnswers({ ipv4: [], ipv6: [], abortable: true });
    await timedOut.resolver.resolve("slow.example.com");
    await timedOut.resolver.resolve("slow.example.com");
    expect(timedOut.log).toHaveLength(4);
  });

  test("coalesces concurrent lookups for the same hostname", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: ["198.51.100.7"] });

    const [a, b] = await Promise.all([
      stub.resolver.resolve("same.example.com"),
      stub.resolver.resolve("same.example.com"),
    ]);

    expect(a).toEqual(b);
    expect(stub.log).toHaveLength(2);
  });

  test("clearCache forces the next render to look the host up again", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: ["198.51.100.7"] });
    await stub.resolver.resolve("cache.example.com");
    stub.resolver.clearCache();
    await stub.resolver.resolve("cache.example.com");
    expect(stub.log).toHaveLength(4);
  });

  test("the real resolver defaults stay short and cache for minutes", async () => {
    expect(RELAY_DNS_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
    expect(RELAY_DNS_CACHE_TTL_MS).toBeGreaterThanOrEqual(60_000);

    const resolver = createRelayResolver();
    await expect(resolver.resolve("[2001:db8::1]")).resolves.toMatchObject({ kind: "literal" });
    await expect(resolver.resolve("not a host")).resolves.toMatchObject({
      reason: "invalid-host",
    });
    await expect(resolver.resolve("")).resolves.toMatchObject({ reason: "host-missing" });
  });
});

describe("loadRelayResolution", () => {
  test("returns a resolution and never throws for a broken host", async () => {
    const stub = stubResolver();
    stub.setAnswers({ ipv4: dnsError("ENOTFOUND"), ipv6: dnsError("ENOTFOUND") });

    const result = await loadRelayResolution(stub.resolver, "nx.example.com");
    expect(result?.reason).toBe("no-records");

    const missing = await loadRelayResolution(stub.resolver, undefined);
    expect(missing?.reason).toBe("host-missing");
    expect(missing?.kind).toBe("literal");
  });

  test("returns undefined when the resolver itself rejects", async () => {
    const broken = {
      resolve: () => Promise.reject(new Error("boom")),
      clearCache: () => {},
    };

    await expect(loadRelayResolution(broken, "derp.example.com")).resolves.toBeUndefined();
  });
});

describe("buildRelayView", () => {
  const endpoint = { host: "derp.example.com", port: 443 };

  test("keeps the configured endpoint as the headline", () => {
    const view = buildRelayView(endpoint, undefined);
    expect(view.host).toEqual({
      hostname: "derp.example.com",
      port: 443,
      endpoint: "derp.example.com:443",
    });
    expect(view.address).toBeUndefined();
  });

  test("lists the resolved families that have addresses", () => {
    const resolution: RelayResolution = {
      host: "derp.example.com",
      kind: "hostname",
      ipv4: ["198.51.100.7"],
      ipv6: ["2001:db8::7"],
    };

    expect(buildRelayView(endpoint, resolution).address?.rows).toEqual([
      { family: "ipv4", addresses: ["198.51.100.7"] },
      { family: "ipv6", addresses: ["2001:db8::7"] },
    ]);
  });

  test("carries the reason when no family resolved", () => {
    const resolution: RelayResolution = {
      host: "nx.example.com",
      kind: "hostname",
      ipv4: [],
      ipv6: [],
      reason: "timeout",
      detail: { timedOut: true, ipv4Empty: true, ipv6Empty: true },
    };

    const view = buildRelayView({ host: "nx.example.com", port: 8443 }, resolution);
    expect(view.address?.rows).toEqual([]);
    expect(view.address?.reason).toBe("timeout");
    expect(view.host?.endpoint).toBe("nx.example.com:8443");
  });

  test("says why there is no endpoint when server_url cannot be read", () => {
    expect(buildRelayView(undefined, undefined).endpointReason).toBe("invalid-host");
    expect(buildRelayView({ host: "  ", port: 443 }, undefined).endpointReason).toBe(
      "host-missing",
    );
  });
});
