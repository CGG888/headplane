import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { translate } from "~/i18n";
import { DATA_BACKUP_ERROR_KEYS } from "~/routes/settings/snapshots/error-keys";
import { appConfigContext, authContext } from "~/server/context";
import {
  createDataBackup,
  DataBackupError,
  dataBackupFileName,
  headplaneDatabasePath,
  isDataBackupError,
} from "~/server/snapshots/data-backup.server";
import { capsForRole, hasCapability, type Role } from "~/server/web/roles";

const MAGIC = "SQLite format 3";
const BACKUP_AT = new Date("2026-10-05T14:52:19.000Z");

let temp: string;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "hp-data-backup-"));
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** A real SQLite database, so the backup API runs against a real file. */
async function createDatabase(path: string, rows = 3): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("create table t (id integer primary key, name text)");
    const insert = db.prepare("insert into t (name) values (?)");
    for (let index = 0; index < rows; index += 1) {
      insert.run(`row-${index}`);
    }
  } finally {
    db.close();
  }
}

function countRows(path: string): number {
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare("select count(*) as total from t").get() as { total: number };
    return row.total;
  } finally {
    db.close();
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await delay(20);
  }

  throw new Error("the condition was not met in time");
}

describe("data backup file name", () => {
  test("stamps the download in UTC", () => {
    expect(dataBackupFileName(BACKUP_AT)).toBe("headplane-data-20261005-145219.sqlite");
  });

  test("points at Headplane's database inside the data directory", () => {
    expect(headplaneDatabasePath("/var/lib/headplane")).toBe(
      resolve("/var/lib/headplane", "hp_persist.db"),
    );
  });
});

