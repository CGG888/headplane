import { describe, expect, test } from "vitest";

import {
  createRelayQueryTarget,
  createRelayResolver,
  reResolveRelayHost,
  relayResolutionSuggestsConfiguredResolver,
  type RelayLookup,
  type RelayQueryTarget,
  type RelayResolution,
} from "~/server/relay-dns";

function dnsError(code: string): Error {
  return Object.assign(new Error(`queryA ${code}`), { code });
}

interface StubTargetLog {
  servers: string[];
  hosts: string[];
}

/**
 * A resolver whose lookups are stubs, so no test touches the network. The target
 * factory records the servers each lookup was bound to, which is how the tests
 * see whether the system resolver or the configured one did the work.
 */
function stubResolver(
  options: {
    servers?: readonly string[] | (() => Promise<string[]> | readonly string[]);
    ipv4?: string[] | Error;
    ipv6?: string[] | Error;
    cacheTtlMs?: number;
  } = {},
) {
  const calls: StubTargetLog[] = [];

  const answer =
    (value: string[] | Error): RelayLookup =>
    (hostname) => {
      calls[calls.length - 1]?.hosts.push(hostname);
      return Promise.resolve().then(() => {
        if (value instanceof Error) {
          throw value;
        }

        return value;
      });
    };

  const createTarget = (servers: string[]): RelayQueryTarget => {
    calls.push({ servers, hosts: [] });
    return {
      resolver: servers.length === 0 ? "system" : "configured",
      servers,
      resolve4: answer(options.ipv4 ?? []),
      resolve6: answer(options.ipv6 ?? []),
    };
  };

  const resolver = createRelayResolver({
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    createTarget,
    ...(options.servers === undefined ? {} : { servers: options.servers }),
  });

  return { resolver, calls };
}

describe("createRelayQueryTarget", () => {
  test("an empty list keeps the lookups the caller already had", () => {
    const fallback = { resolve4: () => Promise.resolve([]), resolve6: () => Promise.resolve([]) };
    const target = createRelayQueryTarget([], fallback);

    expect(target).toEqual({ resolver: "system", servers: [], ...fallback });
  });

  test("a configured list is bound to a resolver of its own", () => {
    const target = createRelayQueryTarget(["1.1.1.1", "[2606:4700:4700::1111]:53"]);

    expect(target.resolver).toBe("configured");
    expect(target.servers).toEqual(["1.1.1.1", "[2606:4700:4700::1111]:53"]);
  });
});

