import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

import log from "~/utils/log";

export async function createDbClient(path: string) {
  const realPath = resolve(path);
  try {
    await mkdir(dirname(realPath), { recursive: true });
  } catch (error) {
    log.error(
      "server",
      "Failed to create directory for database at %s: %s",
      realPath,
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(`Could not create directory for database at ${realPath}`);
  }

  const db = drizzle(realPath);
  migrate(db, {
    migrationsFolder: "./drizzle",
  });

  // The audit log and the OIDC ID token of the console login live in this file,
  // and SQLite creates it with the process umask (0644 on most systems), so any
  // local account could read it. The login store already writes 0600; align the
  // database with it. A failure here is not fatal — the file is still usable.
  try {
    await chmod(realPath, 0o600);
  } catch (error) {
    log.warn(
      "server",
      "Failed to restrict the database permissions at %s: %s",
      realPath,
      error instanceof Error ? error.message : String(error),
    );
  }

  return db;
}
