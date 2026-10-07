import { access, constants, readFile, realpath, stat, writeFile } from "node:fs/promises";

import log from "~/utils/log";

export interface DNSRecord {
  type: "A" | "AAAA" | (string & {});
  name: string;
  value: string;
}

// This class is solely for DNS records that are out of tree in the main
// Headscale config file. If you are using dns.extra_records_path, it will
// be managed here and not in the main config file.
//
// All DNS insertions and deletions are handled by the main config manager,
// but are passed through to here if the extra file is being used.
export class HeadscaleDNSConfig {
  private records: DNSRecord[];
  private access: "rw" | "ro" | "no";
  private path?: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(access: "rw" | "ro" | "no", records?: DNSRecord[], path?: string) {
    this.access = access;
    this.records = records ?? [];
    this.path = path;
  }

  readable() {
    return this.access !== "no";
  }

  writable() {
    return this.access === "rw";
  }

  get r() {
    return this.records;
  }

  async patch(records: DNSRecord[]) {
    if (!this.path || !this.readable() || !this.writable()) {
      return;
    }

    this.records = records;
    log.debug("config", "Patching DNS records (%d -> %d)", this.records.length, records.length);

    return this.write();
  }

  private async write() {
    if (!this.path || !this.writable()) {
      return;
    }

    const path = this.path;

    // Writes are serialized on a promise chain instead of a busy-wait lock.
    // The old `while (this.writeLock) await setTimeout(100)` loop leaked the
    // lock whenever writeFile rejected (ENOSPC, EACCES, the path becoming a
    // directory), after which every later patch spun forever without ever
    // returning.
    const write = this.writeQueue.then(async () => {
      log.debug("config", "Writing updated DNS configuration to %s", path);
      const data = JSON.stringify(this.records, null, 4);
      try {
        await writeFile(path, data);
      } catch (error) {
        log.error("config", "Failed to write the Headscale DNS file at %s", path);
        log.error("config", "%s", error);
        throw error;
      }
    });

    this.writeQueue = write.catch(() => undefined);
    return write;
  }
}

export async function loadHeadscaleDNS(path?: string) {
  if (!path) {
    return;
  }

  log.debug("config", "Loading Headscale DNS configuration file: %s", path);
  const { w, r } = await validateConfigPath(path);
  if (!r) {
    return new HeadscaleDNSConfig("no");
  }

  const records = await loadConfigFile(path);
  if (!records) {
    return new HeadscaleDNSConfig("no");
  }

  return new HeadscaleDNSConfig(w ? "rw" : "ro", records, path);
}

async function validateConfigPath(path: string) {
  let resolved: string;

  try {
    // Resolve symlinks first. A symlink is accepted, but the target has to be a
    // regular file: a directory (or a symlink to one) where the JSON records
    // file is required must be rejected instead of reaching `readFile`.
    resolved = await realpath(path);
    const info = await stat(resolved);
    if (!info.isFile()) {
      log.error("config", "Unable to read a Headscale DNS file at %s", path);
      log.error("config", "The path is not a regular file: %s", resolved);
      return { w: false, r: false };
    }

    await access(resolved, constants.F_OK | constants.R_OK);
    log.info("config", "Found a valid Headscale DNS file at %s", path);
  } catch (error) {
    log.error("config", "Unable to read a Headscale DNS file at %s", path);
    log.error("config", "%s", error);
    return { w: false, r: false };
  }

  try {
    await access(resolved, constants.F_OK | constants.W_OK);
    return { w: true, r: true };
  } catch {
    log.warn("config", "Headscale DNS file at %s is not writable", path);
    return { w: false, r: true };
  }
}

async function loadConfigFile(path: string) {
  log.debug("config", "Reading Headscale DNS file at %s", path);
  let parsed: unknown;
  try {
    const data = await readFile(path, "utf8");
    parsed = JSON.parse(data);
  } catch (e) {
    log.error("config", "Error reading Headscale DNS file at %s", path);
    log.error("config", "%s", e);
    return false;
  }

  // The file must be a JSON array of `{ type, name, value }` records. Anything
  // else means the file is not the one we wrote (a wrapper object, a bare
  // number, entries missing fields). Treat it as unreadable instead of
  // accepting it: the old code only guarded against null/undefined, so an
  // object or number reached `.some`/iteration and threw a 500 on the next
  // DNS edit, and a partial shape would have been silently rewritten.
  if (!Array.isArray(parsed)) {
    log.error("config", "Headscale DNS file at %s is not a JSON array of records", path);
    return false;
  }

  const records: DNSRecord[] = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      log.error("config", "Headscale DNS file at %s contains a non-object record", path);
      return false;
    }

    const { type, name, value } = entry as Record<string, unknown>;
    if (typeof type !== "string" || typeof name !== "string" || typeof value !== "string") {
      log.error(
        "config",
        "Headscale DNS file at %s contains a record without string type/name/value",
        path,
      );
      return false;
    }

    records.push({ type, name, value });
  }

  return records;
}
