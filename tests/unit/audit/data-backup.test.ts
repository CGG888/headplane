import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createDataBackup, isDataBackupError } from "~/server/snapshots/data-backup.server";

let temp: string;
let databasePath: string;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "hp-data-backup-"));
  databasePath = join(temp, "hp_persist.db");

  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE audit_log (id TEXT PRIMARY KEY, detail TEXT NOT NULL)");
  database.exec("INSERT INTO audit_log VALUES ('1', 'hskey-api-secret')");
  database.close();
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe("createDataBackup", () => {
  test("copies the database under a timestamped name", async () => {
    const backup = await createDataBackup({ dbPath: databasePath, directory: temp });

    expect(backup.fileName).toMatch(/^headplane-data-\d{8}-\d{6}\.sqlite$/);
    expect(backup.size).toBeGreaterThan(0);
    expect((await stat(backup.path)).size).toBe(backup.size);

    await backup.dispose();
  });

  test("disposes the copy once the stream has been read to the end", async () => {
    const backup = await createDataBackup({ dbPath: databasePath, directory: temp });
    const reader = backup.stream().getReader();

    for (;;) {
      const { done } = await reader.read();
      if (done) {
        break;
      }
    }

    await vi.waitFor(async () => {
      await expect(stat(backup.path)).rejects.toThrow();
    });
  });

  test("disposes the copy when the reader cancels the download", async () => {
    const backup = await createDataBackup({ dbPath: databasePath, directory: temp });
    const reader = backup.stream().getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(
      Buffer.from(first.value ?? [])
        .subarray(0, 15)
        .toString(),
    ).toBe("SQLite format 3");

    await reader.cancel();

    await vi.waitFor(async () => {
      await expect(stat(backup.path)).rejects.toThrow();
    });
  });

  test("dispose is idempotent and leaves the source database alone", async () => {
    const backup = await createDataBackup({ dbPath: databasePath, directory: temp });

    await backup.dispose();
    await backup.dispose();

    await expect(stat(backup.path)).rejects.toThrow();
    await expect(stat(databasePath)).resolves.toBeDefined();
  });

  test("reports a missing source database as a copy failure", async () => {
    const failure = await createDataBackup({
      dbPath: join(temp, "absent.db"),
      directory: temp,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDataBackupError(failure)).toBe(true);
    if (isDataBackupError(failure)) {
      expect(failure.code).toBe("copyFailed");
    }
  });
});
