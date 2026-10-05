import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  MAX_RELAY_DNS_SERVERS,
  normalizeRelayDnsServers,
  parseRelayDnsServer,
} from "~/routes/settings/headscale/relay-dns-servers";
import {
  RELAY_DNS_SERVERS_FILE,
  parseRelayDnsServersDocument,
  readRelayDnsServers,
  relayDnsServersPath,
  serializeRelayDnsServersDocument,
  writeRelayDnsServers,
} from "~/server/relay-dns-store";

describe("relay DNS server validation", () => {
  test("accepts the forms node:dns takes and canonicalizes them", () => {
    expect(parseRelayDnsServer("1.1.1.1")).toBe("1.1.1.1");
    expect(parseRelayDnsServer(" 1.1.1.1:5353 ")).toBe("1.1.1.1:5353");
    expect(parseRelayDnsServer("01.1.1.1")).toBe("1.1.1.1");
    expect(parseRelayDnsServer("2606:4700:4700::1111")).toBe("2606:4700:4700::1111");
    expect(parseRelayDnsServer("2606:4700:4700:0:0:0:0:1111")).toBe("2606:4700:4700::1111");
    // Node also takes a bracketed literal, with or without a port; the list
    // stores the shortest spelling that resolves to the same server.
    expect(parseRelayDnsServer("[2606:4700:4700::1111]")).toBe("2606:4700:4700::1111");
    expect(parseRelayDnsServer("[2606:4700:4700::1111]:53")).toBe("[2606:4700:4700::1111]:53");
    expect(parseRelayDnsServer("::1")).toBe("::1");
    expect(parseRelayDnsServer("::ffff:1.2.3.4")).toBe("::ffff:102:304");
  });

  test("rejects anything that is not a literal address with an optional port", () => {
    expect(parseRelayDnsServer("")).toBeUndefined();
    expect(parseRelayDnsServer("   ")).toBeUndefined();
    expect(parseRelayDnsServer("dns.example.com")).toBeUndefined();
    expect(parseRelayDnsServer("1.1.1.1:")).toBeUndefined();
    expect(parseRelayDnsServer("1.1.1.1:0")).toBeUndefined();
    expect(parseRelayDnsServer("1.1.1.1:65536")).toBeUndefined();
    expect(parseRelayDnsServer("1.1.1.1:abc")).toBeUndefined();
    expect(parseRelayDnsServer("999.1.1.1")).toBeUndefined();
    expect(parseRelayDnsServer("[2606:4700::1111")).toBeUndefined();
    expect(parseRelayDnsServer("[2606:4700::1111]:0")).toBeUndefined();
    expect(parseRelayDnsServer("10.0.0.0/8")).toBeUndefined();
    expect(parseRelayDnsServer("2606:4700::1111:zz")).toBeUndefined();
    // IPv4 with one port too many must not become an IPv6 address.
    expect(parseRelayDnsServer("1.1.1.1:53:54")).toBeUndefined();
    expect(parseRelayDnsServer("[1.1.1.1:53]")).toBeUndefined();
    expect(parseRelayDnsServer("two words")).toBeUndefined();
  });

  test("cleans a list: empty, one, several, garbage dropped, duplicates collapsed", () => {
    expect(normalizeRelayDnsServers([])).toEqual([]);
    expect(normalizeRelayDnsServers(undefined)).toEqual([]);
    expect(normalizeRelayDnsServers("1.1.1.1")).toEqual([]);
    expect(normalizeRelayDnsServers(["1.1.1.1"])).toEqual(["1.1.1.1"]);
    expect(normalizeRelayDnsServers(["1.1.1.1", "9.9.9.9", "2606:4700:4700::1111"])).toEqual([
      "1.1.1.1",
      "9.9.9.9",
      "2606:4700:4700::1111",
    ]);
    expect(normalizeRelayDnsServers(["1.1.1.1", "not-an-ip", 12, null, "1.1.1.1"])).toEqual([
      "1.1.1.1",
    ]);
  });

  test("stops at the documented limit so a hand-edited file stays bounded", () => {
    const many = Array.from({ length: 12 }, (_, index) => `10.0.0.${index + 1}`);
    expect(normalizeRelayDnsServers(many)).toHaveLength(MAX_RELAY_DNS_SERVERS);
    expect(MAX_RELAY_DNS_SERVERS).toBeLessThanOrEqual(8);
  });
});

describe("relay DNS server document", () => {
  test("round-trips a list and keeps only usable entries", () => {
    const raw = serializeRelayDnsServersDocument({
      servers: ["1.1.1.1", "not-an-ip", "[2606:4700:4700::1111]:53"],
    });

    expect(raw.endsWith("\n")).toBe(true);
    expect(parseRelayDnsServersDocument(raw)).toEqual({
      servers: ["1.1.1.1", "[2606:4700:4700::1111]:53"],
    });
  });

  test("reads an empty list for a missing, corrupt or unexpected document", () => {
    expect(parseRelayDnsServersDocument(undefined)).toEqual({ servers: [] });
    expect(parseRelayDnsServersDocument("")).toEqual({ servers: [] });
    expect(parseRelayDnsServersDocument("{not json")).toEqual({ servers: [] });
    expect(parseRelayDnsServersDocument("null")).toEqual({ servers: [] });
    expect(parseRelayDnsServersDocument('"a string"')).toEqual({ servers: [] });
    expect(parseRelayDnsServersDocument('{"servers":"1.1.1.1"}')).toEqual({ servers: [] });
    // A hand-written bare array is the same document.
    expect(parseRelayDnsServersDocument('["1.1.1.1"]')).toEqual({ servers: ["1.1.1.1"] });
  });
});

describe("relay DNS server file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-relay-dns-servers-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lives in the data directory under a fixed name", () => {
    expect(RELAY_DNS_SERVERS_FILE).toBe("relay-dns-servers.json");
    expect(relayDnsServersPath(dir)).toBe(join(dir, RELAY_DNS_SERVERS_FILE));
  });

  test("round-trips a list through an atomic write", async () => {
    expect(await writeRelayDnsServers(dir, ["1.1.1.1", "9.9.9.9"])).toBe(true);

    // The temp file is renamed into place, so only the target remains.
    expect(await readdir(dir)).toEqual([RELAY_DNS_SERVERS_FILE]);
    expect(await readRelayDnsServers(dir)).toEqual(["1.1.1.1", "9.9.9.9"]);

    const raw = await readFile(join(dir, RELAY_DNS_SERVERS_FILE), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  test("an empty list is the default and replaces a stored one", async () => {
    expect(await readRelayDnsServers(dir)).toEqual([]);
    await writeRelayDnsServers(dir, ["1.1.1.1"]);
    await writeRelayDnsServers(dir, []);

    expect(await readRelayDnsServers(dir)).toEqual([]);
    expect(await readdir(dir)).toEqual([RELAY_DNS_SERVERS_FILE]);
  });

  test("a corrupt file reads as no servers instead of throwing", async () => {
    await writeFile(join(dir, RELAY_DNS_SERVERS_FILE), "{ not json", "utf8");
    expect(await readRelayDnsServers(dir)).toEqual([]);
  });

  test("an unwritable data directory reports failure instead of throwing", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    expect(await writeRelayDnsServers(blocker, ["1.1.1.1"])).toBe(false);
    expect(await readRelayDnsServers(blocker)).toEqual([]);
  });
});
