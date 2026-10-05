// MARK: Relay DNS server store
//
// The DNS servers used for relay lookups are Headplane state, not Headscale
// configuration, so they live in a JSON document under Headplane's `data_path`
// instead of the database: no schema change and no migration. An empty list is
// the default and means "follow the host's system resolver", which is what
// Headplane did before the setting existed.
//
// Following `alerts/store.ts` and `derp-region-names.ts`, reads are defensive (a
// missing or corrupt document degrades to "no servers") and writes go through a
// temp file plus rename so a crash never leaves a half-written document behind.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  MAX_RELAY_DNS_SERVERS,
  normalizeRelayDnsServers,
} from "~/routes/settings/headscale/relay-dns-servers";
import log from "~/utils/log";

/** File under Headplane's `server.data_path`. */
export const RELAY_DNS_SERVERS_FILE = "relay-dns-servers.json";

export interface RelayDnsServersDocument {
  servers: string[];
}

/** `<data_path>/relay-dns-servers.json` — the file the editor reads and writes. */
export function relayDnsServersPath(dataPath: string): string {
  return resolve(dataPath, RELAY_DNS_SERVERS_FILE);
}

/** The default document: no servers, so lookups follow the system resolver. */
export function emptyRelayDnsServersDocument(): RelayDnsServersDocument {
  return { servers: [] };
}

/**
 * Parses the stored document. A bare array is accepted for a hand-written file,
 * because the list is the whole document; anything unusable parses as empty.
 */
export function parseRelayDnsServersDocument(
  raw: string | undefined | null,
): RelayDnsServersDocument {
  if (!raw) {
    return emptyRelayDnsServersDocument();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRelayDnsServersDocument();
  }

  if (parsed === null || typeof parsed !== "object") {
    return emptyRelayDnsServersDocument();
  }

  const source = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).servers;
  return { servers: normalizeRelayDnsServers(source) };
}

/** Stable, human-editable JSON with a trailing newline. */
export function serializeRelayDnsServersDocument(document: RelayDnsServersDocument): string {
  return `${JSON.stringify(
    { servers: normalizeRelayDnsServers(document.servers).slice(0, MAX_RELAY_DNS_SERVERS) },
    null,
    2,
  )}\n`;
}

/** Reads the list; a missing, unreadable or corrupt file reads as empty. */
export async function readRelayDnsServers(dataPath: string): Promise<string[]> {
  try {
    return parseRelayDnsServersDocument(await readFile(relayDnsServersPath(dataPath), "utf8"))
      .servers;
  } catch {
    return [];
  }
}

let tempCounter = 0;

/**
 * Writes the list atomically (temp file plus rename). Returns false instead of
 * throwing, because the settings card surfaces the failure as a localized form
 * error and an unwritable data directory must not break the page.
 */
export async function writeRelayDnsServers(
  dataPath: string,
  servers: readonly string[],
): Promise<boolean> {
  const path = relayDnsServersPath(dataPath);
  const temp = `${path}.${process.pid}.${tempCounter++}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, serializeRelayDnsServersDocument({ servers: [...servers] }), "utf8");
    await rename(temp, path);
    return true;
  } catch (error) {
    log.warn("config", "Unable to save the relay DNS servers: %s", String(error));
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}
