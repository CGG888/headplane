import { describe, expect, test } from "vitest";

import {
  buildRelayView,
  classifyRelayHost,
  compareRelayAddress,
  compareRelayAddresses,
  createRelayResolver,
  loadRelayResolution,
  RELAY_DNS_CACHE_TTL_MS,
  RELAY_DNS_MAX_ADDRESSES,
  RELAY_DNS_TIMEOUT_MS,
  relayVerdictIsNoteworthy,
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
      // No DNS servers are configured, so the host's resolver did the work.
      resolver: "system",
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

describe("compareRelayAddress", () => {
  function hostname(answers: Partial<RelayResolution>): RelayResolution {
    return { host: "derp.example.com", kind: "hostname", ipv4: [], ipv6: [], ...answers };
  }

  test("matches a declared address that resolves for either family", () => {
    const resolution = hostname({ ipv4: ["198.51.100.7"], ipv6: ["2001:db8::7"] });

    expect(compareRelayAddress("ipv4", "198.51.100.7", resolution).verdict).toBe("matches");
    expect(compareRelayAddress("ipv6", "2001:db8::7", resolution).verdict).toBe("matches");
  });

  test("reports a stale declaration that is not among the resolved addresses", () => {
    const resolution = hostname({ ipv4: ["198.51.100.7"], ipv6: ["2001:db8::7"] });

    expect(compareRelayAddress("ipv4", "198.51.100.9", resolution)).toEqual({
      family: "ipv4",
      declared: "198.51.100.9",
      resolved: ["198.51.100.7"],
      verdict: "declared-but-not-resolved",
    });

    expect(compareRelayAddress("ipv6", "2001:db8::9", resolution).verdict).toBe(
      "declared-but-not-resolved",
    );
  });

  test("compares IPv6 spellings by expanding them", () => {
    const resolution = hostname({ ipv6: ["2001:0db8:0000:0000:0000:0000:0000:0007"] });
    expect(compareRelayAddress("ipv6", " 2001:DB8::7 ", resolution).verdict).toBe("matches");

    const padded = hostname({ ipv4: ["198.51.100.007"] });
    expect(compareRelayAddress("ipv4", "198.51.100.7", padded).verdict).toBe("matches");
  });

  test("separates a family with no records from one that resolved", () => {
    const resolution = hostname({
      ipv4: ["198.51.100.7"],
      reason: undefined,
    });

    expect(compareRelayAddress("ipv6", "2001:db8::7", resolution)).toMatchObject({
      declared: "2001:db8::7",
      resolved: [],
      verdict: "no-records",
    });
    // Nothing is declared for IPv4, so the answer it did give cannot contradict.
    expect(compareRelayAddress("ipv4", undefined, resolution).verdict).toBe("matches");
  });

  test("a lookup that did not complete is unavailable, not missing", () => {
    const timedOut = hostname({ reason: "timeout", detail: { timedOut: true } });
    expect(compareRelayAddress("ipv6", "2001:db8::7", timedOut).verdict).toBe(
      "resolver-unavailable",
    );

    const failed = hostname({ reason: "resolver-error", detail: { failed: true } });
    expect(compareRelayAddress("ipv4", "198.51.100.7", failed).verdict).toBe(
      "resolver-unavailable",
    );

    // The resolver itself never answered at all.
    expect(compareRelayAddress("ipv6", "2001:db8::7", undefined).verdict).toBe(
      "resolver-unavailable",
    );
  });

  test("says the host is missing when server_url names no usable host", () => {
    const missing = hostname({ reason: "host-missing" });
    expect(compareRelayAddress("ipv4", "198.51.100.7", missing)).toMatchObject({
      verdict: "host-missing",
    });

    const invalid = hostname({ reason: "invalid-host" });
    expect(compareRelayAddress("ipv6", "2001:db8::7", invalid).verdict).toBe("host-missing");

    // An unusable server_url comes back in the literal shape with a reason, and
    // must not be mistaken for an endpoint that really is an address.
    const unusable: RelayResolution = {
      host: "",
      kind: "literal",
      ipv4: [],
      ipv6: [],
      reason: "host-missing",
    };
    expect(compareRelayAddress("ipv6", "2001:db8::7", unusable)).toMatchObject({
      verdict: "host-missing",
      resolved: [],
    });
  });

  test("treats a literal endpoint as matching itself", () => {
    const literal: RelayResolution = {
      host: "[2001:db8::1]",
      kind: "literal",
      ipv4: [],
      ipv6: [],
    };

    expect(compareRelayAddress("ipv6", "2001:0db8::1", literal)).toEqual({
      family: "ipv6",
      declared: "2001:0db8::1",
      resolved: [],
      verdict: "matches",
    });
    // A literal cannot answer the other family, and with nothing declared the
    // verdict only says the endpoint is an address.
    expect(compareRelayAddress("ipv4", "198.51.100.7", literal).verdict).toBe(
      "declared-but-not-resolved",
    );
    expect(compareRelayAddress("ipv6", undefined, literal).verdict).toBe("literal");
    expect(compareRelayAddress("ipv6", "2001:db8::9", literal).verdict).toBe(
      "declared-but-not-resolved",
    );
  });

  test("returns both families for a card", () => {
    const resolution = hostname({ ipv4: ["198.51.100.7"], ipv6: ["2001:db8::7"] });
    expect(
      compareRelayAddresses({ ipv4: "198.51.100.7", ipv6: "2001:db8::9" }, resolution).map(
        (entry) => [entry.family, entry.verdict],
      ),
    ).toEqual([
      ["ipv4", "matches"],
      ["ipv6", "declared-but-not-resolved"],
    ]);

    expect(compareRelayAddresses(undefined, resolution).map((entry) => entry.declared)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("only a verdict worth reading is printed next to a row", () => {
    const resolution = hostname({ ipv4: ["198.51.100.7"] });

    // A declaration makes every verdict meaningful.
    expect(relayVerdictIsNoteworthy(compareRelayAddress("ipv4", "198.51.100.7", resolution))).toBe(
      true,
    );
    expect(relayVerdictIsNoteworthy(compareRelayAddress("ipv6", undefined, resolution))).toBe(
      false,
    );

    // Without one, only the verdicts the row cannot already show.
    const noLookup = compareRelayAddress("ipv6", undefined, undefined);
    expect(relayVerdictIsNoteworthy(noLookup)).toBe(true);
    const literal: RelayResolution = { host: "[2001:db8::1]", kind: "literal", ipv4: [], ipv6: [] };
    expect(relayVerdictIsNoteworthy(compareRelayAddress("ipv6", undefined, literal))).toBe(true);
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

  test("adds the declared-versus-resolved comparison only when asked", () => {
    const resolution: RelayResolution = {
      host: "derp.example.com",
      kind: "hostname",
      ipv4: ["198.51.100.7"],
      ipv6: [],
    };

    expect(buildRelayView(endpoint, resolution).address?.comparisons).toBeUndefined();

    const compared = buildRelayView(endpoint, resolution, {
      ipv4: "198.51.100.7",
      ipv6: "2001:db8::7",
    });
    expect(compared.address?.comparisons).toEqual([
      {
        family: "ipv4",
        declared: "198.51.100.7",
        resolved: ["198.51.100.7"],
        verdict: "matches",
      },
      { family: "ipv6", declared: "2001:db8::7", resolved: [], verdict: "no-records" },
    ]);
    // The rows the card renders are unchanged by the comparison.
    expect(compared.address?.rows).toEqual([{ family: "ipv4", addresses: ["198.51.100.7"] }]);
  });

  test("keeps saying why when the lookup never ran", () => {
    const view = buildRelayView(endpoint, undefined, { ipv6: "2001:db8::7" });
    expect(view.address?.rows).toEqual([]);
    expect(view.address?.reason).toBeUndefined();
    expect(view.address?.comparisons?.[1]).toMatchObject({ verdict: "resolver-unavailable" });

    expect(buildRelayView(endpoint, undefined).address).toBeUndefined();
  });

  test("says why there is no endpoint when server_url cannot be read", () => {
    expect(buildRelayView(undefined, undefined).endpointReason).toBe("invalid-host");
    expect(buildRelayView({ host: "  ", port: 443 }, undefined).endpointReason).toBe(
      "host-missing",
    );
  });
});