describe("consistent database copy", () => {
  test("copies the live database and deletes the temporary file", async () => {
    const backups = join(temp, "backups");
    await mkdir(backups, { recursive: true });
    const dbPath = join(temp, "data", "hp_persist.db");
    await createDatabase(dbPath);

    // A second connection writing to the same file is exactly what a raw file
    // copy cannot survive, and what SQLite's backup API is for.
    const live = new DatabaseSync(dbPath);
    live.exec("insert into t (name) values ('while-copying')");

    const backup = await createDataBackup({
      dbPath,
      directory: backups,
      clock: () => BACKUP_AT,
    });
    live.close();

    try {
      expect(backup.fileName).toBe("headplane-data-20261005-145219.sqlite");
      expect(backup.path.startsWith(backups)).toBe(true);
      expect(backup.size).toBeGreaterThan(0);

      const content = await readFile(backup.path);
      expect(content.byteLength).toBe(backup.size);
      expect(content.subarray(0, MAGIC.length).toString("utf8")).toBe(MAGIC);
      expect(countRows(backup.path)).toBe(4);
    } finally {
      await backup.dispose();
    }

    expect(existsSync(backup.path)).toBe(false);
    await expect(readdir(backups)).resolves.toEqual([]);

    // Disposing twice is safe: the route might clean up on both paths.
    await expect(backup.dispose()).resolves.toBeUndefined();
  });

  test("streams the copy and removes the temporary file afterwards", async () => {
    const backups = join(temp, "backups");
    await mkdir(backups, { recursive: true });
    const dbPath = join(temp, "data", "hp_persist.db");
    await createDatabase(dbPath);

    const backup = await createDataBackup({ dbPath, directory: backups });
    const body = Buffer.from(await new Response(backup.stream()).arrayBuffer());

    expect(body.byteLength).toBe(backup.size);
    expect(body.subarray(0, MAGIC.length).toString("utf8")).toBe(MAGIC);

    await waitFor(async () => (await readdir(backups)).length === 0);
    expect(existsSync(backup.path)).toBe(false);
  });

  test("removes the temporary file when the copy fails", async () => {
    const backups = join(temp, "backups");
    await mkdir(backups, { recursive: true });
    const garbage = join(temp, "not-a-database.db");
    await writeFile(garbage, "this is not a sqlite database", "utf8");

    const failure = await createDataBackup({ dbPath: garbage, directory: backups }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isDataBackupError(failure)).toBe(true);
    expect(failure).toBeInstanceOf(DataBackupError);
    expect(failure).toMatchObject({ code: "copyFailed" });

    await expect(readdir(backups)).resolves.toEqual([]);
  });

  test("never creates a database that is missing", async () => {
    const backups = join(temp, "backups");
    await mkdir(backups, { recursive: true });
    const missing = join(temp, "absent", "hp_persist.db");

    const failure = createDataBackup({ dbPath: missing, directory: backups });
    await expect(failure).rejects.toMatchObject({ code: "copyFailed" });

    expect(existsSync(missing)).toBe(false);
    await expect(readdir(backups)).resolves.toEqual([]);
  });

  test("reports a temporary location it cannot use", async () => {
    const dbPath = join(temp, "data", "hp_persist.db");
    await createDatabase(dbPath);

    await expect(
      createDataBackup({ dbPath, directory: join(temp, "does-not-exist") }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

interface ThrownResult {
  data?: { localized?: { key: string } };
  init?: { status?: number } | null;
}

interface LoaderOptions {
  role?: Role;
  dataPath?: string;
}

interface LoaderCall {
  response?: Response;
  thrown?: ThrownResult;
}

/**
 * Calls the real resource route with the real role table: a role only passes
 * the gate when it holds the whole capability, exactly like the auth service.
 */
async function callLoader(options: LoaderOptions = {}): Promise<LoaderCall> {
  const { loader } = await import("~/routes/settings/snapshots/data-backup");

  const role = options.role ?? "admin";
  const capabilities = capsForRole(role);
  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          require: () =>
            Promise.resolve({
              kind: "oidc",
              sessionId: "session",
              user: { id: "1", subject: "alice", role, headscaleUserId: undefined },
              profile: { name: "Alice" },
            }),
          can: (_principal: unknown, capability: number) =>
            (capability & capabilities) === capability,
        };
      }

      if (key === appConfigContext) {
        return { server: { data_path: options.dataPath ?? temp } };
      }

      return undefined;
    },
  };

  try {
    const response = (await loader({
      request: new Request("http://localhost/settings/snapshots/data-backup"),
      context,
      params: {},
    } as never)) as Response;
    return { response };
  } catch (thrown) {
    return { thrown: thrown as ThrownResult };
  }
}

describe("data backup download route", () => {
  test("streams Headplane's database as a timestamped attachment", async () => {
    const dataPath = join(temp, "data");
    await createDatabase(join(dataPath, "hp_persist.db"), 2);
    const before = await readdir(tmpdir());

    const { response } = await callLoader({ role: "admin", dataPath });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(response?.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="headplane-data-\d{8}-\d{6}\.sqlite"$/,
    );

    const body = Buffer.from((await response?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(body.byteLength).toBe(Number(response?.headers.get("Content-Length")));
    expect(body.subarray(0, MAGIC.length).toString("utf8")).toBe(MAGIC);

    // The copy is temporary: nothing of ours is left in the temp directory.
    await waitFor(async () => (await readdir(tmpdir())).every((entry) => before.includes(entry)));
  });

  test.for(["viewer", "auditor", "network_admin", "member"] as const)(
    "refuses to download for a role that cannot write snapshots (%s)",
    async (role) => {
      const dataPath = join(temp, "data");
      await createDatabase(join(dataPath, "hp_persist.db"));

      expect(hasCapability(role, "configure_iam")).toBe(false);

      const { thrown, response } = await callLoader({ role, dataPath });
      expect(response).toBeUndefined();
      expect(thrown?.init?.status).toBe(403);
      expect(thrown?.data?.localized?.key).toBe("errors.permission.modifyIam");

      // A refused request never even copies the database.
      await expect(readdir(dataPath)).resolves.toEqual(["hp_persist.db"]);
    },
  );

  test.for(["owner", "admin", "it_admin"] as const)(
    "allows the roles that write snapshots (%s)",
    async (role) => {
      const dataPath = join(temp, "data");
      await createDatabase(join(dataPath, "hp_persist.db"));

      expect(hasCapability(role, "configure_iam")).toBe(true);

      const { response } = await callLoader({ role, dataPath });
      expect(response?.status).toBe(200);

      const body = Buffer.from((await response?.arrayBuffer()) ?? new ArrayBuffer(0));
      expect(body.subarray(0, MAGIC.length).toString("utf8")).toBe(MAGIC);
    },
  );

  test("localizes a database that cannot be copied", async () => {
    const { thrown } = await callLoader({ role: "admin", dataPath: join(temp, "absent") });

    expect(thrown?.init?.status).toBe(500);
    expect(thrown?.data?.localized?.key).toBe("settings.snapshots.dataBackup.errors.copyFailed");
  });

  test("every failure key is translated in each locale", () => {
    for (const locale of ["en", "zh-Hans", "zh-Hant"] as const) {
      for (const key of Object.values(DATA_BACKUP_ERROR_KEYS)) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });
});