describe("configured resolver", () => {
  test("an unset list still resolves through the system resolver path", async () => {
    const stub = stubResolver({ ipv4: ["198.51.100.7"] });
    const result = await stub.resolver.resolve("derp.example.com");

    expect(stub.calls.map((call) => call.servers)).toEqual([[]]);
    expect(stub.calls[0].hosts).toEqual(["derp.example.com", "derp.example.com"]);
    expect(result).toEqual({
      host: "derp.example.com",
      kind: "hostname",
      ipv4: ["198.51.100.7"],
      ipv6: [],
      resolver: "system",
    });
  });

  test("an empty or unusable list falls back to the system resolver", async () => {
    const empty = stubResolver({ servers: [] });
    await empty.resolver.resolve("derp.example.com");
    expect(empty.calls.map((call) => call.servers)).toEqual([[]]);

    const garbage = stubResolver({ servers: ["not-an-ip", "1.1.1.1:0"] });
    const result = await garbage.resolver.resolve("derp.example.com");
    expect(garbage.calls.map((call) => call.servers)).toEqual([[]]);
    expect(result?.resolver).toBe("system");
  });

  test("a configured list is used for the lookup and reported on the answer", async () => {
    const stub = stubResolver({
      servers: ["1.1.1.1", "9.9.9.9"],
      ipv4: ["198.51.100.7"],
      ipv6: ["2001:db8::7"],
    });
    const result = await stub.resolver.resolve("Derp.Example.COM");

    expect(stub.calls.map((call) => call.servers)).toEqual([["1.1.1.1", "9.9.9.9"]]);
    expect(result).toEqual({
      host: "derp.example.com",
      kind: "hostname",
      ipv4: ["198.51.100.7"],
      ipv6: ["2001:db8::7"],
      resolver: "configured",
      servers: ["1.1.1.1", "9.9.9.9"],
    });
  });

  test("a failing configured resolver is reported, never hidden by a fallback", async () => {
    const failed = stubResolver({ servers: ["1.1.1.1"], ipv4: dnsError("ESERVFAIL") });
    const result = await failed.resolver.resolve("derp.example.com");

    expect(result?.reason).toBe("resolver-error");
    expect(result?.resolver).toBe("configured");
    expect(result?.servers).toEqual(["1.1.1.1"]);
    // The system resolver is never consulted behind the operator's back.
    expect(failed.calls.map((call) => call.servers)).toEqual([["1.1.1.1"]]);
  });

  test("changing the list never serves the previous resolver's answer", async () => {
    let servers = ["1.1.1.1"];
    const calls: string[][] = [];
    const resolver = createRelayResolver({
      cacheTtlMs: 60_000,
      servers: () => servers,
      createTarget: (list) => {
        calls.push(list);
        return {
          resolver: list.length === 0 ? "system" : "configured",
          servers: list,
          resolve4: () => Promise.resolve(["198.51.100.7"]),
          resolve6: () => Promise.resolve([]),
        };
      },
    });

    expect((await resolver.resolve("derp.example.com"))?.resolver).toBe("configured");
    servers = [];
    expect((await resolver.resolve("derp.example.com"))?.resolver).toBe("system");
    expect(calls).toEqual([["1.1.1.1"], []]);
  });
});

describe("reResolveRelayHost", () => {
  test("clears the cache and looks the name up again", async () => {
    let answer: string[] = [];
    let lookups = 0;
    const resolver = createRelayResolver({
      cacheTtlMs: 5 * 60_000,
      resolve4: () => {
        lookups++;
        return Promise.resolve(answer);
      },
      resolve6: () => Promise.resolve([]),
    });

    // An empty answer is cached, exactly like the negative answer it stands for.
    const cached = await resolver.resolve("derp.example.com");
    expect(cached?.reason).toBe("no-records");
    expect(await resolver.resolve("derp.example.com")).toEqual(cached);
    expect(lookups).toBe(1);

    // A fixed DNS server shows up at once instead of five minutes later.
    answer = ["198.51.100.7"];
    const refreshed = await reResolveRelayHost(resolver, "derp.example.com");
    expect(refreshed?.ipv4).toEqual(["198.51.100.7"]);
    expect(refreshed?.reason).toBeUndefined();
    expect(lookups).toBe(2);
  });

  test("still reports an unusable host without a lookup", async () => {
    const stub = stubResolver();
    await expect(reResolveRelayHost(stub.resolver, undefined)).resolves.toMatchObject({
      reason: "host-missing",
    });
    expect(stub.calls).toEqual([]);
  });
});

describe("relayResolutionSuggestsConfiguredResolver", () => {
  const empty: RelayResolution = {
    host: "derp.example.com",
    kind: "hostname",
    ipv4: ["198.51.100.7"],
    ipv6: [],
    resolver: "system",
  };

  test("is true only for an empty family the system resolver answered", () => {
    expect(relayResolutionSuggestsConfiguredResolver(empty, "ipv6")).toBe(true);
    expect(relayResolutionSuggestsConfiguredResolver(empty, "ipv4")).toBe(false);
    expect(
      relayResolutionSuggestsConfiguredResolver({ ...empty, resolver: "configured" }, "ipv6"),
    ).toBe(false);
    expect(relayResolutionSuggestsConfiguredResolver(undefined, "ipv6")).toBe(false);
    expect(
      relayResolutionSuggestsConfiguredResolver({ ...empty, ipv6: ["2001:db8::7"] }, "ipv6"),
    ).toBe(false);
  });
});
